/**
 * ScriptCat 脚本自动安装工具。
 *
 * 主路径：ScriptCat 官方安装页 chrome-extension://<id>/src/install.html?url=…
 * （参照 ScriptCat e2e/utils.ts 的 openInstallPageInNewTab：必须经扩展 service worker
 * chrome.tabs.create 新建标签——安装页依赖 history.length 区分「独立标签」与「被接管标签」，
 * 直接 context.newPage()+goto 会留下两条历史导致安装后行为分歧）。
 */
import { readFileSync } from 'node:fs'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { createScriptServer } from '../install/common'

/** 经扩展 SW 打开安装页（生产路径等价：ScriptService.openInstallPageByUrl） */
export async function openInstallPageInNewTab(
    context: BrowserContext,
    extensionId: string,
    targetUrl: string
): Promise<Page> {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 })
    // ⚠️ 不做 encodeURIComponent：安装页解析 url= 用 location.search.slice(idx+4)
    // 后直接 new URL()，不 decode——编码反而解析失败落 "Invalid Page"（与 ScriptCat
    // e2e/utils.ts openInstallPageInNewTab 的拼接方式一致）
    await sw.evaluate(
        // chrome 全局由扩展环境提供（Node 类型环境无 @types/chrome，此处经 unknown 断言）
        (url: string) =>
            (globalThis as unknown as { chrome: { tabs: { create: (o: { url: string }) => void } } }).chrome.tabs.create({
                url
            }),
        `chrome-extension://${extensionId}/src/install.html?url=${targetUrl}`
    )
    // 管理器自启引导页（安装成功/权限引导）可能抢先触发 page 事件：非安装页
    // 直接关掉继续等，直到出现真正的安装页。⚠️ 'page' 事件瞬间 URL 可能还是
    // about:blank（tabs.create 导航未落定），需等 URL 就绪再判定，否则会误杀安装页
    const deadline = Date.now() + 20_000
    for (; ;) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('等待安装页打开超时（可能被管理器引导页抢占）')
        const candidate = await context.waitForEvent('page', { timeout: remaining }).catch(() => undefined)
        if (!candidate) throw new Error('等待安装页打开超时')
        let url = candidate.url()
        if (!url || url === 'about:blank') {
            await candidate
                .waitForURL(/\/src\/install\.html/, { timeout: 3_000 })
                .then(() => {
                    url = candidate.url()
                })
                .catch(() => undefined)
        }
        if (!url?.includes('/src/install.html')) {
            void candidate.close().catch(() => undefined)
            continue
        }
        await candidate.waitForLoadState('domcontentloaded')
        return candidate
    }
}

/**
 * 从本地 .user.js 文件安装脚本：
 * file:// URL 交给安装页直接抓取（ScriptCat 安装页可读 file 来源），
 * 解析元数据 → 展示脚本信息 → 点击主安装按钮 → 等安装页自关。
 *
 * 注意：不能用 file:// URL——ScriptCat 安装页（扩展页面）内 fetch file:// 会被
 * 拒绝，页面直接落 "Invalid Page" 终态。因此起临时本地 HTTP 服务器提供文件。
 *
 * 安装按钮双形态（新旧 UI 兼容，2026-09-27 探针实证）：
 * - 仓库新 UI：data-testid=install-primary（语言无关）
 * - 商店 1.4.0 旧 UI（Arco Design，无 testid）：button.arco-btn-primary
 *   + 文案 install_script（Install Script / 安装 / 更新 Update）
 */

/** 安装页主按钮：testid 优先，回退旧 UI 的 arco 按钮（中/英文文案） */
function primaryButton(page: Page) {
    const byTestId = page.getByTestId('install-primary')
    const byLegacy = page
        .locator('button.arco-btn-primary:not(.arco-btn-status-danger)')
        .filter({ hasText: /安装|install|更新|update/i })
    return byTestId.or(byLegacy).first()
}

export async function installScriptFromFile(
    context: BrowserContext,
    extensionId: string,
    scriptPath: string
): Promise<string> {
    await using server = await createScriptServer(scriptPath)
    // ⚠️ 不做 encodeURIComponent：ScriptCat 安装页解析 url= 用
    // location.search.slice(idx+4) 后直接 new URL()，不 decode——编码反而导致 Invalid Page
    const scriptUrl = server.url
    const page = await openInstallPageInNewTab(context, extensionId, scriptUrl)
    // 等脚本元数据解析完成（安装按钮可用即代表解析成功）
    const button = primaryButton(page)
    await expect(button).toBeEnabled({ timeout: 20_000 })
    // 点安装后安装页自关（独立标签语义）
    await Promise.all([page.waitForEvent('close', { timeout: 15_000 }), button.click()])
    return scriptPath
}

/** 读取脚本源码（供需要校验安装内容或手动注入的场景使用） */
export function readUserScript(scriptPath: string): string {
    return readFileSync(scriptPath, 'utf-8')
}
