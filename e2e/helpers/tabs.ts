/**
 * 标签页跟踪（扩展装载/测试全程可见）。
 *
 * 三层信息源，回答「有哪些标签页 / 谁打开的」：
 * 1. CDP Target 域（浏览器级，最全）：Target.targetCreated/Destroyed 事件带
 *    openerId/openerUrl——扩展 SW 经 chrome.tabs.create 开的标签页、SW 自身启停、
 *    现存页面清单一网打尽，直接归因到打开者；
 * 2. Playwright 页面事件：page 打开/导航/关闭 + opener 链（窗口语义的打开者）；
 * 3. SW console 转发：patchTabsCreate 拦截日志（含调用栈）经此输出，定位到
 *    ScriptCat 具体哪段代码在开标签页。
 */
import type { BrowserContext, Page, Worker } from '@playwright/test'

/** 单个标签页描述：URL + 打开者（opener 链，best-effort） */
async function describePage(page: Page): Promise<string> {
    try {
        if (page.isClosed()) return `${page.url()} [已关闭]`
        const opener = await page.opener().catch(() => undefined)
        const openerPart = opener && !opener.isClosed() ? `（打开者: ${opener.url() || '(未就绪)'}）` : ''
        return `${page.url() || '(URL 未就绪)'}${openerPart}`
    } catch {
        return `${page.url()} [描述失败]`
    }
}

/** 全量清单：输出当前 context 的标签页及各自打开者 */
export async function dumpTabs(context: BrowserContext, reason: string): Promise<void> {
    const pages = context.pages()
    const lines = await Promise.all(
        pages.map(async (p, i) => `  #${i}${p.isClosed() ? ' [已关闭]' : ''} ${await describePage(p)}`)
    )
    console.log(`[tabs] ${reason} — 共 ${pages.length} 个标签页${lines.length ? `\n${lines.join('\n')}` : '（无）'}`)
}

const INTERESTING_TARGET_TYPES = ['page', 'service_worker', 'background_page']

/**
 * 浏览器级 CDP Target 跟踪：Target.targetCreated 带 openerId/openerUrl，可归因
 * 「SW chrome.tabs.create 开的标签」。⚠️ 本项目 playwright-core 版本里
 * newBrowserCDPSession 只挂在 Browser 上；launchPersistentContext 拿到的是
 * BrowserContext（且无 .browser()）——因此经 connectOverCDP 连回同一浏览器取
 * Browser 级会话（调试端口由调用方传入）。
 */
async function attachCDPTracing(debugPort: number, unsubscribers: Array<() => void>): Promise<boolean> {
    try {
        const { chromium } = await import('@playwright/test')
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
        const cdp = await browser.newBrowserCDPSession()
        cdp.on('Target.targetCreated', (args: unknown) => {
            const { targetInfo } = args as { targetInfo?: { type: string; url: string; openerId?: string; openerUrl?: string } }
            if (!targetInfo || !INTERESTING_TARGET_TYPES.includes(targetInfo.type)) return
            const opener = targetInfo.openerId ? ` ← 打开者: ${targetInfo.openerUrl || targetInfo.openerId}` : ''
            console.log(`[target] + ${targetInfo.type}${opener} ${targetInfo.url}`)
        })
        cdp.on('Target.targetDestroyed', (args: unknown) => {
            const { targetInfo } = args as { targetInfo?: { type: string; url: string } }
            if (!targetInfo || !INTERESTING_TARGET_TYPES.includes(targetInfo.type)) return
            console.log(`[target] - ${targetInfo.type} ${targetInfo.url}`)
        })
        await cdp.send('Target.setDiscoverTargets', { discover: true })
        unsubscribers.push(() => browser.close().catch(() => undefined))
        return true
    } catch (e) {
        console.log(`[target] CDP Target 跟踪不可用（${String(e).slice(0, 80)}），仅用 Playwright 页面事件`)
        return false
    }
}

/** 注册全程跟踪（context 生命周期内持续输出）；返回退订函数 */
export async function registerTabTracing(context: BrowserContext, debugPort?: number): Promise<() => void> {
    const unsubscribers: Array<() => void> = []
    // ① CDP Target 域：标签页创建/销毁 + 打开者归因（覆盖 SW 等非 page target）
    if (debugPort) await attachCDPTracing(debugPort, unsubscribers)

    // ② SW console 转发：patchTabsCreate 的拦截警告（含 JS 调用栈）由此浮出
    const hookWorker = (worker: Worker): void => {
        if (!worker.url().startsWith('chrome-extension://')) return
        const site = worker.url().split('/')[2]
        worker.on('console', (msg) => console.log(`[sw ${site}] ${msg.text().at(-240) ?? msg.text()}`))
    }
    context.serviceWorkers().forEach(hookWorker)
    context.on('serviceworker', hookWorker)
    unsubscribers.push(() => context.off('serviceworker', hookWorker))

    // ③ Playwright 页面事件：opener 链 + 导航轨迹
    const onPage = (page: Page): void => {
        let lastUrl = page.url() || '(about:blank)'
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame()) return
            const url = page.url() || '(about:blank)'
            if (url !== lastUrl) {
                lastUrl = url
                console.log(`[tabs] → 导航: ${url}`)
            }
        })
        page.once('close', () => console.log(`[tabs] ✕ 关闭: ${lastUrl}`))
        void describePage(page).then((d) => console.log(`[tabs] + 打开: ${d}`))
    }
    context.on('page', onPage)
    unsubscribers.push(() => context.off('page', onPage))

    await dumpTabs(context, 'context 启动')
    return () => unsubscribers.forEach((off) => off())
}
