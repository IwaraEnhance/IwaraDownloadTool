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
/**
 * 通过Aria2下载视频
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 */
export async function aria2Download(videoInfo: FullVideoInfo, overwrite: boolean | undefined = undefined) {
    let localPath = getDownloadPath(videoInfo)
    let downloadUrl = videoInfo.DownloadUrl.toURL()
    downloadUrl.searchParams.set('videoid', videoInfo.ID)
    downloadUrl.searchParams.set('download', localPath.fullName)
    let params = [
        [downloadUrl.href],
        prune({
            'allow-overwrite': overwrite,
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
    ]
    try {
        let res = await aria2API('aria2.addUri', params) as Aria2.AuctionResult
        if (res.result.isEmpty()) throw `aria2 下载失败：${stringify(res)}`
        newToast(
            ToastType.Info,
            {
                gravity: 'bottom',
                node: toastNode(`${videoInfo.Title}[${videoInfo.ID}] %#pushTaskSucceed#%`)
            }
        ).show()
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
                                                `${info.RAW?.title}[${info.ID}] %#parsingFailed#%`
                                            ], '%#aria2TaskCheck#%'),
                                        onClick() {
                                            this.hide()
                                        },
                                    }
                                ).show()
                                continue
                            }
                            try {
                                aria2Download(info, true)
                                let activeTasks = active.filter(
                                    (activeTask: { id: string, data: Aria2.Status }) => activeTask.id === task.id
                                )
                                for (let t = 0; t < activeTasks.length; t++) {
                                    const element = activeTasks[t];
                                    await aria2API('aria2.forceRemove', [element.data.gid])
                                }
                            } catch (error) {
                                newToast(
                                    ToastType.Error,
                                    {
                                        node:
                                            toastNode([
                                                `${info.RAW?.title}[${info.ID}] %#pushTaskFail#%`,
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

export async function parseVideoInfo(info: VideoInfo): Promise<VideoInfo> {
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
    const metadata = Object.assign(videoInfo, {
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
                    aria2Download(videoInfo)
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
