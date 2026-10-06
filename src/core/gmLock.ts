/**
 * GMLock —— 跨页面互斥锁（双后端：Web Locks 浏览器原生互斥 / GM 存储租约自动降级）
 *
 * 双后端架构：
 * - Web Locks（navigator.locks 经 unsafeWindow，webLock.ts）：浏览器进程内单点仲裁，
 *   同名锁任意时刻至多一个持有者——「双页同帧 acquire 双胜出」「复核后 await 间失锁」
 *   数学上不存在；页面关闭/崩溃锁自动释放，无需 TTL/心跳/租约三件套。同步 acquire
 *   消费预取窗口（acquireReady 异步预取，webLock.ts 详注），窗口未就绪退回 GM 后端
 * - GM 存储租约（原实现）：Web Locks 不可用（secure context 外的管理器剥离等）时的降级路径，
 *   「最后写入者胜出 + 动作前复核」模型，TTL/心跳/租约全套保留
 *
 * GM 后端语义（沿用）：
 * - 防重复接管：抢占时若锁被他人持有且租约未过期则拒绝；只有持有者能 renew() 续期
 * - 防未接管：租约超时后任何页面都能重新抢占；心跳失联/页面关闭后租约自然过期
 * - 无延迟等待：acquireWait() 同时监听 GM 存储事件（释放立即唤醒）与租约到期定时器
 * - 内部心跳：acquireWithHeartbeat() 把续期内聚到锁自身；失去锁时心跳自动停止
 *
 * 依赖：Web Locks API（后台探测）；GM API：GM_getValue/GM_setValue/GM_listValues/
 * GM_deleteValue（acquireWait 额外使用 GM_addValueChangeListener/GM_removeValueChangeListener）
 */

import { isWebLockSupported, verifyWebLockSupported, webLockVerdict, WebLock } from './webLock'

/** 锁值结构：存储在 GM 存储中 */
export interface GMLockValue {
    /** 持有者唯一标识（页面实例级，如 UUID） */
    owner: string
    /** 租约到期时间戳（毫秒） */
    expires: number
}

/**
 * GMLock 使用场景的通用预制 TTL（毫秒）——按「续期模式」归纳场景共性，而非按具体业务：
 *
 * 场景模型（三类）：
 * 1. 短任务互斥（ShortTask）：单次短操作的锁，持锁到完成、不续期。
 *    TTL = 单次操作的最坏耗时；崩溃后恢复快，适合高频短互斥。
 * 2. 批处理迭代（BatchTask）：长任务由多个迭代组成，每个迭代顶部 renew() 续期。
 *    TTL = 单次迭代的最坏耗时（须大于迭代内最长的 await 链）。
 * 3. 守护心跳（DaemonTask）：无限期后台常驻任务，固定心跳 renew()（间隔≈TTL/3）。
 *    TTL 必须大于浏览器后台标签页定时器节流上限（约 60s），
 *    否则被节流时心跳失联会被误判过期。
 *
 * 同一场景的锁直接引用本枚举；新锁找不到匹配场景时再扩展成员。
 */
export enum GMLockTTL {
    /** 短任务互斥：不续期，TTL 覆盖单次操作最坏耗时（如单视频下载推送） */
    ShortTask = 60_000,
    /** 批处理迭代：每次迭代顶部续期（如批量解析下载、全局页面遍历） */
    BatchTask = 60_000,
    /** 批处理迭代·慢迭代：单次迭代可能超过 60s（如订阅页大页解析、慢网） */
    BatchTaskSlow = 120_000,
    /** 守护心跳：心跳≈TTL/3，须大于后台标签页节流上限约 60s（如 aria2 任务管理器） */
    DaemonTask = 75_000
}

export class GMLock {
    /** GM 存储键前缀，便于 GM_listValues 遍历与清理 */
    private static readonly PREFIX = 'GMLock:'

    private readonly owner: string

    /** 各锁名的内部心跳定时器，由 release()/失去锁时清理 */
    private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>()

    /** Web Locks 后端（浏览器原生互斥，跨后端单例）与各锁名的后端选项 */
    private static readonly webLock = new WebLock('GMLock')
    private static readonly useWebLock = new Map<string, boolean>()
    /** 各锁键的 web 预取窗口状态：'granted' = 浏览器预取裁决曾空闲；'denied' = 被他人持有 */
    private static readonly webAcquireState = new Map<string, 'granted' | 'denied'>()

    /** 实例级 web 持有标志：name → true（acquire granted 置位；release/TOCTOU 夺回清除） */
    private readonly held = new Map<string, boolean>()

    /**
     * @param owner 持有者唯一标识（同一页面内应保持一致，如 UUID）。
     * 仅 GM 存储后端使用；Web Locks 后端由浏览器进程仲裁，不含调用方标识。
     */
    constructor(owner: string) {
        this.owner = owner
    }

    private static key(name: string): string {
        return GMLock.PREFIX + name
    }

    /** 锁名对应后端：先读定格缓存；锁定后启动一次运行时验证，验证结论（false）
     * 会覆盖乐观的属性探测（ScriptCat 实测：locks 属性存在但 request 不可用）。 */
    private backend(name: string): 'web' | 'gm' {
        if (!GMLock.useWebLock.has(name)) GMLock.useWebLock.set(name, webLockVerdict())
        return GMLock.useWebLock.get(name) ? 'web' : 'gm'
    }

    /** 运行时后端验证（一次）：验证结论为 gm 时重置全部锁名定格，让后续判定走 GM 后端。
     * 由 acquireAsync / acquireWaitWithHeartbeat 等异步路径首调触发 */
    private static reverifyPromise: Promise<void> | undefined
    private reverifyBackend(): Promise<void> {
        GMLock.reverifyPromise ??= verifyWebLockSupported().then((ok) => {
            if (!ok) GMLock.useWebLock.clear()
        })
        return GMLock.reverifyPromise
    }

    /**
     * 异步获取锁（web 后端全路径，异步调用方优先用此方法）：
     * 预取（peek 落窗口）→ 同步 acquire 消费窗口并 fire-and-forget 真实持有 → isHeld 复核。
     * 一气呵成，消除「同步 acquire 首次调用窗口未就绪而降级 GM 后端」的窗口；
     * GM 后端环境直接等价同步 acquire（返回值始终真实）
     */
    async acquireAsync(name: string, ttl: number): Promise<boolean> {
        // web 后端可用性需运行时验证（属性探测可能乐观）——验证后定格修正
        await this.reverifyBackend()
        await this.acquireReady(name)
        if (!this.acquire(name, ttl)) return false
        return this.isHeld(name)
    }

    /** 锁名对应的 web 后端存储键（与 GM 键统一命名空间，便于诊断关联） */
    private static webKey(name: string): string {
        return GMLock.key(name)
    }

    /**
     * 异步预取 web 后端锁（预取窗口）：web 后端可用时，由 acquireWaitWithHeartbeat /
     * acquireWithHeartbeat 的异步路径先行调用，把「浏览器仲裁快照」落到同步窗口。
     * 预取即探即放（webLock.peekAsync）：granted 也立即释放，只落裁决不占锁——
     * 真实持有发生在调用方后续同步 acquire 之后的挂起持有期。同步 acquire 首次调用
     * 时若窗口未就绪，自动退回 GM 后端语义（返回值始终真实）
     */
    async acquireReady(name: string): Promise<void> {
        if (this.backend(name) !== 'web') return
        const key = GMLock.webKey(name)
        const granted = await GMLock.webLock.peekAsync(key)
        GMLock.webAcquireState.set(key, granted ? 'granted' : 'denied')
    }

    /**
     * 尝试获取锁（条件写入，最后写入者胜出）
     * @param name 锁名（跨页面共享的唯一标识，如 `aria2TrackManager`）
     * @param ttl  租约时长（毫秒）；Web Locks 后端忽略（无租约概念，持有即互斥）
     * @returns 抢占写入是否成功（注意：即使返回 true，执行关键动作前仍应调用
     *          isHeld()/renew() 基于存储复核，以消解并发竞争——GM 后端）
     */
    acquire(name: string, ttl: number): boolean {
        const key = GMLock.key(name)
        const now = Date.now()
        // 双后端互见：web 持有方在 GM 存储同步写「影子租约」，让窗口未就绪而降级
        // GM 后端的上下文（同域其他帧/页首扫）也能读到租约被拒——否则 web 持有方
        // 只在浏览器锁里、降级方只看 GM 存储，两套互不相知 → 双持有漏洞。
        // 影子租约由 web 持有方的心跳（renew）续期；无心跳调用方的过期由下一轮
        // 复核（isHeld 同样要求影子租约未过期）统一。
        // ⚠️ 实测（e2e gmBehavior DIAG，ScriptCat 1.4.0）：裸 GM_setValue/GM_deleteValue
        // 跨上下文（顶层↔子帧）传播可达秒级（811ms 实测）——影子租约的「删除」对
        // 其他上下文不保证即时可见，因此降级竞取**只信到期时间不信键缺失**：
        // 他人影子未过期 → 拒绝；影子已过期或归属本页 → 允许接管/续写。
        const shadowWrite = (): void => GM_setValue(key, { owner: this.owner, expires: now + ttl })
        if (this.backend(name) === 'web') {
            // 影子租约检查（GM 写入方可能晚于本页窗口就绪）：他人影子未过期 → 拒绝
            const shadow = GM_getValue<GMLockValue | undefined>(key)
            if (shadow && shadow.owner !== this.owner && shadow.expires > now && this.held.has(name) === false) return false
            const state = GMLock.webAcquireState.get(key)
            if (state === 'granted') {
                if (this.held.has(name)) {
                    shadowWrite() // 重复 acquire 等同续持 + 影子续期
                    return true
                }
                this.held.set(name, true)
                GMLock.webAcquireState.delete(key) // 窗口消费掉（释放时重置）
                shadowWrite()
                void GMLock.webLock.acquireAsync(key).then((granted) => {
                    if (!granted) this.held.delete(name) // 极小概率 TOCTOU：他人枪先，回退让位
                })
                return true
            }
            if (state === 'denied') void this.acquireReady(name) // 快照已陈旧（持有者可能已释放）：重 peek 供下轮提升
            else if (state === undefined) void this.acquireReady(name) // 首次同步调用：预取供下次提升
            // 同步降级走影子租约竞取（他人真实持有者会写影子租约在此拒绝；
            // 本页影子过期（无心跳调用方 TTL 到）时在此接管——GM 后端同语义）
        }
        const current = GM_getValue<GMLockValue | undefined>(key)
        // 已被其他页面持有且租约未过期 → 抢占失败
        if (current && current.owner !== this.owner && current.expires > now) return false
        // 空闲 / 租约过期 / 本页续期 → 写入抢占（web 后端此处即影子租约写入）
        GM_setValue(key, { owner: this.owner, expires: now + ttl })
        return true
    }

    /**
     * 心跳续期：仅当仍持有（存储校验）时延长租约，非持有者无法覆盖他人租约。
     * Web Locks 后端：同步续写影子租约（GM 后端上下文互见的桥）+ kept 标志校验。
     * @returns 是否仍持有（false 表示已失去，调用方应立即停止动作并让位）
     */
    renew(name: string, ttl: number): boolean {
        const key = GMLock.key(name)
        if (this.backend(name) === 'web') {
            if (!this.held.has(name)) return false
            GM_setValue(key, { owner: this.owner, expires: Date.now() + ttl })
            return true
        }
        const current = GM_getValue<GMLockValue | undefined>(key)
        if (current?.owner !== this.owner) return false
        GM_setValue(key, { owner: this.owner, expires: Date.now() + ttl })
        return true
    }

    /** 是否仍持有该锁（基于存储校验，供执行关键动作前复核）。
     * Web Locks 后端：held 标志 + 影子租约未过期（无心跳调用方租约到期后降级语义一致） */
    isHeld(name: string): boolean {
        const key = GMLock.key(name)
        if (this.backend(name) === 'web') {
            const shadow = GM_getValue<GMLockValue | undefined>(key)
            const shadowValid = !!shadow && shadow.owner === this.owner && shadow.expires > Date.now()
            // 两种 web 持有形态：
            // a) held 标志（消费过 granted 窗口，真实 web 锁在手）+ 影子租约未过期；
            //    影子缺失/过期 = GM 侧语义已失（TTL 到期），维持「TTL 即所有权期限」
            //    的统一语义（web 锁随本页关闭自动释放）；
            // b) held 缺失但归本页的 GM 租约有效（窗口未就绪时的降级 acquire 写入）——
            //    降级期同样是本页的锁，isHeld 必须为 true（否则降级期调用方永久失锁）
            if (this.held.has(name)) return shadowValid
            return shadowValid
        }
        const value = GM_getValue<GMLockValue | undefined>(key)
        return !!value && value.owner === this.owner && value.expires > Date.now()
    }

    /** 启动内部心跳：每 interval 自动 renew 续期；失去锁时停止心跳并回调 onLost（幂等，重复启动先停旧心跳）。
     * 供调用方在异步获取路径（acquireAsync，不含心跳）获得锁后补启；
     * web 后端的心跳仅作存活探测（无租约可续），失锁/释放时停止 */
    startHeartbeatFor(name: string, ttl: number, onLost?: (name: string) => void, interval?: number): void {
        this.startHeartbeat(name, ttl, interval ?? ttl / 3, onLost)
    }

    /** 启动内部心跳：每 interval 自动 renew 续期；失去锁时停止心跳并回调 onLost（幂等，重复启动先停旧心跳） */
    private startHeartbeat(name: string, ttl: number, interval: number, onLost?: (name: string) => void): void {
        this.stopHeartbeat(name)
        const timer = setInterval(() => {
            if (!this.renew(name, ttl)) {
                this.stopHeartbeat(name)
                onLost?.(name)
            }
        }, interval)
        this.heartbeats.set(name, timer)
    }

    /** 停止内部心跳定时器（幂等） */
    private stopHeartbeat(name: string): void {
        const timer = this.heartbeats.get(name)
        if (timer !== undefined) {
            clearInterval(timer)
            this.heartbeats.delete(name)
        }
    }

    /**
     * 抢占锁并启动内部心跳：每 interval 自动 renew 续期，直到 release() 或失去锁。
     * 续期逻辑从调用方循环内聚到锁自身——调用方只需在关键动作前用 isHeld() 复核，
     * 失去锁（租约被夺/过期）时心跳自动停止并回调 onLost（可选）。
     * @param name     锁名
     * @param ttl      租约时长（毫秒）
     * @param interval 心跳间隔（毫秒），默认 TTL/3；须保证节流环境下 interval < TTL
     * @param onLost   失去锁时回调（此时心跳已自动停止）
     */
    acquireWithHeartbeat(name: string, ttl: number, interval: number = ttl / 3, onLost?: (name: string) => void): boolean {
        if (!this.acquire(name, ttl)) return false
        this.startHeartbeat(name, ttl, interval, onLost)
        return true
    }

    /**
     * 等待获取锁并在接管后启动内部心跳（acquireWait + acquireWithHeartbeat 的组合）。
     * Web Locks 后端：等待前先做一次预取（浏览器锁若空闲则直接捕获，不必走 GM 轮询）；
     * 若预取即 granted，后续 acquireWait 内的同步 acquire 首帧即走 web 窗口成功
     * @see acquireWithHeartbeat
     */
    async acquireWaitWithHeartbeat(name: string, ttl: number, interval: number = ttl / 3, onLost?: (name: string) => void, timeout: number = Infinity): Promise<boolean> {
        await this.reverifyBackend()
        await this.acquireReady(name)
        if (!(await this.acquireWait(name, ttl, timeout))) return false
        this.startHeartbeat(name, ttl, interval, onLost)
        return true
    }

    /** 释放锁（仅当仍由本页持有，避免误删他人锁）；同时停止内部心跳。
     * Web Locks 后端：held（真实 web 锁在手）→ 解析挂起回调释放浏览器锁；
     * 两条路径都清影子租约——⚠️ 降级 GM acquire 路径不置 held（窗口未就绪），
     * 其「锁」就是影子租约本身，owner 保护语义与 GM 后端一致（实测曾因
     * held 未置位而跳过删除，影子租约泄漏致他人永远被拒） */
    release(name: string): void {
        this.stopHeartbeat(name)
        const key = GMLock.key(name)
        if (this.backend(name) === 'web') {
            const isWebHeld = this.held.has(name)
            if (isWebHeld) {
                this.held.delete(name)
                GMLock.webLock.release(key)
            }
            if (GM_getValue<GMLockValue | undefined>(key)?.owner === this.owner) {
                // 同键挂起持有的 web 锁一并释放：降级 GM acquire 路径（窗口未就绪）
                // 不置 held 但发出的 fire-and-forget acquireAsync 可能稍后 granted——
                // 浏览器锁挂在本页手里而 held 无记录，只删影子会把真实锁漏在浏览器里
                // （e2e gmBehavior 实测：泄漏后他人 peek 恒 denied，影子也无从恢复）
                GMLock.webLock.release(key)
                GM_deleteValue(key)
            }
            return
        }
        if (GM_getValue<GMLockValue | undefined>(key)?.owner === this.owner) {
            GM_deleteValue(key)
        }
    }

    /**
     * 等待获取锁（无延迟接管）：锁被其他页面持有时不立即失败，而是挂起等待，
     * 锁一旦可用（持有者释放 / 租约过期）立即抢占并返回 true。
     *
     * Web Locks 后端：预取窗口 granted 时首帧 acquire 即成功（无需等待）；
     * GM 后端：不依赖轮询——同时监听
     * 1. GM 存储事件（持有者 release / 其他页面的写入会立即触发本页监听器）；
     * 2. 租约到期定时器（过期接管不产生 GM 事件，到期瞬间重试）。
     * 因此从锁可用到接管只有 GM 存储跨页传播的固有毫秒级延迟。
     *
     * 竞争语义与 acquire 一致（最后写入者胜出）：多页面同时等待时，成功返回的
     * 页面仍需在关键动作前用 renew()/isHeld() 基于存储复核。
     *
     * 唤醒语义（有意不过滤 remote，区别于 GMSyncDictionary 只响应 remote）：
     * 等待期间本页自身绝不写该键（acquire 只在成功路径写），不存在自唤醒环；
     * 持有者的心跳 renew 也会触发本监听器，属于无效唤醒——重读后继续等待即可，
     * 代价仅为偶尔的一次额外 GM 读写；而本地 pruneExpired 的删除是本地事件，
     * 不过滤才能被它提前唤醒。整体换取「锁可用 → 唤醒」零轮询。
     * @param name    锁名
     * @param ttl     抢占成功后使用的租约时长（毫秒）
     * @param timeout 最长等待时间（毫秒），默认 Infinity 无限等待
     * @returns true 表示已成功抢占；false 表示等待超时
     */
    async acquireWait(name: string, ttl: number, timeout: number = Infinity): Promise<boolean> {
        const deadline = Date.now() + timeout
        for (; ;) {
            if (this.acquire(name, ttl)) return true
            if (Date.now() >= deadline) return false

            const key = GMLock.key(name)
            // 传播延迟下可能读到未过期的旧租约：按剩余租约等待（+5ms 缓冲），
            // 持有者 release 会触发 GM 事件提前唤醒，无需等满租约。
            // 下限 15ms：锁反复被抢时避免 0ms 定时器紧凑循环（每轮注册/移除监听器 + GM 读写）
            const current = GM_getValue<GMLockValue | undefined>(key)
            const remain = current ? Math.max(0, current.expires - Date.now()) : 0
            const waitMs = Math.max(15, Math.min(remain + 5, deadline - Date.now()))

            await new Promise<void>((resolve) => {
                let listenerId: number | undefined
                let timer: ReturnType<typeof setTimeout> | undefined
                // 幂等守卫：监听器与定时器都可能触发 done，二次进入只 resolve 不重复清理
                let settled = false
                const done = () => {
                    if (settled) return
                    settled = true
                    if (listenerId !== undefined) GM_removeValueChangeListener(listenerId)
                    if (timer !== undefined) clearTimeout(timer)
                    resolve()
                }
                listenerId = GM_addValueChangeListener(key, () => done())
                timer = setTimeout(done, waitMs)
            })
        }
    }

    /** 清理所有已过期的锁（利用 GM_listValues 遍历全部 GM 键）
     * - 结构异常（owner/expires 缺失或类型不符）同样回收，避免永久滞留存储；
     * - 删除前重读双检：取-删间隙内持有者可能已 renew 写入新租约（renew 只校验
     *   owner 不校验过期），重读不一致则不删——把误删窗口从「整轮遍历」压缩到
     *   「相邻两次 GM 调用之间」（GM 存储无原子 CAS 的固有极限，e2e gmBehavior 锚定真实语义） */
    static pruneExpired(): void {
        const now = Date.now()
        for (const key of GM_listValues()) {
            if (!key.startsWith(GMLock.PREFIX)) continue
            const value = GM_getValue<Partial<GMLockValue> | undefined>(key)
            const valid = typeof value?.owner === 'string' && typeof value.expires === 'number' && Number.isFinite(value.expires)
            // 结构完整且未过期 → 保留
            if (valid && value!.expires! > now) continue
            // 双检：仅当重读仍为同一快照（未被持有者 renew 覆盖）时才删除
            if (JSON.stringify(GM_getValue<GMLockValue | undefined>(key)) === JSON.stringify(value)) GM_deleteValue(key)
        }
    }
}
