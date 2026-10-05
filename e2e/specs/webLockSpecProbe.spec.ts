/**
 * GMLock 双后端：Web Locks（navigator.locks）沙箱可达性实证 + 真实管理器下的后端行为。
 *
 * 实测目标（对应 src/core/gmLock.ts 双后端设计与 src/core/webLock.ts）：
 * 1. 探针在真实脚本管理器（ScriptCat 沙箱）内 unsafeWindow.navigator.locks 是否可达——
 *    可达 → GMLock 走浏览器原生互斥（同名锁至多一页持有，无双胜出窗口）；
 *    不可达 → 自动降级 GM 存储租约（产品行为与升级前一致，不 fail）。
 * 2. 可达时：GMLock.acquireReady 预取 granted/denied → 同步 acquire 消费窗口；
 *    释放后他人可获锁（浏览器仲裁语义）。
 *
 * 「标签 ≤ 1」约束下跨上下文对峙由 GM 宿主的顶层 + #peer 子帧双实例承载（同 gmBehavior.spec）。
 */
import { expect, type Page } from '@playwright/test'
import { testSharedScript as test } from '../helpers/fixtures'
import { createGMHostServer } from '../install/common'

test.describe.configure({ mode: 'serial' })

/** 实例仓表达式（evaluate 内使用） */
const topStore = 'window.__e2eProbes'

test.describe('Web Locks 沙箱可达性（双后端 GMLock 后端选择实证）', () => {
    let hostUrl = ''
    let disposeHost: (() => void) | undefined

    test.beforeAll(async ({ browser }) => {
        const host = await createGMHostServer()
        hostUrl = host.url
        disposeHost = host[Symbol.dispose]
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.goto(hostUrl, { waitUntil: 'domcontentloaded' })
        await context.close()
    })

    test.afterAll(async () => {
        disposeHost?.()
        disposeHost = undefined
    })

    /** 导航到宿主页并等顶层探针就绪 */
    async function gotoHost(page: Page): Promise<void> {
        await page.goto(hostUrl, { waitUntil: 'domcontentloaded' })
        await expect
            .poll(
                async () =>
                    page.evaluate(() => ({
                        marked: document.documentElement.getAttribute('data-e2e-probe'),
                        exposed: typeof (window as any).__e2eProbes?.GMLock === 'function'
                    })),
                { timeout: 30_000 }
            )
            .toEqual({ marked: 'ready', exposed: true })
    }

    /** 主世界视角的 navigator.locks 可达性（镜像探针探测值，交叉验证） */
    function locksReachable(page: Page) {
        return page.evaluate(() => {
            const nav = (window as any).navigator
            return !!nav?.locks && typeof nav.locks?.request === 'function'
        })
    }

    /**
     * 用例 1：实证 unsafeWindow.navigator.locks 在沙箱内的可达性，并与主世界交叉验证。
     * 三种结果都是合法实证产物（记录产品实际走哪条后端）：
     * - 探针 supported=true & 主世界可达 → GMLock 走 web 后端（用例 2 继续验互斥语义）
     * - 探针 supported=false（secure context 外被剥 / 管理器不透传）→ 自动降级 GM 后端
     * 断言只锁「探测与主世界一致」这一产品依赖的事实，不锁具体真假。
     */
    test('探针探测 unsafeWindow.navigator.locks 可达性与主世界一致', async ({ sharedSession }) => {
        test.setTimeout(60_000)
        const page = sharedSession.page
        await gotoHost(page)

        const probeSupported = await page.evaluate(`${topStore}.webLockProbe.supported`)
        const mainWorldReachable = await locksReachable(page)
        // 实证值落报告（本次关注点：ScriptCat 沙箱到底可不可达——此前无实证输出误导排查）
        console.log(`[weblock-probe] probeSupported=${probeSupported} mainWorld=${mainWorldReachable}`)
        test.info().annotations.push({
            type: 'weblock-probe-value',
            description: `probe=${probeSupported}, mainWorld=${mainWorldReachable}`
        })
        // 探针经 unsafeWindow 探测的结果必须与主世界真实可达性一致：
        // 这正是 GMLock 双后端选择依赖的唯一事实（isWebLockSupported 的沙箱探路径）
        expect(probeSupported, `探针探测（${probeSupported}）应与主世界 locks 可达性（${mainWorldReachable}）一致`).toBe(
            mainWorldReachable
        )
        // tryAcquire 实测（区分「属性存在」与「运行时可用」）：500ms 竞速窗口内 granted=true
        const tryAcquired = await page.evaluate(`${topStore}.webLockProbe.tryAcquire('sc-verify-' + ${Date.now()})`)
        console.log(`[weblock-probe] tryAcquire=${tryAcquired} (probeSupported=${probeSupported})`)
        test.info().annotations.push({
            type: 'weblock-tryacquire',
            description: String(tryAcquired)
        })
    })

    /**
     * 用例 3（核心新增）：真正的跨标签页浏览器仲裁——
     * 同一 context 起两个标签页（均装载探针产物、同一 origin 宿主页），各自经探针
     * 露出的 webLockProbe 试取同一锁名：先到的应 granted，后到的应 denied。
     * 这是 Web Locks 区别于 GM 存储租约的根本价值（浏览器进程单点仲裁），
     * 帧/单页测试无法覆盖，必须双标签页实测。
     * ⚠️ 本文件宿主为 127.0.0.1 本地服务（零风控），可临时突破共享会话「单标签」
     * 惯例；用例结束立即关闭第二页。
     */
    test('跨标签页仲裁：标签 A 持锁 → 标签 B 同名锁 denied', async ({ sharedSession }) => {
        test.setTimeout(90_000)
        const page = sharedSession.page
        await gotoHost(page)
        if (!(await page.evaluate(`${topStore}.webLockProbe.supported`))) {
            test.info().annotations.push({ type: 'skip-reason', description: 'navigator.locks 不可达（降级 GM 后端），跨标签仲裁不适用' })
            test.skip(true, 'Web Locks 不可达，GM 后端仲裁由 gmBehavior.spec 锚定')
        }
        await expect.poll(async () => locksReachable(page), { timeout: 10_000 }).toBe(true)

        const lockName = `e2e-weblock-cross-tab-${Date.now()}`
        // 走 GMLock 完整产品路径（双后端门面）：acquireReady（真实 navigator.locks
        // 仲裁落预取窗口）→ 同步 acquire 消费窗口 → release 显式释放
        await page.evaluate(`(${topStore}.webLocks ??= {})`)
        await page.evaluate(`(${topStore}.webLocks.A = new ${topStore}.GMLock('tab-A'))`)
        const second = await sharedSession.context.newPage()
        try {
            await second.goto(hostUrl, { waitUntil: 'domcontentloaded' })
            await expect
                .poll(
                    async () =>
                        second.evaluate(() => ({
                            marked: document.documentElement.getAttribute('data-e2e-probe'),
                            exposed: typeof (window as any).__e2eProbes?.GMLock === 'function'
                        })),
                    { timeout: 30_000 }
                )
                .toEqual({ marked: 'ready', exposed: true })
            await second.evaluate(`(${topStore}.webLocks ??= {})`)
            await second.evaluate(`(${topStore}.webLocks.B = new ${topStore}.GMLock('tab-B'))`)

            // 标签 A：预取（真实浏览器仲裁）→ granted → 同步 acquire 成功
            await page.evaluate(`(function(){ const l = ${topStore}.webLocks.A; return l.acquireReady(${JSON.stringify(lockName)}) })()`)
            const aAcquired = await page.evaluate(`(function(){ const l = ${topStore}.webLocks.A; return l.acquire(${JSON.stringify(lockName)}, 60_000) })()`)
            expect(aAcquired, '标签 A 应获锁（浏览器仲裁，锁空闲）').toBe(true)
            expect(await page.evaluate(`(function(){ const l = ${topStore}.webLocks.A; return l.isHeld(${JSON.stringify(lockName)}) })()`), '标签 A 复核应持有').toBe(true)

            // 标签 B：同名锁预取应 denied（浏览器单点仲裁，A 持锁中）→ 同步 acquire 失败
            await second.evaluate(`(function(){ const l = ${topStore}.webLocks.B; return l.acquireReady(${JSON.stringify(lockName)}) })()`)
            const bAcquired = await second.evaluate(`(function(){ const l = ${topStore}.webLocks.B; return l.acquire(${JSON.stringify(lockName)}, 60_000) })()`)
            expect(bAcquired, '标签 B 同名锁应 denied（跨标签页浏览器仲裁）').toBe(false)

            // 标签 A 释放 → 标签 B 预取翻转为 granted（跨标签页传播）
            await page.evaluate(`(function(){ const l = ${topStore}.webLocks.A; return l.release(${JSON.stringify(lockName)}) })()`)
            await expect
                .poll(async () => second.evaluate(`(function(){ const l = ${topStore}.webLocks.B; l.acquireReady(${JSON.stringify(lockName)}); return l.acquire(${JSON.stringify(lockName)}, 60_000) })()`), { timeout: 10_000 })
                .toBe(true)
        } finally {
            // 恢复单标签惯例：显式释放残余锁并关闭临时第二页
            await page.evaluate(`${topStore}.webLocks?.A?.release(${JSON.stringify(lockName)})`).catch(() => undefined)
            await second.close().catch(() => undefined)
        }
    })
})
