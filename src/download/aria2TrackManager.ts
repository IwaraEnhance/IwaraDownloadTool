import { delay, isConvertibleToNumber, isNullOrUndefined, isString, prune, stringify, UUID } from '../core/env'
import { GMSyncDictionary } from '../core/gmSyncDictionary'
import { DownloadType, ToastType } from '../core/enum'
import { config } from '../core/config'
import { db } from '../core/db'
import { GMLock, GMLockTTL } from '../core/gmLock'
import { originalAddEventListener } from '../core/hijack'
import { createLogger } from '../core/log'
import { unlimitedFetch } from '../core/extension'
import { aria2API, aria2TaskExtractVideoID } from './aria2'
import { analyzeLocalPath, getDownloadPath } from './downloadPath'
import type { Path } from '../core/path'
import { getMoreCompleteVideoInfo, parseVideoInfo } from '../network/video'
import { newToast, toastNode } from '../ui/notify'
import { GM_KEY_IS_DEBUG } from '../core/constants'

const log = createLogger('Aria2Track')
const mediaLog = createLogger('MediaCenter')

/**
 * Aria2 任务管理器
 *
 * 架构：跨页面同步队列 + 单把管理器锁。
 * - 任务记录在共享的同步列表（GMSyncDictionary，GM 存储跨页同步）中，由唯一的“管理器”页面处理；
 * - 管理器通过全局唯一一把锁（GMLock 租约）选举产生，负责处理整个队列；
 * - 管理器页面关闭/崩溃后，租约过期，其他页面可重新选举接管，避免死锁与无人管理。
 */

/** Aria2 任务同步队列：GM 存储键（所有页面共享，由唯一的“管理器”页面处理） */
const ARIA2_TRACK_QUEUE_KEY = 'Aria2TrackQueue'
/** 管理器全局锁名：跨页面仅此一把锁，持有者负责处理整个队列 */
const ARIA2_TRACK_MANAGER_LOCK = 'aria2TrackManager'
/** 管理器选举间隔（毫秒）：非管理器页面周期尝试抢占单把锁 */
const ARIA2_TRACK_ELECTION_INTERVAL = 4000
/** 任务队列扫描间隔（毫秒）：把 aria2 中尚未纳入队列的任务补入队列 */
const ARIA2_TRACK_SCAN_INTERVAL = 60_000
/** 任务轮询间隔（毫秒）：按任务状态自适应——
 * 下载中（active）用短间隔保持实时感知完成/错误/慢速；
 * 等待/暂停（waiting/paused）用中等间隔等待状态变化；
 * 任务不可达（无状态）用较长间隔退避，减少无效请求 */
const ARIA2_TRACK_POLL_INTERVAL_ACTIVE = 1000 * 4 // 4s：下载中，实时性最关键
const ARIA2_TRACK_POLL_INTERVAL_IDLE = 1000 * 8 // 8s：等待/暂停/初始未知
const ARIA2_TRACK_POLL_INTERVAL_BACKOFF = 1000 * 32 // 32s：任务不可达退避

/** 根据任务状态选择下一次轮询间隔：active 用短间隔保持实时，等待/暂停用中等间隔，不可达（无状态）用较长间隔退避 */
function aria2TrackPollInterval(status?: string): number {
    switch (status) {
        case 'active':
            return ARIA2_TRACK_POLL_INTERVAL_ACTIVE
        case 'waiting':
        case 'paused':
            return ARIA2_TRACK_POLL_INTERVAL_IDLE
        default:
            // 无状态（undefined）/未知状态 → 较长间隔退避，减少对 aria2 的无效请求
            return ARIA2_TRACK_POLL_INTERVAL_BACKOFF
    }
}

/** 任务“活跃度”优先级：同一 videoId 存在多个任务（多个 gid）时，
 * 用于挑选最值得追踪的 gid——active > waiting > paused/complete > error/removed/无状态 */
function aria2TrackGidPriority(status?: string): number {
    switch (status) {
        case 'active':
            return 3
        case 'waiting':
            return 2
        case 'paused':
        case 'complete':
            return 1
        default:
            return 0
    }
}
/** 下载速度过慢判定阈值（字节/秒，16 KiB/s）：低于此速度视为“速度过慢”并重启任务 */
export const ARIA2_SLOW_SPEED_THRESHOLD = 16 * 1024
/** 慢启动豁免轮询次数：任务进入 active 后的前 N 次轮询不因“速度过慢”重启——
 * TCP 慢启动阶段速度低是正常的（每次新建连接都会重新慢启动），等它提速后再判定 */
const ARIA2_TRACK_SLOW_START_EXEMPT_POLLS = 16
/** 连续重建失败次数上限：超过后停止自动重试，弹常驻提示询问用户——点击=继续重试，点×=放弃（从队列移除） */
const ARIA2_TRACK_MAX_REBUILD_ATTEMPTS = 8
/** 推送失败重试间隔（毫秒，5 分钟）：complete 任务推送失败后按该间隔退避重试，避免每轮扫描忙循环 */
const ARIA2_TRACK_PUSH_RETRY_INTERVAL = 5 * 60 * 1000
/** 终态记录保留时长（毫秒，30 天）：超期后由扫描清理，防止去重表无限膨胀 */
const ARIA2_TRACK_DONE_RETENTION = 30 * 24 * 60 * 60 * 1000
/** MediaCenter 映射有效性验证结果缓存：key = API 地址 + mediaCenterId（切换实例后缓存自动失效，重新验证），
 * 避免扫描/推送对同一映射反复发起 GET 请求 */
const mediaCenterIdMapValidateCache = new Map<string, { valid: boolean; checkedAt: number }>()
/** 映射验证结果缓存有效期（毫秒，6 小时）：有效结果在缓存期内不再重复验证 */
const MEDIA_CENTER_ID_MAP_VALIDATE_TTL = 6 * 60 * 60 * 1000
/** 当前页面实例唯一的标识 */
const aria2TrackOwner = UUID()
/** 跨页面原子锁：全局仅此一把，用于选举唯一的管理页面 */
const aria2TrackLock = new GMLock(aria2TrackOwner)

/** 队列任务条目（仅存轻量元数据，完整视频信息由处理时从本地数据库/网络解析）。
 * 该表同时承担“状态追踪去重”职责：任务完成后不再删除条目，而是写入终态标记，
 * 防止 tellStopped 中的旧完成任务被反复入队/反复弹提示。
 * MediaCenter 推送状态（pushedAt/pushFailedAt/pushDone）仅当推送功能启用时才维护，
 * 模块自身的去重逻辑不依赖 MediaCenter 映射表。 */
interface Aria2TrackTask {
    videoId: string
    gid: string
    downloadParams: Record<string, any>
    addedAt: number
    /** 扫描补入时任务已是 complete（worker 不再弹“下载完成”提示） */
    alreadyComplete?: boolean
    /** 下载完成时间戳（终态标记：写入后不再重复入队/弹提示） */
    completedAt?: number
    /** MediaCenter 推送成功时间戳（仅启用推送时写入；写入后视为终态） */
    pushedAt?: number
    /** MediaCenter 推送最近失败时间戳（用于重试退避） */
    pushFailedAt?: number
    /** 推送已处理且不再重试（如启用推送但始终无完整视频信息），终态标记 */
    pushDone?: boolean
}

/** 管理器是否在本页运行中（防止并发重复启动管理循环） */
let aria2TrackManagerLoopRunning = false
/** 正在被处理的队列任务 videoId（仅用于避免重复启动 worker；worker 自行通过锁/队列校验停止） */
const aria2TrackWorkers = new Set<string>()
/** 管理器会话代号：每次获得锁递增；旧会话残留 worker 检测到代号不符即让位，防止强制接管时重复 worker 竞争同一任务 */
let aria2TrackManagerEpoch = 0

/** 跨页面同步任务队列：复用 GMSyncDictionary 的 GM 存储跨页同步能力 */
const aria2TrackQueue = new GMSyncDictionary<Aria2TrackTask>(ARIA2_TRACK_QUEUE_KEY, [], (value) => isString((value as Aria2TrackTask)?.videoId) && isString((value as Aria2TrackTask)?.gid))
// 队列变化（含其他页面的远程变更）时，若本页为管理器则立即同步 worker
aria2TrackQueue.onSet = () => {
    if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(aria2TrackManagerEpoch)
}
aria2TrackQueue.onDel = () => {
    if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(aria2TrackManagerEpoch)
}
aria2TrackQueue.onSync = () => {
    if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(aria2TrackManagerEpoch)
}

/** 从视频信息构建带 videoid/download 参数的下载 URL */
export function buildDownloadUrl(videoInfo: FullVideoInfo): URL {
    const localPath = getDownloadPath(videoInfo)
    const url = videoInfo.DownloadUrl.toURL()
    url.searchParams.set('videoid', videoInfo.ID)
    url.searchParams.set('download', localPath.fullName)
    return url
}

// ── 跨页面同步队列：复用 GMSyncDictionary 的跨页同步，任务记录由唯一的管理页面处理 ──

/** 将任务加入同步队列（按 videoId 幂等去重，GMSyncDictionary 负责跨页同步）。
 * alreadyComplete：扫描补入的已完成任务标记——worker 处理时不再弹“下载完成”提示 */
export function enqueueAria2TrackTask(videoId: string, gid: string, downloadParams: Record<string, any>, alreadyComplete: boolean = false): void {
    aria2TrackQueue.set(videoId, { videoId, gid, downloadParams, addedAt: Date.now(), alreadyComplete })
}
/** 队列中是否包含某任务 */
function hasAria2TrackTask(videoId: string): boolean {
    return aria2TrackQueue.has(videoId)
}
/** 从队列移除任务 */
function removeAria2TrackTask(videoId: string): void {
    aria2TrackQueue.delete(videoId)
}
/** 更新队列中任务的 gid（任务重建后） */
function updateAria2TrackTaskGid(videoId: string, gid: string): void {
    const task = aria2TrackQueue.get(videoId)
    if (task) aria2TrackQueue.set(videoId, { ...task, gid })
}

/** 部分更新队列任务条目（保留其余字段，跨页同步） */
function updateAria2TrackTask(videoId: string, patch: Partial<Aria2TrackTask>): void {
    const task = aria2TrackQueue.get(videoId)
    if (task) aria2TrackQueue.set(videoId, { ...task, ...patch })
}

/** MediaCenter 推送功能是否启用（实验特性开启且 API/Key 均已配置） */
function isMediaCenterPushEnabled(): boolean {
    return config.experimentalFeatures && !config.mediaCenterApi.isEmpty() && !config.mediaCenterApiKey.isEmpty()
}

/** 条目是否已达终态（无需 worker 继续处理）：推送成功 / 推送已处理 / 完成且推送未启用 */
function isAria2TrackDone(task: Aria2TrackTask): boolean {
    if (!isNullOrUndefined(task.pushedAt)) return true
    if (!isNullOrUndefined(task.pushDone)) return true
    if (!isNullOrUndefined(task.completedAt) && !isMediaCenterPushEnabled()) return true
    return false
}

/** 计算 aria2 任务下载进度（0~1，基于 completedLength/totalLength），无法计算时返回 0 */
export function getAria2Progress(status: Aria2.Status): number {
    if (!isConvertibleToNumber(status.completedLength) || !isConvertibleToNumber(status.totalLength)) return 0
    const total = Number(status.totalLength)
    if (total <= 0) return 0
    return Math.min(1, Number(status.completedLength) / total)
}

/** 任务状态 toast：按 videoId 固定 id，同任务新提示自动替换旧提示（避免轮询刷屏）。
 * `%#...#%` 占位符由 toastNode/renderNode 自动替换为当前语言 */
function trackStatusToast(videoId: string, title: string, type: ToastType, i18nKey: string): void {
    newToast(type, {
        id: `aria2Track-${videoId}`,
        duration: 5000,
        node: toastNode(`${title}[${videoId}] %#${i18nKey}#%`)
    }).show()
}

/** debug：把下载速度格式化为可读字符串（B/s / KiB/s / MiB/s），无法计算时返回 '未知' */
function formatAria2Speed(speed: any): string {
    if (!isConvertibleToNumber(speed)) return '未知'
    const n = Number(speed)
    if (n < 1024) return `${n} B/s`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB/s`
    return `${(n / 1024 / 1024).toFixed(2)} MiB/s`
}

/** 连续重建失败超过上限后，弹常驻交互提示询问用户是否继续重试：
 * 内建两个按钮——「重试」= 继续重试（返回 true，调用方重置计数继续）；
 * 「取消」= 放弃（等价于右上角 × 关闭，返回 false，调用方从队列移除任务）。
 * Promise 在用户做出决策前一直挂起，worker 循环暂停等待。 */
function askAria2RebuildContinue(videoId: string, title: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let settled = false
        const settle = (value: boolean): void => {
            if (settled) return
            settled = true
            resolve(value)
        }
        const toast = newToast(ToastType.Error, {
            id: `aria2Track-retry-${videoId}`,
            duration: -1, // 常驻，等待用户决策
            close: true, // 右上角 × 关闭按钮：点它 = 放弃（与「取消」按钮等价）
            node: toastNode('%#aria2TrackRebuildGiveUp#%', title),
            // 交互按钮由 newToast/Toast 通用能力渲染（与 onClick 互斥）
            buttons: [
                {
                    text: '%#aria2TrackRebuildRetry#%',
                    className: 'aria2TrackRebuildRetry',
                    onClick: (t) => {
                        // 重试：继续重试（失败计数重置由调用方处理）
                        settle(true)
                        t.hide('other')
                    }
                },
                {
                    text: '%#aria2TrackRebuildCancel#%',
                    className: 'aria2TrackRebuildCancel',
                    onClick: (t) => {
                        // 取消：同步判定为放弃（立即反馈），并收起 toast（等价于点右上角 ×）
                        settle(false)
                        t.hide('close-button')
                    }
                }
            ]
        })
        toast.show()
        // 超时兜底：用户长时间不决策（后台标签页/事件异常）自动继续重试，避免 Promise 永久挂起导致无反馈
        setTimeout(() => {
            settle(true)
            toast.hide('other')
        }, 5 * 60 * 1000)
    })
}

/** 管理器内的单任务处理循环：轮询 aria2 状态，异常自动重试，完成后移除队列并推送 MediaCenter。
 * 仅当本页仍是管理器、且任务仍在队列中时才执行动作；
 * 失去管理器资格或任务被移除时，worker 在下一轮自行退出，无需外部停止信号。
 */
async function processAria2TrackTask(task: Aria2TrackTask, epoch: number): Promise<void> {
    // 初始化完整视频信息（队列仅存轻量元数据）；解析失败不放弃——管理器职责=重建，用队列现有参数/链接接管
    let info = await db.getVideoById(task.videoId)
    if (info?.Type !== 'full') {
        try {
            const parsed = await parseVideoInfo({ Type: 'init', ID: task.videoId, RAW: info?.RAW })
            info = getMoreCompleteVideoInfo(info ?? { Type: 'init', ID: task.videoId }, parsed)
        } catch (e) {
            log.warn(`${task.videoId} 初始化解析异常，降级继续处理: ${stringify(e)}`)
        }
    }
    // 没有完整信息也不移除任务：后续所有用到标题/推送处做空值保护
    let videoInfo = info && info.Type === 'full' ? (info as FullVideoInfo) : undefined
    let currentGid = task.gid
    let consecutiveFailures = 0
    let rebuildFailures = 0 // 连续重建失败次数：超过上限弹提示询问用户
    let lastStatus: string | undefined // 上一轮任务状态，用于自适应轮询间隔
    let activePollCount = 0 // 当前 active 段的连续轮询次数（TCP 慢启动豁免）

    log.debug(`${task.videoId} 开始处理 (gid=${task.gid}, title=${videoInfo?.Title ?? task.videoId})`)

    while (true) {
        // 本页仍是管理器且任务仍在队列中才继续（失去则自行让位）
        if (!aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) return
        if (!hasAria2TrackTask(task.videoId)) return
        // 已被新管理器会话取代（强制接管会清空去重表并重起 worker）→ 让位，由新 worker 接管
        if (epoch !== aria2TrackManagerEpoch) return

        // 终态条目（推送成功/推送已处理/未启用推送的已完成任务）：worker 退出
        const doneQueued = aria2TrackQueue.get(task.videoId)
        if (doneQueued && isAria2TrackDone(doneQueued)) return

        // 每轮从队列重读最新 gid：同一 videoId 在 aria2 中可能有多个任务（多个 gid），
        // 扫描发现更“活”的任务时会更新队列 gid，worker 需跟随最新 gid 追踪真实下载，
        // 避免永远追着旧 gid（paused/error/complete 残留）导致“在队列中但从不检查真实下载”
        const latestTask = aria2TrackQueue.get(task.videoId)
        if (latestTask && latestTask.gid !== currentGid) {
            log.debug(`${task.videoId} 队列 gid 更新 ${currentGid} → ${latestTask.gid}，跟随`)
            currentGid = latestTask.gid
        }

        try {
            const statusRes = (await aria2API('aria2.tellStatus', [currentGid, ['gid', 'status', 'files', 'downloadSpeed', 'errorCode', 'completedLength', 'totalLength']])) as Aria2.TellStatusResult
            const status = statusRes.result

            if (!status?.status) {
                // aria2 无状态返回（最常见：队列里的 gid 已不存在——aria2 重启/任务被清理/
                // 或被其他端以新 gid 重建）。处理策略：
                // 1) 计为一次失败并按退避间隔轮询——绝不能直接 continue：那会跳过循环末尾的
                //    delay，形成无间隔忙循环刷爆 aria2 RPC，任务永远卡在队列里（扫描一直报“已在队列中”）；
                // 2) 连续失败超过上限即移出队列自愈：若任务仍在 aria2 中，60s 周期扫描会用最新
                //    gid 重新纳入队列继续追踪；若已彻底不存在，队列自然清空。
                lastStatus = undefined // 不可达 → 退避轮询
                consecutiveFailures++
                log.debug(`${task.videoId} (gid=${currentGid}) 无状态响应(第${consecutiveFailures}次)，退避轮询`)
                if (consecutiveFailures > 5) {
                    log.warn(`${task.videoId} (gid=${currentGid}) gid 在 aria2 中不可达/不存在，移出队列（周期扫描会以最新 gid 重新纳入）`)
                    removeAria2TrackTask(task.videoId)
                    return
                }
                await delay(aria2TrackPollInterval(undefined))
                continue
            }
            consecutiveFailures = 0

            // debug：状态转换时打印完整状态（log.debug 内部已检查 isDebug 开关）
            const progress = getAria2Progress(status)
            if (lastStatus !== status.status) {
                log.debug(`${task.videoId} 状态: ${lastStatus ?? '初始'} → ${status.status} (gid=${currentGid}, 进度=${(progress * 100).toFixed(1)}%, 速度=${formatAria2Speed(status.downloadSpeed)})`)
            }
            lastStatus = status.status // 记录当前状态，驱动下一轮轮询间隔
            // 离开 active 时重置慢启动计数（重新进入 active 视为新连接，重新豁免）
            if (status.status !== 'active') activePollCount = 0

            switch (status.status) {
                case 'complete': {
                    const now = Date.now()
                    const queued = aria2TrackQueue.get(task.videoId)
                    // 重试轮（completedAt 已写入）：已推送成功或推送未启用 → 终态退出；
                    // 推送失败退避中 → 保持 worker 存活按轮询间隔等待重试（不重复弹提示）
                    if (queued?.completedAt) {
                        if (!isNullOrUndefined(queued.pushedAt) || !isMediaCenterPushEnabled()) return
                        if (queued.pushFailedAt && now - queued.pushFailedAt < ARIA2_TRACK_PUSH_RETRY_INTERVAL) {
                            log.debug(`${task.videoId} 推送失败退避中，等待重试`)
                            break
                        }
                    }
                    log.debug(`${task.videoId} 下载完成`)
                    // 首次完成 / 非扫描补入的旧完成任务才弹“下载完成”提示（避免重复刷屏）
                    if (!queued?.completedAt && !queued?.alreadyComplete) {
                        trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Info, 'aria2TrackComplete')
                    }
                    if (isMediaCenterPushEnabled() && videoInfo) {
                        if (await pushToMediaCenter(videoInfo)) {
                            updateAria2TrackTask(task.videoId, { completedAt: now, pushedAt: now, pushFailedAt: undefined })
                            return // 推送成功 → 终态
                        }
                        log.warn(`${task.videoId} MediaCenter 推送失败，${Math.round(ARIA2_TRACK_PUSH_RETRY_INTERVAL / 1000)}s 后重试`)
                        updateAria2TrackTask(task.videoId, { completedAt: now, pushFailedAt: now })
                        break // 保留 worker，等待退避后重试
                    }
                    // 推送未启用 / 无完整信息：completedAt（或 pushDone）即终态，避免无限重试
                    updateAria2TrackTask(task.videoId, isMediaCenterPushEnabled() ? { completedAt: now, pushDone: true } : { completedAt: now })
                    return
                }

                case 'error':
                case 'removed':
                    log.warn(`${task.videoId} 任务 ${status.status}，重新创建下载`)
                    if (epoch !== aria2TrackManagerEpoch) return // 已被新会话取代，不再重建
                    // 连续重建失败计数：超过上限弹常驻提示询问用户——点击=继续重试，点叉=放弃（从队列移除）
                    const attempt = await nextRebuildAttempt(task.videoId, videoInfo?.Title ?? task.videoId, rebuildFailures)
                    if (!attempt.ok) {
                        removeAria2TrackTask(task.videoId)
                        return
                    }
                    rebuildFailures = attempt.failures
                    // 管理器职责=重建：优先重新解析获取新链接；解析失败/异常则回退用任务现有链接重建，绝不静默放弃
                    const rebuilt = await rebuildAria2Task(task.videoId, task, status)
                    if (rebuilt.gid) {
                        currentGid = rebuilt.gid
                        updateAria2TrackTaskGid(task.videoId, currentGid)
                        if (rebuilt.videoInfo) videoInfo = rebuilt.videoInfo
                        // 重建 = 新连接：重置豁免计数，慢启动期重新豁免；重建成功也重置失败计数
                        activePollCount = 0
                        rebuildFailures = 0
                        trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Warn, 'aria2TrackRestart')
                    }
                    break

                case 'active':
                    // TCP 慢启动豁免：进入 active 后的前 N 次轮询不因“速度过慢”重启（刚起步速度低是正常的）
                    activePollCount++
                    if (isConvertibleToNumber(status.downloadSpeed) && Number(status.downloadSpeed) <= ARIA2_SLOW_SPEED_THRESHOLD) {
                        if (activePollCount > ARIA2_TRACK_SLOW_START_EXEMPT_POLLS) {
                            // 已过慢启动豁免期：下载进度 > 98% 时豁免（接近完成不重启）；但速度为 0 不豁免
                            const speed = Number(status.downloadSpeed)
                            if (speed === 0 || getAria2Progress(status) <= 0.98) {
                                log.debug(`${task.videoId} 速度过慢，重启`)
                                if (epoch !== aria2TrackManagerEpoch) return // 已被新会话取代，不再重启
                                const freshActive = await restartAria2Task(currentGid, task.videoId, status)
                                if (freshActive) {
                                    videoInfo = freshActive
                                    // 重启 = 新连接：重置豁免计数，慢启动期重新豁免，
                                    // 避免刚重启的任务因慢启动速度低被连续误判重启（无限重启循环）
                                    activePollCount = 0
                                    trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Warn, 'aria2TrackRestartSlow')
                                } else {
                                    // 重启失败（重新解析/换链接失败）→ 降级为无条件重建，绝不静默放弃
                                    log.warn(`${task.videoId} 重启失败，降级为无条件重建`)
                                    if (epoch !== aria2TrackManagerEpoch) return // 已被新会话取代，不再重建
                                    const attempt = await nextRebuildAttempt(task.videoId, videoInfo?.Title ?? task.videoId, rebuildFailures)
                                    if (!attempt.ok) {
                                        removeAria2TrackTask(task.videoId)
                                        return
                                    }
                                    rebuildFailures = attempt.failures
                                    const rebuilt = await rebuildAria2Task(task.videoId, task, status)
                                    if (rebuilt.gid) {
                                        currentGid = rebuilt.gid
                                        updateAria2TrackTaskGid(task.videoId, currentGid)
                                        if (rebuilt.videoInfo) videoInfo = rebuilt.videoInfo
                                        activePollCount = 0
                                        rebuildFailures = 0
                                        trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Warn, 'aria2TrackRestart')
                                    }
                                }
                            }
                        } else {
                            // 慢启动豁免期内速度低属正常，暂不重启（避免误杀刚起步的下载）
                            log.debug(`${task.videoId} 速度过慢(${formatAria2Speed(status.downloadSpeed)})，慢启动豁免期 (${activePollCount}/${ARIA2_TRACK_SLOW_START_EXEMPT_POLLS})，暂不重启`)
                        }
                    }
                    break

                case 'waiting':
                    // 等待中，继续轮询
                    break

                case 'paused':
                    if (await isAria2QueueFull()) {
                        log.debug(`${task.videoId} 队列已满，暂不重启`)
                    } else {
                        log.debug(`${task.videoId} 已暂停，重启`)
                        if (epoch !== aria2TrackManagerEpoch) return // 已被新会话取代，不再重启
                        const freshPaused = await restartAria2Task(currentGid, task.videoId, status)
                        if (freshPaused) {
                            videoInfo = freshPaused
                            // 重启 = 新连接：重置豁免计数，慢启动期重新豁免
                            activePollCount = 0
                            trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Warn, 'aria2TrackRestartPaused')
                        } else {
                            // 重启失败（重新解析/换链接失败）→ 降级为无条件重建，绝不静默放弃
                            log.warn(`${task.videoId} 重启失败，降级为无条件重建`)
                            if (epoch !== aria2TrackManagerEpoch) return // 已被新会话取代，不再重建
                            const attempt = await nextRebuildAttempt(task.videoId, videoInfo?.Title ?? task.videoId, rebuildFailures)
                            if (!attempt.ok) {
                                removeAria2TrackTask(task.videoId)
                                return
                            }
                            rebuildFailures = attempt.failures
                            const rebuilt = await rebuildAria2Task(task.videoId, task, status)
                            if (rebuilt.gid) {
                                currentGid = rebuilt.gid
                                updateAria2TrackTaskGid(task.videoId, currentGid)
                                if (rebuilt.videoInfo) videoInfo = rebuilt.videoInfo
                                activePollCount = 0
                                rebuildFailures = 0
                                trackStatusToast(task.videoId, videoInfo?.Title ?? task.videoId, ToastType.Warn, 'aria2TrackRestart')
                            }
                        }
                    }
                    break
            }
        } catch (error) {
            log.warn(`追踪异常 ${currentGid}:`, stringify(error))
            consecutiveFailures++
            if (consecutiveFailures > 5) {
                log.warn(`任务 ${currentGid} 持续异常，从队列移除`)
                removeAria2TrackTask(task.videoId)
                return
            }
        }
        // 状态自适应轮询：在循环末尾按本轮状态决定下一次等待间隔——
        // 首次进入立即查询（任务入队即可实时感知），active 下载中用短间隔保持实时，
        // 等待/暂停用中等间隔，不可达（lastStatus=undefined）用默认间隔退避
        await delay(aria2TrackPollInterval(lastStatus))
    }
}

/** 同步 worker 与队列：为队列中尚未启动 worker 的任务启动 worker（Set 去重防重复） */
function syncAria2TrackWorkers(epoch: number): void {
    for (const task of aria2TrackQueue.valuesArray()) {
        if (isAria2TrackDone(task)) continue // 终态条目不再启动 worker（推送重试由存活 worker 自行处理）
        if (aria2TrackWorkers.has(task.videoId)) continue
        aria2TrackWorkers.add(task.videoId)
        log.debug(`管理器开始处理 ${task.videoId} (gid=${task.gid})`)
        processAria2TrackTask(task, epoch).finally(() => {
            aria2TrackWorkers.delete(task.videoId)
        })
    }
}

/**
 * 尝试通过单把全局锁选举本页为管理器；成功后由本页处理整个队列。
 * 管理器页面关闭/崩溃后租约过期，其他页面可重新选举，避免任务无人管理。
 */
async function tryBecomeAria2TrackManager(): Promise<void> {
    if (aria2TrackManagerLoopRunning) return
    aria2TrackManagerLoopRunning = true // 同步置位，防止并发重复启动管理循环
    try {
        // 接管后由 GMLock 内部心跳自动续期（默认 TTL/3），失去锁时主循环通过 isHeld 退出
        if (!aria2TrackLock.acquireWithHeartbeat(ARIA2_TRACK_MANAGER_LOCK, GMLockTTL.DaemonTask)) return
        log.debug('本页成为管理器，接管整个队列')
        await startAria2TrackManagerLoop()
    } finally {
        aria2TrackManagerLoopRunning = false
    }
}

/** 管理器主循环：同步队列 worker（锁心跳由 GMLock 内部维护，循环仅复核持有状态） */
async function startAria2TrackManagerLoop(): Promise<void> {
    // 成为管理器：开启新会话代号并强制接管所有队列任务——
    // 清空本页 worker 去重表为每个任务重起 worker；旧会话残留的 worker
    // 检测到代号不符会在下一轮让位，避免与新 worker 重复处理同一任务
    const epoch = ++aria2TrackManagerEpoch
    aria2TrackWorkers.clear()
    syncAria2TrackWorkers(epoch)
    while (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) {
        await delay(GMLockTTL.DaemonTask / 3)
        syncAria2TrackWorkers(epoch)
    }
    // 失去管理器资格：worker 会在下一轮通过 isHeld() 自行退出
    log.debug('管理器锁过期/被抢占，停止处理队列')
}

/** 从下载 URL 解析 expires 过期时间戳（秒）；URL 无效或缺少 expires 参数时返回 -Infinity（视为已过期/无法比较） */
function aria2TrackUriExpiry(uri: string): number {
    try {
        const url = uri.toURL()
        if (isNullOrUndefined(url)) return -Infinity
        const expires = url.searchParams.get('expires')
        if (isNullOrUndefined(expires)) return -Infinity
        const exp = Number(expires)
        return Number.isFinite(exp) ? exp : -Infinity
    } catch {
        return -Infinity
    }
}

/** 任务下载 URL 的过期时间：多源下载可能有多个 URL，遍历全部 URL 取最晚过期的那一个（距离过期时间最长） */
function aria2TrackTaskExpiry(task: Aria2.Status): number {
    let best = -Infinity
    for (const file of task.files ?? []) {
        for (const uri of file.uris ?? []) {
            const exp = aria2TrackUriExpiry(uri.uri)
            if (exp > best) best = exp
        }
    }
    return best
}

/** debug：把过期时间戳格式化为可读的剩余时间（如 3 小时 25 分钟），无法解析时返回 '未知' */
function formatAria2TrackExpiry(exp: number): string {
    if (!Number.isFinite(exp)) return '未知'
    const remain = Math.max(0, Math.floor((exp * 1000 - Date.now()) / 60000))
    if (remain < 60) return `${remain} 分钟`
    if (remain < 60 * 24) return `${Math.floor(remain / 60)} 小时 ${remain % 60} 分钟`
    return `${Math.floor(remain / 60 / 24)} 天 ${Math.floor((remain / 60) % 24)} 小时`
}

/** 停止并清理冗余的 aria2 任务：remove 停止 active/waiting/paused 任务，再 removeDownloadResult 清掉结果记录，
 * 避免残留任务被下次扫描重复纳入（error/removed/complete 不在活动队列，直接清结果即可） */
async function removeRedundantAria2Task(task: Aria2.Status): Promise<void> {
    if (task.status === 'active' || task.status === 'waiting' || task.status === 'paused') {
        try {
            await aria2API('aria2.remove', [task.gid])
        } catch (e) {
            log.debug(`停止冗余任务 ${task.gid} 失败（可能已被移除），继续清理结果: ${stringify(e)}`)
        }
    }
    try {
        await aria2API('aria2.removeDownloadResult', [task.gid])
    } catch (e) {
        log.debug(`清理冗余任务结果 ${task.gid} 失败: ${stringify(e)}`)
    }
}

/** 扫描 aria2 现有任务，把尚未纳入队列且未推送过的任务补入队列。
 * 同一 videoId 存在多个任务（多个 gid，如重复下载/重建残留）时，解析各任务下载 URL 的过期时间
 * （多源任务有多个 URL 则遍历取最晚过期），只保留过期时间最长的任务，停止其余冗余任务并从追踪队列移除 */
async function scanAria2TasksAndEnqueue(): Promise<void> {
    try {
        const [actRes, stopRes] = await Promise.all([aria2API('aria2.tellActive', [['gid', 'status', 'files', 'bittorrent']]), aria2API('aria2.tellStopped', [0, 4096, ['gid', 'status', 'files', 'bittorrent']])])
        const activeRes = actRes as Aria2.StartsResult
        const stoppedRes = stopRes as Aria2.StartsResult

        const allTasks = [...(activeRes.result ?? []), ...(stoppedRes.result ?? [])].filter((t) => isNullOrUndefined(t.bittorrent))

        // 按 videoId 分组：同一视频可能因重复下载/重建/手动添加在 aria2 中存在多个任务（多个 gid）
        const taskGroups = new Map<string, Aria2.Status[]>()
        for (const task of allTasks) {
            const videoId = aria2TaskExtractVideoID(task)
            if (isNullOrUndefined(videoId) || videoId.isEmpty()) {
                //log.debug(`扫描跳过 ${task.gid}: 无法提取视频ID (${task.files?.[0]?.path ?? '无路径'})`)
                continue
            }
            let group = taskGroups.get(videoId)
            if (!group) {
                group = []
                taskGroups.set(videoId, group)
            }
            group.push(task)
        }

        let enqueued = 0 // 本轮新纳入队列的任务数（debug 统计）
        let stopped = 0 // 本轮停止的冗余任务数（debug 统计）

        // 清理超期终态记录（推送成功/已处理/未启用推送的完成记录保留一段时间后移除），防止去重表无限膨胀
        for (const entry of aria2TrackQueue.valuesArray()) {
            if (!isAria2TrackDone(entry)) continue
            const doneAt = entry.pushedAt ?? entry.completedAt ?? entry.addedAt
            if (Date.now() - doneAt > ARIA2_TRACK_DONE_RETENTION) removeAria2TrackTask(entry.videoId)
        }

        for (const [videoId, group] of taskGroups) {
            // 同一 videoId 多个任务：解析各任务下载 URL 的 expires（多源任务遍历全部 URL 取最晚过期），
            // 保留距离过期时间最长的任务；过期时间并列时按状态活跃度（active>waiting>paused/complete>error/removed），
            // 仍并列则优先保留队列已追踪的 gid，避免无谓切换
            let task = group[0]
            if (group.length > 1) {
                const queued = aria2TrackQueue.get(videoId)
                const sorted = [...group].sort((a, b) => {
                    const expA = aria2TrackTaskExpiry(a)
                    const expB = aria2TrackTaskExpiry(b)
                    if (expA !== expB) return expA > expB ? -1 : 1
                    const priA = aria2TrackGidPriority(a.status)
                    const priB = aria2TrackGidPriority(b.status)
                    if (priA !== priB) return priA > priB ? -1 : 1
                    if (a.gid === queued?.gid) return -1
                    if (b.gid === queued?.gid) return 1
                    return 0
                })
                task = sorted[0]
                // 停止过期时间更短的冗余任务并清理结果记录；队列若仍记录着被停止任务的 gid 则同步移除，
                // 保留的赢家随后走下方统一入队流程
                for (const loser of sorted.slice(1)) {
                    await removeRedundantAria2Task(loser)
                    const queuedTask = aria2TrackQueue.get(videoId)
                    if (queuedTask && queuedTask.gid === loser.gid) removeAria2TrackTask(videoId)
                    stopped++
                    log.info(`扫描 ${videoId}: 停止冗余任务 ${loser.gid}(${loser.status}, 过期${formatAria2TrackExpiry(aria2TrackTaskExpiry(loser))})，保留 ${task.gid}(${task.status}, 过期${formatAria2TrackExpiry(aria2TrackTaskExpiry(task))})`)
                }
            }

            // 状态追踪去重（模块自维护，不依赖 MediaCenter 映射表）：
            // 已在队列中的任务一律跳过；非终态条目沿用 gid 跟随逻辑，让 worker 追踪真实下载；
            // 终态条目（已完成）由 worker 负责推送重试或直接收尾，扫描不再重复入队
            if (hasAria2TrackTask(videoId)) {
                const queued = aria2TrackQueue.get(videoId)
                if (queued && isNullOrUndefined(queued.completedAt)) {
                    // 非终态：检查队列记录的是否仍是最值得追踪的 gid。
                    // 同一 videoId 可能因重复下载/重建/手动添加而在 aria2 中存在多个任务（多个 gid），
                    // 而队列按 videoId 只存一个 gid——若记录的是旧 gid（paused/error 残留），
                    // 而当前任务才是真实下载（active/waiting），则更新队列 gid 让 worker 跟随真实下载，
                    // 避免“在队列中但从不检查真实下载”。
                    if (queued.gid !== task.gid) {
                        try {
                            const queuedStatusRes = (await aria2API('aria2.tellStatus', [queued.gid, ['status']])) as Aria2.TellStatusResult
                            const queuedStatus = queuedStatusRes.result?.status
                            // 当前任务比队列记录的 gid 更“活”才更新（避免两个 active 互相反复切换）
                            if (aria2TrackGidPriority(task.status) > aria2TrackGidPriority(queuedStatus)) {
                                log.debug(`扫描 ${videoId}: 队列 gid ${queued.gid}(${queuedStatus}) → 更新为 ${task.gid}(${task.status})，跟随真实下载`)
                                updateAria2TrackTaskGid(videoId, task.gid)
                                continue
                            }
                        } catch {
                            // 查询队列 gid 状态失败：不影响扫描主流程，保持原 gid 下轮再查
                        }
                    }
                }
                //log.debug(`扫描跳过 ${videoId} (gid=${task.gid}): 已在队列中`)
                continue
            }

            // 解析完整信息并构建下载参数后入队
            let info: VideoInfo | undefined = await db.getVideoById(videoId)
            if (!info || info.Type === 'cache' || info.Type === 'init' || info.Type === 'fail') {
                info = await parseVideoInfo({ Type: 'init', ID: videoId })
            } else if (info.Type === 'partial') {
                // partial 缺少下载地址等字段，补解析为 full
                info = await parseVideoInfo(info)
            }

            // 解析失败也要入队（管理器 worker 负责重建）：用任务现有路径构建下载参数，
            // 绝不因解析失败让任务游离在队列外、永远不被管理器接管
            let localPath: Path
            if (info.Type === 'full') {
                localPath = getDownloadPath(info)
            } else {
                log.warn(`入队 ${videoId} 解析失败 (${info.Type})，仍按现有路径入队待重建`)
                try {
                    localPath = analyzeLocalPath(task.files?.[0]?.path ?? '')
                } catch {
                    localPath = analyzeLocalPath(`[${videoId}].mp4`)
                }
            }
            const downloadParams = prune({
                'force-save': true,
                'allow-overwrite': true,
                'all-proxy': config.downloadProxy,
                'all-proxy-passwd': !config.downloadProxy.isEmpty() ? config.downloadProxyPassword : undefined,
                'all-proxy-user': !config.downloadProxy.isEmpty() ? config.downloadProxyUsername : undefined,
                out: localPath.fullName,
                dir: localPath.directory,
                referer: window.location.hostname,
                header: ['Cookie:' + unsafeWindow.document.cookie]
            })

            log.debug(`现有任务 ${videoId} (gid=${task.gid}) 已纳入队列`)
            enqueueAria2TrackTask(videoId, task.gid, downloadParams, task.status === 'complete')
            enqueued++
        }
        log.info(`扫描完成: aria2 共 ${allTasks.length} 个任务，新纳入队列 ${enqueued} 个，停止冗余任务 ${stopped} 个`)
    } catch (error) {
        log.warn('扫描 aria2 任务失败:', stringify(error))
    }
}

/** 获取 aria2 全局统计与最大并发数，判断下载队列是否已满 */
async function isAria2QueueFull(): Promise<boolean> {
    try {
        const [statRes, optRes] = await Promise.all([aria2API('aria2.getGlobalStat', []), aria2API('aria2.getGlobalOption', [])])
        const numActive = parseInt((statRes as Aria2.GlobalStatResult).result?.numActive ?? '0', 10)
        const maxConcurrent = parseInt((optRes as Aria2.GlobalOptionResult).result?.['max-concurrent-downloads'] ?? '5', 10)
        return numActive >= maxConcurrent
    } catch {
        return false
    }
}

/** 连续重建失败计数递增并判断是否继续：
 * 未超上限直接返回继续；超过上限弹常驻提示询问用户——点击=继续重试（重置计数），点叉=放弃（返回 ok:false，调用方移除任务） */
async function nextRebuildAttempt(videoId: string, title: string, failures: number): Promise<{ ok: boolean; failures: number }> {
    failures++
    if (failures > ARIA2_TRACK_MAX_REBUILD_ATTEMPTS) {
        const shouldRetry = await askAria2RebuildContinue(videoId, title)
        if (!shouldRetry) {
            log.warn(`${videoId} 用户放弃重试，从队列移除`)
            return { ok: false, failures }
        }
        failures = 0 // 用户选择继续：重置计数，再给一轮完整机会
        log.info(`${videoId} 用户选择继续重试，重置失败计数`)
    }
    return { ok: true, failures }
}

/** 无条件重建 aria2 任务：优先在原有 gid 上原地恢复——changeUri 将全部旧地址替换为新地址 + unpause；
 * aria2 的 changeUri/unpause 仅支持 active/waiting/paused 状态：error 任务的 unpause 会被静默忽略
 * （状态停留 error，只换地址不生效），必须先用 aria2.restart 原地重启（返回新 gid）再替换地址；
 * 仅当任务已被移除（removed）或原地修改失败时，才回退为 addUri 新建任务，
 * 避免同一 videoId 因重试产生多个 gid 并存。解析失败时用任务现有链接兜底，绝不静默放弃。
 * 返回当前生效的 gid 与解析到的视频信息（解析失败时 videoInfo 为空）。 */
async function rebuildAria2Task(videoId: string, task: Aria2TrackTask, status: Aria2.Status): Promise<{ gid?: string; videoInfo?: FullVideoInfo }> {
    try {
        // 任务现有 URI：保留用于多源下载；解析失败时也用于兜底重建
        const oldUris = (status.files?.[0]?.uris ?? []).map((u) => u.uri)

        // 重新解析获取最新下载地址；失败则回退用现有 URI
        let urls: string[]
        let freshVideoInfo: FullVideoInfo | undefined
        try {
            const freshInfo = await parseVideoInfo({ Type: 'init', ID: videoId })
            if (freshInfo.Type === 'full') {
                freshVideoInfo = freshInfo
                urls = [buildDownloadUrl(freshInfo).href]
            } else {
                log.warn(`${videoId} 重新解析失败 (${freshInfo.Type})，回退用现有链接重建`)
                urls = oldUris
            }
        } catch (e) {
            log.warn(`${videoId} 重新解析异常，回退用现有链接重建: ${stringify(e)}`)
            urls = oldUris
        }

        // 优先原地恢复：gid 仍存在（非 removed）的任务直接替换全部旧地址并恢复——
        // 不保留旧地址（旧链接通常已失效/过期），避免 aria2 反复尝试无效源；不产生新 gid；
        // paused/waiting 任务用 unpause 恢复；error 任务无法用 unpause 恢复——
        // aria2 的 changeUri 对 error 任务不检查状态（可成功换地址），但 unpause 会静默忽略
        // （不报错也不改状态），只换地址会导致任务状态永远停在 error，形成假成功循环，
        // 因此 error 任务必须先 aria2.restart 原地重启（重新入队并返回新 gid，状态变为 active/waiting）
        if (status.status !== 'removed') {
            try {
                let gid = task.gid
                if (status.status === 'error') {
                    // error 任务：restart 原地重启（保留原下载参数，任务重新入队，返回新 gid）
                    const restartRes = (await aria2API('aria2.restart', [task.gid])) as Aria2.AuctionResult
                    if (restartRes?.result?.isEmpty()) {
                        log.warn(`${videoId} aria2.restart 返回空 gid，重建失败，下轮重试`)
                        return {}
                    }
                    gid = restartRes.result
                    // 清理 restart 产生的旧任务 removed 记录，避免下次扫描误将其纳入队列
                    try {
                        await aria2API('aria2.removeDownloadResult', [task.gid])
                    } catch {
                        // 忽略：旧任务可能已被其他方式清理
                    }
                    // restart 后任务已重新入队（active/waiting），可将全部旧地址替换为新地址
                    await aria2API('aria2.changeUri', [gid, 0, oldUris, urls])
                    log.debug(`${videoId} 原地重启成功 (旧 gid=${task.gid} → 新 gid=${gid}, 旧地址 ${oldUris.length} 个 → 新地址 ${urls.length} 个)`)
                    return { gid, videoInfo: freshVideoInfo }
                }
                // paused/waiting/active：删除全部旧地址并插入新地址（position=0 从头替换）+ unpause 恢复下载
                await aria2API('aria2.changeUri', [gid, 0, oldUris, urls])
                await aria2API('aria2.unpause', [gid])
                log.debug(`${videoId} 原地替换新地址成功 (gid=${gid}, 旧地址 ${oldUris.length} 个 → 新地址 ${urls.length} 个)，无需重建`)
                return { gid, videoInfo: freshVideoInfo }
            } catch (e) {
                log.warn(`${videoId} 原地恢复失败（error 任务 restart 异常或链接已失效），降级为 addUri 重建: ${stringify(e)}`)
            }
        }

        const newRes = (await aria2API('aria2.addUri', [urls, task.downloadParams])) as Aria2.AuctionResult
        if (newRes?.result?.isEmpty()) {
            log.warn(`${videoId} addUri 返回空 gid，重建失败，下轮重试`)
            return {}
        }
        // 重建成功：清理旧的 error/removed 任务结果，避免残留任务被下次扫描重复入队重建（死循环）
        if (status.status === 'error' || status.status === 'removed') {
            try {
                await aria2API('aria2.removeDownloadResult', [task.gid])
                log.info(`${videoId} 已清理旧任务结果 (gid=${task.gid})`)
            } catch {
                // 忽略：旧任务可能已被其他方式清理
            }
        }
        log.debug(`${videoId} 任务重建成功，新 gid=${newRes.result}`)
        return { gid: newRes.result, videoInfo: freshVideoInfo }
    } catch (error) {
        log.warn(`${videoId} 重建异常，下轮重试: ${stringify(error)}`)
        return {}
    }
}

/** 重启单个 Aria2 任务：重新解析下载地址 → 将全部旧地址替换为新地址（不保留旧地址）→ 恢复，返回最新视频信息 */
async function restartAria2Task(gid: string, videoId: string, task: Aria2.Status): Promise<FullVideoInfo | undefined> {
    try {
        const freshInfo = await parseVideoInfo({ Type: 'init', ID: videoId })
        if (freshInfo.Type !== 'full') {
            log.warn(`restartAria2Task ${videoId} 重新解析失败 (${freshInfo.Type})`)
            return undefined
        }
        const oldUris = (task.files?.[0]?.uris ?? []).map((u: any) => u.uri)
        const newUris = [buildDownloadUrl(freshInfo).href]
        // 不保留旧地址：删除全部旧 URI 并插入新地址（旧链接通常已失效/过期，避免 aria2 反复尝试无效源）
        await aria2API('aria2.changeUri', [gid, 0, oldUris, newUris])
        await aria2API('aria2.unpause', [gid])
        return freshInfo
    } catch (error) {
        log.warn(`restartAria2Task 失败 ${gid}:`, stringify(error))
        return undefined
    }
}

/** 验证 MediaCenter 映射在服务端是否仍然存在（GET /api/media/{id}）：
 * - 200：映射有效，结果按 TTL 缓存（key 含 API 地址，切换实例自动失效）；
 * - 404：映射失效——删除本地 idmap 并返回 undefined（调用方重新走 createMedia 流程）；
 * - 其他状态/网络异常：保守视为有效（返回原 id），避免误删映射导致重复推送；
 * - MediaCenter 未配置：不做请求，直接视为有效。 */
async function verifyMediaCenterMapping(videoId: string, mediaCenterId: string): Promise<string | undefined> {
    if (config.mediaCenterApi.isEmpty() || config.mediaCenterApiKey.isEmpty()) return mediaCenterId
    const cacheKey = `${config.mediaCenterApi}|${mediaCenterId}`
    const cached = mediaCenterIdMapValidateCache.get(cacheKey)
    if (cached && Date.now() - cached.checkedAt < MEDIA_CENTER_ID_MAP_VALIDATE_TTL) {
        return cached.valid ? mediaCenterId : undefined
    }
    try {
        const apiBase = config.mediaCenterApi.replace(/\/+$/, '')
        const checkRes = await unlimitedFetch(`${apiBase}/api/media/${mediaCenterId}`, {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${config.mediaCenterApiKey}`
            }
        })
        if (checkRes.status === 404) {
            mediaLog.warn(`映射失效: ${videoId} → ${mediaCenterId} 在服务端不存在 (404)，删除本地映射`)
            await db.deleteMediaCenterIdMap(videoId)
            mediaCenterIdMapValidateCache.delete(cacheKey)
            return undefined
        }
        if (checkRes.ok) {
            mediaCenterIdMapValidateCache.set(cacheKey, { valid: true, checkedAt: Date.now() })
            return mediaCenterId
        }
        mediaLog.warn(`验证映射 ${videoId} → ${mediaCenterId} 失败: ${checkRes.status}，保守视为有效`)
        return mediaCenterId
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
    if (config.mediaCenterApi.isEmpty() || config.mediaCenterApiKey.isEmpty()) return false
    const apiBase = config.mediaCenterApi.replace(/\/+$/, '')
    const authHeaders = {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${config.mediaCenterApiKey}`
    }
    const downloadPath = getDownloadPath(videoInfo)

    try {
        // 校验映射在服务端仍有效：404 → verify 已删除本地映射并返回 undefined → 重新走 createMedia 流程；
        // 网络异常/非 404 保守保留映射（返回原 id），避免误删导致重复推送
        if (!isNullOrUndefined(mediaCenterId) && !mediaCenterId.isEmpty()) {
            mediaCenterId = await verifyMediaCenterMapping(videoInfo.ID, mediaCenterId)
        }

        if (isNullOrUndefined(mediaCenterId) || mediaCenterId.isEmpty()) {
            // 第一步：createMedia — 创建媒体记录（用 iwara 视频 ID 作为 fileHash 去重标识）
            const createBody = prune({
                filePath: downloadPath.fullPath,
                fileHash: videoInfo.ID
            })
            const createRes = await unlimitedFetch(`${apiBase}/api/media`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(createBody)
            })

            if (createRes.status === 409) {
                // fileHash 重复，已有记录
                const conflict = (await createRes.json()) as { error: string; existingId?: string; existingTitle?: string }
                if (conflict.existingId && !conflict.existingId.isEmpty()) {
                    mediaCenterId = conflict.existingId
                    await db.putMediaCenterIdMap(videoInfo.ID, mediaCenterId)
                    mediaLog.debug(`createMedia 409, reuse existing ${videoInfo.ID} → ${mediaCenterId}`)
                } else {
                    mediaLog.warn(`createMedia 409 but no existingId for ${videoInfo.ID}: ${conflict.error}`)
                    return false
                }
            } else if (!createRes.ok) {
                mediaLog.warn(`createMedia failed for ${videoInfo.ID}: ${createRes.status} ${await createRes.text()}`)
                return false
            } else {
                // 201 Created 成功：{ message: 'media.importSuccess', id }
                const createResult = (await createRes.json()) as { message?: string; error?: string; id?: string }
                if (createResult.error) {
                    mediaLog.warn(`createMedia error for ${videoInfo.ID}: ${createResult.error}`)
                    return false
                }
                if (!createResult.id || createResult.id.isEmpty()) {
                    mediaLog.warn(`createMedia returned no id for ${videoInfo.ID} ${stringify(createResult)}`)
                    return false
                }

                mediaCenterId = createResult.id
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
        const updateRes = await unlimitedFetch(`${apiBase}/api/media/${mediaCenterId}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify(updateBody)
        })

        if (!updateRes.ok) {
            if (updateRes.status === 404) {
                // 服务端记录不存在（验证通过后又被删除/实例切换）：清理本地映射，下次推送/扫描自动重建
                mediaLog.warn(`updateMedia 404 for ${videoInfo.ID}: 服务端记录不存在，删除本地映射 ${mediaCenterId}`)
                await db.deleteMediaCenterIdMap(videoInfo.ID)
            } else {
                mediaLog.warn(`updateMedia failed for ${videoInfo.ID}: ${updateRes.status} ${await updateRes.text()}`)
            }
            return false
        }

        // 校验响应体：服务端成功时返回 { message: 'media.updateSuccess', media: {...} }
        const updateResult = (await updateRes.json()) as { message?: string; error?: string; media?: Record<string, unknown> }
        if (updateResult.error) {
            mediaLog.warn(`updateMedia error for ${videoInfo.ID}: ${updateResult.error}`)
            return false
        }
        if (!updateResult.media) {
            mediaLog.warn(`updateMedia returned no media for ${videoInfo.ID}`)
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
 * 脚本启动时初始化 Aria2 任务管理器（仅下载模式为 Aria2 时有效）：
 * 1. 扫描现有任务纳入同步队列（GMSyncDictionary 自动跨页同步）；
 * 2. 参与“单锁选举”，成为管理器的页面负责处理整个队列；
 * 3. 周期性重试选举/扫描/清理，接管因管理器页面关闭而租约过期的队列，
 *    避免出现无人管理的任务。
 */
export async function trackExistingAria2Tasks(): Promise<void> {
    if (config.downloadType !== DownloadType.Aria2) return

    await scanAria2TasksAndEnqueue()
    await tryBecomeAria2TrackManager()

    // 周期性重新选举：管理器页面关闭/崩溃后，其他页面可接管整个队列
    setInterval(() => {
        tryBecomeAria2TrackManager()
    }, ARIA2_TRACK_ELECTION_INTERVAL)
    // 周期性重扫：把 aria2 中尚未纳入队列的任务补入队列
    setInterval(() => {
        scanAria2TasksAndEnqueue()
    }, ARIA2_TRACK_SCAN_INTERVAL)
    // 清理过期锁数据
    setInterval(() => {
        GMLock.pruneExpired()
    }, ARIA2_TRACK_SCAN_INTERVAL)

    // 页面关闭/进入后台缓存时立即释放管理器锁：正常退出无需等待租约过期即可被其他页面接管
    // （崩溃/非正常退出场景仍由 75s 租约自动过期兜底，不会死锁）
    originalAddEventListener.call(unsafeWindow, 'pagehide', () => {
        aria2TrackLock.release(ARIA2_TRACK_MANAGER_LOCK)
    })
}

// ── debug 注入（仅 isDebug 开启）：测试连续重建失败的交互提示（内建重试/取消按钮）──
// 控制台调用：await testAria2RebuildAsk('视频ID', '标题')
// 返回 Promise<boolean>：true = 点了「重试」，false = 点了「取消」或右上角 ×
if (GM_getValue(GM_KEY_IS_DEBUG)) {
    // @ts-ignore
    unsafeWindow.testAria2RebuildAsk = async (videoId: string = 'debugVideo', title: string = 'Debug 视频') => {
        try {
            const retry = await askAria2RebuildContinue(videoId, title)
            log.info(`testAria2RebuildAsk 结果: ${videoId} → 用户${retry ? '选择重试' : '选择放弃'}`)
            newToast(retry ? ToastType.Info : ToastType.Warn, {
                id: `aria2Track-test-${videoId}`,
                duration: 5000,
                node: toastNode(`${title}[${videoId}] 用户${retry ? '选择重试' : '选择放弃'}`, '测试结果')
            }).show()
            return retry
        } catch (e) {
            log.error(`testAria2RebuildAsk 异常: ${stringify(e)}`)
            return undefined
        }
    }
}
