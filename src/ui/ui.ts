import { Config, config } from "../core/config";
import { db } from "../core/db";
import { DownloadType, PageType, ToastType } from "../core/enum";
import { isNullOrUndefined, delay, stringify } from "../core/env";
import { renderNode, unlimitedFetch } from "../core/extension";
import { check } from "../network/envCheck";
import { getAuth, refreshToken } from "../network/auth";
import { newToast, toastNode } from "./notify";
import { parseVideoInfo } from "../network/video";
import { addDownloadTask, analyzeDownloadTask, pushDownloadTask } from "../download/downloadQueue";
import { importConfig } from "./configUi";
import { syncCachedToMediaCenter } from "../network/mediaCenter";
import { originalNodeAppendChild, originalAddEventListener } from "../core/hijack";
import { createLogger } from "../core/log";
import { i18nList, type Language } from "../i18n";
import { apiEndpoint, editConfig, getPageType, isLoggedIn, pageSelectButtons, rating, selectList } from "../main";
import site from "../data/site.json";

const log = createLogger('UI');

/** 一个月的毫秒数（计算值，JSON 只能存字面量无法表达，故保留在 TS） */
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export function uninjectCheckbox(element: Element | Node) {
    if (element instanceof HTMLElement) {
        if (element instanceof HTMLInputElement && element.classList.contains('selectButton')) {
            element.hasAttribute('videoID') && pageSelectButtons.delete(element.getAttribute('videoID')!)
        }
        if (element.querySelector('input.selectButton')) {
            element.querySelectorAll('.selectButton').forEach(i => i.hasAttribute('videoID') && pageSelectButtons.delete(i.getAttribute('videoID')!))
        }
    }
}
export async function injectCheckbox(element: Element) {
    const thumbnail = element.querySelector('a.videoTeaser__thumbnail') as HTMLLinkElement | null
    if (isNullOrUndefined(thumbnail)) return
    let ID = thumbnail.href.toURL().pathname.split('/')[2]
    if (isNullOrUndefined(ID)) return
    let info = await db.getVideoById(ID)
    const hasFullInfo = info?.Type === 'full' || info?.Type === 'partial'
    const authorLink = element.querySelector('a.username') as HTMLLinkElement | null
    let Title = hasFullInfo ? info?.Title : info?.RAW?.title ?? element.querySelector('.videoTeaser__title')?.getAttribute('title') ?? undefined;
    let Alias = hasFullInfo ? info?.Alias : info?.RAW?.user.name ?? authorLink?.getAttribute('title') ?? undefined;
    let Author = hasFullInfo ? info?.Author : info?.RAW?.user.username ?? authorLink?.href.toURL().pathname.split('/').pop()
    let UploadTime = hasFullInfo ? info?.UploadTime : new Date(info?.RAW?.updatedAt ?? 0).getTime()

    let button = renderNode({
        nodeType: 'input',
        attributes: {
            type: 'checkbox',
            videoID: ID,
            checked: selectList.has(ID) ? true : undefined,
            videoName: Title,
            videoAlias: Alias,
            videoAuthor: Author,
            videoUploadTime: UploadTime
        },
        className: 'selectButton',
        events: {
            click: (event: Event) => {
                (event.target as HTMLInputElement).checked ? selectList.set(ID, {
                    Type: 'init',
                    ID,
                    Title,
                    Alias,
                    Author,
                    UploadTime
                }) : selectList.delete(ID)
                event.stopPropagation()
                event.stopImmediatePropagation()
                return false
            }
        }
    })
    let item = thumbnail.parentElement
    item?.style.setProperty('position', 'relative')
    pageSelectButtons.set(ID, button)
    originalNodeAppendChild.call(item, button)

    if (!isNullOrUndefined(Author)) {
        const AuthorInfo = await db.getFollowByUsername(Author)
        if (AuthorInfo?.following && thumbnail.querySelector('.follow') === null) {
            originalNodeAppendChild.call(thumbnail, renderNode(
                {
                    nodeType: 'div',
                    className: 'follow',
                    childs: {
                        nodeType: 'div',
                        className: ['text', 'text--white', 'text--tiny', 'text--bold'],
                        childs: '%#following#%'
                    }
                }
            ))
        }
    }

    // 检查 MediaCenter 映射，显示是否已下载（仅在配置了 MediaCenter 时启用）
    if (!config.mediaCenterApi.isEmpty() && !config.mediaCenterApiKey.isEmpty()) {
        const mediaCenterId = await db.getMediaCenterIdMap(ID);
        if (!isNullOrUndefined(mediaCenterId) && !mediaCenterId.isEmpty() && thumbnail.querySelector('.downloaded') === null) {
            originalNodeAppendChild.call(thumbnail, renderNode(
                {
                    nodeType: 'div',
                    className: 'downloaded',
                    childs: {
                        nodeType: 'div',
                        className: ['text', 'text--white', 'text--tiny', 'text--bold'],
                        childs: '%#downloaded#%'
                    }
                }
            ))
        }
    }

    if (getPageType() === PageType.Playlist) {
        // 仅在当前用户是该播放列表的所有者时才显示删除按钮
        if (await isCurrentUserPlaylistOwner(unsafeWindow.location.pathname.split('/')[2])) {
            let deletePlaylistItme = renderNode({
                nodeType: 'button',
                attributes: {
                    videoID: ID
                },
                childs: '%#delete#%',
                className: 'deleteButton',
                events: {
                    click: async (event: Event) => {
                        if ((await unlimitedFetch(`https://${apiEndpoint}/playlist/${unsafeWindow.location.pathname.split('/')[2]}/${ID}`, {
                            method: 'DELETE',
                            headers: await getAuth()
                        })).ok) {
                            newToast(ToastType.Info, { text: `${Title} %#deleteSucceed#%`, close: true }).show()
                            deletePlaylistItme.remove()
                        }
                        event.preventDefault()
                        event.stopPropagation()
                        event.stopImmediatePropagation()
                        return false
                    }
                }
            })
            originalNodeAppendChild.call(item, deletePlaylistItme)
        }
    }
}

// ── 播放列表所有者判断（用于决定是否显示删除按钮） ──
// 当前登录用户缓存（Promise 缓存，避免并发重复请求）
let localUserPromise: Promise<Iwara.User | null> | null = null
// 播放列表所有者 ID 缓存（按 playlistId 缓存 Promise）
let playlistOwnerPromise: { playlistId: string, promise: Promise<string> } | null = null

/** 获取当前登录用户（缓存） */
function getLocalUser(): Promise<Iwara.User | null> {
    if (localUserPromise === null) {
        localUserPromise = (async () => {
            try {
                if (!isLoggedIn()) return null
                const res = await unlimitedFetch(`https://${apiEndpoint}/user`, {
                    method: 'GET',
                    headers: await getAuth()
                })
                if (!res.ok) return null
                return (await res.json() as Iwara.LocalUser).user ?? null
            } catch (error) {
                log.warn('Failed to get local user:', error)
                return null
            }
        })()
    }
    return localUserPromise
}

/** 获取播放列表所有者的用户 ID（按播放列表 ID 缓存） */
function getPlaylistOwnerId(playlistId: string): Promise<string> {
    if (playlistOwnerPromise?.playlistId !== playlistId) {
        playlistOwnerPromise = {
            playlistId,
            promise: (async () => {
                try {
                    const res = await unlimitedFetch(`https://${apiEndpoint}/playlist/${playlistId}`, {
                        method: 'GET',
                        headers: await getAuth()
                    })
                    if (!res.ok) return ''
                    return (await res.json() as Iwara.Playlist).playlist?.user?.id ?? ''
                } catch (error) {
                    log.warn('Failed to get playlist owner:', error)
                    return ''
                }
            })()
        }
    }
    return playlistOwnerPromise.promise
}

/** 判断当前用户是否为指定播放列表的所有者 */
async function isCurrentUserPlaylistOwner(playlistId: string): Promise<boolean> {
    const localUser = await getLocalUser()
    if (isNullOrUndefined(localUser)) return false
    const ownerId = await getPlaylistOwnerId(playlistId)
    return ownerId !== '' && localUser.id === ownerId
}



export class configEdit {
    source!: configEdit;
    target: Config
    interfacePage: HTMLParagraphElement;
    interface: HTMLDivElement;
    constructor(config: Config) {
        this.target = config
        this.target.configChange = (item: string) => { this.configChange.call(this, item) }
        this.interfacePage = renderNode({
            nodeType: 'p'
        })

        let save = renderNode({
            nodeType: 'button',
            childs: '%#save#%',
            attributes: {
                title: i18nList[config.language].save
            },
            events: {
                click: async () => {
                    save.disabled = !save.disabled
                    if (await check()) {
                        unsafeWindow.location.reload()
                    }
                    save.disabled = !save.disabled
                }
            }
        })
        let reset = renderNode({
            nodeType: 'button',
            childs: '%#reset#%',
            attributes: {
                title: i18nList[config.language].reset
            },
            events: {
                click: () => {
                    GM_setValue('isFirstRun', true)
                    unsafeWindow.location.reload()
                }
            }
        })
        this.interface = renderNode({
            nodeType: 'div',
            attributes: {
                id: 'pluginConfig'
            },
            childs: [
                {
                    nodeType: 'div',
                    className: 'main',
                    childs: [
                        {
                            nodeType: 'h2',
                            childs: '%#appName#%'
                        },
                        {
                            nodeType: 'label',
                            childs: [
                                '%#language#% ',
                                {
                                    nodeType: 'input',
                                    className: 'inputRadioLine',
                                    attributes: {
                                        name: 'language',
                                        type: 'text',
                                        value: this.target.language
                                    },
                                    events: {
                                        change: (event: Event) => {
                                            this.target.language = (event.target as HTMLInputElement).value as Language
                                        }
                                    }
                                }
                            ]
                        },
                        this.downloadTypeSelect(),
                        this.interfacePage,
                        this.switchButton('checkPriority'),
                        this.switchButton('checkDownloadLink'),
                        this.switchButton('autoFollow'),
                        this.switchButton('autoLike'),
                        this.switchButton('filterLikedVideos'),
                        this.switchButton('autoInjectCheckbox'),
                        this.switchButton('autoDownloadMetadata'),
                        this.switchButton('autoCopySaveFileName'),
                        this.switchButton('addUnlistedAndPrivate', undefined, (name, e) => {
                            const checked = (e.target as HTMLInputElement).checked
                            this.target.addUnlistedAndPrivate = checked
                            if (checked) this.target.filterUnlistedAndPrivate = false
                        }),
                        this.switchButton('filterUnlistedAndPrivate', undefined, (name, e) => {
                            const checked = (e.target as HTMLInputElement).checked
                            this.target.filterUnlistedAndPrivate = checked
                            if (checked) this.target.addUnlistedAndPrivate = false
                        }),
                        this.switchButton('autoCollapseMenu'),
                        this.switchButton('experimentalFeatures'),
                        this.switchButton('enableUnsafeMode'),
                        this.switchButton('enableWidescreen'),
                        this.switchButton('enableBeautify'),
                        this.switchButton('isDebug', GM_getValue, (name: string, e) => {
                            GM_setValue(name, (e.target as HTMLInputElement).checked)
                            unsafeWindow.location.reload()
                        }, false),
                    ]
                },
                {
                    nodeType: 'p',
                    className: 'buttonList',
                    childs: [
                        reset,
                        save
                    ]
                }
            ]
        })

    }
    private switchButton(name: string, get?: (name: string, defaultValue?: any) => any, set?: (name: string, e: Event) => void, defaultValue?: boolean) {
        return renderNode({
            nodeType: 'p',
            className: 'inputRadioLine',
            childs: [
                {
                    nodeType: 'label',
                    childs: `%#${name}#%`,
                    attributes: {
                        for: name
                    }
                }, {
                    nodeType: 'input',
                    className: 'switch',
                    attributes: {
                        type: 'checkbox',
                        name: name,
                        checked: get !== undefined ? get(name, defaultValue) : this.target[name] ?? defaultValue ?? false
                    },
                    events: {
                        change: (e: Event) => {
                            if (set !== undefined) {
                                set(name, e)
                                return
                            } else {
                                this.target[name] = (e.target as HTMLInputElement).checked
                            }
                        }
                    }
                }
            ]
        })
    }
    private inputComponent(name: string, type?: InputType, help?: HTMLElement, get?: (name: string) => void, set?: (name: string, e: Event) => void) {
        return renderNode({
            nodeType: 'label',
            childs: [
                {
                    nodeType: 'span',
                    childs: [
                        `%#${name}#%`,
                        help
                    ],
                },
                {
                    nodeType: 'input',
                    attributes: {
                        name: name,
                        type: type ?? 'text',
                        value: get !== undefined ? get(name) : this.target[name]
                    },
                    events: {
                        change: (e: Event) => {
                            if (set !== undefined) {
                                set(name, e)
                                return
                            } else {
                                this.target[name] = (e.target as HTMLInputElement).value
                            }
                        }
                    }
                }
            ]
        })
    }
    private downloadTypeSelect() {
        return renderNode({
            nodeType: 'fieldset',
            childs: [
                {
                    nodeType: 'legend',
                    childs: '%#downloadType#%'
                },
                ...Object.keys(DownloadType).filter((i: any) => isNaN(Number(i))).map((type: string, index: number) =>
                    renderNode({
                        nodeType: 'label',
                        childs: [
                            {
                                nodeType: 'input',
                                attributes: {
                                    type: 'radio',
                                    name: 'downloadType',
                                    value: index,
                                    checked: index === Number(this.target.downloadType)
                                },
                                events: {
                                    change: (e) => {
                                        this.target.downloadType = Number((e.target as HTMLInputElement).value)
                                    }
                                }
                            },
                            type
                        ]
                    })
                )
            ]
        })
    }
    private appendAll(items: (Element | Node)[]) {
        items.forEach(i => originalNodeAppendChild.call(this.interfacePage, i))
    }
    private configChange(item: string) {
        switch (item) {
            case 'downloadType':
                const radios = this.interface.querySelectorAll(`[name=${item}]`) as NodeListOf<HTMLInputElement>
                radios.forEach(radio => {
                    radio.checked = Number(radio.value) === Number(this.target.downloadType)
                })
                this.pageChange()
                break
            case 'checkPriority':
            case 'experimentalFeatures':
                this.pageChange()
                break
            default:
                let element = this.interface.querySelector(`[name=${item}]`) as HTMLInputElement
                if (element) {
                    switch (element.type) {
                        case 'radio':
                            element.value = this.target[item]
                            break
                        case 'checkbox':
                            element.checked = this.target[item]
                            break
                        case 'text':
                        case 'password':
                            element.value = this.target[item]
                            break
                        default:
                            break
                    }
                }
                break
        }
    }
    private pageChange() {
        while (this.interfacePage.hasChildNodes()) {
            this.interfacePage.removeChild(this.interfacePage.firstChild!)
        }
        let downloadConfigInput = [
            this.inputComponent('downloadPath', 'text', renderNode({
                nodeType: 'a',
                childs: '%#variable#%',
                className: 'rainbow-text',
                attributes: {
                    style: 'float: inline-end;',
                    href: 'https://github.com/IwaraEnhance/IwaraDownloadTool/wiki/路径可用变量'
                }
            }))
        ]
        let proxyConfigInput = [
            this.inputComponent('downloadProxy'),
            this.inputComponent('downloadProxyUsername'),
            this.inputComponent('downloadProxyPassword', 'password')
        ]
        let aria2ConfigInput = [
            this.inputComponent('aria2Path'),
            this.inputComponent('aria2Token', 'password'),
            ...proxyConfigInput
        ]
        let mediaCenterConfigInput = [
            this.inputComponent('mediaCenterApi', 'text', renderNode({
                nodeType: 'a',
                childs: '%#mediaCenterInfo#%',
                className: 'rainbow-text',
                attributes: {
                    style: 'float: inline-end;',
                    href: 'https://github.com/dawn-lc/MediaCenter'
                }
            })),
            this.inputComponent('mediaCenterApiKey', 'password')
        ]
        let iwaradlConfigInput = [
            this.inputComponent('iwaradlPath', 'text', renderNode({
                nodeType: 'a',
                childs: '%#iwaradlLink#%',
                className: 'rainbow-text',
                attributes: {
                    style: 'float: inline-end;',
                    href: 'https://github.com/Izumiko/iwaradl'
                }
            })),
            this.inputComponent('iwaradlToken', 'password'),
            ...proxyConfigInput
        ]
        switch (this.target.downloadType) {
            case DownloadType.Aria2:
                this.appendAll([...downloadConfigInput, ...aria2ConfigInput])
                if (this.target.experimentalFeatures) {
                    this.appendAll(mediaCenterConfigInput)
                }
                break
            case DownloadType.Iwaradl:
                this.appendAll([...downloadConfigInput, ...iwaradlConfigInput])
                break
            default:
                this.appendAll(downloadConfigInput)
                break
        }
        if (this.target.checkPriority) {
            originalNodeAppendChild.call(this.interfacePage, this.inputComponent('downloadPriority'))
        }
    }
    public inject() {
        if (!unsafeWindow.document.querySelector('#pluginConfig')) {
            originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
            this.configChange('downloadType')
        }
    }
}
export class menu {
    [key: string | symbol]: any
    observer!: MutationObserver;
    pageType!: PageType;
    interface!: HTMLDivElement;
    interfacePage!: HTMLUListElement;
    isTouchDevice!: boolean;
    constructor() {
        let body = new Proxy(this, {
            set: (target, prop, value) => {
                if (prop === 'pageType') {
                    if (isNullOrUndefined(value) || target.pageType === value) return true
                    const ok = Reflect.set(target, prop, value)
                    this.pageChange()
                    log.debug(`Page change to ${this.pageType}`)
                    return ok
                }
                return Reflect.set(target, prop, value)
            }
        })
        body.interfacePage = renderNode({
            nodeType: 'ul'
        })
        body.interface = renderNode({
            nodeType: 'div',
            attributes: {
                id: 'pluginMenu'
            },
            childs: body.interfacePage
        })

        // 检测是否为触摸设备（使用 matchMedia 检测 coarse pointer + maxTouchPoints 兜底）
        body.isTouchDevice = unsafeWindow.matchMedia('(pointer: coarse)').matches || (unsafeWindow.navigator.maxTouchPoints ?? 0) > 0;

        if (config.autoCollapseMenu) {
            if (body.isTouchDevice) {
                // 移动端：点击菜单容器切换展开/收起
                originalAddEventListener.call(body.interface, 'click', (event: Event) => {
                    // 只响应直接点击菜单容器（非子元素冒泡）
                    if (event.target === body.interface) {
                        body.interface.classList.toggle('expanded');
                    }
                });

                // 移动端：点击菜单外部区域时收起菜单
                originalAddEventListener.call(unsafeWindow.document, 'click', (event: Event) => {
                    if (body.interface.classList.contains('expanded') &&
                        !body.interface.contains(event.target as Node)) {
                        body.interface.classList.remove('expanded');
                    }
                });
            } else {
                // 桌面端：保持原有的 hover 行为
                let mouseoutTimer: number | null = null;

                originalAddEventListener.call(body.interface, 'mouseover', (event: Event) => {
                    if (mouseoutTimer !== null) {
                        clearTimeout(mouseoutTimer);
                        mouseoutTimer = null;
                    }
                    body.interface.classList.add('expanded');
                })

                originalAddEventListener.call(body.interface, 'mouseout', (event: Event) => {
                    const e = event as MouseEvent;
                    const relatedTarget = e.relatedTarget as Node;

                    if (relatedTarget && body.interface.contains(relatedTarget)) {
                        return;
                    }

                    mouseoutTimer = setTimeout(() => {
                        body.interface.classList.remove('expanded');
                        mouseoutTimer = null;
                    }, 300);
                })

                originalAddEventListener.call(body.interface, 'click', (event: Event) => {
                    if (event.target === body.interface) {
                        body.interface.classList.toggle('expanded');
                    }
                })
            }
        } else {
            // 禁用自动收起：菜单始终保持展开
            body.interface.classList.add('expanded');
        }

        body.observer = new MutationObserver(() => body.pageType = getPageType())
        body.pageType = PageType.Page
        return body
    }
    private button(name: string, click?: (name: string, e: Event) => void) {
        const self = this;
        return renderNode({
            nodeType: 'li',
            childs: `%#${name}#%`,
            events: {
                click: (event: Event) => {
                    if (!isNullOrUndefined(click)) click(name, event)
                    // 移动端：点击菜单项后自动收起菜单
                    if (self.isTouchDevice && config.autoCollapseMenu) {
                        setTimeout(() => self.interface.classList.remove('expanded'), 150);
                    }
                    event.stopPropagation()
                    return false
                }
            }
        })
    }

    /** 将所有按钮追加到菜单（移动已挂载的节点） */
    private appendAll(items: (Element | Node)[]) {
        items.forEach(i => originalNodeAppendChild.call(this.interfacePage, i))
    }

    /** 全选/全不选本页复选框 */
    private selectAll(checked: boolean) {
        unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
            const button = element as HTMLInputElement
            button.checked !== checked && button.click()
        })
    }

    /** 反选本页复选框 */
    private toggleSelect() {
        unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
            (element as HTMLInputElement).click()
        })
    }

    public async parseUnlistedAndPrivate() {
        if (!isLoggedIn()) return
        const lastMonthTimestamp = Date.now() - MONTH_MS
        const thisMonthUnlistedAndPrivateVideos = await db.getFilteredVideos(lastMonthTimestamp, Infinity);
        let parseUnlistedAndPrivateVideos: VideoInfo[] = []

        const MAX_FIND_PAGES = site.maxFindPages;
        let pageCount = 0;
        log.debug(`Starting fetch loop. MAX_PAGES=${MAX_FIND_PAGES}`);

        while (pageCount < MAX_FIND_PAGES) {
            log.debug(`Fetching page ${pageCount}.`);
            const response = await unlimitedFetch(
                `https://${apiEndpoint}/videos?subscribed=true&limit=50&rating=${rating()}&page=${pageCount}`,
                { method: 'GET', headers: await getAuth() },
                {
                    retry: true,
                    retryDelay: 1000,
                    onRetry: async () => { await refreshToken() }
                }
            );
            log.debug('Received response, parsing JSON.');
            const data = (await response.json() as Iwara.IPage).results as Iwara.Video[];
            log.debug(`Page ${pageCount} returned ${data.length} videos.`);
            data.forEach(info => info.user.following = true);
            const videoPromises = data.map(info => parseVideoInfo({
                Type: 'cache',
                ID: info.id,
                RAW: info
            }));
            log.debug('Initializing VideoInfo promises.');
            const videoInfos = await Promise.all(videoPromises);
            parseUnlistedAndPrivateVideos.push(...videoInfos);
            let test = videoInfos.filter(i => i.Type === 'partial' && (i.Private || i.Unlisted)).any()
            log.debug('All VideoInfo objects initialized.');
            if (test && thisMonthUnlistedAndPrivateVideos.intersect(videoInfos, 'ID').any()) {
                log.debug(`Found private video on page ${pageCount}.`);
                break;
            }
            log.debug(`Latest private video not found on page ${pageCount}, continuing.`);
            pageCount++;

            log.debug(`Incremented page to ${pageCount}, delaying next fetch.`);
            await delay(100);
        }
        log.debug('Fetch loop ended. Start updating the database');
        const existingVideos = await db.getVideosByIds(parseUnlistedAndPrivateVideos.map(v => v.ID));
        const toUpdate = parseUnlistedAndPrivateVideos.difference(
            existingVideos.filter(v => v.Type === 'full'), 'ID')
        if (toUpdate.any()) {
            log.debug(`Need to update ${toUpdate.length} pieces of data.`);
            await db.bulkPutVideos(toUpdate)
            log.debug(`Update Completed.`);
        } else {
            log.debug(`No need to update data.`);
        }
    }

    public async pageChange() {
        while (this.interfacePage.hasChildNodes()) {
            this.interfacePage.removeChild(this.interfacePage.firstChild!)
        }
        let manualDownloadButton = this.button('manualDownload', (name, event) => {
            addDownloadTask()
        })
        let settingsButton = this.button('settings', (name, event) => {
            editConfig.inject()
        })

        let exportConfigButton = this.button('exportConfig', (name, event) => {
            GM_setClipboard(stringify(config));
            newToast(
                ToastType.Info,
                {
                    node: toastNode(i18nList[config.language].exportConfigSucceed),
                    duration: 3000,
                    gravity: 'bottom',
                    position: 'center',
                    onClick() {
                        this.hide();
                    }
                }
            ).show()
        })
        let importConfigButton = this.button('importConfig', (name, event) => {
            importConfig()
        })

        let baseButtons = [
            manualDownloadButton,
            exportConfigButton,
            importConfigButton,
            settingsButton
        ];

        let injectCheckboxButton = this.button('injectCheckbox', (name, event) => {
            if (unsafeWindow.document.querySelector('.selectButton')) {
                unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
                    element.remove()
                })
            } else {
                unsafeWindow.document.querySelectorAll(`.videoTeaser`).forEach((element: Element) => {
                    injectCheckbox(element)
                })
            }
        })

        // 数据驱动取消全选：逐个 delete 触发 GMSyncDictionary.onDel 事件链
        //   onDel → updateButtonState（DOM 复选框 checked 同步为 false）
        //        → updateSelected（水印计数刷新）
        //        → 跨页面广播 onSync（其他页面按钮状态同步）
        // 相比直接遍历 .selectButton 触发 click，此方式避免重复的点击事件流
        let deselectAllButton = this.button('deselectAll', () => {
            for (const id of selectList.keys()) {
                selectList.delete(id)
            }
        })
        let reverseSelectButton = this.button('reverseSelect', () => this.toggleSelect())
        let selectThisButton = this.button('selectThis', () => this.selectAll(true))
        let deselectThisButton = this.button('deselectThis', () => this.selectAll(false))
        let downloadSelectedButton = this.button('downloadSelected', (name, event) => {
            analyzeDownloadTask()
            newToast(ToastType.Info, {
                text: `%#${name}#%`,
                close: true
            }).show()
        })

        let selectButtons = [
            injectCheckboxButton,
            deselectAllButton,
            reverseSelectButton,
            selectThisButton,
            deselectThisButton,
            downloadSelectedButton
        ]

        let downloadThisButton = this.button('downloadThis', async (name, event) => {
            let ID = unsafeWindow.location.href.toURL().pathname.split('/')[2]
            await pushDownloadTask(await parseVideoInfo({
                Type: 'init', ID
            }))
        })

        switch (this.pageType) {
            case PageType.Video:
                this.appendAll([downloadThisButton, ...selectButtons, ...baseButtons])
                break
            case PageType.Search:
            case PageType.Profile:
            case PageType.Home:
            case PageType.VideoList:
            case PageType.Subscriptions:
            case PageType.Playlist:
            case PageType.Favorites:
            case PageType.History:
            case PageType.Account:
                this.appendAll([...selectButtons, ...baseButtons])
                break;
            case PageType.Page:
            case PageType.Forum:
            case PageType.Image:
            case PageType.ImageList:
            case PageType.ForumSection:
            case PageType.ForumThread:
            case PageType.Post:
            case PageType.Friends:
            case PageType.Messages:
            case PageType.Notifications:
            case PageType.Auth:
            case PageType.Product:
            case PageType.Create:
            case PageType.Rule:
            case PageType.Admin:
            default:
                this.appendAll(baseButtons)
                break;
        }


        if (config.addUnlistedAndPrivate && !config.filterUnlistedAndPrivate && this.pageType === PageType.VideoList) {
            this.parseUnlistedAndPrivate()
        } else {
            log.debug('Conditions not met: addUnlistedAndPrivate or pageType mismatch.');
        }
    }
    public inject() {
        try {
            this.observer.observe(unsafeWindow.document.getElementById('app')!, { childList: true, subtree: true });
            if (!unsafeWindow.document.querySelector('#pluginMenu')) {
                originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
                this.pageType = getPageType()
            }
        } catch (error) {
            originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
        }
    }
}
const DEBUG_SWITCH_THRESHOLD = 5

export class waterMark {
    debugSwitchCount = 0
    selected = renderNode({
        nodeType: 'span',
        childs: ` %#selected#% ${selectList.size} `
    })
    debugFlag = renderNode({
        nodeType: 'span',
        childs: `${GM_getValue('isDebug') ? `${i18nList[config.language].isDebug} ${GM_info.scriptHandler}` : ''}`
    })
    body = renderNode({
        nodeType: 'p',
        className: 'fixed-bottom-right',
        childs: [
            `%#appName#% ${GM_getValue('version')} `,
            this.selected,
            this.debugFlag
        ],
        events: {
            click: (e: Event) => {
                if (GM_getValue('isDebug')) return
                if (this.debugSwitchCount < DEBUG_SWITCH_THRESHOLD) {
                    this.debugSwitchCount++
                    return
                } else {
                    GM_setValue('isDebug', true)
                    this.debugFlag.textContent = `${GM_getValue('isDebug') ? i18nList[config.language].isDebug : ''}`
                    unsafeWindow.location.reload()
                }
            }
        }
    })
    public inject() {
        originalNodeAppendChild.call(unsafeWindow.document.body, this.body)
    }
}