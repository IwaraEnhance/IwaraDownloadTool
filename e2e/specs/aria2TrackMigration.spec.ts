/**
 * Aria2Track 队列拆分迁移——真实浏览器端到端验证（iwara 站点页 + ScriptCat SW 消息总线）。
 *
 * ⚠️ 为什么不用 GM 宿主页：主脚本（迁移的执行体）注入面只有 iwara 域（mata.json
 * 的 include 泛通配），探针注入面 = 127.0.0.1（build.ts e2e-only 设计）——两个世界
 * 被 @include 切开，宿主页上主脚本不跑（guard=false 实测），迁移无法驱动；站点页上
 * 探针不在场，也无法直接读写脚本沙箱存储。通融方案 = 存储预置/校验改走 ScriptCat
 * SW 消息总线：
 * - 读脚本列表拿 uuid：action "serviceWorker/script/getAllScripts"（v1.4.0 script.ts init）；
 * - 写脚本 GM 存储：action "serviceWorker/value/setScriptValues"
 *   {uuid, keyValuePairs: [[key, value]], isReplace: false}（value.ts:171，值直接
 *   put 进 dataModel，number/string 无 RValue 编码变化）；
 * - 读脚本 GM 存储：action "serviceWorker/value/getScriptValue"（uuid）→ data 键值平铺。
 * 迁移本身仍在站点页真实驱动：主脚本 document-start 装载 → runMigrations。
 *
 * ⚠️ 本用例的 SW 消息总线协议层（getAllScripts/setValue RValue 编码）是 ScriptCat
 * 特有实现；在 TM 下不可用（TM 的 SW 消息走 method 分发、无 RValue 编码）。TM 下
 * 跳过本用例（数据形态转换由单测全覆盖，真机验证按管理器各有专属链路）。
 * 迁移本身仍在站点页真实驱动：主脚本 document-start 装载 → runMigrations。
 *
 * 复现真实升级路径：SW 消息预置旧版数据形态（version=3.3.128 + 旧队列条目）→ page.reload
 * （主脚本重装配 → 迁移执行，silent）→ SW 消息读回校验存储形态 + 无 alert + 脚本完整装配。
 *
 * 与单测（test/tests/aria2TrackMigration.test.ts）的分工：单测 GM mock 穷举分拣矩阵
 * （2000 条大数据形态）；本用例验证真实管理器宿主中的副作用面（alert 模态、reload 时序、
 * GMSyncDictionary 实例与迁移写盘的交互）。
 *
 * ⚠️ 管理器范围：本用例的 SW 消息总线协议（getAllScripts/getScriptValue/setScriptValues
 * + RValue 编码）是 ScriptCat 实现细节，TM 的 SW 消息走 method 分发且无 RValue 编码——
 * 仅 E2E_MANAGER=scriptcat 可跑（缺省），TM 下 test.skip（数据转换矩阵由单测全覆盖）。
 *
 * 前置：npm run build；运行：npm run e2e（全量）。
 */
import { expect, type Page } from '@playwright/test'
import { testSharedScript as test, managerOptionsUrl } from '../helpers/fixtures'
import { resolveManager } from '../managers'
import { getTargetSite } from '../helpers/mataInfo'
import { diagPage, fmtDiag } from '../helpers/diag'

/** 脚本 GM 存储的物理键名（迁移操作面） */
const QUEUE_KEY = 'Aria2TrackQueue'
const DONE_KEY = 'Aria2TrackDone'
const VERSION_KEY = 'version'

test.describe.configure({ mode: 'serial' })

/** 经 ScriptCat SW 消息总线读写脚本 GM 存储。
 * ⚠️ 每次调用都在 options 页现场 evaluate 发消息（函数不可结构化克隆，不能跨 evaluate 持函数）；
 * uuid 只解析一次缓存在 Node 侧。 */
async function openSwStore(page: Page, extensionId: string, scriptName: string): Promise<SwStore> {
    // 扩展页路径经驱动声明（managerOptionsUrl）：TM=options.html 在根目录，
    // ScriptCat=src/options.html——硬编码某一家的路径在另一家立即 ERR_FILE_NOT_FOUND
    const optionsUrl = managerOptionsUrl(extensionId)
    await page.goto(optionsUrl, { waitUntil: 'domcontentloaded' })
    // evaluate 返回值可序列化（函数参数不可）→ 直接 return uuid。
    // ⚠️ 裸 chrome.runtime.sendMessage 收到的是 Server 应答包裹 {code:0,data}（打包层
    // packages/message/server.ts 的 sendResponse）；Client 类的 do() 会解包，这里手动解
    const uuid = await page.evaluate(async (scriptName: string) => {
        const g = (globalThis as unknown as { chrome: { runtime: { sendMessage: (msg: unknown, cb: (r: any) => void) => void } } }).chrome
        const resp = await new Promise<any>((resolve) => {
            g.runtime.sendMessage({ action: 'serviceWorker/script/getAllScripts' }, (r) => resolve(r))
        })
        const unwrapped = (resp && typeof resp === 'object' && 'code' in resp ? resp.data : resp) ?? []
        const scripts = Array.isArray(unwrapped) ? unwrapped : []
        // 宽松匹配：脚本显示名可能带空格（如 "Iwara Download Tool"），全部去空格后再比较；排除探针
        const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
        const wanted = norm(scriptName)
        const target = scripts.find(
            (x: any) => typeof x.name === 'string' && norm(x.name).includes(wanted) && !norm(x.name).includes('probe')
        )
        if (!target) {
            const names = scripts.map((x: any) => x.name)
            throw new Error(`脚本 ${scriptName} 未安装（列表 names=${JSON.stringify(names)}）`)
        }
        return target.uuid
    }, scriptName)
    console.log(`[mig] 目标脚本 uuid=${uuid}`)
    /** 在 options 页现场发一条 SW 消息 */
    const send = async <T>(action: string, data: Record<string, unknown>): Promise<T> => {
        await page.goto(optionsUrl, { waitUntil: 'domcontentloaded' })
        return await page.evaluate(
            async ({ action, data, uuid }) => {
                const g = (globalThis as unknown as { chrome: { runtime: { sendMessage: (msg: unknown, cb: (r: any) => void) => void } } }).chrome
                return await new Promise<T>((resolve, reject) => {
                    g.runtime.sendMessage({ action, data: { ...data, uuid } }, (r) => {
                        const last = (g as any).runtime.lastError
                        if (last) return reject(new Error(String(last.message)))
                        resolve(r as T)
                    })
                })
            },
            { action, data, uuid }
        )
    }
    return {
        get: async (key: string) => {
            const resp = await send<unknown>('serviceWorker/value/getScriptValue', {})
            // 与 getAllScripts 一致：Server.sendResponse 统一包裹 {code:0,data}，手动解包
            const data = (resp && typeof resp === 'object' && 'code' in (resp as Record<string, unknown>)
                ? (resp as { data: Record<string, unknown> }).data
                : resp) as Record<string, unknown> | undefined
            return data?.[key]
        },
        set: async (key: string, value: unknown) => {
            // 值必须是 RValue 编码元组 [RType.STANDARD=0, value]（ValueService.setValues 内部
            // 直接 decodeRValue(rTyped1)——裸值会让 rTyped[0] 落到 default 分支取 rTyped[1]，
            // 存坏数据。options 页自身实现即 encodeRValue 同款三元组规则）
            const isEncoded = Array.isArray(value) && (value[0] === 0 || value[0] === 1 || value[0] === 2)
            const encoded: [number, unknown] = isEncoded ? (value as [number, unknown]) : [0, value]
            await send('serviceWorker/value/setScriptValues', { keyValuePairs: [[key, encoded]], isReplace: false })
        }
    }
}

type SwStore = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

test('迁移：升级路径下 aria2track-queue-split 静默执行（无 alert），存储形态转换正确，页面 reload 后正常装配', async ({ sharedSession }) => {
    // SW 消息总线协议是 ScriptCat 实现细节（见文件头注）：TM 下跳过而非跑挂
    test.skip(resolveManager().id !== 'scriptcat', 'SW 消息总线协议为 ScriptCat 特有（TM 无此 action/RValue 协议）；数据转换矩阵由单测全覆盖')
    test.setTimeout(240_000)
    const TARGET_SITE = getTargetSite()
    const page = sharedSession.page
    const extId = sharedSession.extensionId
    if (!page.url().startsWith(TARGET_SITE)) {
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
    // 等主脚本装配（守卫标记）——迁移在真实主链路上驱动。
    // 回调容错：迁移成功后主脚本会 location.reload()，导航瞬间 evaluate 会抛
    // “Execution context was destroyed”——poll 对回调异常不重试而是直接失败，必须自己吞掉
    console.log(`[mig] 等待主脚本装配: ${fmtDiag(await diagPage(page))}`)
    await expect
        .poll(
            async () => {
                try {
                    return await page.evaluate(() => !!(window as any).IwaraDownloadTool)
                } catch {
                    return false // 导航/reload 摧毁执行上下文——下一轮在新文档上再试
                }
            },
            { timeout: 90_000 }
        )
        .toBe(true)
    console.log('[mig] 主脚本已装配')

    // alert handler 先于 reload 注册（事件级，跨导航存活）。
    // 双保险：dialog 可能已被其他 handler/默认处理消化，accept 再报 no dialog 时忽略
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
        dialogs.push(`${dialog.type()}:${dialog.message()}`)
        dialog.accept().catch(() => { }) // No dialog is showing → 已被处理，忽略
    })

    // ── 阶段 B：SW 消息预置旧版形态（version=3.3.128 + 旧队列）──
    console.log('[mig] 打开 SW 存储口（options 页承载）…')
    const store = await openSwStore(page, extId, 'IwaraDownloadTool')
    const baseline = await store.get(VERSION_KEY)
    console.log(`[mig] 基线 version=${JSON.stringify(baseline)}`)

    const now = Date.now()
    await store.set(VERSION_KEY, '3.3.128')
    // ⚠️ isFirstRun 必须一并预置：全新安装路径上主脚本首跑走 firstRun（不写 version）——
    // 这也是 baseline 读回 undefined 的原因；若不置 false，迁移后主脚本的 location.reload()
    // 会再次加载页面，isFirstRun 无值 → firstRun() 清空全部 GM 存储，迁移成果被抹掉
    await store.set('isFirstRun', false)
    await store.set(QUEUE_KEY, [
        ['mvid-pushed', { videoId: 'mvid-pushed', gid: 'mg1', downloadParams: { out: 'a.mp4' }, addedAt: now - 86400_000, completedAt: now - 7200_000, pushedAt: now - 3600_000 }],
        ['mvid-completed', { videoId: 'mvid-completed', gid: 'mg2', downloadParams: { out: 'b.mp4' }, addedAt: now - 86400_000, completedAt: now - 5000_000 }],
        ['mvid-pushfailed', { videoId: 'mvid-pushfailed', gid: 'mg3', downloadParams: { out: 'c.mp4' }, addedAt: now - 86400_000, completedAt: now - 7200_000, pushFailedAt: now - 60_000 }],
        ['mvid-live', { videoId: 'mvid-live', gid: 'mg4', downloadParams: { out: 'd.mp4' }, addedAt: now - 3600_000 }]
    ])
    await store.set(DONE_KEY, [['mvid-earlier', now - 10 * 86400_000]]) // entries 形态（GMSyncDictionary 契约）
    console.log('[mig] 旧版数据已预置（version=3.3.128；队列 2 终态 + 1 退避 + 1 活）')

    // ── 阶段 C：reload 站点页（主脚本重装配 → 迁移执行）──
    await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    console.log(`[mig] reload 完成: ${fmtDiag(await diagPage(page))}`)
    await expect
        .poll(
            async () => {
                try {
                    return await page.evaluate(() => !!(window as any).IwaraDownloadTool)
                } catch {
                    return false // 预期内的迁移后 location.reload() 导航窗口
                }
            },
            { timeout: 90_000 }
        )
        .toBe(true)
    console.log('[mig] reload 后主脚本已装配')

    // 断言 ①：无 alert（silent 迁移）
    expect(dialogs, `迁移不应触发用户提示（实际 ${JSON.stringify(dialogs)}）`).toEqual([])
    console.log('[mig] ✓ 无 alert')

    // 断言 ②③：新 store 实例读回（options 页重新打开，无跨实例缓存）
    const store2 = await openSwStore(page, extId, 'IwaraDownloadTool')
    const version = (await store2.get(VERSION_KEY)) as string
    console.log(`[mig] 迁移后 version=${JSON.stringify(version)}（预置 3.3.128）`)
    expect(version).not.toBe('3.3.128')
    expect(version).toMatch(/^\d+\.\d+\.\d+/)

    const done = Object.fromEntries(((await store2.get(DONE_KEY)) ?? []) as Array<[string, number]>) as Record<string, number>
    const queue = (await store2.get(QUEUE_KEY)) as Array<[string, any]>
    const queueKeys = queue.map(([k]) => k)
    console.log(`[mig] 迁移后存储: done=${JSON.stringify(done)}, queue keys=${JSON.stringify(queueKeys)}`)
    expect(done['mvid-pushed']).toBe(now - 3600_000)
    expect(done['mvid-completed']).toBe(now - 5000_000)
    expect(done['mvid-earlier']).toBe(now - 10 * 86400_000)
    expect(queueKeys).toEqual(expect.arrayContaining(['mvid-pushfailed', 'mvid-live']))
    expect(queueKeys).not.toContain('mvid-pushed')
    expect(queueKeys).not.toContain('mvid-completed')
    const pushFailed = queue.find(([k]) => k === 'mvid-pushfailed')![1]
    expect(pushFailed.pushFailedAt).toBe(now - 60_000)
    expect(pushFailed.completedAt).toBeUndefined()
    expect(pushFailed.pushedAt).toBeUndefined()
    const live = queue.find(([k]) => k === 'mvid-live')![1]
    expect(live.gid).toBe('mg4')
    console.log('[mig] ✓ 全部通过：无 alert、版本推进、存储形态正确、脚本正常装配（守卫）')

    // ── 收尾交接：把共享会话还原为「全新安装」态 ──
    // 本 spec 按文件字典序最先执行，会消费掉 fixtures 建好的一次性首装态：
    // version/isFirstRun=false 留存 → uiBehavior 首装用例期待的引导 overlay 永不出现
    // → 30s 超时级联拖垮串行套件（表现为站点页反复重载/卡住）。
    // 置回 isFirstRun=true 后 reload：main() 走 firstRun() 清空全部 GM 存储，
    // 下游拿到与首装等价的干净状态；version 无需处理（firstRun 全清）。
    await store2.set('isFirstRun', true)
    await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect
        .poll(
            async () => {
                try {
                    return await page.evaluate(() => !!(window as any).IwaraDownloadTool)
                } catch {
                    return false
                }
            },
            { timeout: 90_000 }
        )
        .toBe(true)
    console.log('[mig] 共享会话已交还首装态（isFirstRun=true，引导层待 uiBehavior 验收）')
})
