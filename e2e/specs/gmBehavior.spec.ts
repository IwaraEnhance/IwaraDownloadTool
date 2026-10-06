import { expect, type Page } from '@playwright/test'
import { testSharedScript as test } from '../helpers/fixtures'
import { createGMHostServer } from '../install/common'

test.describe.configure({ mode: 'serial' })

/**
 * 探针实例存于页内 __e2eProbes.dictionaries/locks 仓（顶层 + #peer 子帧）。
 * 全文件 evaluate 一律回调形态：实例名/锁名经 arg 传入，不在 Node 侧拼接 JS 字符串
 * （字符串拼接形态曾触发 CodeQL js/bad-code-sanitization 逐处告警）。
 * ⚠️ Playwright 只把回调函数体序列化进浏览器执行（Node 侧闭包不可用），仓取用
 * 逻辑必须内联进各回调；下列声明仅作文档与 Node 侧类型参考，不供 evaluate 引用。
 */

/** 回调内顶层仓取字典实例的原地形态：((window as any).__e2eProbes?.dictionaries?.[name] ?? fail) */

test.describe('GM 存储真行为（产品类 × 真实 ScriptCat，实例直挂形态）', () => {
    /** GM 宿主服务（beforeAll 起，afterAll 释放；套件内全部用例共用同一 URL） */
    let hostUrl = ''
    let disposeHost: (() => void) | undefined

    test.beforeAll(async ({ browser }) => {
        const host = await createGMHostServer()
        hostUrl = host.url
        disposeHost = host[Symbol.dispose]
        // 预热：确认服务可达（起临时 context，用完即弃，不占业务标签）
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.goto(hostUrl, { waitUntil: 'domcontentloaded' })
        await context.close()
    })

    test.afterAll(async () => {
        disposeHost?.()
        disposeHost = undefined
    })

    /** 导航到宿主页并等顶层探针就绪（就绪 = DOM 属性 + 类本体挂载同现） */
    async function gotoHost(page: Page): Promise<void> {
        await page.goto(hostUrl, { waitUntil: 'domcontentloaded' })
        await expect
            .poll(
                async () =>
                    page.evaluate(() => ({
                        marked: document.documentElement.getAttribute('data-e2e-probe'),
                        exposed: typeof (window as any).__e2eProbes?.GMSyncDictionary === 'function'
                    })),
                { timeout: 30_000 }
            )
            .toEqual({ marked: 'ready', exposed: true })
    }

    /**
     * 用例 0（套件守护）：探针双实例就绪（顶层 + #peer 子帧，类本体可达）。
     * 顶层直接 new 真实类（构造函数读 GM 存储 = 沙箱 API 可用的直接证明）。
     */
    test('探针双实例就绪（顶层 + 子帧，类本体可达）', async ({ sharedSession }) => {
        test.setTimeout(60_000)
        expect(hostUrl, 'beforeAll 应起 GM 宿主服务').toBeTruthy()
        const page = sharedSession.page
        await gotoHost(page)

        const topInstantiated = await page.evaluate(() => {
            const probes = (window as any).__e2eProbes
                ; (probes.dictionaries ??= {}).probeReady = new probes.GMSyncDictionary(
                    'probe-ready-check',
                    [],
                    (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number'
                )
            return typeof probes.dictionaries.probeReady.set === 'function'
        })
        expect(topInstantiated, '顶层 new 真实类应成功（GM API 在沙箱可用）').toBe(true)

        // 子帧：contentDocument 标记 + 类本体
        await expect
            .poll(
                async () =>
                    page.evaluate(() => {
                        const frame = document.querySelector<HTMLIFrameElement>('#peer')
                        return {
                            marked: frame?.contentDocument?.documentElement?.getAttribute('data-e2e-probe') ?? null,
                            exposed: typeof (frame?.contentWindow as any)?.__e2eProbes?.GMSyncDictionary === 'function'
                        }
                    }),
                { timeout: 30_000 }
            )
            .toEqual({ marked: 'ready', exposed: true })
    })

    /**
     * 用例 1：真实 GMSyncDictionary 的 remote 同步。
     * 产品类机制：实例 B（子帧）set 写 GM 存储 → 管理器向实例 A（顶层）派发
     * remote=true → A.handleRemoteChange 增量合并 → onSet 逐键触发、快照收敛。
     */
    test('GMSyncDictionary：子帧实例写入 → 顶层实例真 remote 同步（产品类）', async ({ sharedSession }) => {
        test.setTimeout(120_000)
        const page = sharedSession.page
        await gotoHost(page)

        const name = `e2e-dict-${Date.now()}`

        // ① 双实例创建（A 顶层、B 子帧）；A 经实例自身 onSet 挂事件收集（无 buffer 层）
        await page.evaluate((n) => {
            const probes = (window as any).__e2eProbes
            ;(probes.dictionaries ??= {})[n] = new probes.GMSyncDictionary(n, [], (v: unknown) => typeof v === 'string' || typeof v === 'number')
        }, name)
        await page.evaluate((n) => {
            const d: any = (window as any).__e2eProbes?.dictionaries?.[n]
            if (!d) throw new Error(`dict ${n} not ready`)
            d.onSet = function (this: any, k: string, v: unknown) {
                ;(this.__events ??= []).push({ type: 'set', key: k, value: v })
            }
        }, name)
        await page.evaluate((n) => {
            const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow
            if (!w) throw new Error('#peer iframe 无 contentWindow')
            ;((w as any).__e2eProbes.dictionaries ??= {})[n] = new (w as any).__e2eProbes.GMSyncDictionary(n, [], (v: unknown) => typeof v === 'string' || typeof v === 'number')
        }, name)

        // ② B（子帧）set 两键（实例直调）
        await page.evaluate((n) => {
            const d: any = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow!.__e2eProbes?.dictionaries?.[n]
            if (!d) throw new Error(`frame dict ${n} not ready`)
            return d.set('r1', 'vr1')
        }, name)
        await page.evaluate((n) => {
            const d: any = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow!.__e2eProbes?.dictionaries?.[n]
            if (!d) throw new Error(`frame dict ${n} not ready`)
            return d.set('r2', 'vr2')
        }, name)
        await page.waitForTimeout(800)

        // ③ A（顶层）：实例自身 __events 应经真 remote 合并出 r1/r2 的 onSet
        const events = (await page.evaluate((n) => (window as any).__e2eProbes?.dictionaries?.[n]?.__events ?? [], name)) as Array<any>
        const setKeys = events.filter((e: any) => e.type === 'set').map((e: any) => e.key)
        expect(setKeys, `顶层实例应经真 remote 合并出 r1/r2（实收 ${JSON.stringify(events)}）`).toEqual(
            expect.arrayContaining(['r1', 'r2'])
        )
        // 快照一致：同存储域两实例最终一致（实例直读 entries）
        const topSnap = await page.evaluate((n) => [...(window as any).__e2eProbes?.dictionaries?.[n].entries()], name)
        expect(Object.fromEntries(topSnap)).toEqual({ r1: 'vr1', r2: 'vr2' })
        const frameSnap = await page.evaluate((n) => {
            const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow
            return [...(w as any).__e2eProbes?.dictionaries?.[n].entries()]
        }, name)
        expect(Object.fromEntries(frameSnap)).toEqual({ r1: 'vr1', r2: 'vr2' })

        // ④ A（顶层）本地 set → B 视角 remote（反向同样成立）
        await page.evaluate((n) => (window as any).__e2eProbes?.dictionaries?.[n].set('top', 'vtop'), name)
        await page.waitForTimeout(800)
        const frameSnapAfter = await page.evaluate((n) => {
            const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow
            return [...(w as any).__e2eProbes?.dictionaries?.[n].entries()]
        }, name)
        expect(Object.fromEntries(frameSnapAfter)).toEqual({ r1: 'vr1', r2: 'vr2', top: 'vtop' })
    })

    /**
     * 用例 2：真实 GMLock 的存储互斥。
     * 他人持有时 acquire 失败 / 非持有者 renew 不改租约 / 让位复核。
     */
    test('GMLock：子帧抢占互斥 + 非持有者 renew 不改租约（产品类真互斥）', async ({ sharedSession }) => {
        test.setTimeout(120_000)
        const page = sharedSession.page
        await gotoHost(page)

        const lockName = `e2e-lock-${Date.now()}`

        // ① 顶层实例 A 创建并抢锁成功
        await page.evaluate(() => {
            const probes = (window as any).__e2eProbes
            ;(probes.locks ??= {}).A = new probes.GMLock('owner-A')
        })
        const aOk = await page.evaluate((args) => (window as any).__e2eProbes?.locks?.A.acquire(args.lockName, 60_000), { lockName })
        expect(aOk, '空闲锁 A（顶层）应抢占成功').toBe(true)

        // ② 传播等待：ScriptCat GM 存储写跨上下文可见有毫秒级延迟。
        //    信号语义：B 视角「看到 A 的租约」无法用 isHeld 表达（B 非持有者恒 false），
        //    等价镜像 = A 侧 isHeld 为 true 且稳定（A 持锁期间跨上下文读自身租约恒真），
        //    与裸 raw 键轮询同效；B 的互斥断言由下一步 acquire 失败直接承载。
        await expect
            .poll(
                async () => page.evaluate((args) => (window as any).__e2eProbes?.locks?.A.isHeld(args.lockName), { lockName }),
                { timeout: 10_000 }
            )
            .toBe(true)
        // 子帧实例 B：acquire 应失败（A 的租约在场且未过期）
        const bAcquired = await page.evaluate((args) => {
            const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow as any
            ;((w.__e2eProbes.locks ??= {}).B = new w.__e2eProbes.GMLock('owner-B'))
            return w.__e2eProbes.locks.B.acquire(args.lockName, 60_000)
        }, { lockName })
        expect(bAcquired, 'A 持有时 B（子帧）acquire 应失败').toBe(false)

        // ③ A 释放 → 等 B 视角可见空锁 → B 抢占（竞争消解的真实路径）
        await page.evaluate((args) => (window as any).__e2eProbes?.locks?.A.release(args.lockName), { lockName })
        // ⚠️ A 的 release 删除跨上下文传播到子帧有毫秒级延迟：B 直接 acquire 可能读到
        // 未传播的旧租约而失败——轮询直到 B 视角空锁可见（acquire 每轮实时读存储），
        // 这与产品调用方「acquire 失败后由调用方重试」的用法同构（acquireWait 留 test/）
        await expect
            .poll(
                async () =>
                    page.evaluate((args) => {
                        const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow
                        return (w as any)!.__e2eProbes?.locks?.B.acquire(args.lockName, 60_000)
                    }, { lockName }),
                { timeout: 10_000 }
            )
            .toBe(true)
        expect(true, 'A 释放后 B（子帧）应抢占成功（传播允许内）').toBe(true)
        // B 动作期间 A 复核：应让位（异地租约在场）
        const aHeldAfter = await page.evaluate((args) => (window as any).__e2eProbes?.locks?.A.isHeld(args.lockName), { lockName })
        expect(aHeldAfter, 'B 持有时 A 复核应让位（最后写入者胜出）').toBe(false)
        // ④ 非持有者 A 的 renew 不改变 B 的租约（owner/expires 均不变：B 仍 isHeld）
        const aRenewResult = await page.evaluate((args) => (window as any).__e2eProbes?.locks?.A.renew(args.lockName, 60_000), { lockName })
        expect(aRenewResult, '非持有者 renew 应返回 false').toBe(false)
        const bStillHeld = await page.evaluate((args) => {
            const w = (document.querySelector('#peer') as HTMLIFrameElement).contentWindow
            return (w as any)!.__e2eProbes?.locks?.B.isHeld(args.lockName)
        }, { lockName })
        expect(bStillHeld, 'A renew 后 B 仍持有（租约未被改变）').toBe(true)
    })
})
