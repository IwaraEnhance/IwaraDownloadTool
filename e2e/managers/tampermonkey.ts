/**
 * Tampermonkey 驱动。
 *
 * 与 ScriptCat 的关键差异（SW 源码逆向 + 探针实证，2026-10-03/06）：
 * - 商店 ID：dhdgffkkebhmkfjojejmpbldmpobfkfo（5.5.0 stable）；
 * - 脚本安装（2026-10-06 终态）：options 页直发 saveScript({code, new_script:true,
 *   ask:false}) ——与 options「添加新脚本」（tvid="new-user-script"）编辑器保存
 *   完全同一条 SW 消息链，零 UI/接管/ask.html；详见 installScriptViaMessage。
 * - 配置直写（同 ScriptCat firstShowDeveloperMode 方案）：TM config 物理键为
 *   `!extdb.#config`（值需 {origin:'normal', value:...} 包装，background.js:298/521），
 *   预写 scriptUrlDetection=legacy + notification_showUpdate=off（关掉安装后的
 *   tampermonkey.net 欢迎页，background.js:436 的 di() 短路）+ #version 预写
 *   （migration 链判定非 first-run）。⚠️ memory 层为权威且外部写入被 LT.onChanged
 *   忽略——写后必须 chrome.runtime.reload() 让 SW 重读；
 * - 权限：MV3 下 TM 用 optional userScripts 权限；fixtures 两阶段预配置已开
 *   userScriptsAccess，TM 侧无 docs 外链引导页。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import type { ManagerDriver } from './types'
import { fetchExtension } from '../helpers/fetchStoreExt'

const STORE_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo' // Tampermonkey stable（Chrome 商店）

/**
 * 经 SW 消息总线静默安装脚本（ScriptCat installByCode 思路的 TM 等价物，
 * 5.5.0 解包源码实证，e2e/.tampermonkeyStore/ext/）：
 *
 * - 用户指认的 options「添加新脚本」tab（tvid="new-user-script"）背后是内建
 *   编辑器，其保存链 = 页面发 {method:"saveScript", uuid, code, new_script:
 *   true, ...}（extension.js 384831 的 W()）；SW 端 handler
 *   a={allow:{extpage:!0}}（background.js 546167）：e.code 分支**要求 uuid
 *   必传**（缺失直接 {error:"uuid missing"}，new_script=true 只是重生成
 *   Pe() 覆盖，不豁免）→ sl.doSave({src: e.code /* 纯文本源码 *,
 *   save:!0, ask:!wn.values.editor_easySave,...})。
 * - 确认对话框开关 editor_easySave **出厂默认 true**（config 默认表
 *   background.js:148485 editor_easySave:!0）→ ask:false → doSave 走静默分支
 *   （$c 的 s?…:se(→落库,resolve)），不弹确认。为防用户配置被改，prepareProfile
 *   仍显式预写该键为 true。
 * - 幂等性：new_script=true 走「新建」语义（Pe() 新 uuid + replace 允许同名
 *   脚本被顶替），与官方「添加新脚本」编辑器新建保存一致；重复运行 e2e =
 *   库中出现多个同 name 条目（每 worker 独立 profile，跨 run 不共享，无实害）。
 * - 应答：handlers 完成时回调 {items, options}（含新脚本条目）或 {error}；
 *   reload 默认 true 时 SW 会顺带刷新 options 树。
 * - 扩展页（options.html）直发即达：chrome.runtime.sendMessage → SW
 *   onMessage→vp→fp.saveScript，sender.origin==ce 判 extpage 通过。
 */
async function installScriptViaMessage(
    context: BrowserContext,
    extensionId: string,
    scriptPath: string
): Promise<string> {
    const code = readFileSync(scriptPath, 'utf-8')
    const page: Page = await context.newPage()
    try {
        await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
        const result = await page.evaluate(
            (payload: { code: string }) =>
                new Promise<{ error?: string; items?: unknown[] }>((resolve) => {
                    // chrome 全局由扩展页环境提供（Node 类型环境无 @types/chrome）
                    const g = globalThis as unknown as {
                        chrome: {
                            runtime: {
                                lastError?: { message?: string }
                                sendMessage: (msg: unknown, cb: (resp: { error?: string; items?: unknown[] } | undefined) => void) => void
                            }
                        }
                    }
                    try {
                        g.chrome.runtime.sendMessage(
                            {
                                method: 'saveScript',
                                // handler 硬要求 uuid（缺失即 {error:"uuid missing"}）；
                                // new_script=true → SW 端 Pe() 重生成新 uuid，勿占用传入值
                                uuid: crypto.randomUUID(),
                                new_script: true,
                                code: payload.code,
                                // doSave 幂等：replace=true 且 uuid 与旧库不冲突 → 按元数据
                                // @uuid 优先；同 name+namespace 已存在则由 new_script 走新建
                                replace: true,
                                // 配合 editor_easySave（默认 true）→ ask=false → 静默落库
                                save: true,
                                reload: false // 不让 SW 刷 options 树（页面即将关闭）
                            },
                            (raw) => {
                                void g.chrome.runtime.lastError // 消费 lastError 防未检查告警
                                resolve(raw ?? { error: 'no response (SW 未应答)' })
                            }
                        )
                    } catch (e) {
                        resolve({ error: String(e) })
                    }
                }),
            { code }
        )
        if (result?.error) {
            throw new Error(`TM saveScript 安装失败: ${JSON.stringify(result).slice(0, 300)}`)
        }
        console.log(`[tm-driver] saveScript 安装成功: ${path.basename(scriptPath)}`)
        return scriptPath
    } finally {
        await page.close()
    }
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
     * 配置直写（TM 侧对齐 ScriptCat firstShowDeveloperMode 方案）：
     * 1) fileAccess=true（file: 脚本读取权限，developerPrivate 官方 API）；
     * 2) TM config 物理键 `!extdb.#config` 预写 scriptUrlDetection=legacy（http(s)
     *    也接管）+ notification_showUpdate=off（关欢迎页）+ #version 预写
     *    （migration 判非 first-run），写后 runtime.reload() 让 SW 重读
     *    （memory 层为权威且外部写入被忽略——background.js:298/299）。
     */
    async prepareProfile(context, extensionId): Promise<void> {
        // 1) fileAccess（保留：TM 的 file: 安装链硬依赖）
        const devPage = await context.newPage()
        await devPage.goto('chrome://extensions/')
        await devPage.waitForFunction(() => !!(window as any).chrome?.developerPrivate, { timeout: 10_000 })
        const before = await devPage.evaluate(async (id) => {
            const dp = (globalThis as any).chrome.developerPrivate
            const info = (await dp.getExtensionsInfo({ includeDisabled: true })).find((e: { id: string }) => e.id === id)
            const target = info?.fileAccess === true
            if (!target) await dp.updateExtensionConfiguration({ extensionId: id, fileAccess: true })
            return target ? 'already' : 'written'
        }, extensionId).catch((e) => `写入失败: ${String(e).slice(0, 120)}`)
        console.log(`[tm-driver] fileAccess=true 预配置: ${before}`)
        await devPage.close()

        // 2) TM config 直写 + SW 重载（写入与 reload 分离：reload 会重启 SW 并顺手
        // 关闭所有扩展页——承载 evaluate 的 options 页会 'Target closed'，正是
        // fixtures enableUserScriptsAccess 注释里的同型竞态）
        const page = await context.newPage()
        try {
            await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
            const writeResult = await page.evaluate(async () => {
                // evaluate 回调在 Node 侧类型检查无 chrome 全局：经 globalThis 取（运行时扩展页有真值）
                const g = (globalThis as any).chrome
                const CFG_K = '!extdb.#config'
                const VER_K = '!extdb.#version'
                const cur = await g.storage.local.get([CFG_K, VER_K])
                const raw = cur[CFG_K]
                // 兼容两种形态：已包装 {origin,value} 与裸对象
                const cfg = raw && typeof raw === 'object' && 'value' in raw ? (raw as any).value : (raw ?? {})
                const origin = g.runtime.inIncognitoContext ? 'incognito' : 'normal'
                await g.storage.local.set({
                    [CFG_K]: {
                        origin,
                        value: {
                            ...cfg,
                            // file: + http(s) 的 .user.js 都自动接管（background.js:926/698）
                            scriptUrlDetection: 'legacy',
                            // 关掉 installed.php/changelog.php 欢迎页（background.js:436 di() 短路）
                            notification_showUpdate: 'off',
                            // 编辑器保存免确认（saveScript 静默分支的开关；出厂默认 true，
                            // 仍显式预写防用户配置漂移）——直发 saveScript({code}) 的前提
                            editor_easySave: true
                        }
                    },
                    // 与 manifest 一致 → migration 链判非 first-run（background.js:1091）
                    [VER_K]: { origin, value: g.runtime.getManifest().version }
                })
                return 'written'
            }).catch((e) => `写入失败: ${String(e).slice(0, 120)}`)
            console.log(`[tm-driver] config 直写: ${writeResult}`)
            // page.close 之后再用 SW evaluate 触发 reload（options 页关闭不影响 reload 执行）
        } finally {
            await page.close()
        }
        // SW 直接触发 reload：等新 SW 上来（旧 SW evaluate 可能随关闭失效）
        const reloadSw = await (async () => {
            for (let i = 0; i < 10; i++) {
                const sw = context.serviceWorkers().find((w) => w.url().includes(extensionId))
                if (sw) return sw
                await new Promise((r) => setTimeout(r, 500))
            }
            return undefined
        })()
        if (reloadSw) {
            await reloadSw.evaluate(() => (globalThis as any).chrome.runtime.reload()).catch((e) =>
                console.warn(`[tm-driver] SW reload 失败（配置下轮启动生效）: ${String(e).slice(0, 100)}`)
            )
        } else {
            console.warn('[tm-driver] 未找到 TM SW 跳过 reload（配置下轮启动生效）')
        }
    },
    /**
     * 运行时预配置（Phase 2 每次扩展载入后、installScript 前调用）：
     * fileAccess=true 必须对**当前动态实例**重写——基准 profile 的 Secure Preferences
     * 里的 fileAccess 与扩展实例路径绑定，CDP loadUnpacked 的新实例不继承（实测：
     * 只预写 profile 时 file:// 安装链 fail，ask.html 不弹）。写完无需 reload
     * （developerPrivate.updateExtensionConfiguration 对运行中实例即时生效）。
     */
    async prepareRuntime(context, extensionId): Promise<void> {
        const page = await context.newPage()
        try {
            await page.goto('chrome://extensions/')
            await page.waitForFunction(() => !!(window as any).chrome?.developerPrivate, { timeout: 10_000 })
            const results = await page.evaluate(async (id) => {
                const dp = (globalThis as any).chrome.developerPrivate
                const info = (await dp.getExtensionsInfo({ includeDisabled: true })).find((e: { id: string }) => e.id === id)
                const state = info?.state
                const fileAccess = info?.fileAccess === true ? 'already' : 'written'
                if (fileAccess === 'written') await dp.updateExtensionConfiguration({ extensionId: id, fileAccess: true })
                return { fileAccess, state }
            }, extensionId)
            console.log(`[tm-driver] runtime fileAccess: ${results.fileAccess} (state=${results.state})`)
        } catch (e) {
            console.warn(`[tm-driver] runtime fileAccess 写入失败: ${String(e).slice(0, 120)}`)
        } finally {
            await page.close()
        }
    },
    installScript(context, extensionId, scriptPath): Promise<string> {
        // 直接经 options 页发 saveScript 消息（与「添加新脚本」编辑器保存同链路）
        return installScriptViaMessage(context, extensionId, scriptPath)
    },
    isInstallPageUrl(url) {
        // ⚠️ ask.html 是 TM 的安装确认对话框（SW installFromUrl 弹出，等待用户
        // 点「安装」后经 aid 消息通道回传结果）——把它关掉 = 安装失败（SW 会给
        // 原 URL 加 #bypass=true 并放弃）。白名单：ask.html + options.html。
        return url.includes('ask.html') || url.includes('options.html')
    },
    /** TM 自启噪音外链：安装完成后的 tampermonkey.net 欢迎页（预写 off 后通常不再弹，
     * 兑底声明防首次基准 profile 重建时竞态弹出） */
    noiseUrlPatterns: ['https://www.tampermonkey.net']
}

