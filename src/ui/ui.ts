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



/** 配置编辑 schema：声明每个配置项的渲染方式、分组、显隐条件与特殊行为。
 * 新增配置项只需在此数组加一行；渲染（pageChange）、回写（configChange）、
 * 显隐联动（dependsOn）均由本表驱动。 */
interface ConfigField {
    name: string
    type: 'switch' | 'text' | 'password' | 'number'
    /** 该字段出现在哪些标签页 */
    tabs: string[]
    /** 页内分组（同组渲染为一个 fieldset，缺省则直接平铺） */
    group?: string
    visible?: (target: Config) => boolean
    dependsOn?: string
    help?: { text: string; href: string }
    get?: (name: string, defaultValue?: any) => any
    onSet?: (target: Config, e: Event) => void
    defaultValue?: any
    rerender?: boolean
}

/** 标签页定义：下载器页按 downloadType 显隐，MediaCenter 额外要求实验性功能 */
const TABS: { id: string; visible: (target: Config) => boolean }[] = [
    { id: 'general', visible: () => true },
    { id: 'download', visible: () => true },
    { id: 'aria2', visible: (target) => target.downloadType === DownloadType.Aria2 },
    { id: 'iwaradl', visible: (target) => target.downloadType === DownloadType.Iwaradl },
    { id: 'mediaCenter', visible: (target) => target.downloadType === DownloadType.Aria2 && target.experimentalFeatures },
    // 高级页（实验性 / 风险 / 调试）固定在最后
    { id: 'advanced', visible: () => true },
]

const CONFIG_FIELDS: ConfigField[] = [
    // 常规页：下载行为
    { name: 'checkPriority', type: 'switch', tabs: ['general'], group: 'download', rerender: true },
    { name: 'checkDownloadLink', type: 'switch', tabs: ['general'], group: 'download' },
    { name: 'autoDownloadMetadata', type: 'switch', tabs: ['general'], group: 'download' },
    { name: 'autoCopySaveFileName', type: 'switch', tabs: ['general'], group: 'download' },
    // 常规页：选择与关注
    { name: 'autoInjectCheckbox', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'autoFollow', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'autoLike', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'filterLikedVideos', type: 'switch', tabs: ['general'], group: 'selection' },
    // 常规页：可见性
    {
        name: 'addUnlistedAndPrivate', type: 'switch', tabs: ['general'], group: 'visibility',
        onSet: (target, e) => { const checked = (e.target as HTMLInputElement).checked; target.addUnlistedAndPrivate = checked; if (checked) target.filterUnlistedAndPrivate = false }
    },
    {
        name: 'filterUnlistedAndPrivate', type: 'switch', tabs: ['general'], group: 'visibility',
        onSet: (target, e) => { const checked = (e.target as HTMLInputElement).checked; target.filterUnlistedAndPrivate = checked; if (checked) target.addUnlistedAndPrivate = false }
    },
    // 常规页：界面
    { name: 'autoCollapseMenu', type: 'switch', tabs: ['general'], group: 'interface' },
    { name: 'enableWidescreen', type: 'switch', tabs: ['general'], group: 'interface' },
    { name: 'enableBeautify', type: 'switch', tabs: ['general'], group: 'interface' },
    // 高级页（实验性 / 风险 / 调试）
    { name: 'experimentalFeatures', type: 'switch', tabs: ['advanced'], rerender: true },
    { name: 'enableUnsafeMode', type: 'switch', tabs: ['advanced'] },
    {
        name: 'isDebug', type: 'switch', tabs: ['advanced'], defaultValue: false,
        get: (name, defaultValue) => GM_getValue(name, defaultValue),
        onSet: (target, e) => { GM_setValue('isDebug', (e.target as HTMLInputElement).checked); unsafeWindow.location.reload() }
    },
    // 下载页（下载画质在前，下载位置在后）
    { name: 'downloadPriority', type: 'text', tabs: ['download'], group: 'download', visible: (target) => target.checkPriority },
    { name: 'downloadPath', type: 'text', tabs: ['download'], group: 'download', help: { text: '%#variable#%', href: 'https://github.com/IwaraEnhance/IwaraDownloadTool/wiki/路径可用变量' } },
    { name: 'pathNormalize', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathReplaceEmojis', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathFoldMarks', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathSanitize', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathTruncate', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathTitleMaxLength', type: 'number', tabs: ['download'], group: 'pathNormalize', dependsOn: 'pathTruncate' },
    { name: 'pathAliasMaxLength', type: 'number', tabs: ['download'], group: 'pathNormalize', dependsOn: 'pathTruncate' },
    // Aria2 页（标签页本身已按 downloadType 显隐）
    { name: 'aria2Path', type: 'text', tabs: ['aria2'], group: 'aria2' },
    { name: 'aria2Token', type: 'password', tabs: ['aria2'], group: 'aria2' },
    // 代理（Aria2 / iwaradl 页共用）
    { name: 'downloadProxy', type: 'text', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    { name: 'downloadProxyUsername', type: 'text', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    { name: 'downloadProxyPassword', type: 'password', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    // MediaCenter 页（标签页已含 downloadType + experimentalFeatures 条件）
    { name: 'mediaCenterApi', type: 'text', tabs: ['mediaCenter'], group: 'mediaCenter', help: { text: '%#mediaCenterInfo#%', href: 'https://github.com/dawn-lc/MediaCenter' } },
    { name: 'mediaCenterApiKey', type: 'password', tabs: ['mediaCenter'], group: 'mediaCenter' },
    // iwaradl 页
    { name: 'iwaradlPath', type: 'text', tabs: ['iwaradl'], group: 'iwaradl', help: { text: '%#iwaradlLink#%', href: 'https://github.com/Izumiko/iwaradl' } },
    { name: 'iwaradlToken', type: 'password', tabs: ['iwaradl'], group: 'iwaradl' },
]

export class configEdit {
    target: Config
    interface: HTMLDivElement;
    tabButtons: HTMLDivElement;
    tabPanels: HTMLDivElement;
    activeTab = 'general';
    constructor(config: Config) {
        this.target = config
        this.target.configChange = (item: string) => { this.configChange.call(this, item) }
        this.tabButtons = renderNode({
            nodeType: 'div',
            className: 'tabs'
        })
        this.tabPanels = renderNode({
            nodeType: 'div',
            className: 'tabPanels',
            childs: TABS.map(tab => ({
                nodeType: 'div',
                className: 'tabPanel',
                attributes: {
                    'data-tab': tab.id
                }
            }))
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
                        this.tabButtons,
                        this.tabPanels
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
    /** 按 schema 渲染单个配置项（switch 用开关，其余用输入框，带 help/dependsOn） */
    private renderField(field: ConfigField): Element {
        if (field.type === 'switch') {
            return this.switchButton(field.name, field.get, field.onSet ? (name, e) => field.onSet!(this.target, e) : undefined, field.defaultValue)
        }
        const help = field.help ? renderNode({
            nodeType: 'a',
            childs: field.help.text,
            className: 'rainbow-text',
            attributes: { style: 'float: inline-end;', href: field.help.href }
        }) : undefined
        return this.inputComponent(field.name, field.type, help, undefined, undefined, field.dependsOn)
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
    private inputComponent(name: string, type?: InputType, help?: HTMLElement, get?: (name: string) => void, set?: (name: string, e: Event) => void, dependsOn?: string) {
        return renderNode({
            nodeType: 'label',
            className: 'fieldLine',
            // dependsOn：声明本输入框由哪个开关控制显隐（关闭开关时隐藏，开启时显示）
            attributes: dependsOn ? { 'data-depends-on': dependsOn } : undefined,
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
                                const input = e.target as HTMLInputElement
                                this.target[name] = input.type === 'number' ? Number(input.value) : input.value
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
            className: 'downloadType',
            childs: [
                {
                    nodeType: 'div',
                    className: 'fieldTitle',
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
    /** 根据依赖开关的当前状态，控制带 data-depends-on 的输入框显隐（关闭开关则隐藏其依赖输入框） */
    private updateVisibility() {
        this.interface.querySelectorAll<HTMLElement>('[data-depends-on]').forEach(element => {
            const dependsOn = element.dataset.dependsOn
            if (dependsOn) element.style.display = this.target[dependsOn] ? '' : 'none'
        })
    }
    private configChange(item: string) {
        if (item === 'downloadType') {
            // 下载方式：同步 radio 选中态，重建标签页（不自动跳转，停留在当前页）
            this.interface.querySelectorAll<HTMLInputElement>('[name=downloadType]').forEach(radio => {
                radio.checked = Number(radio.value) === Number(this.target.downloadType)
            })
            this.renderAllTabs()
            return
        }
        // 影响布局的字段（其 visible 条件变化）→ 重建标签页
        if (CONFIG_FIELDS.find(field => field.name === item)?.rerender) {
            this.renderAllTabs()
            return
        }
        // 普通字段：同步 DOM 值（覆盖互斥联动、跨页远程同步等非事件路径）
        const element = this.interface.querySelector<HTMLInputElement>(`[name=${item}]`)
        if (element) {
            if (element.type === 'checkbox') element.checked = this.target[item]
            else element.value = this.target[item]
        }
        // 刷新依赖显隐（开关切换即时控制其依赖输入框的显示/隐藏）
        this.updateVisibility()
    }
    /** 切换标签页：仅切换显示与激活态，不重建内容（避免丢失输入焦点） */
    private tabChange(tab: string) {
        this.activeTab = tab
        this.tabButtons.querySelectorAll<HTMLButtonElement>('button.tab').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tab)
        })
        this.tabPanels.querySelectorAll<HTMLElement>('.tabPanel').forEach(panel => {
            panel.style.display = panel.dataset.tab === tab ? '' : 'none'
        })
        this.updateVisibility()
    }
    /** 重建标签栏与所有可见页内容（下载方式 / rerender 变化时调用） */
    private renderAllTabs() {
        // 当前激活页若已不再可见（如切换下载方式后下载器页消失），回退到常规页，避免所有面板都隐藏
        if (!TABS.find(tab => tab.id === this.activeTab && tab.visible(this.target))) {
            this.activeTab = 'general'
        }
        // 标签栏：按条件显隐 + 激活态
        while (this.tabButtons.hasChildNodes()) {
            this.tabButtons.removeChild(this.tabButtons.firstChild!)
        }
        for (const tab of TABS) {
            if (!tab.visible(this.target)) continue
            originalNodeAppendChild.call(this.tabButtons, renderNode({
                nodeType: 'button',
                className: this.activeTab === tab.id ? ['tab', 'active'] : 'tab',
                attributes: {
                    'data-tab': tab.id,
                    type: 'button'
                },
                childs: `%#${tab.id}Tab#%`,
                events: {
                    click: () => { this.tabChange(tab.id) }
                }
            }))
        }
        // 各页内容：按 tab 过滤 schema，再按 group 渲染为 fieldset（无 group 则平铺）
        for (const tab of TABS) {
            const panel = this.tabPanels.querySelector(`.tabPanel[data-tab=${tab.id}]`) as HTMLElement
            while (panel.hasChildNodes()) {
                panel.removeChild(panel.firstChild!)
            }
            if (!tab.visible(this.target)) {
                panel.style.display = 'none'
                continue
            }
            if (tab.id === 'general') {
                originalNodeAppendChild.call(panel, renderNode({
                    nodeType: 'label',
                    className: 'languageLine',
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
                }))
                originalNodeAppendChild.call(panel, this.downloadTypeSelect())
            }
            const groups = new Map<string, ConfigField[]>()
            for (const field of CONFIG_FIELDS) {
                if (!field.tabs.includes(tab.id)) continue
                if (field.visible && !field.visible(this.target)) continue
                const key = field.group ?? '__flat__'
                const list = groups.get(key) ?? []
                list.push(field)
                groups.set(key, list)
            }
            for (const [group, fields] of groups) {
                if (group === '__flat__') {
                    fields.forEach(field => originalNodeAppendChild.call(panel, this.renderField(field)))
                } else {
                    originalNodeAppendChild.call(panel, renderNode({
                        nodeType: 'fieldset',
                        childs: [
                            {
                                nodeType: 'div',
                                className: 'fieldTitle',
                                childs: `%#${group}Group#%`
                            },
                            ...fields.map(field => this.renderField(field))
                        ]
                    }))
                }
            }
            panel.style.display = this.activeTab === tab.id ? '' : 'none'
        }
        // 动态渲染完成后应用初始显隐（依据当前开关状态）
        this.updateVisibility()
    }
    public inject() {
        if (!unsafeWindow.document.querySelector('#pluginConfig')) {
            originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
            this.renderAllTabs()
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