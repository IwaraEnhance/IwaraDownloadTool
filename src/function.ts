import "./env";
import { delay, isArray, isConvertibleToNumber, isNullOrUndefined, isString, isVideoInfo, prune, stringify, UUID } from "./env"
import { i18nList } from "./i18n"
import { ToastType, DownloadType, PageType } from "./enum"
import { Config, config } from "./config"
import { unlimitedFetch, renderNode } from "./extension"
import { Dictionary, Path } from "./class"
import { domain, apiEndpoint, isLoggedIn, selectList, pluginMenu } from "./main"
import { activeToasts, Toast, ToastOptions } from "./toastify";
import { originalConsole } from "./hijack";
import { db } from "./db";

/**
 * 刷新Iwara.tv的访问令牌
 * @async
 * @returns {Promise<string>} 返回新的访问令牌或回退到配置中的授权令牌
 */
export async function refreshToken(): Promise<string> {
    const { authorization } = config;
    if (!isLoggedIn()) throw new Error(`Refresh token failed: Not logged in`)
    const refreshToken = localStorage.getItem('token') ?? authorization;
    if (isNullOrUndefined(refreshToken) || refreshToken.isEmpty()) {
        throw new Error(`Refresh token failed: no refresh token`);
    }

    const oldAccessToken = localStorage.getItem('accessToken');
    try {
        const res = await unlimitedFetch(
            `https://${apiEndpoint}/user/token`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${refreshToken}`
                }
            }
        );

        if (!res.ok) {
            throw new Error(`Refresh token failed with status: ${res.status}`);
        }

        const { accessToken } = await res.json();
        if (!accessToken) {
            throw new Error(`No access token in response`);
        }

        if (!oldAccessToken || oldAccessToken !== accessToken) {
            localStorage.setItem('accessToken', accessToken);
        }

        return accessToken;

    } catch (error) {
        originalConsole.warn('Failed to refresh token:', error);

        if (!oldAccessToken?.trim()) {
            throw new Error(`Refresh token failed and no valid access token available`);
        }

        return oldAccessToken;
    }
}

/**
 * 获取请求认证头信息
 * @async
 * @param {string} [url] - 可选URL参数，用于生成X-Version头
 * @returns 包含Cookie和Authorization的请求头对象
 */
export async function getAuth(url?: string): Promise<{ Cooike: string; Authorization: string; } & { 'X-Version': string; }> {
    return prune({
        'Referer': `${window.location.origin}/`,
        'Accept': 'application/json',
        'Cooike': unsafeWindow.document.cookie,
        'Authorization': isLoggedIn() ? `Bearer ${localStorage.getItem('accessToken') ?? await refreshToken()}` : undefined,
        'X-Version': !isNullOrUndefined(url) && !url.isEmpty() ? await getXVersion(url) : undefined,
        'X-Site': unsafeWindow.location.hostname
    })
}
/**
 * 检查评论中是否包含下载链接
 * @param {string} comment - 要检查的评论内容
 * @returns {boolean} 如果包含下载链接返回true，否则返回false
 */
export function checkIsHaveDownloadLink(comment: string): boolean {
    if (!config.checkDownloadLink || isNullOrUndefined(comment) || comment.isEmpty()) {
        return false
    }
    return [
        'iwara.zip',
        'pan.baidu',
        '/s/',
        'mega.nz',
        'drive.google.com',
        'aliyundrive',
        'uploadgig',
        'katfile',
        'storex',
        'subyshare',
        'rapidgator',
        'filebe',
        'filespace',
        'mexa.sh',
        'mexashare',
        'mx-sh.net',
        'icerbox',
        'alfafile',
        '1drv.ms',
        'onedrive.',
        'gofile.io',
        'workupload.com',
        'pixeldrain.',
        'dailyuploads.net',
        'katfile.com',
        'fikper.com',
        'frdl.io',
        'rg.to',
        'gigafile.nu',
        'mediafire.com'
    ].filter(i => comment.toLowerCase().includes(i)).any()
}
/**
 * 创建Toast通知的DOM节点
 * @param {RenderCode<any>["childs"]} body - 通知主体内容
 * @param {string} [title] - 可选的通知标题
 * @returns {Element|Node} 返回创建的DOM节点
 */
export function toastNode(body: RenderCode<any>["childs"], title?: string): Element | Node {
    return renderNode({
        nodeType: 'div',
        childs: [
            !isNullOrUndefined(title) && !title.isEmpty() ? {
                nodeType: 'h3',
                childs: `%#appName#% - ${title}`
            } : {
                nodeType: 'h3',
                childs: '%#appName#%'
            },
            {
                nodeType: 'p',
                childs: body
            }
        ]
    })
}
/**
 * 从DOM节点中提取文本内容
 * @param {Node|Element} node - 要提取文本的DOM节点
 * @returns {string} 返回提取的文本内容
 */
export function getTextNode(node: Node | Element): string {
    return node.nodeType === Node.TEXT_NODE
        ? node.textContent || ''
        : node.nodeType === Node.ELEMENT_NODE
            ? Array.from(node.childNodes)
                .map(getTextNode)
                .join('')
            : ''
}
/**
 * 创建新的Toast通知
 * @param {ToastType} type - Toast类型(Info/Warn/Error/Log)
 * @param {ToastOptions} params - Toast配置选项
 * @returns {Toast} 返回创建的Toast实例
 */
export function newToast(type: ToastType, params?: ToastOptions): Toast {
    const logFunc = {
        [ToastType.Warn]: originalConsole.warn,
        [ToastType.Error]: originalConsole.error,
        [ToastType.Log]: originalConsole.log,
        [ToastType.Info]: originalConsole.info,
    }[type] || originalConsole.log
    if (isNullOrUndefined(params)) params = {}
    if (!isNullOrUndefined(params.id) && activeToasts.has(params.id)) activeToasts.get(params.id)?.hide()
    switch (type) {
        case ToastType.Info:
            params = Object.assign({
                duration: 2000,
                style: {
                    background: 'linear-gradient(-30deg, rgb(0, 108, 215), rgb(0, 180, 255))'
                }
            }, params)
        case ToastType.Warn:
            params = Object.assign({
                duration: -1,
                style: {
                    background: 'linear-gradient(-30deg, rgb(119, 76, 0), rgb(255, 165, 0))'
                }
            }, params)
            break;

        case ToastType.Error:
            params = Object.assign({
                duration: -1,
                style: {
                    background: 'linear-gradient(-30deg, rgb(108, 0, 0), rgb(215, 0, 0))'
                }
            }, params)
        default:
            break;
    }
    if (!isNullOrUndefined(params.text)) {
        params.text = params.text.replaceVariable(i18nList[config.language]).toString()
    }
    logFunc((!isNullOrUndefined(params.text) ? params.text : !isNullOrUndefined(params.node) ? getTextNode(params.node) : 'undefined').replaceVariable(i18nList[config.language]))
    return new Toast(params)
}

/**
 * 根据视频信息生成下载路径
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 * @returns {Path} 返回生成的路径对象
 */
export function getDownloadPath(videoInfo: FullVideoInfo): Path {
    return analyzeLocalPath(
        config.downloadPath.trim().replaceVariable({
            NowTime: new Date(),
            UploadTime: new Date(videoInfo.UploadTime),
            AUTHOR: videoInfo.Author,
            ID: videoInfo.ID,
            TITLE: videoInfo.Title.normalize('NFKC').replaceEmojis('_').replaceAll(/(\P{Mark})(\p{Mark}+)/gu, '_').replace(/^\.|[\\\\/:*?\"<>|]/img, '_').truncate(72),
            ALIAS: videoInfo.Alias.normalize('NFKC').replaceAll(/(\P{Mark})(\p{Mark}+)/gu, '_').replace(/^\.|[\\\\/:*?\"<>|]/img, '_').truncate(64),
            QUALITY: videoInfo.DownloadQuality,
        })
    )
}

/**
 * 分析本地路径并返回Path对象
 * @param {string} path - 要分析的路径字符串
 * @returns {Path} 返回Path对象
 * @throws {Error} 如果路径无效会抛出错误并显示Toast通知
 */
export function analyzeLocalPath(path: string): Path {
    try {
        return new Path(path)
    } catch (error) {
        let toast = newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `%#downloadPathError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    toast.hide()
                }
            }
        )
        toast.show()
        throw new Error(`%#downloadPathError#% ["${path}"]`)
    }
}
/**
 * 检查浏览器环境是否支持下载
 * @async
 * @returns {Promise<boolean>} 如果环境检查通过返回true，否则返回false
 */
export async function EnvCheck(): Promise<boolean> {
    try {
        if (GM_info.scriptHandler !== 'ScriptCat' && GM_info.downloadMode !== 'browser') {
            GM_getValue('isDebug') && originalConsole.debug('[Debug]', GM_info)
            throw new Error('%#browserDownloadModeError#%')
        }
    } catch (error: any) {
        let toast = newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `%#configError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    toast.hide()
                }
            }
        )
        toast.show()
        return false
    }
    return true
}
/**
 * 检查本地下载路径是否有效
 * @async
 * @returns {Promise<boolean>} 如果路径有效返回true，否则返回false
 */
export async function localPathCheck(): Promise<boolean> {
    try {
        let pathTest = analyzeLocalPath(config.downloadPath.replaceVariable({
            NowTime: new Date(),
            UploadTime: new Date(),
            AUTHOR: 'test',
            ID: 'test',
            TITLE: 'test',
            ALIAS: 'test',
            QUALITY: 'test'
        }))
        if (isNullOrUndefined(pathTest)) throw 'analyzeLocalPath error'
        if (pathTest.fullPath.isEmpty()) throw 'analyzeLocalPath isEmpty'
    } catch (error: any) {
        let toast = newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `%#downloadPathError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    toast.hide()
                }
            }
        )
        toast.show()
        return false
    }
    return true
}
/**
 * 检查Aria2 RPC连接是否正常
 * @async
 * @returns {Promise<boolean>} 如果连接正常返回true，否则返回false
 */
export async function aria2Check(): Promise<boolean> {
    try {
        let res = await (await unlimitedFetch(config.aria2Path, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                'jsonrpc': '2.0',
                'method': 'aria2.tellActive',
                'id': UUID(),
                'params': ['token:' + config.aria2Token]
            })
        })).json()
        if (res.error) {
            throw new Error(res.error.message)
        }
    } catch (error: any) {
        let toast = newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `Aria2 RPC %#connectionTest#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    toast.hide()
                }
            }
        )
        toast.show()
        return false
    }
    return true
}
/**
 * 检查iwaradl RPC连接是否正常
 * @async
 * @returns {Promise<boolean>} 如果连接正常返回true，否则返回false
 */
export async function iwaradlCheck(): Promise<boolean> {
    try {
        let res = await (await unlimitedFetch(config.iwaradlPath, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'authorization': `Bearer ${config.iwaradlToken}`
            }
        })).json()

        if (!isArray(res)) {
            throw new Error(`后端未启动或无响应`)
        }

    } catch (error: any) {
        newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `iwaradl RPC %#connectionTest#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    this.hide()
                }
            }
        ).show()
        return false
    }
    return true
}
/** 从视频信息构建带 videoid/download 参数的下载 URL */
function buildDownloadUrl(videoInfo: FullVideoInfo): URL {
    const localPath = getDownloadPath(videoInfo);
    const url = videoInfo.DownloadUrl.toURL();
    url.searchParams.set('videoid', videoInfo.ID);
    url.searchParams.set('download', localPath.fullName);
    return url;
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
        // 后台持续追踪任务状态：异常自动重试，完成后推送到 MediaCenter
        trackAria2Task(videoInfo, res.result, downloadParams);
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

/** 后台追踪单个 Aria2 下载任务，异常自动重试，完成后推送到 MediaCenter */
async function trackAria2Task(
    videoInfo: FullVideoInfo,
    gid: string,
    downloadParams: Record<string, any>,
): Promise<void> {
    let currentGid = gid;
    let consecutiveErrors = 0;

    while (true) {
        await delay(1000 * 10 * 3);
        try {
            const statusRes = await aria2API('aria2.tellStatus', [
                currentGid,
                ['gid', 'status', 'files', 'downloadSpeed', 'errorCode'],
            ]) as Aria2.TellStatusResult;
            const task = statusRes.result;

            if (!task?.status) {
                consecutiveErrors++;
                if (consecutiveErrors > 3) {
                    originalConsole.warn(`[Aria2Track] 任务 ${currentGid} 持续无响应，放弃追踪`);
                    return;
                }
                continue;
            }
            consecutiveErrors = 0;

            switch (task.status) {
                case 'complete':
                    GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${videoInfo.ID} 下载完成`);
                    if (config.experimentalFeatures) {
                        await pushToMediaCenter(videoInfo);
                    }
                    return; // 完成，退出追踪

                case 'error':
                case 'removed':
                    originalConsole.warn(`[Aria2Track] ${videoInfo.ID} 任务 ${task.status}，重新创建下载`);
                    try {
                        const freshInfo = await parseVideoInfo({ Type: 'init', ID: videoInfo.ID });
                        if (freshInfo.Type === 'full') {
                            videoInfo = freshInfo
                            const newRes = await aria2API('aria2.addUri', [[buildDownloadUrl(freshInfo).href], downloadParams]) as Aria2.AuctionResult;
                            if (!newRes?.result?.isEmpty()) {
                                currentGid = newRes.result;
                            }
                        }
                    } catch { /* fall through, will retry next poll */ }
                    break;

                case 'active':
                    if (isConvertibleToNumber(task.downloadSpeed) && Number(task.downloadSpeed) <= 512) {
                        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${videoInfo.ID} 速度过慢，重启`);
                        const freshActive = await restartAria2Task(currentGid, videoInfo.ID, task);
                        if (freshActive) videoInfo = freshActive;
                    }
                    break;

                case 'waiting':
                    // 等待中，继续轮询
                    break;

                case 'paused':
                    if (await isAria2QueueFull()) {
                        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${videoInfo.ID} 队列已满，暂不重启`);
                    } else {
                        GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] ${videoInfo.ID} 已暂停，重启`);
                        const freshPaused = await restartAria2Task(currentGid, videoInfo.ID, task);
                        if (freshPaused) videoInfo = freshPaused;
                    }
                    break;
            }
        } catch (error) {
            originalConsole.warn(`[Aria2Track] 追踪异常 ${currentGid}:`, stringify(error));
            consecutiveErrors++;
            if (consecutiveErrors > 5) return;
        }
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
 * 脚本启动时扫描所有现有 Aria2 任务，对未建立 idmap 映射的任务启动后台追踪。
 * 仅当下载模式为 Aria2 时有效。
 */
export async function trackExistingAria2Tasks(): Promise<void> {
    if (config.downloadType !== DownloadType.Aria2) return;

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

            // 已有 idmap 映射说明之前已追踪过 / 已推送到 MediaCenter
            const existingMapping = await db.getMediaCenterIdMap(videoId);
            if (!isNullOrUndefined(existingMapping) && !existingMapping.isEmpty()) continue;

            // 优先从本地数据库获取视频信息，仅 partial 时补解析为 full
            let info: VideoInfo | undefined = await db.getVideoById(videoId);
            if (!info || info.Type === 'cache' || info.Type === 'init' || info.Type === 'fail') {
                info = await parseVideoInfo({ Type: 'init', ID: videoId });
            } else if (info.Type === 'partial') {
                // partial 缺少下载地址等字段，补解析为 full
                info = await parseVideoInfo(info);
            }
            if (info.Type !== 'full') {
                originalConsole.warn(`[Aria2Track] 启动追踪 ${videoId} 解析失败 (${info.Type})，跳过`);
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

            GM_getValue('isDebug') && originalConsole.debug(`[Aria2Track] 启动时接管现有任务 ${videoId} (gid=${task.gid})`);
            trackAria2Task(info, task.gid, downloadParams);
        }
    } catch (error) {
        originalConsole.warn('[Aria2Track] 启动时扫描现有任务失败:', stringify(error));
    }
}

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
                originalConsole.log(`${videoInfo.Title} %#pushTaskSucceed#%`)
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
            (task: { id: string, data: Aria2.Status }) => isConvertibleToNumber(task.data.downloadSpeed) && Number(task.data.downloadSpeed) >= 512
        ).unique('id');
        let downloadCompleted: Array<{ id: string, data: Aria2.Status }> = stoped.filter(
            (task: { id: string, data: Aria2.Status }) => task.data.status === 'complete' //|| task.data.errorCode === '13'
        ).unique('id');
        //downloadCompleted = [];
        let downloadUncompleted: Array<{ id: string, data: Aria2.Status }> = stoped.difference(downloadCompleted, 'id').difference(downloadNormalTasks, 'id');
        let downloadToSlowTasks: Array<{ id: string, data: Aria2.Status }> = active.filter(
            (task: { id: string, data: Aria2.Status }) => isConvertibleToNumber(task.data.downloadSpeed) && Number(task.data.downloadSpeed) <= 512
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
/**
 * 解析JWT令牌的payload部分
 * @param {string} authorization - 授权令牌字符串
 * @returns {Object} 返回解析后的payload对象
 */
export function getPlayload(authorization: string): { [key: string]: any } {
    return JSON.parse(decodeURIComponent(encodeURIComponent(window.atob(authorization.split(' ').pop()!.split('.')[1]))))
}
/**
 * 根据配置的下载类型执行相应的环境检查
 * @async
 * @returns {Promise<boolean>} 如果检查通过返回true，否则返回false
 */
export async function check(): Promise<boolean> {
    if (await localPathCheck()) {
        switch (config.downloadType) {
            case DownloadType.Aria2:
                return await aria2Check()
            case DownloadType.Iwaradl:
                return await iwaradlCheck()
            case DownloadType.Browser:
                return await EnvCheck()
            default:
                break
        }
        return true
    } else {
        return false
    }
}
/**
 * 根据URL生成X-Version头值
 * @async
 * @private
 * @param {string} urlString - 请求URL
 * @returns {Promise<string>} 返回生成的X-Version值
 */
async function getXVersion(urlString: string): Promise<string> {
    let url = urlString.toURL()
    const data = new TextEncoder().encode([url.pathname.split("/").pop(), url.searchParams.get('expires'), 'mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN'].join('_'))
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}


async function getCommentData(id: string, commentID?: string, page: number = 0): Promise<Iwara.IPage> {
    return await (await unlimitedFetch(`https://${apiEndpoint}/video/${id}/comments?page=${page}${!isNullOrUndefined(commentID) && !commentID.isEmpty() ? '&parent=' + commentID : ''}`, { headers: await getAuth() })).json() as Iwara.IPage
}
async function getCommentDatas(id: string, commentID?: string): Promise<Iwara.Comment[]> {
    let comments: Iwara.Comment[] = []
    let base = await getCommentData(id, commentID)
    comments.push(...base.results as Iwara.Comment[])
    for (let page = 1; page < Math.ceil(base.count / base.limit); page++) {
        comments.push(...(await getCommentData(id, commentID, page)).results as Iwara.Comment[])
    }
    let replies: Iwara.Comment[] = []
    for (let index = 0; index < comments.length; index++) {
        const comment = comments[index]
        if (comment.numReplies > 0) {
            replies.push(...await getCommentDatas(id, comment.id))
        }
    }
    comments.push(...replies)
    return comments
}

export async function parseVideoInfo(info: VideoInfo): Promise<FullVideoInfo | PartialVideoInfo | FailVideoInfo> {
    let ID: string = info.ID
    let Type: VideoInfoType = info.Type
    let RAW: Iwara.Video | undefined = info.RAW
    try {
        switch (info.Type) {
            case "cache":
                RAW = info.RAW
                ID = RAW.id
                Type = 'partial'
                break;
            case "init":
            case "fail":
            case "partial":
            case "full":
                GM_getValue('isDebug') && originalConsole.debug(`[debug] try parse full source`)
                let sourceResult = await (await unlimitedFetch(
                    `https://${apiEndpoint}/video/${info.ID}`,
                    {
                        headers: await getAuth()
                    },
                    {
                        retry: true,
                        maxRetries: 3,
                        failStatus: [403, 404],
                        retryDelay: 1000,
                        onRetry: async () => { await refreshToken() },
                        onFail: async (response) => {
                            GM_getValue("isDebug") && originalConsole.debug("[Debug]", `${response.url} Fail, response: ${await response.clone().text()}`);
                        }
                    }
                )).json() as Iwara.IResult
                if (isNullOrUndefined(sourceResult.id)) {
                    Type = 'fail'
                    return {
                        ID, Type, RAW, Msg: sourceResult.message ?? stringify(sourceResult)
                    }
                }
                RAW = sourceResult as Iwara.Video
                ID = RAW.id
                Type = 'full'
                break;
            default:
                Type = 'fail'
                return {
                    ID, Type, RAW, Msg: "Unknown type"
                }
        }
    } catch (error) {
        newToast(
            ToastType.Error,
            {
                node:
                    toastNode([
                        `${info.RAW?.title}[${ID}] %#parsingFailed#%`
                    ], '%#createTask#%'),
                async onClick() {
                    this.hide()
                },
            }
        ).show()
        Type = 'fail'
        return {
            ID, Type, RAW, Msg: stringify(error)
        }
    }


    let FileName: string
    let Size: number
    let External: boolean
    let ExternalUrl: string | undefined
    let Description: string | undefined
    let DownloadQuality: string
    let DownloadUrl: string
    let Comments: string
    let UploadTime: number
    let Title: string
    let Tags: Iwara.Tag[]
    let Liked: boolean
    let Alias: string
    let Author: string
    let AuthorID: string
    let Private: boolean
    let Unlisted: boolean
    let Following: boolean
    let Friend: boolean

    UploadTime = new Date(RAW.createdAt ?? 0).getTime()
    Title = RAW.title
    Tags = RAW.tags
    Liked = RAW.liked
    Alias = RAW.user.name
    Author = RAW.user.username
    AuthorID = RAW.user.id
    Private = RAW.private
    Unlisted = RAW.unlisted


    External = !isNullOrUndefined(RAW.embedUrl) && !RAW.embedUrl.isEmpty()
    ExternalUrl = RAW.embedUrl

    if (External) {
        Type = 'fail'
        return {
            Type, RAW, ID, Alias, Author, AuthorID, Private, UploadTime, Title, Tags, Liked, External, ExternalUrl, Description, Unlisted, Msg: "external Video"
        }
    }

    try {
        switch (Type) {
            case "full":
                Following = RAW.user.following
                Friend = RAW.user.friend

                if (Following) {
                    await db.putFollow(RAW.user)
                } else {
                    await db.deleteFollow(AuthorID)
                }

                if (Friend) {
                    await db.putFriend(RAW.user)
                } else {
                    await db.deleteFriend(AuthorID)
                }

                Description = RAW.body
                FileName = RAW.file.name
                Size = RAW.file.size
                let VideoFileSource = (await (await unlimitedFetch(RAW.fileUrl, { headers: await getAuth(RAW.fileUrl) })).json() as Iwara.Source[]).sort((a, b) => (!isNullOrUndefined(config.priority[b.name]) ? config.priority[b.name] : 0) - (!isNullOrUndefined(config.priority[a.name]) ? config.priority[a.name] : 0))
                if (isNullOrUndefined(VideoFileSource) || !(VideoFileSource instanceof Array) || VideoFileSource.length < 1) throw new Error(i18nList[config.language].getVideoSourceFailed.toString())
                DownloadQuality = config.checkPriority ? config.downloadPriority : VideoFileSource[0].name
                let fileList = VideoFileSource.filter(x => x.name === DownloadQuality)
                if (!fileList.any()) throw new Error(i18nList[config.language].noAvailableVideoSource.toString())

                let Source = fileList[Math.floor(Math.random() * fileList.length)].src.download
                if (isNullOrUndefined(Source) || Source.isEmpty()) throw new Error(i18nList[config.language].videoSourceNotAvailable.toString())

                DownloadUrl = decodeURIComponent(`https:${Source}`)

                GM_getValue('isDebug') && originalConsole.debug(`[debug] try parse all comment`)
                Comments = JSON.stringify(await getCommentDatas(ID)).normalize('NFKC')

                return {
                    Type, RAW, ID, Alias, Author, AuthorID, Private, UploadTime, Title, Tags, Liked, External, FileName, DownloadQuality, ExternalUrl, Description, Comments, DownloadUrl, Size, Following, Unlisted, Friend
                }
            case "partial":
                return {
                    Type, RAW, ID, Alias, Author, AuthorID, UploadTime, Title, Tags, Liked, External, ExternalUrl, Unlisted, Private
                }
            default:
                Type = 'fail'
                return {
                    Type, RAW, ID, Alias, Author, AuthorID, Private, UploadTime, Title, Tags, Liked, External, ExternalUrl, Description, Unlisted, Msg: "Unknown type"
                }
        }
    }
    catch (error) {
        Type = 'fail'
        return {
            Type, RAW, ID, Alias, Author, AuthorID, Private, UploadTime, Title, Tags, Liked, External, ExternalUrl, Description, Unlisted, Msg: stringify(error)
        }
    }
}

/**
 * 计算 VideoInfo 的信息完整度分数
 * 排序依据（从高到低）：full > partial > cache > init > fail
 * @param {VideoInfo} info - 视频信息对象
 * @returns {number} 完整度分数
 */
export function getVideoInfoCompleteness(info: VideoInfo): number {
    switch (info.Type) {
        case 'full': return 5;
        case 'partial': return 4;
        case 'fail': return 3;
        case 'cache': return 2;
        case 'init': return 1;
    }
}

/**
 * 从两个 VideoInfo 中返回信息更完整的那一个
 * 适用于同一直视频的不同版本（如缓存 vs 完整解析后）择优保留
 * @param {VideoInfo} a - 版本 A
 * @param {VideoInfo} b - 版本 B
 * @returns {VideoInfo} 信息更完整的 VideoInfo
 * @throws {Error} 如果 ID 不同则抛出异常
 */
export function getMoreCompleteVideoInfo(a: VideoInfo, b: VideoInfo): VideoInfo {
    if (a.ID !== b.ID) throw new Error(`VideoInfo ID mismatch: "${a.ID}" vs "${b.ID}"`);
    const completenessA = getVideoInfoCompleteness(a);
    const completenessB = getVideoInfoCompleteness(b);
    return completenessB > completenessA ? b : a;
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
function browserDownloadMetadata(videoInfo: FullVideoInfo): void {
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
function othersDownloadMetadata(videoInfo: FullVideoInfo): void {
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

/**
 * 将视频元数据推送到 MediaCenter
 * 流程：先 createMedia 创建媒体记录，再 updateMedia 更新完整元数据
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
async function pushToMediaCenter(videoInfo: FullVideoInfo, mediaCenterId: string | undefined = undefined): Promise<boolean> {
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
        }).show();
        return;
    }

    const apiBase = config.mediaCenterApi.replace(/\/+$/, '');
    const authHeaders = {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${config.mediaCenterApiKey}`
    };

    const total = await db.countVideos();

    if (total === 0) {
        newToast(ToastType.Info, {
            text: `没有找到缓存的视频数据`,
            duration: 3000
        }).show();
        return;
    }

    // ── 阶段一：从 MediaCenter 拉取全部视频列表，通过 title 匹配 iwara 视频 ID 建立映射 ──
    const phaseStartTime = Date.now();
    let stepStartTime = phaseStartTime;

    const matchedMap = await db.getAllMediaCenterIdMaps(); // 先加载本地已有的映射缓存
    originalConsole.debug(`[MediaCenter] 步骤1/4 加载本地映射缓存: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s`);
    stepStartTime = Date.now();

    const listProgressNode = renderNode({
        nodeType: 'p',
        childs: `正在从 MediaCenter 拉取视频列表...`
    });
    const listProgressToast = newToast(ToastType.Info, {
        node: listProgressNode,
        duration: -1
    });
    listProgressToast.show();

    try {
        const listUrl = `${apiBase}/api/media?limit=0&sortBy=createdAt&sortOrder=desc`;
        const response = await unlimitedFetch(listUrl, { headers: authHeaders });

        if (!response.ok) {
            throw new Error(`拉取 MediaCenter 列表失败: ${response.status} ${await response.text()}`);
        }

        const result = await response.json();
        const items: Array<{ id: string; fileHash?: string; title?: string }> = result.items;

        originalConsole.debug(`[MediaCenter] 步骤2/4 拉取 MediaCenter 列表: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s（${items.length} 条）`);
        stepStartTime = Date.now();

        listProgressNode.firstChild!.textContent =
            `MediaCenter 列表拉取完成，共 ${items.length} 条记录，正在遍历本地数据库建立映射...`;

        const entriesToSave: Array<{ videoId: string; mediaCenterId: string }> = [];
        let processedCount = 0;

        // ── 预建查找索引：避免每视频 O(n) 扫描 items ──
        const hashToId = new Map<string, string>();
        const tokenToId = new Map<string, string>();
        const titleContains: Array<{ id: string; lowerTitle: string }> = [];
        for (const m of items) {
            if (!isNullOrUndefined(m.fileHash) && !m.fileHash.isEmpty()) {
                hashToId.set(m.fileHash, m.id);
            }
            if (!isNullOrUndefined(m.title) && !m.title.isEmpty()) {
                const lowerTitle = m.title.toLowerCase();
                titleContains.push({ id: m.id, lowerTitle });
                for (const token of lowerTitle.split(/[^a-z0-9]+/).filter(t => t.length >= 3)) {
                    if (!tokenToId.has(token)) tokenToId.set(token, m.id);
                }
            }
        }

        // 使用轻量级键遍历（只读视频 ID，不反序列化整个对象）
        const keyIterator = db.iterateVideoKeysBatched(10240);
        let idx = 0;
        let currentBatch: string[] = [];
        let keyBatchIter = keyIterator[Symbol.asyncIterator]();
        let prefetchDone = false;
        let prefetchPromise: Promise<void> | null = null;
        const batchQueue: string[][] = [];

        const prefetchNextBatch = async (): Promise<void> => {
            const t0 = Date.now();
            const { value, done } = await keyBatchIter.next();
            originalConsole.debug(`[MediaCenter] 批次获取: ${((Date.now() - t0) / 1000).toFixed(1)}s（${value?.length ?? 0} 条）`);
            if (done) {
                prefetchDone = true;
            } else {
                batchQueue.push(value);
            }
        };

        const ensureBatch = async (): Promise<boolean> => {
            if (batchQueue.length > 0) return true;
            if (prefetchDone) return false;
            if (!prefetchPromise) {
                prefetchPromise = prefetchNextBatch().finally(() => { prefetchPromise = null; });
            }
            await prefetchPromise;
            return batchQueue.length > 0;
        };

        // 启动第一批预取
        prefetchPromise = prefetchNextBatch().finally(() => { prefetchPromise = null; });

        const nextVideo = async (): Promise<void> => {
            if (idx >= currentBatch.length) {
                if (!await ensureBatch()) return;
                currentBatch = batchQueue.shift()!;
                idx = 0;
                if (batchQueue.length < 2 && !prefetchDone && !prefetchPromise) {
                    prefetchPromise = prefetchNextBatch().finally(() => { prefetchPromise = null; });
                }
            }
            const videoId = currentBatch[idx++];
            processedCount++;
            if (Date.now() - stepStartTime >= 500 || processedCount === 1 || processedCount === total) {
                listProgressNode.firstChild!.textContent =
                    `正在匹配映射... [${processedCount}/${total}] 已映射: ${matchedMap.size}`;
            }
            if (matchedMap.has(videoId)) return nextVideo();

            // 1) fileHash 精确匹配 O(1)
            if (hashToId.has(videoId)) {
                const mcId = hashToId.get(videoId)!;
                matchedMap.set(videoId, mcId);
                entriesToSave.push({ videoId, mediaCenterId: mcId });
                return nextVideo();
            }

            // 2) title token 快速命中 O(1)
            const videoIdLower = videoId.toLowerCase();
            if (tokenToId.has(videoIdLower)) {
                const mcId = tokenToId.get(videoIdLower)!;
                matchedMap.set(videoId, mcId);
                entriesToSave.push({ videoId, mediaCenterId: mcId });
                return nextVideo();
            }

            // 3) 回退：title 包含匹配（仅 token 未命中的极少数情况）
            for (const tc of titleContains) {
                if (tc.lowerTitle.indexOf(videoIdLower) !== -1) {
                    matchedMap.set(videoId, tc.id);
                    entriesToSave.push({ videoId, mediaCenterId: tc.id });
                    break;
                }
            }

            return nextVideo();
        };
        await Promise.allSettled(
            Array.from({ length: Math.min(64, total) }, () => nextVideo())
        );

        originalConsole.debug(`[MediaCenter] 步骤3/4 遍历数据库匹配映射: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s（${processedCount} 条，映射 ${entriesToSave.length} 条）`);
        stepStartTime = Date.now();

        if (entriesToSave.length > 0) {
            await db.bulkPutMediaCenterIdMaps(entriesToSave);
        }

        originalConsole.debug(`[MediaCenter] 步骤4/4 保存映射到本地: ${((Date.now() - stepStartTime) / 1000).toFixed(1)}s`);
        const totalTime = (Date.now() - phaseStartTime) / 1000;

        listProgressNode.firstChild!.textContent =
            `映射建立完成，共 ${matchedMap.size} 条映射（新增 ${entriesToSave.length} 条），总耗时 ${totalTime.toFixed(1)}s`;
    } catch (error) {
        originalConsole.error('[MediaCenter] 拉取列表失败:', stringify(error));
        listProgressToast.hide();
        newToast(ToastType.Error, {
            node: toastNode([
                `MediaCenter 列表拉取失败，请检查 API 地址和密钥`,
                { nodeType: 'br' },
                stringify(error)
            ], 'MediaCenter 同步'),
            duration: 10000,
            close: true,
            onClick() { this.hide(); }
        }).show();
        return;
    }

    listProgressToast.hide();

    if (matchedMap.size === 0) {
        newToast(ToastType.Info, {
            text: `MediaCenter 中未找到包含 fileHash 的视频记录，无法同步`,
            duration: 3000
        }).show();
        return;
    }

    // ── 阶段二：遍历匹配项，解析完整元数据并更新到 MediaCenter ──
    let updated = 0;
    let skipped = 0;
    let updateErrors = 0;

    const updateProgressNode = renderNode({
        nodeType: 'p',
        childs: `MediaCenter 更新中... [0/${matchedMap.size}]`
    });
    const updateProgressToast = newToast(ToastType.Info, {
        node: updateProgressNode,
        duration: -1
    });
    updateProgressToast.show();

    const matchedIds = [...matchedMap.keys()];
    const concurrency = 6;
    let idx = 0;
    const nextUpdate = async () => {
        if (idx >= matchedIds.length) return;
        const i = idx++;
        const videoId = matchedIds[i];
        const mediaCenterId = matchedMap.get(videoId)!;
        try {
            let video = await db.getVideoById(videoId) ?? { Type: 'init', ID: videoId };
            if (video.Type !== 'full') {
                const pvideo = await parseVideoInfo(video)
                video = getMoreCompleteVideoInfo(video, pvideo)
            }

            if (video.Type === 'cache' || video.Type === 'init') {
                skipped++;
                return;
            }
            db.putVideo(video)
            if (await pushToMediaCenter(video as FullVideoInfo, mediaCenterId)) {
                updated++;
            } else {
                updateErrors++;
            }
        } catch (error) {
            originalConsole.warn(`[MediaCenter] 同步异常 ${videoId}:`, stringify(error));
            updateErrors++;
        } finally {
            updateProgressNode.firstChild!.textContent =
                `MediaCenter 更新中... [${updated + skipped + updateErrors}/${matchedMap.size}] 更新: ${updated} 跳过: ${skipped} 错误: ${updateErrors}`;
            if (idx < matchedIds.length) await delay(100);
            await nextUpdate();
        }
    };
    await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, matchedIds.length) }, () => nextUpdate())
    );

    updateProgressToast.hide();

    newToast(ToastType.Info, {
        text: `MediaCenter 同步完成！已更新: ${updated}, 跳过: ${skipped}, 错误: ${updateErrors}`,
        duration: 5000,
        close: true,
        onClick() { this.hide(); }
    }).show();
}

/**
 * 抓取单页视频列表并缓存到 IndexedDB
 * @returns true 表示成功(含空页)，false 表示请求失败，'last' 表示已是最后一页
 */
async function fetchAndCachePage(page: number): Promise<true | false | 'last'> {
    const auth = await getAuth();
    const response = await unlimitedFetch(
        `https://${apiEndpoint}/videos?sort=date&page=${page}&limit=50`,
        { headers: auth as any },
        {
            retry: true,
            maxRetries: 3,
            retryDelay: 3000,
            failStatus: [403, 404, 429],
            onRetry: async () => { await refreshToken(); },
        }
    );

    if (!response.ok) return false;

    const pageData = await response.json() as Iwara.IPage;
    const rawVideos = pageData.results as Iwara.Video[];

    // 判断是否还有下一页
    if (pageData.page * pageData.limit >= pageData.count) return 'last';
    if (isNullOrUndefined(rawVideos) || rawVideos.length === 0) return true;

    // 解析并批量写入 DB（与 handleVideosResponse 一致）
    const list: Array<PartialVideoInfo | FullVideoInfo> = [];
    let idx = 0;
    const concurrency = 6;
    const nextParse = async () => {
        if (idx >= rawVideos.length) return;
        const i = idx++;
        try {
            const info = await parseVideoInfo({ Type: 'cache', ID: rawVideos[i].id, RAW: rawVideos[i] });
            if (info.Type === 'partial' || info.Type === 'full') {
                list.push(info);
            }
        } catch { } finally {
            if (idx < rawVideos.length) await delay(100);
            await nextParse();
        }
    };
    await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, rawVideos.length) }, () => nextParse())
    );

    if (list.length > 0) {
        const ids = list.map(v => v.ID);
        const existing = await db.getVideosByIds(ids);
        const fullVideos = existing.filter(v => v.Type === 'full');
        const toUpdate = list.difference(fullVideos, 'ID');
        if (toUpdate.any()) {
            await db.bulkPutVideos(toUpdate);
            originalConsole.log(`update: ${toUpdate.length} ${toUpdate[0].Title}`)
        }
    }

    return true;
}

/**
 * 遍历 iwara 视频列表的所有页面，逐页抓取并通过 fetchAndCachePage 缓存到 IndexedDB
 * 使用 unlimitedFetch（自动处理跨域）手动解析响应并写入数据库
 * 每页请求间隔加入随机 jitter 避免触发限流
 */
export async function syncAllVideosPages(): Promise<void> {
    if (!isLoggedIn()) {
        newToast(ToastType.Warn, {
            node: toastNode(`请先登录 iwara`, '页面遍历'),
            duration: 3000
        }).show();
        return;
    }

    // 显示进度
    const progressNode = renderNode({
        nodeType: 'p',
        childs: `正在遍历视频页面...`
    });
    const progressToast = newToast(ToastType.Info, {
        node: progressNode,
        duration: -1
    });
    progressToast.show();

    let succeeded = 0;
    const failedPages: number[] = [];
    let page = 6000;

    while (true) {
        try {
            const result = await fetchAndCachePage(page);

            if (result === 'last') {
                succeeded++;
                progressNode.firstChild!.textContent = `正在遍历视频页面... 已是最后一页 (${page})，提前结束`;
                break;
            }

            if (result === false) {
                originalConsole.warn(`[SyncPages] 页面 ${page} 失败`);
                failedPages.push(page);
                await delay(5000 + Math.random() * 1000);
                page++;
                continue;
            }

            // true: 成功（含空页）
            succeeded++;
            progressNode.firstChild!.textContent = `正在遍历视频页面... 第 ${page} 页 (失败: ${failedPages.length})`;

        } catch (error) {
            originalConsole.warn(`[SyncPages] 页面 ${page} 异常:`, stringify(error));
            failedPages.push(page);
        }

        await delay(500 + Math.random() * 1000);
        page++;
    }

    // ── 重试失败的页面 ──
    let retryFailed: number[] = [];
    if (failedPages.length > 0) {
        progressNode.firstChild!.textContent = `正在重试 ${failedPages.length} 个失败页面...`;

        for (const retryPage of failedPages) {
            try {
                const result = await fetchAndCachePage(retryPage);

                if (result === false) {
                    originalConsole.warn(`[SyncPages] 重试页面 ${retryPage} 仍失败`);
                    retryFailed.push(retryPage);
                    continue;
                }

                succeeded++;
                progressNode.firstChild!.textContent = `正在重试失败页面... ${retryPage} 成功 (剩余 ${failedPages.length - retryFailed.length - (failedPages.indexOf(retryPage) + 1 - retryFailed.length)} 个待重试)`;

            } catch (error) {
                originalConsole.warn(`[SyncPages] 重试页面 ${retryPage} 异常:`, stringify(error));
                retryFailed.push(retryPage);
            }

            await delay(500 + Math.random() * 1000);
        }
    }

    progressToast.hide();

    newToast(ToastType.Info, {
        text: `页面遍历完成！成功: ${succeeded} 页${retryFailed.length > 0 ? `，重试后仍失败: ${retryFailed.length} 页` : '，无失败'}`,
        close: true,
        onClick() { this.hide(); }
    }).show();

    if (retryFailed.length > 0) {
        originalConsole.warn(`[SyncPages] 始终失败的页码: ${retryFailed.join(', ')}`);
    }
}

export async function importConfig() {
    let textArea = renderNode({
        nodeType: "textarea",
        attributes: {
            placeholder: i18nList[config.language].importConfig,
            style: 'margin-bottom: 10px;',
            rows: "16",
            cols: "96"
        }
    })
    let body = renderNode({
        nodeType: "div",
        attributes: {
            id: "pluginOverlay"
        },
        childs: [
            textArea,
            {
                nodeType: "button",
                events: {
                    click: (e: Event) => {
                        if (!isNullOrUndefined(textArea.value) && !textArea.value.isEmpty()) {
                            try {
                                let tempConfig = JSON.parse(textArea.value)
                                if (!tempConfig || typeof tempConfig !== 'object') {
                                    throw "配置校验失败"
                                }
                                Config.initInstance(tempConfig)
                                unsafeWindow.location.reload()
                            } catch (error) {
                                newToast(ToastType.Error, {
                                    node: renderNode({
                                        nodeType: 'p',
                                        childs: [
                                            "%#importConfigFail#%",
                                            stringify(error)
                                        ]
                                    })
                                }).show()
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

export async function addDownloadTask() {
    let textArea = renderNode({
        nodeType: "textarea",
        attributes: {
            placeholder: i18nList[config.language].manualDownloadTips,
            style: 'margin-bottom: 10px;',
            rows: "16",
            cols: "96"
        }
    })
    let body = renderNode({
        nodeType: "div",
        attributes: {
            id: "pluginOverlay"
        },
        childs: [
            textArea,
            {
                nodeType: "button",
                events: {
                    click: (e: Event) => {
                        if (!isNullOrUndefined(textArea.value) && !textArea.value.isEmpty()) {
                            let list: Array<[string, VideoInfo]> = [];
                            try {
                                list = textArea.value.split('|').map(ID => [ID.trim(), {
                                    Type: 'init',
                                    ID: ID.trim()
                                }]);
                            } catch (error) {
                                throw new Error('解析结果不是符合预期的列表');
                            }
                            if (list.length > 0) {
                                analyzeDownloadTask(new Dictionary<VideoInfo>(list));
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
        let active: Array<{ id: string, data: Aria2.Status }> = prune(
            (await aria2API(
                'aria2.tellActive',
                [
                    [
                        'gid',
                        'status',
                        'files',
                        'downloadSpeed',
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
        let downloadCompleted: Array<{ id: string, data: Aria2.Status }> = stoped.filter(
            (task: { id: string, data: Aria2.Status }) => task.data.status === 'complete'
        ).unique('id');
        let startedAndCompleted = [...active, ...downloadCompleted].map(i => i.id);
        for (let key of taskList.keysArray().intersect(startedAndCompleted)) {
            taskList.delete(key)
        }
    } catch (error) {
        newToast(ToastType.Error, {
            node: toastNode(
                [
                    `%#duplicateTaskAnalysisError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ]
            )
        }).show()
    }
}
export async function analyzeDownloadTask(taskList: Dictionary<VideoInfo> = selectList) {
    let size = taskList.size
    let node = renderNode({
        nodeType: 'p',
        childs: `${i18nList[config.language].parsingProgress}[${taskList.size}/${size}]`
    })

    let parsingProgressToast = newToast(ToastType.Info, {
        node: node,
        duration: -1
    })

    function updateParsingProgress() {
        node.firstChild!.textContent = `${i18nList[config.language].parsingProgress}[${taskList.size}/${size}]`
    }

    parsingProgressToast.show()
    if (config.experimentalFeatures && config.downloadType === DownloadType.Aria2) {
        await downloadTaskUnique(taskList)
        updateParsingProgress()
    }

    for (let [id, info] of taskList) {
        await pushDownloadTask(await parseVideoInfo(info))
        taskList.delete(id)
        updateParsingProgress()
        !config.enableUnsafeMode && await delay(3000)
    }

    parsingProgressToast.hide()
    newToast(
        ToastType.Info,
        {
            text: `%#allCompleted#%`,
            duration: -1,
            close: true,
            onClick() {
                this.hide()
            }
        }
    ).show()
}
export async function pushDownloadTask(videoInfo: VideoInfo) {
    switch (videoInfo.Type) {
        case "partial":
            const partialCache = await db.getVideoById(videoInfo.ID)
            if (!isNullOrUndefined(partialCache) && partialCache.Type !== 'full') await db.putVideo(videoInfo)
        case "cache":
        case "init":
            return await pushDownloadTask(await parseVideoInfo(videoInfo))
        case "fail":
            const cache = await db.getVideoById(videoInfo.ID)
            newToast(
                ToastType.Error,
                {
                    close: true,
                    node: toastNode([
                        `${videoInfo.Title ?? videoInfo.RAW?.title ?? cache?.RAW?.title}[${videoInfo.ID}] %#parsingFailed#%`,
                        { nodeType: 'br' },
                        videoInfo.Msg,
                        { nodeType: 'br' },
                        videoInfo.External ? `%#openVideoLink#%` : `%#tryReparseDownload#%`
                    ], '%#createTask#%'),
                    async onClick() {
                        this.hide()
                        if (videoInfo.External && !isNullOrUndefined(videoInfo.ExternalUrl) && !videoInfo.ExternalUrl.isEmpty()) {
                            GM_openInTab(videoInfo.ExternalUrl, { active: false, insert: true, setParent: true })
                        } else {
                            await pushDownloadTask(await parseVideoInfo({ Type: 'init', ID: videoInfo.ID, RAW: videoInfo.RAW ?? cache?.RAW }))
                        }
                    },
                }
            ).show()
            break;
        case "full":
            await db.putVideo(videoInfo)
            const authorInfo = await db.getFollowById(videoInfo.AuthorID);
            if (config.autoFollow && (!authorInfo?.following || !videoInfo.Following)) {
                await unlimitedFetch(
                    `https://${apiEndpoint}/user/${videoInfo.AuthorID}/followers`,
                    {
                        method: 'POST',
                        headers: await getAuth()
                    },
                    {
                        retry: true,
                        successStatus: 201,
                        failStatus: [404],
                        onFail: async (res) => {
                            newToast(ToastType.Warn, {
                                text: `${videoInfo.Alias} %#autoFollowFailed#% ${res.status}`,
                                close: true,
                                onClick() { this.hide() }
                            }).show();
                        },
                        onRetry: async () => { await refreshToken() }
                    }
                );
            }
            if (config.autoLike && !videoInfo.Liked) {
                await unlimitedFetch(
                    `https://${apiEndpoint}/video/${videoInfo.ID}/like`,
                    {
                        method: 'POST',
                        headers: await getAuth()
                    },
                    {
                        retry: true,
                        successStatus: 201,
                        failStatus: [404],
                        onFail: async (res) => {
                            newToast(ToastType.Warn, {
                                text: `${videoInfo.Alias} %#autoLikeFailed#% ${res.status}`,
                                close: true,
                                onClick() { this.hide() }
                            }).show();
                        },
                        onRetry: async () => { await refreshToken() }
                    }
                )
            }
            if (pluginMenu.pageType !== PageType.Video && config.checkDownloadLink && checkIsHaveDownloadLink(`${videoInfo.Description} ${videoInfo.Comments}`)) {
                let toastBody = toastNode([
                    `${videoInfo.Title}[${videoInfo.ID}] %#findedDownloadLink#%`,
                    { nodeType: 'br' },
                    `%#openVideoLink#%`
                ], '%#createTask#%')
                newToast(
                    ToastType.Warn,
                    {
                        node: toastBody,
                        close: config.autoCopySaveFileName,
                        onClick() {
                            GM_openInTab(`https://www.${domain}/video/${videoInfo.ID}`, { active: false, insert: true, setParent: true })
                            if (config.autoCopySaveFileName) {
                                GM_setClipboard(getDownloadPath(videoInfo).fullName, "text")
                                toastBody.appendChild(renderNode({
                                    nodeType: 'p',
                                    childs: '%#copySucceed#%'
                                }))
                            } else {
                                this.hide()
                            }
                        }
                    }
                ).show()
                return
            }
            if (config.checkPriority && videoInfo.DownloadQuality !== config.downloadPriority) {
                newToast(
                    ToastType.Warn,
                    {
                        node: toastNode([
                            `${videoInfo.Title.truncate(64)}[${videoInfo.ID}] %#downloadQualityError#%`,
                            { nodeType: 'br' },
                            `%#tryReparseDownload#%`
                        ], '%#createTask#%'),
                        async onClick() {
                            this.hide()
                            await pushDownloadTask(await parseVideoInfo(videoInfo))
                        }
                    }
                ).show()
                return
            }
            switch (config.downloadType) {
                case DownloadType.Aria2:
                    aria2Download(videoInfo, true)
                    // pushToMediaCenter 由 trackAria2Task 在下载完成后自动调用
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
                GM_getValue('isDebug') && originalConsole.debug('[Debug] Download task pushed:', videoInfo);
            }
            selectList.delete(videoInfo.ID)
            break;
        default:
            GM_getValue('isDebug') && originalConsole.debug('[Debug] Unknown type:', videoInfo);
            break;
    }
}
