import { delay, isConvertibleToNumber, isNullOrUndefined, isString, prune, stringify, UUID } from "../core/env";
import { GMSyncDictionary } from "../core/class";
import { DownloadType } from "../core/enum";
import { config } from "../core/config";
import { db } from "../core/db";
import { GMLock } from "../core/gmLock";
import { originalAddEventListener, originalConsole } from "../core/hijack";
import { unlimitedFetch } from "../core/extension";
import { aria2API, aria2TaskExtractVideoID } from "./aria2";
import { getDownloadPath } from "./downloadPath";
import { getMoreCompleteVideoInfo, parseVideoInfo } from "../network/video";

/**
 * Aria2 任务管理器
 *
 * 架构：跨页面同步队列 + 单把管理器锁。
 * - 任务记录在共享的同步列表（GMSyncDictionary，GM 存储跨页同步）中，由唯一的“管理器”页面处理；
 * - 管理器通过全局唯一一把锁（GMLock 租约）选举产生，负责处理整个队列；
 * - 管理器页面关闭/崩溃后，租约过期，其他页面可重新选举接管，避免死锁与无人管理。
 */

/** Aria2 任务同步队列：GM 存储键（所有页面共享，由唯一的“管理器”页面处理） */
const ARIA2_TRACK_QUEUE_KEY = 'Aria2TrackQueue';
/** 管理器全局锁名：跨页面仅此一把锁，持有者负责处理整个队列 */
const ARIA2_TRACK_MANAGER_LOCK = 'aria2TrackManager';
/** 管理器租约时长（毫秒）：持有页面关闭/崩溃后其他页面可重新选举接管。
 *  不低于后台标签页定时器节流上限（约 60s）+ 余量，避免被节流时误判过期导致频繁重选 */
const ARIA2_TRACK_MANAGER_TTL = 75_000;
/** 管理器选举间隔（毫秒）：非管理器页面周期尝试抢占单把锁 */
const ARIA2_TRACK_ELECTION_INTERVAL = 5_000;
/** 任务队列扫描间隔（毫秒）：把 aria2 中尚未纳入队列的任务补入队列 */
const ARIA2_TRACK_SCAN_INTERVAL = 60_000;
/** 任务轮询间隔（毫秒）：每个 worker 每 30s 检查一次任务状态 */
const ARIA2_TRACK_POLL_INTERVAL = 1000 * 10 * 3;
/** 下载速度过慢判定阈值（字节/秒，64 KiB/s）：低于此速度视为“速度过慢”并重启任务 */
export const ARIA2_SLOW_SPEED_THRESHOLD = 64 * 1024;
/** 当前页面实例唯一的标识 */
const aria2TrackOwner = UUID();
/** 跨页面原子锁：全局仅此一把，用于选举唯一的管理页面 */
const aria2TrackLock = new GMLock(aria2TrackOwner);

/** 队列任务条目（仅存轻量元数据，完整视频信息由处理时从本地数据库/网络解析） */
interface Aria2TrackTask {
    videoId: string;
    gid: string;
    downloadParams: Record<string, any>;
    addedAt: number;
}

/** 管理器是否在本页运行中（防止并发重复启动管理循环） */
let aria2TrackManagerLoopRunning = false;
/** 正在被处理的队列任务 videoId（仅用于避免重复启动 worker；worker 自行通过锁/队列校验停止） */
const aria2TrackWorkers = new Set<string>();

/** 跨页面同步任务队列：复用 GMSyncDictionary 的 GM 存储跨页同步能力 */
const aria2TrackQueue = new GMSyncDictionary<Aria2TrackTask>(
    ARIA2_TRACK_QUEUE_KEY,
    [],
    (value) => isString((value as Aria2TrackTask)?.videoId) && isString((value as Aria2TrackTask)?.gid)
);
// 队列变化（含其他页面的远程变更）时，若本页为管理器则立即同步 worker
aria2TrackQueue.onSet = () => { if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(); };
aria2TrackQueue.onDel = () => { if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(); };
aria2TrackQueue.onSync = () => { if (aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) syncAria2TrackWorkers(); };

/** 从视频信息构建带 videoid/download 参数的下载 URL */
export function buildDownloadUrl(videoInfo: FullVideoInfo): URL {
    const localPath = getDownloadPath(videoInfo);
    const url = videoInfo.DownloadUrl.toURL();
    url.searchParams.set('videoid', videoInfo.ID);
    url.searchParams.set('download', localPath.fullName);
    return url;
}

// ── 跨页面同步队列：复用 GMSyncDictionary 的跨页同步，任务记录由唯一的管理页面处理 ──

/** 将任务加入同步队列（按 videoId 幂等去重，GMSyncDictionary 负责跨页同步） */
export function enqueueAria2TrackTask(videoId: string, gid: string, downloadParams: Record<string, any>): void {
    aria2TrackQueue.set(videoId, { videoId, gid, downloadParams, addedAt: Date.now() });
}
/** 队列中是否包含某任务 */
function hasAria2TrackTask(videoId: string): boolean {
    return aria2TrackQueue.has(videoId);
}
/** 从队列移除任务 */
function removeAria2TrackTask(videoId: string): void {
    aria2TrackQueue.delete(videoId);
}
/** 更新队列中任务的 gid（任务重建后） */
function updateAria2TrackTaskGid(videoId: string, gid: string): void {
    const task = aria2TrackQueue.get(videoId);
    if (task) aria2TrackQueue.set(videoId, { ...task, gid });
}

/** 计算 aria2 任务下载进度（0~1，基于 completedLength/totalLength），无法计算时返回 0 */
export function getAria2Progress(status: Aria2.Status): number {
    if (!isConvertibleToNumber(status.completedLength) || !isConvertibleToNumber(status.totalLength)) return 0;
    const total = Number(status.totalLength);
    if (total <= 0) return 0;
    return Math.min(1, Number(status.completedLength) / total);
}

/**
 * 管理器内的单任务处理循环：轮询 aria2 状态，异常自动重试，完成后移除队列并推送 MediaCenter。
 * 仅当本页仍是管理器、且任务仍在队列中时才执行动作；
 * 失去管理器资格或任务被移除时，worker 在下一轮自行退出，无需外部停止信号。
 */
async function processAria2TrackTask(task: Aria2TrackTask): Promise<void> {
    // 初始化完整视频信息（队列仅存轻量元数据）
    let info = await db.getVideoById(task.videoId);
    if (info?.Type !== 'full') {
        const parsed = await parseVideoInfo({ Type: 'init', ID: task.videoId, RAW: info?.RAW });
        info = getMoreCompleteVideoInfo(info ?? { Type: 'init', ID: task.videoId }, parsed);
    }
    if (info.Type !== 'full') {
        originalConsole.warn(`[Aria2Track] ${task.videoId} 初始化解析失败 (${info.Type})，从队列移除`);
        removeAria2TrackTask(task.videoId);
        return;
    }
    let videoInfo = info as FullVideoInfo;
    let currentGid = task.gid;
    let consecutiveFailures = 0;

    while (true) {
        await delay(ARIA2_TRACK_POLL_INTERVAL);
        // 本页仍是管理器且任务仍在队列中才继续（失去则自行让位）
        if (!aria2TrackLock.isHeld(ARIA2_TRACK_MANAGER_LOCK)) return;
        if (!hasAria2TrackTask(task.videoId)) return;

        try {
            const statusRes = await aria2API('aria2.tellStatus', [
                currentGid,
                ['gid', 'status', 'files', 'downloadSpeed', 'errorCode', 'completedLength', 'totalLength'],
            ]) as Aria2.TellStatusResult;
            const status = statusRes.result;

            if (!status?.status) {
                // 持续无响应不移除任务，继续轮询重试（任务可能暂时不可达）
                continue;
            }
            consecutiveFailures = 0;

            switch (status.status) {
                case 'complete':
                    GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${task.videoId} 下载完成`);
                    if (config.experimentalFeatures) {
                        await pushToMediaCenter(videoInfo);
                    }
                    removeAria2TrackTask(task.videoId);
                    return; // 完成，从队列移除

                case 'error':
                case 'removed':
                    originalConsole.warn(`[Aria2Track] ${task.videoId} 任务 ${status.status}，重新创建下载`);
                    try {
                        const freshInfo = await parseVideoInfo({ Type: 'init', ID: task.videoId });
                        if (freshInfo.Type === 'full') {
                            videoInfo = freshInfo
                            const newRes = await aria2API('aria2.addUri', [[buildDownloadUrl(freshInfo).href], task.downloadParams]) as Aria2.AuctionResult;
                            if (!newRes?.result?.isEmpty()) {
                                currentGid = newRes.result;
                                updateAria2TrackTaskGid(task.videoId, currentGid);
                            }
                        }
                    } catch { /* fall through, will retry next poll */ }
                    break;

                case 'active':
                    if (isConvertibleToNumber(status.downloadSpeed) && Number(status.downloadSpeed) <= ARIA2_SLOW_SPEED_THRESHOLD) {
                        // 下载进度 > 98% 时豁免（接近完成不重启）；但速度为 0 不豁免
                        const speed = Number(status.downloadSpeed);
                        if (speed === 0 || getAria2Progress(status) <= 0.98) {
                            GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${task.videoId} 速度过慢，重启`);
                            const freshActive = await restartAria2Task(currentGid, task.videoId, status);
                            if (freshActive) videoInfo = freshActive;
                        }
                    }
                    break;

                case 'waiting':
                    // 等待中，继续轮询
                    break;

                case 'paused':
                    if (await isAria2QueueFull()) {
                        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${task.videoId} 队列已满，暂不重启`);
                    } else {
                        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${task.videoId} 已暂停，重启`);
                        const freshPaused = await restartAria2Task(currentGid, task.videoId, status);
                        if (freshPaused) videoInfo = freshPaused;
                    }
                    break;
            }
        } catch (error) {
            originalConsole.warn(`[Aria2Track] 追踪异常 ${currentGid}:`, stringify(error));
            consecutiveFailures++;
            if (consecutiveFailures > 5) {
                originalConsole.warn(`[Aria2Track] 任务 ${currentGid} 持续异常，从队列移除`);
                removeAria2TrackTask(task.videoId);
                return;
            }
        }
    }
}

/** 同步 worker 与队列：为队列中尚未启动 worker 的任务启动 worker（Set 去重防重复） */
function syncAria2TrackWorkers(): void {
    for (const task of aria2TrackQueue.valuesArray()) {
        if (aria2TrackWorkers.has(task.videoId)) continue;
        aria2TrackWorkers.add(task.videoId);
        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] 管理器开始处理 ${task.videoId} (gid=${task.gid})`);
        processAria2TrackTask(task).finally(() => {
            aria2TrackWorkers.delete(task.videoId);
        });
    }
}

/**
 * 尝试通过单把全局锁选举本页为管理器；成功后由本页处理整个队列。
 * 管理器页面关闭/崩溃后租约过期，其他页面可重新选举，避免任务无人管理。
 */
async function tryBecomeAria2TrackManager(): Promise<void> {
    if (aria2TrackManagerLoopRunning) return;
    aria2TrackManagerLoopRunning = true; // 同步置位，防止并发重复启动管理循环
    try {
        if (!aria2TrackLock.acquire(ARIA2_TRACK_MANAGER_LOCK, ARIA2_TRACK_MANAGER_TTL)) return;
        GM_getValue('isDebug') && originalConsole.debug('[Aria2Track] 本页成为管理器，接管整个队列');
        await startAria2TrackManagerLoop();
    } finally {
        aria2TrackManagerLoopRunning = false;
    }
}

/** 管理器主循环：心跳续期 + 同步队列 worker */
async function startAria2TrackManagerLoop(): Promise<void> {
    syncAria2TrackWorkers();
    while (aria2TrackLock.renew(ARIA2_TRACK_MANAGER_LOCK, ARIA2_TRACK_MANAGER_TTL)) {
        await delay(ARIA2_TRACK_MANAGER_TTL / 3);
        syncAria2TrackWorkers();
    }
    // 失去管理器资格：worker 会在下一轮通过 isHeld() 自行退出
    GM_getValue('isDebug') && originalConsole.debug('[Aria2Track] 管理器锁过期/被抢占，停止处理队列');
}

/** 扫描 aria2 现有任务，把尚未纳入队列且未推送过的任务补入队列 */
async function scanAria2TasksAndEnqueue(): Promise<void> {
    try {
        const [actRes, stopRes] = await Promise.all([
            aria2API('aria2.tellActive', [['gid', 'status', 'files', 'bittorrent']]),
            aria2API('aria2.tellStopped', [0, 4096, ['gid', 'status', 'files', 'bittorrent']]),
        ]);
        const activeRes = actRes as Aria2.StartsResult;
        const stoppedRes = stopRes as Aria2.StartsResult;

        const allTasks = [...(activeRes.result ?? []), ...(stoppedRes.result ?? [])]
            .filter(t => isNullOrUndefined(t.bittorrent));

        for (const task of allTasks) {
            const videoId = aria2TaskExtractVideoID(task);
            if (isNullOrUndefined(videoId) || videoId.isEmpty()) continue;

            // 已在队列中 → 跳过
            if (hasAria2TrackTask(videoId)) continue;

            // 已有 idmap 映射说明之前已追踪过 / 已推送到 MediaCenter
            const existingMapping = await db.getMediaCenterIdMap(videoId);
            if (!isNullOrUndefined(existingMapping) && !existingMapping.isEmpty()) continue;

            // 解析完整信息并构建下载参数后入队
            let info: VideoInfo | undefined = await db.getVideoById(videoId);
            if (!info || info.Type === 'cache' || info.Type === 'init' || info.Type === 'fail') {
                info = await parseVideoInfo({ Type: 'init', ID: videoId });
            } else if (info.Type === 'partial') {
                // partial 缺少下载地址等字段，补解析为 full
                info = await parseVideoInfo(info);
            }
            if (info.Type !== 'full') {
                originalConsole.warn(`[Aria2Track] 入队 ${videoId} 解析失败 (${info.Type})，跳过`);
                continue;
            }

            const localPath = getDownloadPath(info);
            const downloadParams = prune({
                'allow-overwrite': true,
                'all-proxy': config.downloadProxy,
                'all-proxy-passwd': !config.downloadProxy.isEmpty() ? config.downloadProxyPassword : undefined,
                'all-proxy-user': !config.downloadProxy.isEmpty() ? config.downloadProxyUsername : undefined,
                'out': localPath.fullName,
                'dir': localPath.directory,
                'referer': window.location.hostname,
                'header': ['Cookie:' + unsafeWindow.document.cookie],
            });

            GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] 现有任务 ${videoId} 已纳入队列 (gid=${task.gid})`);
            enqueueAria2TrackTask(videoId, task.gid, downloadParams);
        }
    } catch (error) {
        originalConsole.warn('[Aria2Track] 扫描 aria2 任务失败:', stringify(error));
    }
}

/** 获取 aria2 全局统计与最大并发数，判断下载队列是否已满 */
async function isAria2QueueFull(): Promise<boolean> {
    try {
        const [statRes, optRes] = await Promise.all([
            aria2API('aria2.getGlobalStat', []),
            aria2API('aria2.getGlobalOption', []),
        ]);
        const numActive = parseInt((statRes as Aria2.GlobalStatResult).result?.numActive ?? '0', 10);
        const maxConcurrent = parseInt((optRes as Aria2.GlobalOptionResult).result?.['max-concurrent-downloads'] ?? '5', 10);
        return numActive >= maxConcurrent;
    } catch {
        return false;
    }
}

/** 重启单个 Aria2 任务：重新解析下载地址 → 刷新链接 → 恢复，返回最新视频信息 */
async function restartAria2Task(gid: string, videoId: string, task: Aria2.Status): Promise<FullVideoInfo | undefined> {
    try {
        const freshInfo = await parseVideoInfo({ Type: 'init', ID: videoId });
        if (freshInfo.Type !== 'full') {
            originalConsole.warn(`[Aria2Track] restartAria2Task ${videoId} 重新解析失败 (${freshInfo.Type})`);
            return undefined;
        }
        const oldUris = (task.files?.[0]?.uris ?? []).map((u: any) => u.uri);
        await aria2API('aria2.changeUri', [gid, 1, oldUris, [buildDownloadUrl(freshInfo).href]]);
        await aria2API('aria2.unpause', [gid]);
        return freshInfo;
    } catch (error) {
        originalConsole.warn(`[Aria2Track] restartAria2Task 失败 ${gid}:`, stringify(error));
        return undefined;
    }
}

/**
 * 将视频元数据推送到 MediaCenter
 * 流程：先 createMedia 创建媒体记录，再 updateMedia 更新完整元数据
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export async function pushToMediaCenter(videoInfo: FullVideoInfo, mediaCenterId: string | undefined = undefined): Promise<boolean> {
    if (config.mediaCenterApi.isEmpty() || config.mediaCenterApiKey.isEmpty()) return false;
    const apiBase = config.mediaCenterApi.replace(/\/+$/, '');
    const authHeaders = {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${config.mediaCenterApiKey}`
    };
    const downloadPath = getDownloadPath(videoInfo);

    try {

        if (isNullOrUndefined(mediaCenterId) || mediaCenterId.isEmpty()) {
            // 第一步：createMedia — 创建媒体记录（用 iwara 视频 ID 作为 fileHash 去重标识）
            const createBody = prune({
                filePath: downloadPath.fullPath,
                fileHash: videoInfo.ID
            });
            const createRes = await unlimitedFetch(`${apiBase}/api/media`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(createBody)
            });

            if (createRes.status === 409) {
                // fileHash 重复，已有记录
                const conflict = await createRes.json() as { error: string; existingId?: string; existingTitle?: string };
                if (conflict.existingId && !conflict.existingId.isEmpty()) {
                    mediaCenterId = conflict.existingId;
                    await db.putMediaCenterIdMap(videoInfo.ID, mediaCenterId);
                    GM_getValue('isDebug') && originalConsole.debug(`[MediaCenter] createMedia 409, reuse existing ${videoInfo.ID} → ${mediaCenterId}`);
                } else {
                    originalConsole.warn(`[MediaCenter] createMedia 409 but no existingId for ${videoInfo.ID}: ${conflict.error}`);
                    return false;
                }
            } else if (!createRes.ok) {
                originalConsole.warn(`[MediaCenter] createMedia failed for ${videoInfo.ID}: ${createRes.status} ${await createRes.text()}`);
                return false;
            } else {
                // 201 Created 成功：{ message: 'media.importSuccess', id }
                const createResult = await createRes.json() as { message?: string; error?: string; id?: string };
                if (createResult.error) {
                    originalConsole.warn(`[MediaCenter] createMedia error for ${videoInfo.ID}: ${createResult.error}`);
                    return false;
                }
                if (!createResult.id || createResult.id.isEmpty()) {
                    originalConsole.warn(`[MediaCenter] createMedia returned no id for ${videoInfo.ID}`);
                    return false;
                }

                mediaCenterId = createResult.id;
                await db.putMediaCenterIdMap(videoInfo.ID, mediaCenterId);
            }
        }

        // 第二步：updateMedia — 更新完整元数据
        const updateBody = prune({
            filePath: downloadPath.fullPath,
            fileHash: videoInfo.ID,
            title: videoInfo.Title,
            description: videoInfo.Description ?? '',
            source: 'iwara',
            author: videoInfo.Author || videoInfo.Alias,
            tags: (videoInfo.Tags ?? []).map(t => t.id),
            duration: videoInfo.RAW?.file?.duration,
            sourceMeta: videoInfo.RAW ? JSON.stringify(videoInfo.RAW) : undefined,
            createdAt: new Date(videoInfo.UploadTime).toISOString(),
        });
        const updateRes = await unlimitedFetch(`${apiBase}/api/media/${mediaCenterId}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify(updateBody)
        });

        if (!updateRes.ok) {
            originalConsole.warn(`[MediaCenter] updateMedia failed for ${videoInfo.ID}: ${updateRes.status} ${await updateRes.text()}`);
            return false;
        }

        // 校验响应体：服务端成功时返回 { message: 'media.updateSuccess', media: {...} }
        const updateResult = await updateRes.json() as { message?: string; error?: string; media?: Record<string, unknown> };
        if (updateResult.error) {
            originalConsole.warn(`[MediaCenter] updateMedia error for ${videoInfo.ID}: ${updateResult.error}`);
            return false;
        }
        if (!updateResult.media) {
            originalConsole.warn(`[MediaCenter] updateMedia returned no media for ${videoInfo.ID}`);
            return false;
        }

        GM_getValue('isDebug') && originalConsole.debug('[Debug] MediaCenter metadata pushed:', videoInfo.ID, '→', mediaCenterId);
        return true;
    } catch (error) {
        originalConsole.warn(`[MediaCenter] Push metadata error for ${videoInfo.ID}:`, stringify(error));
    }

    return false;
}

/**
 * 脚本启动时初始化 Aria2 任务管理器（仅下载模式为 Aria2 时有效）：
 * 1. 扫描现有任务纳入同步队列（GMSyncDictionary 自动跨页同步）；
 * 2. 参与“单锁选举”，成为管理器的页面负责处理整个队列；
 * 3. 周期性重试选举/扫描/清理，接管因管理器页面关闭而租约过期的队列，
 *    避免出现无人管理的任务。
 */
export async function trackExistingAria2Tasks(): Promise<void> {
    if (config.downloadType !== DownloadType.Aria2) return;

    await scanAria2TasksAndEnqueue();
    await tryBecomeAria2TrackManager();

    // 周期性重新选举：管理器页面关闭/崩溃后，其他页面可接管整个队列
    setInterval(() => { tryBecomeAria2TrackManager(); }, ARIA2_TRACK_ELECTION_INTERVAL);
    // 周期性重扫：把 aria2 中尚未纳入队列的任务补入队列
    setInterval(() => { scanAria2TasksAndEnqueue(); }, ARIA2_TRACK_SCAN_INTERVAL);
    // 清理过期锁数据
    setInterval(() => { GMLock.pruneExpired(); }, ARIA2_TRACK_SCAN_INTERVAL);

    // 页面关闭/进入后台缓存时立即释放管理器锁：正常退出无需等待租约过期即可被其他页面接管
    // （崩溃/非正常退出场景仍由 75s 租约自动过期兜底，不会死锁）
    originalAddEventListener.call(unsafeWindow, 'pagehide', () => {
        aria2TrackLock.release(ARIA2_TRACK_MANAGER_LOCK);
    });
}
