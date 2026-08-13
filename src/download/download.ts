import "../core/env";
import { isNullOrUndefined, prune, stringify } from "../core/env";
import { Path } from "../core/path";
import { ToastType } from "../core/enum";
import { config } from "../core/config";
import { unlimitedFetch, renderNode } from "../core/extension";
import { createLogger } from "../core/log";
import { newToast, toastNode } from "../ui/notify";
import { analyzeLocalPath, getDownloadPath } from "./downloadPath";
import { domain } from "../main";
import { pushDownloadTask } from "./downloadQueue";

const log = createLogger('Download');

/**
 * 通过iwaradl下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function iwaradlDownload(videoInfo: FullVideoInfo) {
    (async function (videoInfo: FullVideoInfo) {
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
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'authorization': `Bearer ${config.iwaradlToken}`
                },
                body: JSON.stringify(prune({
                    "urls": [`https://www.${domain}/video/${videoInfo.ID}`],
                    'options': {
                        'proxy_url': proxyURL ? proxyURL.href : undefined,
                        'cookies': unsafeWindow.document.cookie,
                        "download_dir": downloadPathTemplate.directory,
                        "filename_template": downloadPathTemplate.fullName
                    }
                }))
            })
            if (response.ok) {
                log.info(`${videoInfo.Title} %#pushTaskSucceed#%`)
                newToast(
                    ToastType.Info,
                    {
                        node: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskSucceed#%`)
                    }
                ).show()
            }
        } catch (error) {
            newToast(
                ToastType.Error,
                {
                    node: toastNode([
                        `${videoInfo.Title}[${videoInfo.ID}] %#pushTaskFailed#% `,
                        { nodeType: 'br' },
                        stringify(error)
                    ], '%#iwaradlDownload#%'),
                    onClick() {
                        this.hide()
                    }
                }
            ).show()
        }
    }(videoInfo))
}

/**
 * 通过浏览器直接下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function othersDownload(videoInfo: FullVideoInfo) {
    (async function (DownloadUrl: URL) {
        DownloadUrl.searchParams.set('download', getDownloadPath(videoInfo).fullName)
        GM_openInTab(DownloadUrl.href, { active: false, insert: true, setParent: true })
    }(videoInfo.DownloadUrl.toURL()))
}

/**
 * 解析浏览器下载错误信息
 * @param {Tampermonkey.DownloadErrorResponse|Error} error - 错误对象
 * @returns {string} 返回解析后的错误信息
 */
export function browserDownloadErrorParse(error: Tampermonkey.DownloadErrorResponse | Error): string {
    let errorInfo = stringify(error)
    if (!(error instanceof Error)) {
        errorInfo = {
            'not_enabled': `%#browserDownloadNotEnabled#%`,
            'not_whitelisted': `%#browserDownloadNotWhitelisted#%`,
            'not_permitted': `%#browserDownloadNotPermitted#%`,
            'not_supported': `%#browserDownloadNotSupported#%`,
            'not_succeeded': `%#browserDownloadNotSucceeded#% ${isNullOrUndefined(error.details) ? 'UnknownError' : error.details}`,
        }[error.error] || `%#browserDownloadUnknownError#%`
    }
    return errorInfo
}

/**
 * 通过浏览器下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export function browserDownload(videoInfo: FullVideoInfo) {
    (async function (videoInfo: FullVideoInfo) {
        function toastError(error: Tampermonkey.DownloadErrorResponse | Error) {
            let toast = newToast(
                ToastType.Error,
                {
                    node: toastNode([
                        `${videoInfo.Title}[${videoInfo.ID}] %#downloadFailed#%`,
                        { nodeType: 'br' },
                        browserDownloadErrorParse(error),
                        { nodeType: 'br' },
                        `%#tryRestartingDownload#%`
                    ], '%#browserDownload#%'),
                    async onClick() {
                        toast.hide()
                        await pushDownloadTask(videoInfo)
                    }
                }
            )
            toast.show()
        }
        GM_download({
            url: videoInfo.DownloadUrl,
            saveAs: false,
            name: getDownloadPath(videoInfo).fullPath,
            onerror: (err) => toastError(err),
            ontimeout: () => toastError(new Error('%#browserDownloadTimeout#%'))
        })
    }(videoInfo))
}

function generateMatadataURL(videoInfo: FullVideoInfo): string {
    const metadataContent = generateMetadataContent(videoInfo);
    const blob = new Blob([metadataContent], { type: 'text/plain' });
    return URL.createObjectURL(blob);
}
function getMatadataPath(videoInfo: FullVideoInfo): string {
    const videoPath = getDownloadPath(videoInfo);
    return `${videoPath.directory}/${videoPath.baseName}.json`;
}
function generateMetadataContent(videoInfo: FullVideoInfo): string {
    const metadata = Object.assign({}, videoInfo, {
        DownloadPath: getDownloadPath(videoInfo).fullPath,
        MetaDataVersion: GM_info.script.version,
    });
    return JSON.stringify(metadata, (key, value) => {
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    }, 2);
}
export function browserDownloadMetadata(videoInfo: FullVideoInfo): void {
    const url = generateMatadataURL(videoInfo);
    function toastError(error: Tampermonkey.DownloadErrorResponse | Error) {
        newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `${videoInfo.Title}[${videoInfo.ID}] %#videoMetadata#% %#downloadFailed#%`,
                    { nodeType: 'br' },
                    browserDownloadErrorParse(error)
                ], '%#browserDownload#%'),
                close: true
            }
        ).show()
    }
    GM_download({
        url: url,
        saveAs: false,
        name: getMatadataPath(videoInfo),
        onerror: (err) => toastError(err),
        ontimeout: () => toastError(new Error('%#browserDownloadTimeout#%')),
        onload: () => URL.revokeObjectURL(url)
    });
}
export function othersDownloadMetadata(videoInfo: FullVideoInfo): void {
    const url = generateMatadataURL(videoInfo);
    const metadataFile = analyzeLocalPath(getMatadataPath(videoInfo)).fullName
    const downloadHandle = renderNode({
        nodeType: 'a',
        attributes: {
            href: url,
            download: metadataFile
        }
    });
    downloadHandle.click();
    downloadHandle.remove();
    URL.revokeObjectURL(url);
}
