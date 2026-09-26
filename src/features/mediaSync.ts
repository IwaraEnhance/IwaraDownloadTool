/**
 * MediaCenter 同步编排（推送 + 批量同步，经运行时注入的 hook 被下载完成回调触发）。
 * aria2TrackManager 在下载完成后经运行时注入的 hook 调用推送（feature→download 单向，消除环）。
 */
import '../core/env'
import { delay, isNullOrUndefined, prune, stringify } from '../core/env'
import { ToastType } from '../core/enum'
import { config } from '../core/config'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { db } from '../core/db'
import { newToast, toastNode } from '../ui/notify'
import { createProgressTracker } from './progress'
import { getDownloadPath } from '../download/downloadPath'
import { getMoreCompleteVideoInfo, parseVideoInfo } from '../network/video'
import { createMedia, fetchMediaList, isMediaCenterConfigured, mediaCenterApiBase, mediaCenterAuthHeaders, mediaCenterRecordExists, updateMedia } from '../network/mediaCenter'

const log = createLogger('MediaCenter')
const mediaLog = createLogger('MediaCenter')

/** MediaCenter 映射有效性验证结果缓存：key = API 地址 + mediaCenterId（切换实例后缓存自动失效，重新验证），
 * 避免扫描/推送对同一映射反复发起 GET 请求 */
const mediaCenterIdMapValidateCache = new Map<string, { valid: boolean; checkedAt: number }>()
/** 映射验证结果缓存有效期（毫秒，6 小时）：有效结果在缓存期内不再重复验证 */
const MEDIA_CENTER_ID_MAP_VALIDATE_TTL = 6 * 60 * 60 * 1000

/** 验证 MediaCenter 映射在服务端是否仍然存在（GET /api/media/{id}）：
 * - 200：映射有效，结果按 TTL 缓存（key 含 API 地址，切换实例自动失效）；
 * - 404：映射失效——删除本地 idmap 并返回 undefined（调用方重新走 createMedia 流程）；
 * - 其他状态/网络异常：保守视为有效（返回原 id），避免误删映射导致重复推送；
 * - MediaCenter 未配置：不做请求，直接视为有效。 */
async function verifyMediaCenterMapping(videoId: string, mediaCenterId: string): Promise<string | undefined> {
    if (!isMediaCenterConfigured()) return mediaCenterId
    const cacheKey = `${config.mediaCenterApi}|${mediaCenterId}`
    const cached = mediaCenterIdMapValidateCache.get(cacheKey)
    if (cached && Date.now() - cached.checkedAt < MEDIA_CENTER_ID_MAP_VALIDATE_TTL) {
        return cached.valid ? mediaCenterId : undefined
    }
    try {
        const exists = await mediaCenterRecordExists(mediaCenterId)
        if (exists) {
            mediaCenterIdMapValidateCache.set(cacheKey, { valid: true, checkedAt: Date.now() })
            return mediaCenterId
        }
        // 404（或不可达时的非 2xx）：仅当能确认不存在时删除本地映射；网络异常保守保留
        mediaLog.warn(`映射失效: ${videoId} → ${mediaCenterId} 在服务端不存在，删除本地映射`)
        await db.deleteMediaCenterIdMap(videoId)
        mediaCenterIdMapValidateCache.delete(cacheKey)
        return undefined
    } catch (e) {
        mediaLog.warn(`验证映射 ${videoId} → ${mediaCenterId} 异常，保守视为有效: ${stringify(e)}`)
        return mediaCenterId
    }
}

/**
 * 将视频元数据推送到 MediaCenter
 * 流程：先 createMedia 创建媒体记录，再 updateMedia 更新完整元数据
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export async function pushToMediaCenter(videoInfo: FullVideoInfo, mediaCenterId: string | undefined = undefined): Promise<boolean> {
    if (!isMediaCenterConfigured()) return false
    const downloadPath = getDownloadPath(videoInfo)

    try {
        // 校验映射在服务端仍有效：失效 → verify 已删除本地映射并返回 undefined → 重新走 createMedia 流程
        if (!isNullOrUndefined(mediaCenterId) && !mediaCenterId.isEmpty()) {
            mediaCenterId = await verifyMediaCenterMapping(videoInfo.ID, mediaCenterId)
        }

        if (isNullOrUndefined(mediaCenterId) || mediaCenterId.isEmpty()) {
            // 第一步：createMedia — 创建媒体记录（用 iwara 视频 ID 作为 fileHash 去重标识）
            const created = await createMedia(prune({
                filePath: downloadPath.fullPath,
                fileHash: videoInfo.ID
            }))
            if (!created.ok) {
                if (created.conflict?.existingId && !created.conflict.existingId.isEmpty()) {
                    // fileHash 重复，复用已有记录
                    mediaCenterId = created.conflict.existingId
                    await db.putMediaCenterIdMap(videoInfo.ID, mediaCenterId)
                    mediaLog.debug(`createMedia 409, reuse existing ${videoInfo.ID} → ${mediaCenterId}`)
                } else {
                    mediaLog.warn(`createMedia failed for ${videoInfo.ID}:`, created.error ?? created.status)
                    return false
                }
            } else {
                mediaCenterId = created.id
                await db.putMediaCenterIdMap(videoInfo.ID, mediaCenterId)
            }
        }

        // 第二步：updateMedia — 更新完整元数据
        const updateBody = prune({
            filePath: downloadPath.fullPath,
            fileHash: videoInfo.ID,
            title: videoInfo.Title,
            description: videoInfo.Description ?? '',
            source: 'iwara',
            author: videoInfo.Author,
            altNames: videoInfo.Alias.isEmpty() ? undefined : [videoInfo.Alias],
            tags: (videoInfo.Tags ?? []).map((t) => t.id),
            duration: videoInfo.RAW?.file?.duration,
            sourceMeta: videoInfo.RAW ? JSON.stringify(videoInfo.RAW) : undefined,
            createdAt: new Date(videoInfo.UploadTime).toISOString()
        })
        const updated = await updateMedia(mediaCenterId, updateBody)
        if (!updated.ok) {
            if (updated.status === 404) {
                // 服务端记录不存在（验证通过后又被删除/实例切换）：清理本地映射，下次推送/扫描自动重建
                mediaLog.warn(`updateMedia 404 for ${videoInfo.ID}: 服务端记录不存在，删除本地映射 ${mediaCenterId}`)
                await db.deleteMediaCenterIdMap(videoInfo.ID)
            } else {
                mediaLog.warn(`updateMedia failed for ${videoInfo.ID}: ${updated.status ?? ''} ${updated.error ?? ''}`)
            }
            return false
        }

        mediaLog.debug('metadata pushed:', videoInfo.ID, '→', mediaCenterId)
        return true
    } catch (error) {
        mediaLog.warn(`Push metadata error for ${videoInfo.ID}:`, stringify(error))
    }

    return false
}

/**
 * 将浏览器数据库中缓存的视频元数据同步到 MediaCenter
 * 分两阶段执行：
 *   阶段一：从 MediaCenter 拉取全部视频列表，通过 title 匹配 iwara 视频 ID 建立映射
 *   阶段二：遍历匹配项，读取/解析完整元数据并更新到 MediaCenter
 */
export async function syncCachedToMediaCenter(): Promise<void> {
    if (!isMediaCenterConfigured()) {
        newToast(ToastType.Warn, {
            node: toastNode(`请先配置 MediaCenter API 地址和密钥`, 'MediaCenter 同步'),
            duration: 3000
        }).show()
        return
    }

    const apiBase = mediaCenterApiBase()
    const authHeaders = mediaCenterAuthHeaders()

    const total = await db.countVideos()

    if (total === 0) {
        newToast(ToastType.Info, {
            text: `没有找到缓存的视频数据`,
            duration: 3000
        }).show()
        return
    }

    // ── 阶段一：从 MediaCenter 拉取全部视频列表，通过 title 匹配 iwara 视频 ID 建立映射 ──
    const phaseStartTime = Date.now()
    let stepStartTime = phaseStartTime

    const matchedMap = await db.getAllMediaCenterIdMaps() // 先加载本地已有的映射缓存
    log.debug(`步骤1/4 加载本地映射缓存: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s`)
    stepStartTime = Date.now()

    // 阶段一进度域（常驻 toast + 文本刷新 + 收起三件套收敛）
    const listProgress = createProgressTracker(`正在从 MediaCenter 拉取视频列表...`)
    listProgress.start()

    try {
        const items = await fetchMediaList()

        log.debug(`步骤2/4 拉取 MediaCenter 列表: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s（${items.length} 条）`)
        stepStartTime = Date.now()

        listProgress.update(`MediaCenter 列表拉取完成，共 ${items.length} 条记录，正在遍历本地数据库建立映射...`)

        const entriesToSave: Array<{ videoId: string; mediaCenterId: string }> = []
        let processedCount = 0

        // ── 预建查找索引：避免每视频 O(n) 扫描 items ──
        const hashToId = new Map<string, string>()
        const tokenToId = new Map<string, string>()
        const titleContains: Array<{ id: string; lowerTitle: string }> = []
        for (const m of items) {
            if (!isNullOrUndefined(m.fileHash) && !m.fileHash.isEmpty()) {
                hashToId.set(m.fileHash, m.id)
            }
            if (!isNullOrUndefined(m.title) && !m.title.isEmpty()) {
                const lowerTitle = m.title.toLowerCase()
                titleContains.push({ id: m.id, lowerTitle })
                for (const token of lowerTitle.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
                    if (!tokenToId.has(token)) tokenToId.set(token, m.id)
                }
            }
        }

        // 使用轻量级键遍历（只读视频 ID，不反序列化整个对象）
        const keyIterator = db.iterateVideoKeysBatched(10240)
        let idx = 0
        let currentBatch: string[] = []
        let keyBatchIter = keyIterator[Symbol.asyncIterator]()
        let prefetchDone = false
        let prefetchPromise: Promise<void> | null = null
        const batchQueue: string[][] = []

        const prefetchNextBatch = async (): Promise<void> => {
            const t0 = Date.now()
            const { value, done } = await keyBatchIter.next()
            log.debug(`批次获取: ${((Date.now() - t0) / 1000).toFixed(1)}s（${value?.length ?? 0} 条）`)
            if (done) {
                prefetchDone = true
            } else {
                batchQueue.push(value)
            }
        }

        const ensureBatch = async (): Promise<boolean> => {
            if (batchQueue.length > 0) return true
            if (prefetchDone) return false
            if (!prefetchPromise) {
                prefetchPromise = prefetchNextBatch().finally(() => {
                    prefetchPromise = null
                })
            }
            await prefetchPromise
            return batchQueue.length > 0
        }

        // 启动第一批预取
        prefetchPromise = prefetchNextBatch().finally(() => {
            prefetchPromise = null
        })

        const nextVideo = async (): Promise<void> => {
            if (idx >= currentBatch.length) {
                if (!(await ensureBatch())) return
                currentBatch = batchQueue.shift()!
                idx = 0
                if (batchQueue.length < 2 && !prefetchDone && !prefetchPromise) {
                    prefetchPromise = prefetchNextBatch().finally(() => {
                        prefetchPromise = null
                    })
                }
            }
            const videoId = currentBatch[idx++]
            processedCount++
            if (Date.now() - stepStartTime >= 500 || processedCount === 1 || processedCount === total) {
                listProgress.update(`正在匹配映射... [${processedCount}/${total}] 已映射: ${matchedMap.size}`)
            }
            if (matchedMap.has(videoId)) return nextVideo()

            // 1) fileHash 精确匹配 O(1)
            if (hashToId.has(videoId)) {
                const mcId = hashToId.get(videoId)!
                matchedMap.set(videoId, mcId)
                entriesToSave.push({ videoId, mediaCenterId: mcId })
                return nextVideo()
            }

            // 2) title token 快速命中 O(1)
            const videoIdLower = videoId.toLowerCase()
            if (tokenToId.has(videoIdLower)) {
                const mcId = tokenToId.get(videoIdLower)!
                matchedMap.set(videoId, mcId)
                entriesToSave.push({ videoId, mediaCenterId: mcId })
                return nextVideo()
            }

            // 3) 回退：title 包含匹配（仅 token 未命中的极少数情况）
            for (const tc of titleContains) {
                if (tc.lowerTitle.indexOf(videoIdLower) !== -1) {
                    matchedMap.set(videoId, tc.id)
                    entriesToSave.push({ videoId, mediaCenterId: tc.id })
                    break
                }
            }

            return nextVideo()
        }
        await Promise.allSettled(Array.from({ length: Math.min(64, total) }, () => nextVideo()))

        log.debug(`步骤3/4 遍历数据库匹配映射: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s（${processedCount} 条，映射 ${entriesToSave.length} 条）`)
        stepStartTime = Date.now()

        if (entriesToSave.length > 0) {
            await db.bulkPutMediaCenterIdMaps(entriesToSave)
        }

        log.debug(`步骤4/4 保存映射到本地: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s`)
        const totalTime = (Date.now() - phaseStartTime) / 1000

        listProgress.update(`映射建立完成，共 ${matchedMap.size} 条映射（新增 ${entriesToSave.length} 条），总耗时 ${totalTime.toFixed(1)}s`)
    } catch (error) {
        log.error('拉取列表失败:', stringify(error))
        listProgress.close()
        newToast(ToastType.Error, {
            node: toastNode([`MediaCenter 列表拉取失败，请检查 API 地址和密钥`, { nodeType: 'br' }, stringify(error)], 'MediaCenter 同步'),
            duration: 10000,
            close: true,
            onClick() {
                this.hide()
            }
        }).show()
        return
    }

    listProgress.close()

    if (matchedMap.size === 0) {
        newToast(ToastType.Info, {
            text: `MediaCenter 中未找到包含 fileHash 的视频记录，无法同步`,
            duration: 3000
        }).show()
        return
    }

    // ── 阶段二：遍历匹配项，解析完整元数据并更新到 MediaCenter ──
    let updated = 0
    let skipped = 0
    let updateErrors = 0

    const updateProgress = createProgressTracker(`MediaCenter 更新中... [0/${matchedMap.size}]`)
    updateProgress.start()

    const matchedIds = [...matchedMap.keys()]
    const concurrency = 6
    let idx = 0
    const nextUpdate = async () => {
        if (idx >= matchedIds.length) return
        const i = idx++
        const videoId = matchedIds[i]
        const mediaCenterId = matchedMap.get(videoId)!
        try {
            let video = (await db.getVideoById(videoId)) ?? { Type: 'init', ID: videoId }
            if (video.Type !== 'full') {
                const pvideo = await parseVideoInfo(video)
                video = getMoreCompleteVideoInfo(video, pvideo)
            }

            if (video.Type === 'cache' || video.Type === 'init') {
                skipped++
                return
            }
            db.putVideo(video)
            if (await pushToMediaCenter(video as FullVideoInfo, mediaCenterId)) {
                updated++
            } else {
                updateErrors++
            }
        } catch (error) {
            log.warn(`同步异常 ${videoId}:`, stringify(error))
            updateErrors++
        } finally {
            updateProgress.update(`MediaCenter 更新中... [${updated + skipped + updateErrors}/${matchedMap.size}] 更新: ${updated} 跳过: ${skipped} 错误: ${updateErrors}`)
            if (idx < matchedIds.length) await delay(100)
            await nextUpdate()
        }
    }
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, matchedIds.length) }, () => nextUpdate()))

    updateProgress.close()

    newToast(ToastType.Info, {
        text: `MediaCenter 同步完成！已更新: ${updated}, 跳过: ${skipped}, 错误: ${updateErrors}`,
        duration: 5000,
        close: true,
        onClick() {
            this.hide()
        }
    }).show()
}
