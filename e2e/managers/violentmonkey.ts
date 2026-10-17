/**
 * Violentmonkey 驱动。
 *
 * 安装不走 confirm 页 UI：VM 的扩展页（options/confirm 等）与 SW 之间有一套内部
 * 命令协议（src/common/messaging.js + messaging-sw.js）——扩展页用
 * `sw.postMessage({ id, msg: { cmd, data } })` 调 SW，SW 用同 id 回复
 * `{ id, res, err }`。confirm 页的“安装”按钮最终就是发 `ParseScript`
 * （src/confirm/views/app.vue → sendCmdDirectly('ParseScript', { ...meta, code })）。
 *
 * 这里在 options 页上下文复现同一协议直接发 `ParseScript`：
 * - 与 confirm 页安装走同一条 SW 命令链（解析元数据、落库、注册注入），不碰存储；
 * - 无 UI 依赖、无本地 HTTP 服务，也不受 confirm 页 10s bypass 缓存/首启 DB 竞态影响。
 * - 响应 id 用高随机段，避开 VM 页面自身 pending 请求的递增 id 空间。
 *
 * ⚠️ MV3 注入权限（Chrome 138+）：userScriptsAccess 的基准 profile 写入不会
 * 继承到 CDP 动态载入的实例（与 TM 的 fileAccess 同型，实测 isActive=false）。
 * prepareRuntime 必须对当前实例重新打开该开关，并调 `GetInjectorError` 让 SW
 * 重新 registerInjector（等价于 chrome://extensions 里“重新加载”后的首次注册）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import type { ManagerDriver } from './types'
import { fetchExtension } from '../helpers/fetchStoreExt'

const STORE_ID = 'jinjaccalgkegednnccohejagnlnfdag' // Violentmonkey（Chrome 商店）

/** options 页承载协议调用（扩展页上下文才有 navigator.serviceWorker + 扩展权限） */
const OPTIONS_PATH = 'options/index.html#settings'

interface ParseScriptResult {
    where?: { id?: number }
    update?: { message?: string }
}

/**
 * 在扩展页上下文向 VM SW 发送内部命令（VM 的 page ↔ SW 协议）。
 * 返回 SW 的 res；handler 抛错时以 err 拒绝。
 */
function sendSwCommand<T = unknown>(page: Page, cmd: string, data?: unknown): Promise<T> {
    return page.evaluate(
        async ({ cmd, data }): Promise<{ res?: T; err?: string }> => {
            const swContainer = navigator.serviceWorker
            if (!swContainer) return { err: 'navigator.serviceWorker 不可用' }
            const reg = await Promise.race([
                swContainer.ready,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('等待 VM SW 就绪超时')), 15_000))
            ])
            const sw = reg.active
            if (!sw) return { err: 'VM service worker 未激活' }
            // 高随机 id：VM 页面自身 pending id 从 1 递增，避开其命名空间
            const id = 1e9 + Math.floor(Math.random() * 1e9)
            try {
                const res = await new Promise<T>((resolve, reject) => {
                    const onMessage = (event: MessageEvent) => {
                        if (event.data?.id !== id) return
                        swContainer.removeEventListener('message', onMessage)
                        if (event.data.err) reject(event.data.err)
                        else resolve(event.data.res as T)
                    }
                    swContainer.addEventListener('message', onMessage)
                    sw.postMessage({ id, msg: { cmd, data } })
                })
                return { res }
            } catch (error) {
                return { err: String((error as { message?: string })?.message ?? error) }
            }
        },
        { cmd, data }
    ).then(({ res, err }) => {
        if (err != null) throw new Error(err)
        return res as T
    })
}

/** 打开 options 页执行一段 SW 命令（扩展页用完即弃） */
async function withOptionsPage<T>(context: BrowserContext, extensionId: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await context.newPage()
    try {
        await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`, { waitUntil: 'domcontentloaded' })
        return await fn(page)
    } finally {
        if (!page.isClosed()) await page.close().catch(() => undefined)
    }
}

async function installScriptViaSw(context: BrowserContext, extensionId: string, scriptPath: string): Promise<string> {
    const code = readFileSync(scriptPath, 'utf-8')
    const result = await withOptionsPage(context, extensionId, (page) => sendSwCommand<ParseScriptResult>(page, 'ParseScript', { code, from: page.url(), bumpDate: true }))
    if (result?.where?.id == null) throw new Error(`VM ParseScript 未返回脚本 id: ${JSON.stringify(result)}`)
    console.log(`[vm-driver] ParseScript 安装成功: ${path.basename(scriptPath)}（id=${result.where.id}）`)
    return scriptPath
}

export const violentmonkeyDriver: ManagerDriver = {
    id: 'violentmonkey',
    optionsPath: OPTIONS_PATH, // manifest options_ui.page 原样事实
    async resolveExtension(): Promise<string> {
        const explicit = process.env.VIOLENTMONKEY_EXT_PATH
        if (explicit) {
            if (existsSync(path.join(explicit, 'manifest.json'))) return explicit
            throw new Error(`VIOLENTMONKEY_EXT_PATH=${explicit} 中未找到 manifest.json`)
        }
        return fetchExtension(STORE_ID, '.violentmonkeyStore')
    },
    /**
     * Phase 2 每次扩展载入后：为当前实例打开 userScriptsAccess，并让 SW 重新
     * registerInjector（GetInjectorError 是 VM 公开的内部命令，成功返回 undefined）。
     */
    async prepareRuntime(context, extensionId): Promise<void> {
        const devPage = await context.newPage()
        try {
            await devPage.goto('chrome://extensions/')
            await devPage.waitForFunction(() => !!(window as any).chrome?.developerPrivate, { timeout: 10_000 })
            const result = await devPage.evaluate(async (id) => {
                const dp = (globalThis as any).chrome.developerPrivate
                const read = async () =>
                    (await dp.getExtensionsInfo({ includeDisabled: true })).find((e: { id: string }) => e.id === id) as
                        | { state?: string; userScriptsAccess?: { isActive?: boolean } }
                        | undefined
                const before = (await read())?.userScriptsAccess?.isActive === true
                if (!before) {
                    await dp.updateExtensionConfiguration({ extensionId: id, userScriptsAccess: true })
                    for (let i = 0; i < 20; i++) {
                        if ((await read())?.userScriptsAccess?.isActive === true) break
                        await new Promise((r) => setTimeout(r, 500))
                    }
                }
                const info = await read()
                return { before, after: info?.userScriptsAccess?.isActive === true, state: info?.state }
            }, extensionId)
            console.log(`[vm-driver] userScriptsAccess: before=${result.before} after=${result.after} (state=${result.state})`)
            if (!result.after) throw new Error('VM userScriptsAccess 未激活（chrome://extensions 开关写入失败）')
        } finally {
            await devPage.close().catch(() => undefined)
        }
        // 开关生效后让 SW 重新注册注入器；成功返回 undefined（失败返回错误文案）
        const injectorError = await withOptionsPage(context, extensionId, (page) => sendSwCommand<string | undefined>(page, 'GetInjectorError'))
        if (injectorError) throw new Error(`VM injector 注册失败: ${injectorError}`)
        console.log('[vm-driver] injector 注册成功')
    },
    installScript: installScriptViaSw
}
