import "../core/env";
import { isConvertibleToNumber, isNullOrUndefined, prune, stringify, UUID } from "../core/env";
import { ToastType } from "../core/enum";
import { config } from "../core/config";
import { unlimitedFetch } from "../core/extension";
import { originalConsole } from "../core/hijack";
import { newToast, toastNode } from "../ui/notify";
import { analyzeLocalPath, getDownloadPath } from "./downloadPath";
import { parseVideoInfo } from "../network/video";
import { ARIA2_SLOW_SPEED_THRESHOLD, buildDownloadUrl, enqueueAria2TrackTask, getAria2Progress } from "./aria2TrackManager";

/**
 * 调用Aria2 RPC API
 * @async
 * @param {string} method - API方法名
 * @param {any} params - API参数
 * @returns {Promise<Aria2.IResult>} 返回API调用结果
 */
export async function aria2API(method: string, params: any): Promise<Aria2.IResult> {
    return await (await unlimitedFetch(
        config.aria2Path,
        {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: method,
                id: UUID(),
                params: [`token:${config.aria2Token}`, ...params]
            }, (_, v) => typeof v === 'boolean' ? String(v) : v),
            method: 'POST'
        }
    )).json()
}

/**
 * 从Aria2任务中提取视频ID
 * @param {Aria2.Status} task - Aria2任务状态
 * @returns {string|undefined} 返回提取的视频ID，如果提取失败返回undefined
 */
export function aria2TaskExtractVideoID(task: Aria2.Status): string | undefined {
    try {
        if (isNullOrUndefined(task.files) || task.files.length !== 1) return
        const file = task.files[0]
        if (isNullOrUndefined(file)) return
        if (file.uris.length < 1) return
        let downloadUrl = file.uris[0].uri.toURL()
        if (isNullOrUndefined(downloadUrl)) return
        let videoID: string | undefined | null
        if (downloadUrl.searchParams.has('videoid')) videoID = downloadUrl.searchParams.get('videoid')
        if (!isNullOrUndefined(videoID) && !videoID.isEmpty()) return videoID
        if (isNullOrUndefined(file.path) || file.path.isEmpty()) return
        let path = analyzeLocalPath(file.path)
        if (isNullOrUndefined(path.fullName) || path.fullName.isEmpty()) return
        videoID = path.fullName.toLowerCase().among('[', '].mp4', false, true)
        if (videoID.isEmpty()) return
        return videoID
    } catch (error) {
        GM_getValue('isDebug') && originalConsole.debug(`[Debug] check aria2 task file fail! ${stringify(task)}`)
        return
    }
}

/**
 * 通过Aria2下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export async function aria2Download(videoInfo: FullVideoInfo, overwrite: boolean | undefined = undefined) {
    const downloadUrl = buildDownloadUrl(videoInfo);
    const localPath = getDownloadPath(videoInfo);
    const downloadParams = prune({
        'allow-overwrite': true,
        'all-proxy': config.downloadProxy,
        'all-proxy-passwd': !config.downloadProxy.isEmpty() ? config.downloadProxyPassword : undefined,
        'all-proxy-user': !config.downloadProxy.isEmpty() ? config.downloadProxyUsername : undefined,
        'out': localPath.fullName,
        'dir': localPath.directory,
        'referer': window.location.hostname,
        'header': [
            'Cookie:' + unsafeWindow.document.cookie
        ]
    })
    try {
        let res = await aria2API('aria2.addUri', [[downloadUrl.href], downloadParams]) as Aria2.AuctionResult
        if (res.result.isEmpty()) throw `aria2 下载失败：${stringify(res)}`
        newToast(
            ToastType.Info,
            {
                gravity: 'bottom',
                node: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskSucceed#%`)
            }
        ).show()
        // 加入跨页面同步队列，由唯一的“管理器”页面负责后续追踪
        enqueueAria2TrackTask(videoInfo.ID, res.result, downloadParams);
    } catch (error) {
        newToast(
            ToastType.Info,
            {
                gravity: 'bottom',
                node: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskFail#%`)
            }
        ).show()
    }
}

/**
 * 检查并重启异常的Aria2下载任务
 */
export async function aria2TaskCheckAndRestart() {
    try {
        let stoped: Array<{ id: string, data: Aria2.Status }> = prune(
            (await aria2API(
                'aria2.tellStopped',
                [
                    0,
                    4096,
                    [
                        'gid',
                        'status',
                        'files',
                        'errorCode',
                        'bittorrent'
                    ]
                ]
            ) as Aria2.StartsResult)
                .result
                .filter(
                    (task: Aria2.Status) => isNullOrUndefined(task.bittorrent)
                )
                .map(
                    (task: Aria2.Status) => {
                        let ID = aria2TaskExtractVideoID(task)
                        if (!isNullOrUndefined(ID) && !ID.isEmpty()) {
                            return {
                                id: ID,
                                data: task
                            }
                        }
                    }
                )
        );
        let active: Array<{ id: string, data: Aria2.Status }> = prune(
            (await aria2API(
                'aria2.tellActive',
                [
                    [
                        'gid',
                        'status',
                        'files',
                        'downloadSpeed',
                        'completedLength',
                        'totalLength',
                        'bittorrent'
                    ]
                ]
            ) as Aria2.StartsResult)
                .result
                .filter(
                    (task: Aria2.Status) =>
                        isNullOrUndefined(task.bittorrent)
                )
                .map(
                    (task: Aria2.Status) => {
                        let ID = aria2TaskExtractVideoID(task)
                        if (!isNullOrUndefined(ID) && !ID.isEmpty()) {
                            return {
                                id: ID,
                                data: task
                            }
                        }
                    }
                )
        );
        let downloadNormalTasks: Array<{ id: string, data: Aria2.Status }> = active.filter(
            (task: { id: string, data: Aria2.Status }) => isConvertibleToNumber(task.data.downloadSpeed) && Number(task.data.downloadSpeed) >= ARIA2_SLOW_SPEED_THRESHOLD
        ).unique('id');
        let downloadCompleted: Array<{ id: string, data: Aria2.Status }> = stoped.filter(
            (task: { id: string, data: Aria2.Status }) => task.data.status === 'complete' //|| task.data.errorCode === '13'
        ).unique('id');
        //downloadCompleted = [];
        let downloadUncompleted: Array<{ id: string, data: Aria2.Status }> = stoped.difference(downloadCompleted, 'id').difference(downloadNormalTasks, 'id');
        let downloadToSlowTasks: Array<{ id: string, data: Aria2.Status }> = active.filter(
            (task: { id: string, data: Aria2.Status }) => {
                if (!isConvertibleToNumber(task.data.downloadSpeed) || Number(task.data.downloadSpeed) > ARIA2_SLOW_SPEED_THRESHOLD) return false;
                // 下载进度 > 95% 时豁免（接近完成不重启）；但速度为 0 不豁免
                return Number(task.data.downloadSpeed) === 0 || getAria2Progress(task.data) <= 0.95;
            }
        ).unique('id');
        let needRestart = downloadUncompleted.union(downloadToSlowTasks, 'id');
        if (needRestart.length !== 0) {
            newToast(
                ToastType.Warn,
                {
                    id: 'aria2TaskCheckAndRestart',
                    node: toastNode(
                        [
                            `发现 ${needRestart.length} 个需要重启的下载任务！`,
                            { nodeType: 'br' },
                            '%#tryRestartingDownload#%'
                        ], '%#aria2TaskCheck#%'),
                    async onClick() {
                        this.hide()
                        for (let i = 0; i < needRestart.length; i++) {
                            const task = needRestart[i]
                            let info = await parseVideoInfo({
                                Type: "init",
                                ID: task.id
                            })

                            if (info.Type != 'full') {
                                newToast(
                                    ToastType.Error,
                                    {
                                        node:
                                            toastNode([
                                                `${info.Title}[${info.ID}] %#parsingFailed#%`
                                            ], '%#aria2TaskCheck#%'),
                                        onClick() {
                                            this.hide()
                                        },
                                    }
                                ).show()
                                continue
                            }

                            try {
                                GM_getValue('isDebug') && originalConsole.debug(`[Debug] aria2TaskCheckAndRestart: 处理任务 ${task.data.gid} 状态 ${task.data.status}`, task.data);

                                switch (task.data.status) {
                                    case "waiting":
                                    case 'active':
                                        GM_getValue('isDebug') && originalConsole.debug(`[Debug] aria2TaskCheckAndRestart: 暂停活跃任务 ${task.data.gid}`);
                                        const pauseRes = await aria2API('aria2.forcePause', [task.data.gid]) as Aria2.AuctionResult;
                                        if (pauseRes.error) {
                                            originalConsole.warn(`[aria2TaskCheckAndRestart] forcePause 失败 ${task.data.gid}:`, pauseRes.error);
                                            break;
                                        }
                                    case "paused":
                                        let localPath = getDownloadPath(info)
                                        let downloadUrl = info.DownloadUrl.toURL()
                                        downloadUrl.searchParams.set('videoid', info.ID)
                                        downloadUrl.searchParams.set('download', localPath.fullName)
                                        // 获取旧 URIs
                                        const oldUris = (task.data.files?.[0]?.uris ?? []).map(u => u.uri)
                                        GM_getValue('isDebug') && originalConsole.debug(
                                            `[Debug] aria2TaskCheckAndRestart: 替换 URIs - 任务 ${task.data.gid}`,
                                            { oldUris, newUrl: downloadUrl.href }
                                        )
                                        // 替换 URIs
                                        const changeRes = await aria2API('aria2.changeUri', [
                                            task.data.gid,
                                            1,
                                            oldUris,
                                            [downloadUrl.href]
                                        ]) as Aria2.AuctionResult;
                                        if (changeRes.error) {
                                            originalConsole.warn(`[aria2TaskCheckAndRestart] changeUri 失败 ${task.data.gid}:`, changeRes.error);
                                            break;
                                        }
                                        GM_getValue('isDebug') && originalConsole.debug(`[Debug] aria2TaskCheckAndRestart: changeUri 返回`, changeRes.result);
                                        // 恢复下载
                                        GM_getValue('isDebug') && originalConsole.debug(`[Debug] aria2TaskCheckAndRestart: 恢复下载 ${task.data.gid}`);
                                        const unpauseRes = await aria2API('aria2.unpause', [task.data.gid]) as Aria2.AuctionResult;
                                        if (unpauseRes.error) {
                                            originalConsole.warn(`[aria2TaskCheckAndRestart] unpause 失败 ${task.data.gid}:`, unpauseRes.error);
                                            break;
                                        }

                                        newToast(ToastType.Info, {
                                            gravity: 'bottom',
                                            node: toastNode(`${info.Title}[${info.ID}] %#pushTaskSucceed#%`)
                                        }).show()
                                        break;
                                    case "complete":
                                    case "error":
                                    case "removed":
                                        aria2Download(info, true)
                                        break;
                                    default:
                                        break;
                                }
                            } catch (error) {
                                newToast(
                                    ToastType.Error,
                                    {
                                        node:
                                            toastNode([
                                                `${info.RAW?.title ?? info.Title}[${info.ID}] %#pushTaskFail#%`,
                                                { nodeType: 'br' },
                                                stringify(error)
                                            ], '%#aria2TaskCheck#%'),
                                        onClick() {
                                            this.hide()
                                        },
                                    }
                                ).show()
                                break
                            }
                        }
                    }
                }
            ).show()
        } else {
            newToast(ToastType.Info, {
                id: 'aria2TaskCheckAndRestart',
                duration: 10000,
                node: toastNode(
                    `%#noAria2TasksNeedRestart#%`
                )
            }).show()
        }
    } catch (error) {
        newToast(ToastType.Error, {
            id: 'aria2TaskCheckAndRestart',
            node: toastNode(
                [
                    `%#aria2TaskRestartError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ]
            )
        }).show()
    }
}
