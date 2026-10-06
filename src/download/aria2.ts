import '../core/env'
import { isNullOrUndefined, prune, stringify, UUID } from '../core/env'
import { config } from '../core/config'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { report, toastNode } from '../core/notify'
import { analyzeLocalPath, getDownloadPath, buildDownloadUrl } from './downloadPath'

const log = createLogger('Aria2')

/** 任务入队 hook（宿主注入）：新增下载后加入跨页同步队列由管理页面追踪。
 * 队列入队回调由 main 组装注入。 */
let enqueueTrackTaskHook: ((videoId: string, gid: string, downloadParams: Record<string, any>) => void) | undefined
export function setAria2TrackEnqueueHook(hook: (videoId: string, gid: string, downloadParams: Record<string, any>) => void): void {
    enqueueTrackTaskHook = hook
}

/**
 * 调用Aria2 RPC API
 * @async
 * @param {string} method - API方法名
 * @param {any} params - API参数
 * @returns {Promise<Aria2.IResult>} 返回API调用结果
 */
export async function aria2API(method: string, params: any): Promise<Aria2.IResult> {
    return await (
        await unlimitedFetch(config.aria2Path, {
            headers: {
                accept: 'application/json',
                'content-type': 'application/json'
            },
            body: JSON.stringify(
                {
                    jsonrpc: '2.0',
                    method: method,
                    id: UUID(),
                    params: [`token:${config.aria2Token}`, ...params]
                },
                (_, v) => (typeof v === 'boolean' ? String(v) : v)
            ),
            method: 'POST'
        })
    ).json()
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
        log.debug(`check aria2 task file fail! ${stringify(task)}`)
        return
    }
}

/**
 * 通过Aria2下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export async function aria2Download(videoInfo: FullVideoInfo, overwrite: boolean | undefined = undefined) {
    const localPath = getDownloadPath(videoInfo)
    // 执行器统一经 buildDownloadUrl 注入 videoid/download 参数（与 others/brower 一致）
    const downloadUrl = buildDownloadUrl(videoInfo, localPath)
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
    try {
        let res = (await aria2API('aria2.addUri', [[downloadUrl.href], downloadParams])) as Aria2.AuctionResult
        if (res.result.isEmpty()) throw `aria2 下载失败：${stringify(res)}`
        // 报告经 core/notify 通道（报告展示由 sink 完成，见 main 组装）
        report('info', {
            body: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskSucceed#%`),
            gravity: 'bottom'
        })
        // 加入跨页面同步队列，由唯一的“管理器”页面负责后续追踪（hook 由 main 注入）
        enqueueTrackTaskHook?.(videoInfo.ID, res.result, downloadParams)
    } catch (error) {
        // 原行为为 Info 级（2s 自动消失），保持不变
        report('info', {
            body: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskFail#%`),
            gravity: 'bottom'
        })
    }
}
