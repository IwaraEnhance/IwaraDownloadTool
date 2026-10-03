/**
 * Tampermonkey 驱动。
 *
 * 与 ScriptCat 的关键差异（SW 源码逆向 + 探针实证，2026-10-03）：
 * - 商店 ID：dhdgffkkebhmkfjojejmpbldmpobfkfo（5.5.0 stable）；
 * - 安装触发：SW onBeforeRequest/onCommitted 回调（NA/dl）判定
 *   `("legacy"==scriptUrlDetection) || ("auto"!=scriptUrlDetection… && url.startsWith("file:"))`
 *   且 Vo(url)（.user.js/.tamper.js 后缀）→ installFromUrl 自动弹 ask.html?aid=…。
 *   默认 auto 模式下 **file: 协议即满足接管条件**（http(s) 需 legacy 配置）——
 *   故 installScript 直出 file:// URL，零配置项依赖（file 读取权限见 prepareProfile）；
 * - aid 生命周期仅存于 SW 内存（Ri{}）：ask.html?aid= 必须由 SW 自己创建，
 *   外部无法传址/伪造——这也是不走「ask 页传址」方案的原因；
 * - 权限：MV3 下 TM 用 optional userScripts 权限；fixtures 两阶段预配置已开
 *   userScriptsAccess，TM 侧无 docs 外链引导页。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import type { ManagerDriver } from './types'
import { fetchExtension } from '../helpers/fetchStoreExt'

const STORE_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo' // Tampermonkey stable（Chrome 商店）

/** 脚本的 file:// URL（TM auto 模式接管条件第二分支原生支持 file: 协议） */
function fileUrl(scriptPath: string): string {
    return 'file:///' + path.resolve(scriptPath).replaceAll('\\', '/')
}

export const tampermonkeyDriver: ManagerDriver = {
    id: 'tampermonkey',
    async resolveExtension(): Promise<string> {
        const explicit = process.env.TAMPERMONKEY_EXT_PATH
        if (explicit) {
            if (existsSync(path.join(explicit, 'manifest.json'))) return explicit
            throw new Error(`TAMPERMONKEY_EXT_PATH=${explicit} 中未找到 manifest.json`)
        }
        // 缺失时自动下载（与 ScriptCat 同一条 CRX 下载解包链路，仅商店 ID 不同）
        return fetchExtension(STORE_ID, '.tampermonkeyStore')
    },
    /**
     * Phase 1 预配置（Chrome 官方权限 API，非配置项预写）：开启「允许访问文件网址」
     * （developerPrivate.fileAccess）。TM 的 file: 脚本安装链路硬依赖此权限——
     * installFromUrl 内部用 fetch 读 file: URL，无权限时 fetch 失败 → fail →
     * 原 URL 加 #bypass=true 放弃（探针实证：ask.html 弹出后秒关即此因）。
     * 该权限持久化进基准 profile，Phase 2 拷贝后生效。
     */
    async prepareProfile(context, extensionId): Promise<void> {
        const page = await context.newPage()
        await page.goto('chrome://extensions/')
        await page.waitForFunction(() => !!(window as any).chrome?.developerPrivate, { timeout: 10_000 })
        const before = await page.evaluate(async (id) => {
            const dp = (globalThis as any).chrome.developerPrivate
            const info = (await dp.getExtensionsInfo({ includeDisabled: true })).find((e: { id: string }) => e.id === id)
            const target = info?.fileAccess === true
            if (!target) await dp.updateExtensionConfiguration({ extensionId: id, fileAccess: true })
            return target ? 'already' : 'written'
        }, extensionId).catch((e) => `写入失败: ${String(e).slice(0, 120)}`)
        console.log(`[tm-driver] fileAccess=true 预配置: ${before}`)
        await page.close()
    },
    async installScript(context, _extensionId, scriptPath): Promise<string> {
        // TM 安装流程：导航 file://*.user.js → SW（NA/dl 回调）检测 → installFromUrl
        // 自动弹 ask.html?aid=… 确认页 → 在该页点「安装」→ SW 经 aid 消息通道完成安装。
        // ⚠️ ask.html 有 ~15s 生命周期（SW 端 Ei 清理器）+ 握手超时：监听器必须
        // 先于导航注册（事件丢失 = SW 走 fail 分支给 URL 加 #bypass 后放弃）。
        const url = fileUrl(scriptPath)
        const askPagePromise = context
            .waitForEvent('page', { timeout: 30_000 })
            .then((p) => (p.url().includes('ask.html') ? p : undefined))
        // 已存在的 ask.html（竞态：导航前 SW 已弹出）也纳入候选
        const existingAsk = () => context.pages().find((p) => p.url().includes('ask.html') && !p.isClosed())

        const page = await context.newPage()
        const navPromise = page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => page)

        const askPage = (await Promise.race([askPagePromise, navPromise.then(() => existingAsk())])) ?? existingAsk()
        if (!askPage) {
            throw new Error(
                `TM 安装确认页（ask.html）未出现：SW 未接管 ${url}。检查 TM 是否 ENABLED（fixtures Phase 1 开发者模式预配置）`
            )
        }
        await confirmInstall(askPage)
        return scriptPath
    },
    isInstallPageUrl(url) {
        // ⚠️ ask.html 是 TM 的安装确认对话框（SW installFromUrl 弹出，等待用户
        // 点「安装」后经 aid 消息通道回传结果）——把它关掉 = 安装失败（SW 会给
        // 原 URL 加 #bypass=true 并放弃）。白名单：ask.html + options.html。
        return url.includes('ask.html') || url.includes('options.html')
    }
}

/** TM 安装确认页主按钮：双语言文案（安装/重新安装 + Install/Reinstall） */
function installButton(page: Page) {
    return page
        .locator('button')
        .filter({ hasText: /^(重新)?安装$|^(Re)?install$/i })
        .first()
}

async function confirmInstall(page: Page): Promise<void> {
    const button = installButton(page)
    await expect(button).toBeEnabled({ timeout: 20_000 })
    // 点安装后 TM 显示「已安装」，页面保留（不自动关）——按钮态变化即可判定完成
    await button.click()
    await expect(button).toBeDisabled({ timeout: 10_000 }).catch(() => undefined)
    await page.close()
}
