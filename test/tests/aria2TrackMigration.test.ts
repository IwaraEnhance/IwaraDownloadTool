import { Test, TestGroup } from '../framework.ts'
import { migrations } from '../../src/core/migration.ts'

/**
 * Aria2Track 队列拆分迁移（aria2track-queue-split）单测：
 * 与旧版 isAria2TrackDone 语义对齐的终态判定 + 瘦表转换 + 活任务字段剥离。
 * GM API 由 test/setup.ts 的有状态 mock 提供，迁移直改物理存储可被直接断言。
 */

declare const GM_getValue: (key: string, defaultValue?: any) => any
declare const GM_setValue: (key: string, value: any) => void
declare const GM_deleteValue: (key: string) => void

const target = migrations.find((m) => m!.name === 'aria2track-queue-split')!
const deps = { selectList: { clear() { } } } as const

const queueSplitTestGroup = new TestGroup('Aria2TrackQueueSplit 迁移', '旧版队列终态条目 → 瘦去重表转换（v3.3.129）')

queueSplitTestGroup.add(
    new Test('终态条目（pushedAt/pushDone/completedAt）→ done 表 + 出队；活任务留队并剥离废弃字段', 'async', async function () {
        GM_setValue('Aria2TrackQueue', [
            ['vid-pushed', { videoId: 'vid-pushed', gid: 'g1', addedAt: 1000, completedAt: 2000, pushedAt: 3000 }],
            ['vid-pushdone', { videoId: 'vid-pushdone', gid: 'g2', addedAt: 1000, pushDone: true }],
            ['vid-completed', { videoId: 'vid-completed', gid: 'g3', addedAt: 1500, completedAt: 99000 }],
            ['vid-pushfailed', { videoId: 'vid-pushfailed', gid: 'g4', addedAt: 1000, completedAt: 2000, pushFailedAt: 3000 }],
            ['vid-live', { videoId: 'vid-live', gid: 'g5', addedAt: 1000 }]
        ])
        GM_deleteValue('Aria2TrackDone')
        await (target as any).run(deps)

        // ⚠️ Aria2TrackDone 物理形态 = GMSyncDictionary 契约的 entries 数组（Array<[videoId, doneAt]>，
        // 见 dictionary.toArray）——非对象。写成对象会被新页面加载时 filter 抛错→构造兑底空表→saveToStorage 清盘
        const done = Object.fromEntries(GM_getValue('Aria2TrackDone', []) as Array<[string, number]>) as Record<string, number>
        const queue = GM_getValue('Aria2TrackQueue', []) as Array<[string, any]>
        const queueKeys = queue.map(([k]) => k)

        // 终态三条入 done 表（doneAt 取最精确时间戳）
        if (done['vid-pushed'] !== 3000) throw new Error(`pushedAt 条目应记 doneAt=3000，实际 ${done['vid-pushed']}`)
        if (done['vid-pushdone'] !== 1000) throw new Error(`pushDone 条目应记 addedAt=1000，实际 ${done['vid-pushdone']}`)
        if (done['vid-completed'] !== 99000) throw new Error(`completedAt 条目应记 doneAt=99000，实际 ${done['vid-completed']}`)
        // 推送失败退避中的条目不算终态，留在队列
        if (!queueKeys.includes('vid-pushfailed')) throw new Error('pushFailedAt 条目应留队（worker 重试中）')
        if (!queueKeys.includes('vid-live')) throw new Error('活任务应留队')
        if ('vid-pushfailed' in done || 'vid-live' in done) throw new Error('非终态条目不应写入 done 表')
        // 留队条目剥离废弃字段，保留 pushFailedAt
        const kept = queue.find(([k]) => k === 'vid-pushfailed')![1]
        if ('completedAt' in kept || 'pushedAt' in kept || 'pushDone' in kept) throw new Error('留队条目应剥离废弃终态字段')
        if (kept.pushFailedAt !== 3000) throw new Error('pushFailedAt 应保留（新版退避语义仍用）')
    })
)

queueSplitTestGroup.add(
    new Test('空队列/缺失键：幂等安全，不产生垃圾写入', 'async', async function () {
        GM_deleteValue('Aria2TrackQueue')
        GM_deleteValue('Aria2TrackDone')
        await (target as any).run(deps)
        // 缺失键时不写出空 done 表
        if (GM_getValue('Aria2TrackDone', undefined) !== undefined) throw new Error('缺失队列时不应写出 done 表')
        // 空队列（已拆分过/全新安装）同理
        GM_setValue('Aria2TrackQueue', [])
        await (target as any).run(deps)
        if (GM_getValue('Aria2TrackDone', undefined) !== undefined) throw new Error('空队列时不应写出 done 表')
    })
)

queueSplitTestGroup.add(
    new Test('done 表已有数据时合并不破坏既有记录；结构异常条目原样保留', 'async', async function () {
        GM_setValue('Aria2TrackQueue', [
            ['vid-old', { videoId: 'vid-old', gid: 'g1', completedAt: 500 }],
            ['weird-key', 'not-an-object']
        ])
        GM_setValue('Aria2TrackDone', [['vid-earlier', 111]]) // entries 形态（GMSyncDictionary 契约）
        await (target as any).run(deps)
        const done = Object.fromEntries(GM_getValue('Aria2TrackDone', []) as Array<[string, number]>) as Record<string, number>
        if (done['vid-earlier'] !== 111) throw new Error('既有 done 记录应保留')
        if (done['vid-old'] !== 500) throw new Error('新终态记录应写入')
        const queue = GM_getValue('Aria2TrackQueue', []) as Array<[string, any]>
        const weird = queue.find(([k]) => k === 'weird-key')
        if (!weird) throw new Error('结构异常条目应原样保留（不做破坏性清理）')
    })
)

// ── 大规模数据形态（重度用户 30 天积累的真实分布）──────────────────────────
// 旧版缺陷场景：终态记录长期堆在队列单键（300B+/条含完整 Cookie header），
// 2000 条 ≈ 670KB 单键。迁移必须在一次执行中正确分拣全部条目，且：
// ① 零数据丢失（每条要么落在 done 表、要么留队，计数闭合）；
// ② done 表只含瘦记录（videoId → number，不携带原条目的任何重字段）；
// ③ 留队条目零废弃字段（后续 GMSyncDictionary 加载即符合新契约）。

/** 构造一条旧版队列条目（字段齐全形态，含真实体量的 downloadParams/Cookie） */
function legacyTask(id: string, addedAt: number, overrides: Record<string, unknown> = {}) {
    return {
        videoId: id,
        gid: 'gid-' + id,
        downloadParams: {
            'force-save': true,
            'allow-overwrite': true,
            out: `[2026-01] Long Video Title ${id} [1080p].mp4`,
            dir: 'D:/Downloads/Iwara/Following/User',
            referer: 'www.iwara.tv',
            header: ['Cookie: cf_clearance=' + 'x'.repeat(120) + '; SESSION=' + 'y'.repeat(48)]
        },
        addedAt,
        ...overrides
    }
}

/** 批量构造混合队列：按给定比例生成终态/活任务，返回 [键值对数组, 期望分布] */
function buildBulkQueue(
    count: number,
    opts: { donePushed: number; donePushDone: number; doneCompleted: number; pushFailed: number; doneExistingInDone: number; weird: number }
) {
    const entries: Array<[string, any]> = []
    const now = Date.now()
    let i = 0
    const expectDone: Record<string, number> = {}
    const expectLive = new Set<string>()
    const push = (key: string, task: any): void => {
        entries.push([key, task])
    }
    for (let k = 0; k < opts.doneExistingInDone; k++, i++) {
        // 之前已迁移过的（done 表与队列同时存在——理论上不会，但防御合并语义）
        push(`exist-${i}`, legacyTask(`exist${i}`, now - 10 * 86400_000, { completedAt: now - 9 * 86400_000 }))
    }
    for (let k = 0; k < opts.donePushed; k++, i++) {
        const id = `pushed${i}`
        push(id, legacyTask(id, now - 86400_000, { completedAt: now - 3600_000, pushedAt: now - 1800_000 }))
        expectDone[id] = now - 1800_000
    }
    for (let k = 0; k < opts.donePushDone; k++, i++) {
        const id = `pushdone${i}`
        push(id, legacyTask(id, now - 86400_000, { pushDone: true }))
        expectDone[id] = now - 86400_000
    }
    for (let k = 0; k < opts.doneCompleted; k++, i++) {
        const id = `completed${i}`
        push(id, legacyTask(id, now - 86400_000, { completedAt: now - 7200_000 }))
        expectDone[id] = now - 7200_000
    }
    for (let k = 0; k < opts.pushFailed; k++, i++) {
        const id = `pushfailed${i}`
        push(id, legacyTask(id, now - 86400_000, { completedAt: now - 7200_000, pushFailedAt: now - 60_000 }))
        expectLive.add(id)
    }
    for (let k = 0; k < opts.weird; k++, i++) {
        push(`weird${i}`, 'garbage-' + k)
        expectLive.add(`weird${i}`) // 结构异常原样保留（不计 done、不出队）
    }
    // 剩余全是纯活任务
    const livePlain = count - i
    for (let k = 0; k < livePlain; k++, i++) {
        const id = `live${i}`
        push(id, legacyTask(id, now - 3600_000))
        expectLive.add(id)
    }
    return { entries, expectDone, expectLive }
}

queueSplitTestGroup.add(
    new Test('重度数据（2000 条混合：900 终态 + 60 推送失败 + 20 异常 + 1020 活）：全量分拣零丢失，done 表纯瘦记录', 'async', async function () {
        const { entries, expectDone, expectLive } = buildBulkQueue(2000, {
            donePushed: 300,
            donePushDone: 200,
            doneCompleted: 400,
            pushFailed: 60,
            doneExistingInDone: 0,
            weird: 20
        })
        GM_setValue('Aria2TrackQueue', entries)
        GM_deleteValue('Aria2TrackDone')
        await (target as any).run(deps)

        const done = Object.fromEntries(GM_getValue('Aria2TrackDone', []) as Array<[string, number]>) as Record<string, unknown>
        const queue = GM_getValue('Aria2TrackQueue', []) as Array<[string, any]>

        // ① 计数闭合：done 条数 = 期望终态数；队列 = 活 + 异常
        const doneKeys = Object.keys(done)
        if (doneKeys.length !== 900) throw new Error(`done 表应恰 900 条，实际 ${doneKeys.length}`)
        if (queue.length !== 1100) throw new Error(`队列应恰 1100 条（60 退避 + 20 异常 + 1020 活），实际 ${queue.length}`)
        // ② done 表瘦记录：值必须是纯 number（不含重字段），且无一样例携带 downloadParams
        for (const [key, value] of Object.entries(done)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`done[${key}] 应为 number，实际 ${typeof value}`)
        }
        if (done['pushed0'] !== expectDone['pushed0']) throw new Error('pushed 类 doneAt 取 pushedAt')
        if (done['pushdone0'] !== expectDone['pushdone0']) throw new Error('pushDone 类 doneAt 取 addedAt')
        if (done['completed0'] !== expectDone['completed0']) throw new Error('completed 类 doneAt 取 completedAt')
        // ③ 逐条核对：期望 done 的都在、期望活的都在且互不越界
        for (const id of Object.keys(expectDone)) {
            if (!(id in done)) throw new Error(`终态条目 ${id} 缺失于 done 表`)
        }
        const queueKeys = new Set(queue.map(([k]) => k))
        for (const id of expectLive) {
            if (!queueKeys.has(id)) throw new Error(`应留队条目 ${id} 丢失`)
            if (id in done) throw new Error(`留队条目 ${id} 不应出现在 done 表`)
        }
        // ④ 留队条目零废弃字段（抽样全量核对——字符串形态的垃圾条目除外）
        for (const [key, task] of queue) {
            if (typeof task !== 'object' || task === null) continue
            if ('completedAt' in task || 'pushDone' in task || 'pushedAt' in task) {
                throw new Error(`留队条目 ${key} 残留废弃字段`)
            }
        }
        // ⑤ 单键体积语义：瘦表每条值是 number——序列化体积应远小于原条目（抽查均值 < 60B）
        const doneJson = JSON.stringify(done)
        const perEntry = doneJson.length / doneKeys.length
        if (perEntry > 60) throw new Error(`done 表均条体积应 <60B（瘦记录），实际 ${perEntry.toFixed(1)}B`)
    })
)

queueSplitTestGroup.add(
    new Test('边界分布：100% 终态队列（老用户长期未清）全量转出后队列清空', 'async', async function () {
        const entries: Array<[string, any]> = []
        const now = Date.now()
        for (let i = 0; i < 500; i++) {
            // 混合三种终态，全部老时间戳（< 30 天窗口内，但都是终态）
            const kind = i % 3
            if (kind === 0) entries.push([`a${i}`, legacyTask(`a${i}`, now - 86400_000, { completedAt: now - 7200_000, pushedAt: now - 3600_000 })])
            else if (kind === 1) entries.push([`b${i}`, legacyTask(`b${i}`, now - 86400_000, { pushDone: true })])
            else entries.push([`c${i}`, legacyTask(`c${i}`, now - 86400_000, { completedAt: now - 7200_000 })])
        }
        GM_setValue('Aria2TrackQueue', entries)
        GM_deleteValue('Aria2TrackDone')
        await (target as any).run(deps)
        const done = Object.fromEntries(GM_getValue('Aria2TrackDone', []) as Array<[string, number]>) as Record<string, number>
        const queue = GM_getValue('Aria2TrackQueue', []) as Array<[string, any]>
        if (Object.keys(done).length !== 500) throw new Error(`500 终态应全量转出，实际 ${Object.keys(done).length}`)
        if (queue.length !== 0) throw new Error(`全终态队列应清空，实际残留 ${queue.length}`)
    })
)

queueSplitTestGroup.add(
    new Test('历史缺陷防线：done 表为旧对象形态时兼容读取并转为 entries 写回', 'async', async function () {
        GM_setValue('Aria2TrackQueue', [
            ['vid-new', { videoId: 'vid-new', gid: 'g9', addedAt: 1000, completedAt: 2000 }]
        ])
        GM_setValue('Aria2TrackDone', { 'vid-legacy-obj': 777 }) // 旧迁移写入的裸对象形态
        await (target as any).run(deps)
        const doneRaw = GM_getValue('Aria2TrackDone', []) as Array<[string, number]>
        if (!Array.isArray(doneRaw)) throw new Error('迁移后 done 表必须为 entries 数组形态（对象形态会被 GMSyncDictionary 清盘）')
        const done = Object.fromEntries(doneRaw)
        if (done['vid-legacy-obj'] !== 777) throw new Error('旧对象形态记录应无损转入 entries')
        if (done['vid-new'] !== 2000) throw new Error('新终态记录应写入')
    })
)

export default queueSplitTestGroup
