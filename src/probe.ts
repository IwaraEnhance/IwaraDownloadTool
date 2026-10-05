/**
 * e2e 探针用户脚本（src/probe.ts，与主入口 main.ts 对称；不参与产品构建，
 * 由 build.ts 依 mata.json 的 e2e.probeEntry 打包输出 dist/<displayName>.e2e-test.user.js）。
 *
 * 核心原则（用户裁定）：**不自行实现任何 GM 语义** —— 直接 bundling 项目真实类
 * GMSyncDictionary / GMLock（src/core/gmSyncDictionary.ts、src/core/gmLock.ts），
 * 测的就是产品代码本体，探针只是「在第二个真实上下文里执行同一份类」的载体。
 *
 * 与主脚本差异（仅两处，且都有必要）：
 * - 宿主 = e2e 本地服务页面（http://127.0.0.1/gm-host，createGMHostServer）；
 *   @include 覆盖 127.0.0.1（与 iwara 完全隔离：零风控暴露、零外网依赖、CI 无头可跑）；
 * - **不声明 @noframes**：宿主页内嵌 /gm-frame 子帧，ScriptCat 注入顶/子帧两个上下文。
 *   GM 存储按脚本分域（跨脚本彼此不可见），同一探针脚本双实例共享存储域——
 *   实例 B 写同键 → 实例 A 收到管理器派发的真实 remote=true 事件。
 *   这是「标签 ≤ 1」约束下唯一无 mock 的远端事件源。
 *
 * 暴露形态（实证定稿，2026-10-04）：真实类**本体直挂** unsafeWindow——
 * 沙箱世界与主世界 window 隔离，但经 @grant 的 unsafeWindow 挂上去的类/实例在主世界
 * 方法调用完整可用（实例直挂 get/set 实测全通，写入真实落 GM 存储；
 * 见 e2e/specs/probeLab2.spec.ts）。本文件只挂**类构造器**，spec 在主世界直接
 * `new __e2eProbes.GMSyncDictionary(name)` 创建实例（实例天然驻文档生命周期，
 * 跨 evaluate 存活；事件回调由 spec 经实例自身 onSet 挂接，无 buffer 层）。
 * 就绪标记：documentElement[data-e2e-probe="ready"]（DOM 属性跨世界共享）。
 * ⚠️ 前提：@grant unsafeWindow 必须在（build.ts 从 mata.grant 派生时有断言守卫）。
 */
import { GMSyncDictionary } from './core/gmSyncDictionary'
import { GMLock } from './core/gmLock'
import { isWebLockSupported } from './core/webLock'

// @ts-ignore
// main.ts debug 钩子同款惯例：unsafeWindow 直挂（挂的是类本体，非包装口）
// webLockProbe：Web Locks（NavigatorLocks）沙箱可达性实证口——
// supported = unsafeWindow.navigator.locks 探测结果（同步）；
// tryAcquire = 探针内真实发起一次 ifAvailable 请求（异步，结果落 DOM 属性）。
// e2e 据此判定「双后端 GMLock 在真实管理器下走哪条后端」，不可达则
// GMLock 自动降级 GM 存储租约（isWebLockSupported 返回 false 的同源验证）
const webLockProbe = {
    supported: isWebLockSupported(),
    tryAcquire: async (name: string): Promise<boolean> => {
        try {
            const { WebLock } = await import('./core/webLock')
            const lock = new WebLock('e2e-probe')
            // ⚠️ acquireAsync 的 resolve 语义 = 「获得锁并在回调挂起后」——granted 结果
            // 只有在 release 被调用、挂起回调返回后才落回。因此这里不 await 本体，
            // 而是竞速窗口：500ms 内拿不到 granted 即视为 denied/不可达，随后立即释放。
            // 同时后台 keepAlive 保证真实 granted 也被立即释放，不占住锁名空间
            const outcome = await Promise.race([
                lock.acquireAsync(name).finally(() => lock.release(name)),
                new Promise<boolean>((r) => setTimeout(() => r(false), 500))
            ])
            return outcome
        } catch {
            return false
        }
    }
}
// @ts-ignore
unsafeWindow.__e2eProbes = {
    GMSyncDictionary,
    GMLock,
    webLockProbe,
    // 裸 GM 存储原始 API 直通（e2e 诊断用：跨上下文传播语义实证）
    GM_getValue: (key: string, defaultValue?: unknown) => GM_getValue(key, defaultValue),
    GM_setValue: (key: string, value: unknown) => GM_setValue(key, value),
    GM_deleteValue: (key: string) => GM_deleteValue(key)
}

/** 就绪标记：DOM 属性（跨沙箱世界共享；window 属性不跨世界） */
const markReady = (): void => {
    try {
        document.documentElement?.setAttribute('data-e2e-probe', 'ready')
    } catch {
        /* document-start 早期 documentElement 未就绪：DOMContentLoaded 再挂 */
    }
}
markReady()
document.addEventListener('DOMContentLoaded', markReady, { once: true })
