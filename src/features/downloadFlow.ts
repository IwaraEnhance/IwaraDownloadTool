import '../core/env'
import { delay, isNullOrUndefined, prune, stringify, UUID } from '../core/env'
import { GMLock, GMLockTTL } from '../core/gmLock'
import { i18nList } from '../i18n'
import { DownloadType, PageType, ToastType } from '../core/enum'
import { config } from '../core/config'
import { unlimitedFetch, renderNode } from '../core/extension'
import { Dictionary } from '../core/dictionary'
import { createLogger } from '../core/log'
import { db } from '../core/db'
import { getAuth, refreshToken } from '../network/auth'
import { followUser, likeVideo } from '../network/interactions'
import { registerBatchAction } from './selection'
import { newToast, toastNode } from '../ui/notify'
import { runBatchTask, taskConflict } from './progress'
import { getDownloadPath } from '../download/downloadPath'

const log = createLogger('DownloadQueue')
import { parseVideoInfo } from '../network/video'
import { checkIsHaveDownloadLink } from '../download/linkCheck'
import { aria2API, aria2Download, aria2TaskExtractVideoID } from '../download/aria2'
import { browserDownload, browserDownloadMetadata, iwaradlDownload, othersDownload, othersDownloadMetadata } from '../download/download'
import { apiEndpoint, domain } from '../context/site'
import { selectList } from '../context/selection'

/** 页面类型查询器（宿主注入，避免本模块反向依赖 UI 层的 menu 实例：
 * 现状仅用于 checkDownloadLink 的“非视频页才检查外链”判定） */
let getPageTypeProbe: () => PageType = () => PageType.Page
export function setPageTypeProbe(probe: () => PageType): void {
    getPageTypeProbe = probe
}

export async function addDownloadTask() {
    // 防连点叠加多个输入弹窗
    if (unsafeWindow.document.querySelector('#pluginOverlay')) return
    let textArea = renderNode({
        nodeType: 'textarea',
        attributes: {
            placeholder: i18nList[config.language].manualDownloadTips,
            style: 'margin-bottom: 10px;',
            rows: '16',
            cols: '96'
        }
    })
    let body = renderNode({
        nodeType: 'div',
        attributes: {
            id: 'pluginOverlay'
        },
        childs: [
            textArea,
            {
                nodeType: 'button',
                events: {
                    click: (e: Event) => {
                        if (!isNullOrUndefined(textArea.value) && !textArea.value.isEmpty()) {
                            let list: Array<[string, VideoInfo]> = []
                            try {
                                list = textArea.value.split('|').map((ID) => [
                                    ID.trim(),
                                    {
                                        Type: 'init',
                                        ID: ID.trim()
                                    }
                                ])
                            } catch (error) {
                                throw new Error('解析结果不是符合预期的列表')
                            }
                            if (list.length > 0) {
                                analyzeDownloadTask(new Dictionary<VideoInfo>(list))
                            }
                        }
                        body.remove()
                    }
                },
                childs: i18nList[config.language].ok
            }
        ]
    })
    unsafeWindow.document.body.appendChild(body)
}

async function downloadTaskUnique(taskList: Dictionary<VideoInfo>) {
    try {
        let stoped: Array<{ id: string; data: Aria2.Status }> = prune(
            ((await aria2API('aria2.tellStopped', [0, 4096, ['gid', 'status', 'files', 'errorCode', 'bittorrent']])) as Aria2.StartsResult).result
                .filter((task: Aria2.Status) => isNullOrUndefined(task.bittorrent))
                .map((task: Aria2.Status) => {
                    let ID = aria2TaskExtractVideoID(task)
                    if (!isNullOrUndefined(ID) && !ID.isEmpty()) {
                        return {
                            id: ID,
                            data: task
                        }
                    }
                })
        )
        let active: Array<{ id: string; data: Aria2.Status }> = prune(
            ((await aria2API('aria2.tellActive', [['gid', 'status', 'files', 'downloadSpeed', 'bittorrent']])) as Aria2.StartsResult).result
                .filter((task: Aria2.Status) => isNullOrUndefined(task.bittorrent))
                .map((task: Aria2.Status) => {
                    let ID = aria2TaskExtractVideoID(task)
                    if (!isNullOrUndefined(ID) && !ID.isEmpty()) {
                        return {
                            id: ID,
                            data: task
                        }
                    }
                })
        )
        let downloadCompleted: Array<{ id: string; data: Aria2.Status }> = stoped.filter((task: { id: string; data: Aria2.Status }) => task.data.status === 'complete').unique('id')
        let startedAndCompleted = [...active, ...downloadCompleted].map((i) => i.id)
        for (let key of taskList.keysArray().intersect(startedAndCompleted)) {
            taskList.delete(key)
        }
    } catch (error) {
        newToast(ToastType.Error, {
            node: toastNode([`%#duplicateTaskAnalysisError#%`, { nodeType: 'br' }, stringify(error)])
        }).show()
    }
}

/** 解析下载任务防重入标志（循环内每视频有间隔，连点会并发运行多个解析循环） */
let analyzeDownloadTaskRunning = false
/** 批量解析下载跨页互斥锁名（selectList 跨页同步，多标签页同时批量下载会重复推送任务） */
const ANALYZE_DOWNLOAD_LOCK = 'analyzeDownloadTask'

/** 解析下载的快照交付：BatchAction.run 传入副本快照（隔离解析期间的新勾选）；
 * 取消选中由 pushDownloadTaskInner 的 full 成功分支直接删真源 selectList 完成，
 * 无需快照反向同步（fail/toast 拦截路径原版即保留选中，供用户重试后自然删除） */
export async function analyzeDownloadTask(taskList: Dictionary<VideoInfo> = selectList) {
    if (analyzeDownloadTaskRunning) {
        taskConflict()
        return
    }
    log.debug(`[时序] analyze start: size=${taskList.size}, isSnapshot=${taskList !== selectList}`)
    analyzeDownloadTaskRunning = true
    try {
        // 批量作业模板：锁获取/心跳/等待提示/释放全部内聚，
        // 失去锁时 runner 静默退出（与原 isHeld 失败路径的提示差异见下）
        await runBatchTask<void>({
            lockName: ANALYZE_DOWNLOAD_LOCK,
            ttl: GMLockTTL.BatchTask,
            onConflict: 'wait',
            iterate: async (ctl) => {
                const size = taskList.size
                let done = 0
                const progressText = () => `${i18nList[config.language].parsingProgress}[${taskList.size}/${size}] `
                ctl.progress(progressText())
                if (config.experimentalFeatures && config.downloadType === DownloadType.Aria2) {
                    await downloadTaskUnique(taskList)
                    ctl.progress(progressText())
                }

                for (const [id, info] of taskList) {
                    // 心跳由 GMLock 内部维护：循环内仅复核持有状态，失去锁立即让位
                    if (!ctl.isHeld()) {
                        taskConflict()
                        return
                    }
                    await pushDownloadTask(await parseVideoInfo(info))
                    taskList.delete(id)
                    done++
                    ctl.progress(progressText())
                    ctl.progressRatio(1 - taskList.size / size, 1)
                    !config.enableUnsafeMode && (await delay(3000))
                }

                log.debug(`[时序] analyze end, taskList.remain=${taskList.size}, selectList.size=${selectList.size}`)
                newToast(ToastType.Info, {
                    text: `%#allCompleted#%`,
                    duration: -1,
                    close: true,
                    onClick() {
                        this.hide()
                    }
                }).show()
            }
        })
    } finally {
        analyzeDownloadTaskRunning = false
    }
}

/** 同一视频 ID 的下载推送进行中集合（单页防重入，连点跳过） */
const pushingVideoIds = new Set<string>()
/** 下载推送跨页互斥锁（多标签页同时推送同一视频时仅一个页面执行） */
const PUSH_LOCK_PREFIX = 'pushDownloadTask:'
const pushLock = new GMLock(UUID())

/** 推送下载任务（顶层入口，单页 + 跨页同 ID 防重入：进行中再次推送会被跳过） */
export async function pushDownloadTask(videoInfo: VideoInfo): Promise<void> {
    if (pushingVideoIds.has(videoInfo.ID)) {
        log.debug(`Skip duplicate push: ${videoInfo.ID}`)
        return
    }
    const lockName = `${PUSH_LOCK_PREFIX}${videoInfo.ID}`
    if (!pushLock.acquire(lockName, GMLockTTL.ShortTask)) {
        log.debug(`Skip duplicate push (another page): ${videoInfo.ID}`)
        return
    }
    pushingVideoIds.add(videoInfo.ID)
    try {
        await pushDownloadTaskInner(videoInfo)
    } finally {
        pushingVideoIds.delete(videoInfo.ID)
        pushLock.release(lockName)
    }
}

async function pushDownloadTaskInner(videoInfo: VideoInfo) {
    switch (videoInfo.Type) {
        case 'partial':
            const partialCache = await db.getVideoById(videoInfo.ID)
            if (!isNullOrUndefined(partialCache) && partialCache.Type !== 'full') await db.putVideo(videoInfo)
        case 'cache':
        case 'init':
            return await pushDownloadTaskInner(await parseVideoInfo(videoInfo))
        case 'fail':
            const cache = await db.getVideoById(videoInfo.ID)
            const externalUrl = videoInfo.External && !isNullOrUndefined(videoInfo.ExternalUrl) && !videoInfo.ExternalUrl.isEmpty() ? videoInfo.ExternalUrl : undefined
            newToast(ToastType.Error, {
                close: true,
                node: toastNode([`${videoInfo.Title ?? videoInfo.RAW?.title ?? cache?.RAW?.title}[${videoInfo.ID}] %#parsingFailed#%`, { nodeType: 'br' }, videoInfo.Msg], '%#createTask#%'),
                // 解析失败交互：外部视频→打开链接；否则→重新解析重试
                buttons: [
                    isNullOrUndefined(externalUrl)
                        ? {
                            text: '%#tryReparseDownload#%',
                            onClick: async (t) => {
                                t.hide()
                                await pushDownloadTask(await parseVideoInfo({ Type: 'init', ID: videoInfo.ID, RAW: videoInfo.RAW ?? cache?.RAW }))
                            }
                        }
                        : {
                            text: '%#openVideoLink#%',
                            onClick: (t) => {
                                t.hide()
                                GM_openInTab(externalUrl, { active: false, insert: true, setParent: true })
                            }
                        }
                ]
            }).show()
            break
        case 'full':
            await db.putVideo(videoInfo)
            const authorInfo = await db.getFollowById(videoInfo.AuthorID)
            if (config.autoFollow && (!authorInfo?.following || !videoInfo.Following)) {
                // 社交互动经 network/interactions 客户端；失败提示保留原语义
                if (!(await followUser(videoInfo.AuthorID).catch(() => false))) {
                    newToast(ToastType.Warn, {
                        text: `${videoInfo.Alias} %#autoFollowFailed#%`,
                        close: true,
                        onClick() {
                            this.hide()
                        }
                    }).show()
                }
            }
            if (config.autoLike && !videoInfo.Liked) {
                if (!(await likeVideo(videoInfo.ID).catch(() => false))) {
                    newToast(ToastType.Warn, {
                        text: `${videoInfo.Alias} %#autoLikeFailed#%`,
                        close: true,
                        onClick() {
                            this.hide()
                        }
                    }).show()
                }
            }
            if (getPageTypeProbe() !== PageType.Video && config.checkDownloadLink && checkIsHaveDownloadLink(`${videoInfo.Description} ${videoInfo.Comments}`)) {
                // 「打开链接」改为标准交互按钮行（buttons），不再是正文里的伪按钮文本；
                // buttons 与整块 onClick 互斥（Toastify 保证），主体点击不再触发打开链接
                const toastBody = toastNode([`${videoInfo.Title}[${videoInfo.ID}] %#findedDownloadLink#%`], '%#createTask#%')
                newToast(ToastType.Warn, {
                    node: toastBody,
                    // 按钮行接管交互后主体点击无行为，必须始终提供 × 关闭，否则无法收起
                    close: true,
                    buttons: [
                        {
                            text: '%#openVideoLink#%',
                            onClick: (t) => {
                                GM_openInTab(`https://www.${domain}/video/${videoInfo.ID}`, { active: false, insert: true, setParent: true })
                                if (config.autoCopySaveFileName) {
                                    GM_setClipboard(getDownloadPath(videoInfo).fullName, 'text')
                                    toastBody.appendChild(
                                        renderNode({
                                            nodeType: 'p',
                                            childs: '%#copySucceed#%'
                                        })
                                    )
                                } else {
                                    t.hide()
                                }
                            }
                        }
                    ]
                }).show()
                return
            }
            if (config.checkPriority && videoInfo.DownloadQuality !== config.downloadPriority) {
                newToast(ToastType.Warn, {
                    node: toastNode([`${videoInfo.Title.truncate(64)}[${videoInfo.ID}] %#downloadQualityError#%`, { nodeType: 'br' }, `%#tryReparseDownload#%`], '%#createTask#%'),
                    async onClick() {
                        this.hide()
                        await pushDownloadTask(await parseVideoInfo(videoInfo))
                    }
                }).show()
                return
            }
            switch (config.downloadType) {
                case DownloadType.Aria2:
                    aria2Download(videoInfo, true)
                    // pushToMediaCenter 由 aria2TrackManager 在下载完成后自动调用
                    break
                case DownloadType.Iwaradl:
                    iwaradlDownload(videoInfo)
                    break
                case DownloadType.Browser:
                    browserDownload(videoInfo)
                    break
                default:
                    othersDownload(videoInfo)
                    break
            }
            if (config.autoDownloadMetadata) {
                switch (config.downloadType) {
                    case DownloadType.Others:
                        othersDownloadMetadata(videoInfo)
                        break
                    case DownloadType.Browser:
                        browserDownloadMetadata(videoInfo)
                        break
                    default:
                        break
                }
                log.debug('Download task pushed:', videoInfo)
            }
            selectList.delete(videoInfo.ID)
            break
        default:
            log.debug('Unknown type:', videoInfo)
            break
    }
}

// ── 批量动作注册：下载作为 selection 批量操作体系的第一个注册消费者 ──
// 直接传活引用（默认参数 = selectList）：downloadTaskUnique 去重与 full 分支的删除
// 都写透真源，取消选中行为与原版一致（快照交付会写透断裂 → 已去重项残留选中）
registerBatchAction({
    id: 'downloadSelected',
    labelKey: 'downloadSelected',
    run: () => analyzeDownloadTask()
})
