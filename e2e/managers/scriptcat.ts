/**
 * ScriptCat 驱动：
 * - 扩展来源：SCRIPTCAT_EXT_PATH 显式目录（含仓库自构建版）优先，
 *   否则从 Chrome 商店自动下载 CRX 并解包（fetchStoreExt，纯 Node 零外部命令）。
 * - 脚本安装：SW 消息总线静默注入（installScriptViaMessage）——与官方 options
 *   导入编辑器保存完全同一条通道（ScriptClient.installByCode），零 UI 交互；
 *   安装页（src/install.html?url=…）仅作为 isInstallPageUrl 白名单保留。
 * - 引导抑制：直写 firstShowDeveloperMode（SW showUserscriptActivationGuide 的
 *   去重键，键值与 er DAO/localStorageDAO 完全同构）——SW 读到同 UA 指纹即
 *   return，不再弹 open-dev 引导页。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import type { ManagerDriver } from './types'
import { fetchExtension } from '../helpers/fetchStoreExt'

/**
 * 经 SW 消息总线静默安装脚本（v1.4.0 源码实证，scriptscat/scriptcat）：
 *
 * - wire 协议（packages/message/{client,server,extension_message}.ts）：payload =
 *   { action, data }；Server prefix "serviceWorker"（src/service_worker.ts:75）+
 *   ScriptService 挂载 group("script")（service_worker/index.ts:77）+ 方法名
 *   installByCode（script.ts init() group.on 注册）→ action 全名
 *   "serviceWorker/script/installByCode"；成功应答 {code:0,data}，失败 {code:-1,message}。
 * - SW 端 installByCode（script.ts:394）→ prepareScriptByCode（解析元数据、按
 *   name+namespace 幂等查旧版并继承 uuid/createtime/status、普通脚本置 ENABLE）
 *   → installScript（写 ScriptDAO "script:<uuid>" + ScriptCodeDAO "scriptCode:<uuid>"
 *   于 chrome.storage.local → 下载 require/resource → MQ publish "installScript"
 *   触发 Runtime 编译缓存与页面注入）。
 * - 必须经扩展页承载（options.html）：chrome.runtime.sendMessage 会唤醒 SW 并
 *   投递（manifest 已含 storage/tabs 权限，本扩展内发送无需额外授权）。直写
 *   storage 不可行——会绕过 SW 内存缓存与 MQ 广播，脚本落库但永不注入。
 * - sendMessage 应答时 SW 可能仍在异步收尾（资源下载后置且不阻塞应答），安装
 *   成功即返回 {update, updatetime}，注入就绪由既有探针/用例判据兜底。
 */
async function installScriptViaMessage(
    context: BrowserContext,
    extensionId: string,
    scriptPath: string
): Promise<string> {
    const code = readFileSync(scriptPath, 'utf-8')
    const page: Page = await context.newPage()
    try {
        await page.goto(`chrome-extension://${extensionId}/src/options.html`, { waitUntil: 'domcontentloaded' })
        const result = await page.evaluate(
            async (payload: { action: string; data: { code: string; upsertBy: string } }) => {
                const resp = await new Promise<{ code: number; data?: unknown; message?: string }>((resolve) => {
                    // chrome 全局由扩展页环境提供（Node 类型环境无 @types/chrome）
                    const g = globalThis as unknown as {
                        chrome: {
                            runtime: {
                                sendMessage: (
                                    msg: unknown,
                                    cb: (resp: { code: number; data?: unknown; message?: string } | undefined) => void
                                ) => void
                            }
                        }
                    }
                    try {
                        g.chrome.runtime.sendMessage(payload, (resp) => {
                            void resp
                            resolve(resp ?? { code: -1, message: 'no response (SW 未就绪或无应答)' })
                        })
                    } catch (e) {
                        resolve({ code: -1, message: String(e) })
                    }
                })
                return resp
            },
            { action: 'serviceWorker/script/installByCode', data: { code, upsertBy: 'user' } }
        )
        if (result.code !== 0) {
            throw new Error(`ScriptCat 消息安装失败: ${result.message ?? JSON.stringify(result)}`)
        }
        console.log(`[scriptcat-driver] 消息安装成功: ${path.basename(scriptPath)}`)
        return scriptPath
    } finally {
        await page.close()
    }
}

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
        try {
            // 扩展页就绪信号（替代旧版固定 1s 盲睡）：waitInit 完成是读端可见的前提，
            // SW 侧 localStorageDAO 无内存缓存（v1.4.0 index.ts 未 enableCache）→
            // storage.local 直写即刻对读端可见；此等待只为确保 options 页 evaluate
            // 环境的 chrome.storage 已挂好（React 首渲染 + SW storage.local 切换完成）
            await page.goto(`chrome-extension://${extensionId}/src/options.html`, {
                waitUntil: 'domcontentloaded',
                timeout: 20_000
            })
            await page
                .waitForFunction(
                    () => {
                        const g = (globalThis as unknown as { chrome?: { storage?: { local?: unknown } } }).chrome
                        return !!(g && g.storage && g.storage.local)
                    },
                    { timeout: 10_000 }
                )
                .catch(() => undefined) // 不可用则靠下方 evaluate 的防御分支给出可读错误
            // typed function 形态（与 TM 驱动 saveScript 同款）：TS 编译期检查 +
            // IDE 可跳转/重构——旧版 evaluate 字符串模板无类型检查，且块注释 `*/`
            // 提前闭合会触发 babel 报错（记忆地雷）。chrome 全局由扩展页环境提供
            //（Node 类型环境无 @types/chrome），经 globalThis 断言取用
            const result = await page
                .evaluate(async () => {
                    type WriteResult = 'written' | 'already' | 'no chrome.storage.local'
                    const g = (
                        globalThis as unknown as {
                            chrome?: {
                                storage: {
                                    local: {
                                        get: (keys: string[]) => Promise<Record<string, { value: unknown } | undefined>>
                                        set: (items: Record<string, unknown>) => Promise<void>
                                    }
                                }
                            }
                        }
                    ).chrome
                    if (!g) return 'no chrome.storage.local' satisfies WriteResult
                    const ua = navigator.userAgent
                    // 与 SW 端 getBrowserInstalledVersion 逐字同构：
                    // btoa([...ua.matchAll(/[\d._]+/g)].map((e) => e[0]).join(";"))（pkg/utils/utils.ts）
                    const fingerprint = btoa([...ua.matchAll(/[\d._]+/g)].map((e) => e[0]).join(';'))
                    const key = 'localStorage:firstShowDeveloperMode'
                    const existing = (await g.storage.local.get([key]))[key]
                    if (existing && existing.value === fingerprint) return 'already' satisfies WriteResult
                    await g.storage.local.set({ [key]: { key: 'firstShowDeveloperMode', value: fingerprint } })
                    return 'written' satisfies WriteResult
                })
                .catch((e) => `写入失败: ${String(e).slice(0, 120)}`)
            console.log(`[scriptcat-driver] firstShowDeveloperMode 预写: ${result}`)
        } finally {
            await page.close().catch(() => undefined)
        }
    },
    installScript(context, extensionId, scriptPath) {
        return installScriptViaMessage(context, extensionId, scriptPath)
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
     *
     * ⚠️ 为何必须 patch（v1.4.0 源码对读结论，内部变量无法替代）：
     * - open-dev 引导页已被 prepareProfile 预写去重键覆盖（内部状态方案）；
     * - install_comple（onInstalled reason="install"）与更新日志页（reason="update"
     *   且版本尾号为 .0）**没有 visited/suppress 类存储开关**——reason 是 Chrome
     *   派发的事件事实。e2e 下 CDP loadUnpacked 每次启动=一次新装事件，两页
     *   每个用例级 context 都可能弹，唯一手段=创建前拦截。
     */
    async patchTabsCreate(context, extensionId) {
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
