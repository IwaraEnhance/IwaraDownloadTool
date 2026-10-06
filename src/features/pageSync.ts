import '../core/env'
import { delay, isNullOrUndefined, stringify } from '../core/env'
import { GMLockTTL } from '../core/gmLock'
import { ToastType } from '../core/enum'
import { createLogger } from '../core/log'
import { db } from '../core/db'
import { verifyLogin } from '../network/auth'
import { fetchVideoPage, fetchSubscribedVideos } from '../network/videos'
import { newToast, toastNode } from '../ui/notify'
import { parseVideoInfo } from '../network/video'
import { runBatchTask, taskConflict } from './progress'
import site from '../data/site.json'

const log = createLogger('SyncPages')

/** 页面遍历跨页互斥锁名（防止多个标签页同时遍历，浪费请求且易触发限流）；锁操作走 runBatchTask 模板 */
const SYNC_PAGES_LOCK = 'syncAllVideosPages'

/** 一个月的毫秒数（计算值，JSON 只能存字面量无法表达，故保留在 TS） */
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

/** 订阅页遍历跨页互斥锁名（慢迭代租约 BatchTaskSlow；冲突时静默让位） */
const PARSE_UNLISTED_LOCK = 'parseUnlistedAndPrivate'
/** 单页内防重入（pageChange 频繁触发时避免并发启动多个遍历）；跨页互斥由 GMLock 保证 */
let parseUnlistedRunning = false

/**
 * 抓取单页视频列表并缓存到 IndexedDB
 * @returns true 表示成功(含空页)，false 表示请求失败，'last' 表示已是最后一页
 */
async function fetchAndCachePage(page: number): Promise<true | false | 'last'> {
    let pageData: Iwara.IPage<Iwara.Video>
    try {
        pageData = await fetchVideoPage(page)
    } catch {
        return false
    }

    const rawVideos = pageData.results

    // 判断是否还有下一页
    if (pageData.page * pageData.limit >= pageData.count) return 'last'
    if (isNullOrUndefined(rawVideos) || rawVideos.length === 0) return true

    // 解析并批量写入 DB（与 handleVideosResponse 一致）
    const list: Array<PartialVideoInfo | FullVideoInfo> = []
    let idx = 0
    const concurrency = 6
    const nextParse = async () => {
        if (idx >= rawVideos.length) return
        const i = idx++
        try {
            const info = await parseVideoInfo({ Type: 'cache', ID: rawVideos[i].id, RAW: rawVideos[i] })
            if (info.Type === 'partial' || info.Type === 'full') {
                list.push(info)
            }
        } catch {
        } finally {
            if (idx < rawVideos.length) await delay(100)
            await nextParse()
        }
    }
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, rawVideos.length) }, () => nextParse()))

    if (list.length > 0) {
        const ids = list.map((v) => v.ID)
        const existing = await db.getVideosByIds(ids)
        const fullVideos = existing.filter((v) => v.Type === 'full')
        const toUpdate = list.difference(fullVideos, 'ID')
        if (toUpdate.any()) {
            await db.bulkPutVideos(toUpdate)
            log.info(`update: ${toUpdate.length} ${toUpdate[0].Title}`)
        }
    }

    return true
}

/**
 * 遍历 iwara 视频列表的所有页面，逐页抓取并通过 fetchAndCachePage 缓存到 IndexedDB
 * 使用 unlimitedFetch（自动处理跨域）手动解析响应并写入数据库
 * 每页请求间隔加入随机 jitter 避免触发限流
 */
export async function syncAllVideosPages(): Promise<void> {
    if (!(await verifyLogin())) {
        newToast(ToastType.Warn, {
            node: toastNode(`请先登录 iwara`, '页面遍历'),
            duration: 3000
        }).show()
        return
    }

    // 防多页面重入：仅允许一个页面执行全局遍历（锁/心跳/提示/释放由 runBatchTask 内聚）
    return runBatchTask<void>({
        lockName: SYNC_PAGES_LOCK,
        ttl: GMLockTTL.BatchTask,
        onConflict: 'exit',
        iterate: async (ctl) => {
            ctl.progress(`正在遍历视频页面...`)

            let succeeded = 0
            const failedPages: number[] = []
            let page = site.syncStartPage

            while (true) {
                // 心跳由 GMLock 内部维护：循环内仅复核持有状态，失去锁立即让位
                if (!ctl.isHeld()) {
                    taskConflict()
                    return
                }
                try {
                    const result = await fetchAndCachePage(page)

                    if (result === 'last') {
                        succeeded++
                        ctl.progress(`正在遍历视频页面... 已是最后一页 (${page})，提前结束`)
                        break
                    }

                    if (result === false) {
                        log.warn(`页面 ${page} 失败`)
                        failedPages.push(page)
                        await delay(5000 + Math.random() * 1000)
                        page++
                        continue
                    }

                    // true: 成功（含空页）
                    succeeded++
                    ctl.progress(`正在遍历视频页面... 第 ${page} 页 (失败: ${failedPages.length})`)
                } catch (error) {
                    log.warn(`页面 ${page} 异常:`, stringify(error))
                    failedPages.push(page)
                }

                await delay(500 + Math.random() * 1000)
                page++
            }

            // ── 重试失败的页面 ──
            let retryFailed: number[] = []
            if (failedPages.length > 0) {
                ctl.progress(`正在重试 ${failedPages.length} 个失败页面...`)

                for (const retryPage of failedPages) {
                    // 心跳由 GMLock 内部维护：循环内仅复核持有状态，失去锁立即让位
                    if (!ctl.isHeld()) {
                        taskConflict()
                        return
                    }
                    try {
                        const result = await fetchAndCachePage(retryPage)

                        if (result === false) {
                            log.warn(`重试页面 ${retryPage} 仍失败`)
                            retryFailed.push(retryPage)
                            continue
                        }

                        succeeded++
                        ctl.progress(`正在重试失败页面... ${retryPage} 成功 (剩余 ${failedPages.length - retryFailed.length - (failedPages.indexOf(retryPage) + 1 - retryFailed.length)} 个待重试)`)
                    } catch (error) {
                        log.warn(`重试页面 ${retryPage} 异常:`, stringify(error))
                        retryFailed.push(retryPage)
                    }

                    await delay(500 + Math.random() * 1000)
                }
            }

            ctl.progressEnd()

            newToast(ToastType.Info, {
                text: `页面遍历完成！成功: ${succeeded} 页${retryFailed.length > 0 ? `，重试后仍失败: ${retryFailed.length} 页` : '，无失败'}`,
                close: true,
                onClick() {
                    this.hide()
                }
            }).show()

            if (retryFailed.length > 0) {
                log.warn(`始终失败的页码: ${retryFailed.join(', ')}`)
            }
        }
    })
}

/**
 * 遍历订阅页（慢迭代租约 + 冲突静默让位 + maxFindPages 上限 + 无失败重试），
 * 解析最近一个月内有未公开/私有视频的订阅页并入库。
 * 行为参数原样保留：retryDelay 1000、页间隔 delay(100)、终止条件（本页含私有视频且其已在当月库中）。
 */
export async function parseUnlistedAndPrivate(): Promise<void> {
    // 防重入：pageChange 频繁触发时避免并发启动多个遍历
    if (parseUnlistedRunning) return
    parseUnlistedRunning = true
    try {
        await runBatchTask<void>({
            lockName: PARSE_UNLISTED_LOCK,
            ttl: GMLockTTL.BatchTaskSlow,
            onConflict: 'exit',
            iterate: async (ctl) => {
                if (!(await verifyLogin())) return
                const lastMonthTimestamp = Date.now() - MONTH_MS
                const thisMonthUnlistedAndPrivateVideos = await db.getFilteredVideos(lastMonthTimestamp, Infinity)
                const parseUnlistedAndPrivateVideos: VideoInfo[] = []

                const MAX_FIND_PAGES = site.maxFindPages
                let pageCount = 0
                log.debug(`Starting fetch loop. MAX_PAGES=${MAX_FIND_PAGES}`)

                while (pageCount < MAX_FIND_PAGES) {
                    // 心跳由 GMLock 内部维护：循环内仅复核持有状态，失去锁立即让位
                    if (!ctl.isHeld()) return
                    log.debug(`Fetching page ${pageCount}.`)
                    const data = (await fetchSubscribedVideos(pageCount)).results
                    log.debug(`Page ${pageCount} returned ${data.length} videos.`)
                    data.forEach((info) => (info.user.following = true))
                    const videoPromises = data.map((info) =>
                        parseVideoInfo({
                            Type: 'cache',
                            ID: info.id,
                            RAW: info
                        })
                    )
                    log.debug('Initializing VideoInfo promises.')
                    const videoInfos = await Promise.all(videoPromises)
                    parseUnlistedAndPrivateVideos.push(...videoInfos)
                    const foundPrivate = videoInfos.filter((i) => i.Type === 'partial' && (i.Private || i.Unlisted)).any()
                    log.debug('All VideoInfo objects initialized.')
                    if (foundPrivate && thisMonthUnlistedAndPrivateVideos.intersect(videoInfos, 'ID').any()) {
                        log.debug(`Found private video on page ${pageCount}.`)
                        break
                    }
                    log.debug(`Latest private video not found on page ${pageCount}, continuing.`)
                    pageCount++

                    log.debug(`Incremented page to ${pageCount}, delaying next fetch.`)
                    await delay(100)
                }
                log.debug('Fetch loop ended. Start updating the database')
                const existingVideos = await db.getVideosByIds(parseUnlistedAndPrivateVideos.map((v) => v.ID))
                const toUpdate = parseUnlistedAndPrivateVideos.difference(
                    existingVideos.filter((v) => v.Type === 'full'),
                    'ID'
                )
                if (toUpdate.any()) {
                    log.debug(`Need to update ${toUpdate.length} pieces of data.`)
                    await db.bulkPutVideos(toUpdate)
                    log.debug(`Update Completed.`)
                } else {
                    log.debug(`No need to update data.`)
                }
            }
        })
    } finally {
        parseUnlistedRunning = false
    }
}
