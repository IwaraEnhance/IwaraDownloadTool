/**
 * WebLock —— 基于 Web Locks API（navigator.locks）的浏览器原生跨标签页互斥。
 *
 * 与 GMLock（GM 存储租约）的根本区别：仲裁发生在浏览器进程内单点（LockManager），
 * 同名锁任意时刻至多一个持有者——「双页同帧 acquire 双胜出」「复核后 await 间失锁」
 * 在此模型下数学上不存在，临界区天然封闭（持有即互斥，他人根本无法 acquire）。
 * 页面关闭/崩溃锁自动释放，无需 TTL/心跳/租约三件套。
 *
 * 沙箱注意：脚本管理器把脚本跑在隔离 world，navigator 可能被替换。本模块经
 * unsafeWindow 取主世界 LockManager（@grant unsafeWindow 必须在 mata.json grant 中，
 * 项目已声明）；不可用（secure context 限制/管理器剥离）时 isSupported() 返回 false，
 * 调用方（GMLock）自动退回 GM 存储租约路径。
 *
 * 与 GMLock 后端的语义对齐：
 * - acquire/ifAvailable 失败 → false（等价 tryLock）
 * - 无 TTL：锁不租约化，持有期 = 回调执行期。GMLock 的 TTL 参数被忽略（保留签名兼容），
 *   心跳调用退化为 isHeld 查询；「页面假死但未崩溃」时锁被长持——GMLock 层的让
 *   渡逻辑（aria2Track pagehide 释放）继续提供，且浏览器冻结页在 steal 场景外
 *   不会丢失锁（比 TTL 误判过期更符合"管理器不漂移"的期望）
 * - release 幂等且仅持有者语义由 LockManager 天然保证
 */

/** 属性探测结果（同步快照，进程内缓存） */
let propertyProbe: boolean | undefined
/** 运行时验证后的结论（peekAsync 真实裁决一次，异步覆盖属性探测的乐观估计） */
let runtimeVerdict: boolean | undefined

/** 属性层面 locks 是否存在（同步；沙箱代理物可能存在但运行不可用） */
export function isWebLockSupported(): boolean {
    if (propertyProbe !== undefined) return propertyProbe
    try {
        // unsafeWindow 沙箱主世界；LockManager 为 secure-context-only API
        const nav = unsafeWindow.navigator
        propertyProbe = !!nav && !!nav.locks && typeof nav.locks.request === 'function'
    } catch {
        propertyProbe = false
    }
    return propertyProbe
}

/**
 * 运行时验证：真实发起一次即探即放的 peek 裁决（ ScriptCat 实测：属性探测 true
 * 但 locks.request 沙箱内不可用 → 验证 false）。结果缓存并覆盖属性探测——
 * GMLock 的 backend 定格用 verify 后的结论（backend 缓存重置后下次判定生效）。
 */
export async function verifyWebLockSupported(): Promise<boolean> {
    if (runtimeVerdict !== undefined) return runtimeVerdict
    if (!isWebLockSupported()) {
        runtimeVerdict = false
        return false
    }
    try {
        const probe = new WebLock('GMLock-verify')
        runtimeVerdict = await probe.peekAsync(`__e2e_weblock_verify_${Date.now()}`)
    } catch {
        runtimeVerdict = false
    }
    return runtimeVerdict
}

/** 读运行时验证结论（未验证时回退属性探测） */
export function webLockVerdict(): boolean {
    return runtimeVerdict ?? isWebLockSupported()
}

export class WebLock {
    /** 挂起的释放解析器表：name → 持有挂起回调的 resolve（acquire 成功期间存在） */
    private readonly pendingResolve = new Map<string, () => void>()

    constructor(_owner: string) {
        // owner 仅保留构造签名兼容：Web Locks 由浏览器进程仲裁，不依赖调用方标识
    }

    /** 异步获取锁（ifAvailable 不排队，失败立即 false）。
     * 成功后锁保持持有直到 release()——Web Locks 的持有单位是「回调执行期」，
     * 本方法把回调挂起为一个不 resolve 的 Promise，release 时才放行释放，
     * 由此把「作用域锁」适配成 GMLock 的「句柄锁 + 显式释放」模型。
     *
     * ⚠️ resolve 语义（2026-10-04 实测定稿）：本方法在**获锁瞬间**即 resolve granted
     * （不等释放结束后才报告），挂起持有转入后台——调用方拿到 true 的那一刻锁已在手。
     * 这与「await request() 回调结束后才 resolve」的朴素实现不同：后者会把 granted
     * 信息拖延到释放之后，调用方（gmLock.acquire 的 fire-and-forget TOCTOU 复核、
     * GMLock.acquireAsync 全路径）都无法在获取点拿到裁决。
     * denoted（锁被他人持有）仍然立即 false。 */
    async acquireAsync(name: string, _ttl?: number): Promise<boolean> {
        if (!isWebLockSupported()) return false
        const locks = unsafeWindow.navigator.locks
        // 获锁即 resolve 的门闩：与后台挂起持有解耦
        let settleAcquire!: (granted: boolean) => void
        const acquireGate = new Promise<boolean>((resolve) => { settleAcquire = resolve })
        try {
            // 不 await request 本体（其在释放后才 settle）；后台消费异常与裁决
            void locks.request<void>(
                name,
                { ifAvailable: true },
                (lock) => {
                    if (!lock) {
                        settleAcquire(false) // ifAvailable 下锁被他人持有：立即裁决 denied
                        return
                    }
                    settleAcquire(true) // 获锁瞬间通知调用方，挂起持有转入后台
                    return new Promise<void>((resolve) => this.pendingResolve.set(name, resolve))
                }
            ).catch(() => {
                // request 异常（AbortError/沙箱限制等）：未获得
                settleAcquire(false)
                this.pendingResolve.delete(name)
            })
        } catch {
            settleAcquire(false)
            this.pendingResolve.delete(name)
        }
        const result = await acquireGate
        if (!result) this.pendingResolve.delete(name)
        return result
    }

    /** 是否仍持有该锁：基于 LockManager.query 快照（异步） */
    async isHeld(name: string): Promise<boolean> {
        if (!isWebLockSupported()) return false
        const snapshot = await unsafeWindow.navigator.locks.query()
        return (snapshot.held ?? []).some((l) => l.name === name)
    }

    /** 预取裁决快照（granted 即立即释放）：只问「现在抢能不能抢到」，不实际占锁。
     * 供 GMLock.acquireReady 落预取窗口——持有语义由调用方后续的 acquire 消费，
     * 预取本身不得阻塞（否则 request() 在挂起持有期间永不 resolve，调用方卡死）。
     * 存在固有 TOCTOU：快照 granted 后释放，后续 acquire 前他人可能枪先——
     * 预取窗口本来即乐观快照，GM 后端同步竞取作最终裁决兜底 */
    async peekAsync(name: string): Promise<boolean> {
        if (!isWebLockSupported()) return false
        const locks = unsafeWindow.navigator.locks
        let granted = false
        try {
            await locks.request<void>(
                name,
                { ifAvailable: true },
                (lock) => {
                    if (!lock) return
                    granted = true
                    // 立即返回（不挂起）→ 回调结束即释放，仅取裁决快照
                }
            )
        } catch {
            granted = false
        }
        return granted
    }

    /** 释放锁：解析挂起的持有 Promise → 回调返回 → LockManager 释放（幂等） */
    release(name: string): void {
        const resolve = this.pendingResolve.get(name)
        if (resolve) {
            this.pendingResolve.delete(name)
            resolve()
        }
    }
}
