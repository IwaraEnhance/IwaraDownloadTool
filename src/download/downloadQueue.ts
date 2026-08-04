import "../core/env";
import { delay, isNullOrUndefined, prune, stringify } from "../core/env";
import { i18nList } from "../i18n";
import { DownloadType, PageType, ToastType } from "../core/enum";
import { config } from "../core/config";
import { unlimitedFetch, renderNode } from "../core/extension";
import { Dictionary } from "../core/class";
import { originalConsole } from "../core/hijack";
import { db } from "../core/db";
import { getAuth, refreshToken } from "../network/auth";
import { newToast, toastNode } from "../ui/notify";
import { getDownloadPath } from "./downloadPath";
import { parseVideoInfo } from "../network/video";
import { checkIsHaveDownloadLink } from "./linkCheck";
import { aria2API, aria2Download, aria2TaskExtractVideoID } from "./aria2";
import { browserDownload, browserDownloadMetadata, iwaradlDownload, othersDownload, othersDownloadMetadata } from "./download";
import { apiEndpoint, domain, pluginMenu, selectList } from "../main";

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
                GM_getValue('isDebug') && originalConsole.debug('[Debug] Download task pushed:', videoInfo);
            }
            selectList.delete(videoInfo.ID)
            break;
        default:
            GM_getValue('isDebug') && originalConsole.debug('[Debug] Unknown type:', videoInfo);
            break;
    }
}
