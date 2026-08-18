/**
 * GMLock —— 基于 GM 存储的跨页面租约锁（最后写入者胜出 + 动作前复核）
 *
 * 优雅之处：GM 存储没有“比较并交换”，但本锁并不需要它。调用方约定在每次执行
 * 关键动作前都用 renew()/isHeld() 基于存储重新复核持有权，因此：
 * - 无需监听器、无需写入后的消解等待、无需任何本地持有状态；
 * - 即使两个页面同时“抢占成功”，也只有最后写入者能通过后续的存储复核并执行
 *   动作，其余页面自然让位，保证任一时刻只有一个页面真正执行。
 *
 * - 防重复接管：抢占时若锁被他人持有且租约未过期则拒绝；只有持有者能 renew()
 *   续期，非持有者无法覆盖他人租约。
 * - 防未接管：租约（expires）超时后任何页面都能重新抢占；持有者周期性 renew()
 *   心跳续期，页面关闭/崩溃后租约自然过期，其他页面可接管。
 * - 无延迟等待：acquireWait() 在锁被他人持有时不立即失败，而是挂起等待——
 *   同时监听 GM 存储事件（释放立即唤醒）与租约到期定时器（过期瞬间重试），
 *   锁一可用立即抢占，无需轮询、无 TTL 级延迟。
 * - 内部心跳：acquireWithHeartbeat() 把续期逻辑内聚到锁自身（setInterval 自动
 *   renew），调用方只需在关键动作前 isHeld() 复核；失去锁时心跳自动停止。
 *
 * 依赖的 GM API：GM_getValue / GM_setValue / GM_listValues / GM_deleteValue
 * （acquireWait 额外使用 GM_addValueChangeListener / GM_removeValueChangeListener）。
 */

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

    /**
     * @param owner 持有者唯一标识（同一页面实例内应保持一致，如 UUID）
     */
    constructor(owner: string) {
        this.owner = owner
    }

    private static key(name: string): string {
        return GMLock.PREFIX + name
    }

    /**
     * 尝试获取锁（条件写入，最后写入者胜出）
     * @param name 锁名（跨页面共享的唯一标识，如 `aria2TrackManager`）
     * @param ttl  租约时长（毫秒）
     * @returns 抢占写入是否成功（注意：即使返回 true，执行关键动作前仍应调用
     *          isHeld()/renew() 基于存储复核，以消解并发竞争）
     */
    acquire(name: string, ttl: number): boolean {
        const key = GMLock.key(name)
        const now = Date.now()
        const current = GM_getValue<GMLockValue | undefined>(key)
        // 已被其他页面持有且租约未过期 → 抢占失败
        if (current && current.owner !== this.owner && current.expires > now) return false
        // 空闲 / 租约过期 / 本页续期 → 写入抢占
        GM_setValue(key, { owner: this.owner, expires: now + ttl })
        return true
    }

    /**
     * 心跳续期：仅当仍持有（存储校验）时延长租约，非持有者无法覆盖他人租约
     * @returns 是否仍持有（false 表示已失去，调用方应立即停止动作并让位）
     */
    renew(name: string, ttl: number): boolean {
        const key = GMLock.key(name)
        const current = GM_getValue<GMLockValue | undefined>(key)
        if (current?.owner !== this.owner) return false
        GM_setValue(key, { owner: this.owner, expires: Date.now() + ttl })
        return true
    }

    /** 是否仍持有该锁（基于存储校验，供执行关键动作前复核） */
    isHeld(name: string): boolean {
        const value = GM_getValue<GMLockValue | undefined>(GMLock.key(name))
        return !!value && value.owner === this.owner && value.expires > Date.now()
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
     * @see acquireWithHeartbeat
     */
    async acquireWaitWithHeartbeat(name: string, ttl: number, interval: number = ttl / 3, onLost?: (name: string) => void, timeout: number = Infinity): Promise<boolean> {
        if (!(await this.acquireWait(name, ttl, timeout))) return false
        this.startHeartbeat(name, ttl, interval, onLost)
        return true
    }

    /** 释放锁（仅当仍由本页持有，避免误删他人锁）；同时停止内部心跳 */
    release(name: string): void {
        this.stopHeartbeat(name)
        const key = GMLock.key(name)
        if (GM_getValue<GMLockValue | undefined>(key)?.owner === this.owner) {
            GM_deleteValue(key)
        }
    }

    /**
     * 等待获取锁（无延迟接管）：锁被其他页面持有时不立即失败，而是挂起等待，
     * 锁一旦可用（持有者释放 / 租约过期）立即抢占并返回 true。
     *
     * 无延迟的关键：不依赖轮询——同时监听
     * 1. GM 存储事件（持有者 release / 其他页面的写入会立即触发本页监听器）；
     * 2. 租约到期定时器（过期接管不产生 GM 事件，到期瞬间重试）。
     * 因此从锁可用到接管只有 GM 存储跨页传播的固有毫秒级延迟。
     *
     * 竞争语义与 acquire 一致（最后写入者胜出）：多页面同时等待时，成功返回的
     * 页面仍需在关键动作前用 renew()/isHeld() 基于存储复核。
     * @param name    锁名
     * @param ttl     抢占成功后使用的租约时长（毫秒）
     * @param timeout 最长等待时间（毫秒），默认 Infinity 无限等待
     * @returns true 表示已成功抢占；false 表示等待超时
     */
    async acquireWait(name: string, ttl: number, timeout: number = Infinity): Promise<boolean> {
        const deadline = Date.now() + timeout
        for (;;) {
            if (this.acquire(name, ttl)) return true
            if (Date.now() >= deadline) return false

            const key = GMLock.key(name)
            // 传播延迟下可能读到未过期的旧租约：按剩余租约等待（+5ms 缓冲），
            // 持有者 release 会触发 GM 事件提前唤醒，无需等满租约
            const current = GM_getValue<GMLockValue | undefined>(key)
            const remain = current ? Math.max(0, current.expires - Date.now()) : 0
            const waitMs = Math.max(0, Math.min(remain + 5, deadline - Date.now()))

            await new Promise<void>((resolve) => {
                let listenerId: number | undefined
                let timer: ReturnType<typeof setTimeout> | undefined
                const done = () => {
                    if (listenerId !== undefined) GM_removeValueChangeListener(listenerId)
                    if (timer !== undefined) clearTimeout(timer)
                    resolve()
                }
                listenerId = GM_addValueChangeListener(key, () => done())
                timer = setTimeout(done, waitMs)
            })
        }
    }

    /** 清理所有已过期的锁（利用 GM_listValues 遍历全部 GM 键） */
    static pruneExpired(): void {
        const now = Date.now()
        for (const key of GM_listValues()) {
            if (!key.startsWith(GMLock.PREFIX)) continue
            const value = GM_getValue<GMLockValue | undefined>(key)
            if (!value || value.expires <= now) GM_deleteValue(key)
        }
    }
}
