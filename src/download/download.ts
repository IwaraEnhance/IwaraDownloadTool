import '../core/env'
import { isNullOrUndefined, prune, stringify } from '../core/env'
import { Path } from '../core/path'
import { config } from '../core/config'
import { unlimitedFetch, renderNode } from '../core/extension'
import { createLogger } from '../core/log'
import { report, toastNode } from '../core/notify'
import { analyzeLocalPath, getDownloadPath, buildDownloadUrl } from './downloadPath'
import { domain } from '../context/site'

const log = createLogger('Download')

/** 下载重试 hook（宿主注入）：browserDownload 失败后的“重试下载”回调。
 * 重试回调由 main 组装注入。 */
let retryDownloadHook: ((videoInfo: FullVideoInfo) => Promise<void>) | undefined
export function setRetryDownloadHook(hook: (videoInfo: FullVideoInfo) => Promise<void>): void {
    retryDownloadHook = hook
}

/**
 * 通过iwaradl下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function iwaradlDownload(videoInfo: FullVideoInfo) {
    ; (async function (videoInfo: FullVideoInfo) {
        try {
            let proxyURL: URL | undefined
            if (!config.downloadProxy.isEmpty()) {
                proxyURL = new URL(config.downloadProxy)
                proxyURL.username = config.downloadProxyUsername
                proxyURL.password = config.downloadProxyPassword
            }
            let downloadPathTemplate = new Path(config.downloadPath, false)
            let response = await unlimitedFetch(config.iwaradlPath, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    authorization: `Bearer ${config.iwaradlToken}`
                },
                body: JSON.stringify(
                    prune({
                        urls: [`https://www.${domain}/video/${videoInfo.ID}`],
                        options: {
                            proxy_url: proxyURL ? proxyURL.href : undefined,
                            cookies: unsafeWindow.document.cookie,
                            download_dir: downloadPathTemplate.directory,
                            filename_template: downloadPathTemplate.fullName
                        }
                    })
                )
            })
            if (response.ok) {
                log.info(`${videoInfo.Title} %#pushTaskSucceed#%`)
                report('info', {
                    body: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskSucceed#%`)
                })
            }
        } catch (error) {
            report('error', {
                title: '%#iwaradlDownload#%',
                body: toastNode([`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskFailed#% `, { nodeType: 'br' }, stringify(error)], '%#iwaradlDownload#%')
            })
        }
    })(videoInfo)
}

/**
 * 通过浏览器直接下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function othersDownload(videoInfo: FullVideoInfo) {
    // 执行器统一经 buildDownloadUrl 注入 videoid/download 参数（与 aria2 一致）
    const DownloadUrl = buildDownloadUrl(videoInfo, getDownloadPath(videoInfo))
    GM_openInTab(DownloadUrl.href, { active: false, insert: true, setParent: true })
}

/**
 * 解析浏览器下载错误信息
 * @param {Tampermonkey.DownloadErrorResponse|Error} error - 错误对象
 * @returns {string} 返回解析后的错误信息
 */
export function browserDownloadErrorParse(error: Tampermonkey.DownloadErrorResponse | Error): string {
    let errorInfo = stringify(error)
    if (!(error instanceof Error)) {
        errorInfo =
            {
                not_enabled: `%#browserDownloadNotEnabled#%`,
                not_whitelisted: `%#browserDownloadNotWhitelisted#%`,
                not_permitted: `%#browserDownloadNotPermitted#%`,
                not_supported: `%#browserDownloadNotSupported#%`,
                not_succeeded: `%#browserDownloadNotSucceeded#% ${isNullOrUndefined(error.details) ? 'UnknownError' : error.details}`
            }[error.error] || `%#browserDownloadUnknownError#%`
    }
    return errorInfo
}

/**
 * 通过浏览器下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function browserDownload(videoInfo: FullVideoInfo) {
    ; (async function (videoInfo: FullVideoInfo) {
        function reportError(error: Tampermonkey.DownloadErrorResponse | Error) {
            // 报告走 core/notify 通道；重试交互经 retryDownloadHook（main 注入）
            report('error', {
                title: '%#browserDownload#%',
                body: toastNode([`${videoInfo.Title}[${videoInfo.ID}] %#downloadFailed#%`, { nodeType: 'br' }, browserDownloadErrorParse(error), { nodeType: 'br' }, `%#tryRestartingDownload#%`], '%#browserDownload#%'),
                close: true,
                onClick: async (host) => {
                    ; (host as { hide(): void })?.hide()
                    await retryDownloadHook?.(videoInfo)
                }
            })
        }
        GM_download({
            url: videoInfo.DownloadUrl,
            saveAs: false,
            name: getDownloadPath(videoInfo).fullPath,
            onerror: (err) => reportError(err),
            ontimeout: () => reportError(new Error('%#browserDownloadTimeout#%'))
        })
    })(videoInfo)
}

function generateMatadataURL(videoInfo: FullVideoInfo): string {
    const metadataContent = generateMetadataContent(videoInfo)
    const blob = new Blob([metadataContent], { type: 'text/plain' })
    return URL.createObjectURL(blob)
}
function getMatadataPath(videoInfo: FullVideoInfo): string {
    const videoPath = getDownloadPath(videoInfo)
    return `${videoPath.directory}/${videoPath.baseName}.json`
}
function generateMetadataContent(videoInfo: FullVideoInfo): string {
    const metadata = Object.assign({}, videoInfo, {
        DownloadPath: getDownloadPath(videoInfo).fullPath,
        MetaDataVersion: GM_info.script.version
    })
    return JSON.stringify(
        metadata,
        (key, value) => {
            if (value instanceof Date) {
                return value.toISOString()
            }
            return value
        },
        2
    )
}
export function browserDownloadMetadata(videoInfo: FullVideoInfo): void {
    const url = generateMatadataURL(videoInfo)
    function reportError(error: Tampermonkey.DownloadErrorResponse | Error) {
        report('error', {
            title: '%#browserDownload#%',
            body: toastNode([`${videoInfo.Title}[${videoInfo.ID}] %#videoMetadata#% %#downloadFailed#%`, { nodeType: 'br' }, browserDownloadErrorParse(error)], '%#browserDownload#%'),
            close: true
        })
    }
    GM_download({
        url: url,
        saveAs: false,
        name: getMatadataPath(videoInfo),
        onerror: (err) => reportError(err),
        ontimeout: () => reportError(new Error('%#browserDownloadTimeout#%')),
        onload: () => URL.revokeObjectURL(url)
    })
}
export function othersDownloadMetadata(videoInfo: FullVideoInfo): void {
    const url = generateMatadataURL(videoInfo)
    const metadataFile = analyzeLocalPath(getMatadataPath(videoInfo)).fullName
    const downloadHandle = renderNode({
        nodeType: 'a',
        attributes: {
            href: url,
            download: metadataFile
        }
    })
    downloadHandle.click()
    downloadHandle.remove()
    URL.revokeObjectURL(url)
}
