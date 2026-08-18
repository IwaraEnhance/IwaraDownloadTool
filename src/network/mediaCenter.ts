import '../core/env'
import { delay, isNullOrUndefined, stringify } from '../core/env'
import { ToastType } from '../core/enum'
import { config } from '../core/config'
import { unlimitedFetch, renderNode } from '../core/extension'
import { createLogger } from '../core/log'
import { db } from '../core/db'
import { newToast, toastNode } from '../ui/notify'
import { getDownloadPath } from '../download/downloadPath'
import { getMoreCompleteVideoInfo, parseVideoInfo } from './video'
import { pushToMediaCenter } from '../download/aria2TrackManager'

const log = createLogger('MediaCenter')

/**
 * 将浏览器数据库中缓存的视频元数据同步到 MediaCenter
 * 分两阶段执行：
 *   阶段一：从 MediaCenter 拉取全部视频列表，通过 title 匹配 iwara 视频 ID 建立映射
 *   阶段二：遍历匹配项，读取/解析完整元数据并更新到 MediaCenter
 */
export async function syncCachedToMediaCenter(): Promise<void> {
    if (config.mediaCenterApi.isEmpty() || config.mediaCenterApiKey.isEmpty()) {
        newToast(ToastType.Warn, {
            node: toastNode(`请先配置 MediaCenter API 地址和密钥`, 'MediaCenter 同步'),
            duration: 3000
        }).show()
        return
    }

    const apiBase = config.mediaCenterApi.replace(/\/+$/, '')
    const authHeaders = {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${config.mediaCenterApiKey}`
    }

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

    const listProgressNode = renderNode({
        nodeType: 'p',
        childs: `正在从 MediaCenter 拉取视频列表...`
    })
    const listProgressToast = newToast(ToastType.Info, {
        node: listProgressNode,
        duration: -1
    })
    listProgressToast.show()

    try {
        const listUrl = `${apiBase}/api/media?limit=0&sortBy=createdAt&sortOrder=desc`
        const response = await unlimitedFetch(listUrl, { headers: authHeaders })

        if (!response.ok) {
            throw new Error(`拉取 MediaCenter 列表失败: ${response.status} ${await response.text()}`)
        }

        const result = await response.json()
        const items: Array<{ id: string; fileHash?: string; title?: string }> = result.items

        log.debug(`步骤2/4 拉取 MediaCenter 列表: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s（${items.length} 条）`)
        stepStartTime = Date.now()

        listProgressNode.firstChild!.textContent = `MediaCenter 列表拉取完成，共 ${items.length} 条记录，正在遍历本地数据库建立映射...`

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
                listProgressNode.firstChild!.textContent = `正在匹配映射... [${processedCount}/${total}] 已映射: ${matchedMap.size}`
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

        listProgressNode.firstChild!.textContent = `映射建立完成，共 ${matchedMap.size} 条映射（新增 ${entriesToSave.length} 条），总耗时 ${totalTime.toFixed(1)}s`
    } catch (error) {
        log.error('拉取列表失败:', stringify(error))
        listProgressToast.hide()
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

    listProgressToast.hide()

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

    const updateProgressNode = renderNode({
        nodeType: 'p',
        childs: `MediaCenter 更新中... [0/${matchedMap.size}]`
    })
    const updateProgressToast = newToast(ToastType.Info, {
        node: updateProgressNode,
        duration: -1
    })
    updateProgressToast.show()

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
            updateProgressNode.firstChild!.textContent = `MediaCenter 更新中... [${updated + skipped + updateErrors}/${matchedMap.size}] 更新: ${updated} 跳过: ${skipped} 错误: ${updateErrors}`
            if (idx < matchedIds.length) await delay(100)
            await nextUpdate()
        }
    }
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, matchedIds.length) }, () => nextUpdate()))

    updateProgressToast.hide()

    newToast(ToastType.Info, {
        text: `MediaCenter 同步完成！已更新: ${updated}, 跳过: ${skipped}, 错误: ${updateErrors}`,
        duration: 5000,
        close: true,
        onClick() {
            this.hide()
        }
    }).show()
}
