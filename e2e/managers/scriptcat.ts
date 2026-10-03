/**
 * ScriptCat 驱动：
 * - 扩展来源：SCRIPTCAT_EXT_PATH 显式目录（含仓库自构建版）优先，
 *   否则从 Chrome 商店自动下载 CRX 并解包（fetchStoreExt，纯 Node 零外部命令）。
 * - 脚本安装：官方安装页 src/install.html?url=…（必须经扩展 SW
 *   chrome.tabs.create 打开；url= 参数禁止 encodeURIComponent；不吃 file://，
 *   由 scriptcatInstall 复用 install/common 的一次性本地 HTTP 服务器提供脚本文件）。
 * - 引导抑制：直写 firstShowDeveloperMode（SW showUserscriptActivationGuide 的
 *   去重键，键值与 er DAO/localStorageDAO 完全同构）——SW 读到同 UA 指纹即
 *   return，不再弹 open-dev 引导页。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from '@playwright/test'
import type { ManagerDriver } from './types'
import { fetchExtension } from '../helpers/fetchStoreExt'
import { installScriptFromFile } from '../helpers/scriptcatInstall'

export const scriptcatDriver: ManagerDriver = {
    id: 'scriptcat',
    async resolveExtension(): Promise<string> {
        const explicit = process.env.SCRIPTCAT_EXT_PATH
        if (explicit) {
            if (existsSync(path.join(explicit, 'manifest.json'))) return explicit
            throw new Error(`SCRIPTCAT_EXT_PATH=${explicit} 中未找到 manifest.json`)
        }
        // 缺失时自动下载（新克隆零手工步骤；已存在则直接返回）
        return fetchExtension()
    },
    /**
     * Phase 1 预配置：直写 chrome.storage.local 的
     * `localStorage:firstShowDeveloperMode`（值 = UA 数字段 btoa，与 SW
     * showUserscriptActivationGuide 的去重键完全同构）——禁掉 SW 启动竞态窗口
     * 里的 open-dev 引导页弹窗（install_comple 属 onInstalled 一次性事件，
     * profile 拷贝不重放，无需处理）。
     */
    async prepareProfile(context, extensionId): Promise<void> {
        const page = await context.newPage()
        await page.goto(`chrome-extension://${extensionId}/src/options.html`).catch(() => undefined)
        await page.waitForTimeout(1_000) // options 页初始化
        const result = await page
            .evaluate(`(async () => {
                const g = globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local
                if (!g) return 'no chrome.storage.local'
                const ua = navigator.userAgent
                const fingerprint = btoa(ua.match(/[\\d._]+/g).join(';'))
                const key = 'localStorage:firstShowDeveloperMode'
                const existing = (await g.get([key]))[key]
                if (existing && existing.value === fingerprint) return 'already'
                await g.set({ [key]: { key: 'firstShowDeveloperMode', value: fingerprint } })
                return 'written'
            })()`)
            .catch((e) => `写入失败: ${String(e).slice(0, 120)}`)
        console.log(`[scriptcat-driver] firstShowDeveloperMode 预写: ${result}`)
        await page.close()
    },
    installScript(context, extensionId, scriptPath) {
        return installScriptFromFile(context, extensionId, scriptPath)
    },
    isInstallPageUrl(url) {
        return url.includes('/src/install.html')
    },
    /** ScriptCat 自启噪音外链：更新日志/权限引导文档页（无代理时空白卡位） */
    noiseUrlPatterns: ['https://docs.scriptcat.org'],
    /**
     * SW 源头拦截：patch 扩展 SW 的 chrome.tabs.create，非安装页创建直接丢弃
     * （返回假 tab.id 兼容 awaiter），安装页照常放行。ScriptCat 首启/启用时
     * 自动弹的「安装成功/权限引导」页由此在创建前即被拦掉，无窗口闪烁。
     * 返回恢复函数（本探针/测试结束时调用，还原原始实现）。
     */
    async patchTabsCreate(context, extensionId) {
        const original = new Map<string, string>()
        await patchSwTabsCreate(context, extensionId, true)
        // 开发者模式切换/扩展重载会重启 SW：监听新 SW 出现时重新 patch
        const reapply = (sw: import('@playwright/test').Worker): void => {
            if (!sw.url().includes(extensionId)) return
            void patchSwTabsCreate(context, extensionId, true)
        }
        context.on('serviceworker', reapply)
        return () => {
            context.off('serviceworker', reapply)
            return patchSwTabsCreate(context, extensionId, false)
        }
        /** 在所有目标 SW 内安装/还原拦截器 */
        async function patchSwTabsCreate(ctx: import('@playwright/test').BrowserContext, extId: string, enable: boolean): Promise<void> {
            const workers = ctx.serviceWorkers().filter((w) => w.url().includes(extId))
            await Promise.all(
                workers.map((worker) =>
                    worker
                        .evaluate(
                            (mode: { enable: boolean; installMarker: string }) => {
                                const g = globalThis as unknown as {
                                    chrome: { tabs: { create: (o: { url: string }) => Promise<{ id?: number }> } }
                                }
                                const anyG = g as unknown as {
                                    __e2eOrigTabsCreate?: typeof g.chrome.tabs.create
                                    __e2ePatchedTabsCreate?: boolean
                                }
                                if (!mode.enable) {
                                    if (anyG.__e2eOrigTabsCreate) {
                                        g.chrome.tabs.create = anyG.__e2eOrigTabsCreate
                                        anyG.__e2eOrigTabsCreate = undefined
                                        anyG.__e2ePatchedTabsCreate = false
                                    }
                                    return 'restored'
                                }
                                if (anyG.__e2ePatchedTabsCreate) return 'already'
                                anyG.__e2eOrigTabsCreate = g.chrome.tabs.create.bind(g.chrome.tabs)
                                g.chrome.tabs.create = (options) => {
                                    if (String(options.url ?? '').includes(mode.installMarker)) {
                                        console.log(`[e2e] 放行安装页创建: ${options.url}`)
                                        return anyG.__e2eOrigTabsCreate!(options)
                                    }
                                    // 归因：打印调用栈，定位 ScriptCat 哪段代码在开标签页
                                    const stack = new Error().stack?.split('\n').slice(2, 7).join(' | ') ?? '(无栈)'
                                    console.warn(`[e2e] 已拦截扩展页创建: ${options.url}\n[e2e]   调用栈: ${stack}`)
                                    return Promise.resolve({ id: -1 })
                                }
                                anyG.__e2ePatchedTabsCreate = true
                                return 'patched'
                            },
                            { enable, installMarker: '/src/install.html' }
                        )
                        .catch(() => 'sw-gone')
                )
            )
        }
    }
}
