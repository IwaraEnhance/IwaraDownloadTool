import './core/mutex'
import site from './data/site.json'
import rainbowCSS from './css/rainbow.css'
import menuCSS from './css/menu.css'
import configCSS from './css/config.css'
import overlayCSS from './css/overlay.css'
import videoCardCSS from './css/videoCard.css'
import toastCSS from './css/toast.css'
import beautifyCSS from './css/beautify.css'
import widescreenCSS from './css/widescreen.css'
import { isNullOrUndefined, stringify } from './core/env'
import { createLogger } from './core/log'
import { i18nList } from './i18n'
import { config, Config } from './core/config'
import { originalAddEventListener, originalNodeAppendChild, originalHistoryPushState, originalElementRemove, originalNodeRemoveChild, originalHistoryReplaceState, originalStorageSetItem, originalStorageRemoveItem, originalStorageClear } from './core/hijack'
import { Dictionary } from './core/dictionary'
import { GMSyncDictionary } from './core/gmSyncDictionary'
import { Version } from './core/version'
import { db } from './core/db'
import { runMigrations } from './core/migration'
import { GM_KEY_IS_DEBUG, GM_KEY_IS_FIRST_RUN, GM_KEY_SELECT_LIST, GM_KEY_VERSION, LS_KEY_RATING, LS_KEY_TOKEN } from './core/constants'
import { findElement, renderNode, unlimitedFetch } from './core/extension'
import { check } from './network/envCheck'
import { getAuth, verifyLogin } from './network/auth'
import { newToast, toastNode } from './ui/notify'
import { syncAllVideosPages } from './network/syncPages'
import { syncCachedToMediaCenter } from './network/mediaCenter'
import { trackExistingAria2Tasks } from './download/aria2TrackManager'
import { configEdit, injectCheckbox, menu, uninjectCheckbox, waterMark } from './ui/ui'
import { PageType, ToastType } from './core/enum'
import { getPageTypeFromPath } from './core/pageType'
import { createInterceptedFetch } from './network/fetchInterceptor'

const log = createLogger('Main')
const hostname = unsafeWindow.location.hostname
// 从支持域名中匹配注册域名（无需 tldts：对固定域名直接用 hostname 相等/后缀匹配）
export var domain = site.supportedDomains.find((d) => hostname === d || hostname.endsWith('.' + d)) ?? ''
if (!domain) {
    throw 'Not target'
}

switch (GM_info.scriptHandler) {
    case 'Tampermonkey':
    case 'ScriptCat':
        break
    case 'Via':
        // Via 内置油猴引擎不支持 GM_getTabs/GM_saveTab，且跨页 GM_addValueChangeListener 不可靠，
        // 会导致跨页同步（selectList/配置/GMLock）静默失效，因此封杀
        throw `Not support ${GM_info.scriptHandler} (内置油猴引擎不完整，跨页同步不可用)`
    default:
        throw `Not support ${GM_info.scriptHandler}`
}

if (GM_getValue(GM_KEY_IS_DEBUG)) {
    debugger
    log.debug(stringify(GM_info))
    // @ts-ignore
    unsafeWindow.syncCachedToMediaCenter = syncCachedToMediaCenter
    // @ts-ignore
    unsafeWindow.syncAllVideosPages = syncAllVideosPages
    // @ts-ignore
    unsafeWindow.exportAllToJsonFiles = db.exportAllToJsonFiles.bind(db)
    // @ts-ignore
    unsafeWindow.exportToJsonFiles = db.exportToJsonFiles.bind(db)
    // @ts-ignore
    // 测试首次安装引导弹窗（注意：会清空所有配置并重新显示引导）
    unsafeWindow.testFirstRun = firstRun
    // @ts-ignore
    // 测试引导弹窗（不清空配置，确认后打开配置面板）
    unsafeWindow.testGuideOverlay = showGuideOverlay
    // @ts-ignore
    unsafeWindow.debugGMFetch = unlimitedFetch
}

unsafeWindow.fetch = createInterceptedFetch()

export var apiEndpoint = site.apiEndpoint
export var rating = () => localStorage.getItem(LS_KEY_RATING) ?? 'all'

export var selectList = new GMSyncDictionary<VideoInfo>(GM_KEY_SELECT_LIST)
export var pageSelectButtons = new Dictionary<HTMLInputElement>()
export var mouseTarget: Element | null = null
export var pluginMenu = new menu()
export var editConfig = new configEdit(config)
export var watermark = new waterMark()

selectList.onSet = (key) => {
    updateButtonState(key)
    updateSelected()
}
selectList.onDel = (key) => {
    updateButtonState(key)
    updateSelected()
}
selectList.onSync = () => {
    pageSelectButtons.forEach((value, key) => {
        updateButtonState(key)
    })
    updateSelected()
}

export function getSelectButton(id: string): HTMLInputElement | undefined {
    return pageSelectButtons.has(id) ? pageSelectButtons.get(id) : (unsafeWindow.document.querySelector(`input.selectButton[videoid="${id}"]`) as HTMLInputElement | undefined)
}
export function getPageType(): PageType {
    // URL 路由来源：browserHistory 走 pathname；hashHistory 走 hash（#/path 或 #!/path）。
    // location.pathname 已是浏览器标准 URL 解析结果（不含 query/hash）；hash 需去掉 '#'/'!' 与 query 串。
    const hashPath = unsafeWindow.location.hash.trimHead('#').trimHead('!').split('?')[0]
    return getPageTypeFromPath(hashPath || unsafeWindow.location.pathname)
}
export function pageChange() {
    pluginMenu.pageType = getPageType()
    log.debug(pageSelectButtons)
}

function updateSelected() {
    watermark.selected.textContent = ` ${i18nList[config.language].selected} ${selectList.size} `
}

function updateButtonState(videoID: string) {
    const selectButton = getSelectButton(videoID)
    if (selectButton) selectButton.checked = selectList.has(videoID)
}

function hijackAddEventListener() {
    unsafeWindow.EventTarget.prototype.addEventListener = function (type, listener, options) {
        originalAddEventListener.call(this, type, listener, options)
    }
}
function hijackNodeAppendChild() {
    Node.prototype.appendChild = function <T extends Node>(node: T): T {
        if (node instanceof HTMLElement && node.classList.contains('videoTeaser')) {
            injectCheckbox(node)
        }
        return originalNodeAppendChild.call(this, node) as T
    }
}
function hijackNodeRemoveChild() {
    Node.prototype.removeChild = function <T extends Node>(child: T): T {
        uninjectCheckbox(child)
        return originalNodeRemoveChild.apply(this, [child]) as T
    }
}
function hijackElementRemove() {
    Element.prototype.remove = function () {
        uninjectCheckbox(this)
        return originalElementRemove.apply(this)
    }
}
function hijackHistoryPushState() {
    unsafeWindow.history.pushState = function (...args) {
        originalHistoryPushState.apply(this, args)
        pageChange()
    }
}
function hijackHistoryReplaceState() {
    unsafeWindow.history.replaceState = function (...args) {
        originalHistoryReplaceState.apply(this, args)
        pageChange()
    }
}
function hijackStorage() {
    unsafeWindow.Storage.prototype.setItem = function (key, value) {
        originalStorageSetItem.call(this, key, value)
        if (key === LS_KEY_TOKEN) pluginMenu.pageChange()
    }
    unsafeWindow.Storage.prototype.removeItem = function (key) {
        originalStorageRemoveItem.call(this, key)
        if (key === LS_KEY_TOKEN) pluginMenu.pageChange()
    }
    unsafeWindow.Storage.prototype.clear = function () {
        originalStorageClear.call(this)
        pluginMenu.pageChange()
    }
}
/** 渲染首次安装引导弹窗（不清空配置）。
 * 点击"确定"后：若提供 confirm 回调则调用（首次安装写入标记），否则移除弹窗并打开配置面板（测试用）。 */
function showGuideOverlay(confirm?: () => void) {
    let confirmButton = renderNode({
        nodeType: 'button',
        attributes: {
            disabled: true,
            title: i18nList[config.language].ok
        },
        childs: '%#ok#%',
        events: {
            click: () => {
                unsafeWindow.document.querySelector('#pluginOverlay')?.remove()
                if (confirm) {
                    confirm()
                } else {
                    editConfig.inject()
                }
            }
        }
    })
    originalNodeAppendChild.call(
        unsafeWindow.document.body,
        renderNode({
            nodeType: 'div',
            attributes: {
                id: 'pluginOverlay'
            },
            childs: [
                {
                    nodeType: 'div',
                    className: 'main',
                    childs: [
                        { nodeType: 'p', childs: i18nList[config.language].useHelpForBase },
                        { nodeType: 'p', childs: '%#useHelpForInjectCheckbox#%' },
                        { nodeType: 'p', childs: '%#useHelpForCheckDownloadLink#%' },
                        { nodeType: 'p', childs: i18nList[config.language].useHelpForManualDownload },
                        { nodeType: 'p', childs: i18nList[config.language].useHelpForBugreport }
                    ]
                },
                {
                    nodeType: 'div',
                    className: 'checkbox-container',
                    childs: {
                        nodeType: 'label',
                        className: ['checkbox-label', 'rainbow-text'],
                        childs: [
                            {
                                nodeType: 'input',
                                className: 'checkbox',
                                attributes: {
                                    type: 'checkbox',
                                    name: 'agree-checkbox'
                                },
                                events: {
                                    change: (event: Event) => {
                                        confirmButton.disabled = !(event.target as HTMLInputElement).checked
                                    }
                                }
                            },
                            '%#alreadyKnowHowToUse#%'
                        ]
                    }
                },
                confirmButton
            ]
        })
    )
}

function firstRun() {
    GM_listValues().forEach((i) => GM_deleteValue(i))
    Config.destroyInstance()
    editConfig = new configEdit(config)
    showGuideOverlay(() => {
        GM_setValue(GM_KEY_IS_FIRST_RUN, false)
        GM_setValue(GM_KEY_VERSION, GM_info.script.version)
        editConfig.inject()
    })
}
async function main() {
    ;[rainbowCSS, menuCSS, configCSS, overlayCSS, videoCardCSS, toastCSS].forEach((css) => GM_addStyle(css))

    // 升级迁移：旧版本数据不兼容时执行清理
    const migration = await runMigrations({ selectList })
    if (migration === 'failed') return // 迁移失败：中止启动，版本号未更新，下次启动自动重试
    if (migration === 'reload') {
        // 迁移完成：重载进入正常流程
        unsafeWindow.location.reload()
        return
    }

    // 首次安装引导（3.3.0 之前的旧版本由迁移置 isFirstRun=true 触发）
    if (GM_getValue(GM_KEY_IS_FIRST_RUN, true)) {
        firstRun()
        return
    }

    GM_setValue(GM_KEY_VERSION, GM_info.script.version)
    watermark.inject()

    config.enableBeautify && GM_addStyle(beautifyCSS)
    config.enableWidescreen && GM_addStyle(widescreenCSS)
    if (!(await check())) {
        newToast(ToastType.Info, {
            text: `%#configError#%`,
            duration: 60 * 1000
        }).show()
        editConfig.inject()
        return
    }

    hijackAddEventListener()
    if (config.autoInjectCheckbox) hijackNodeAppendChild()
    hijackNodeRemoveChild()
    hijackElementRemove()
    hijackStorage()
    hijackHistoryPushState()
    hijackHistoryReplaceState()
    originalAddEventListener('mouseover', (event: Event) => {
        mouseTarget = (event as MouseEvent).target instanceof Element ? ((event as MouseEvent).target as Element) : null
    })
    originalAddEventListener('keydown', (event: Event) => {
        const keyboardEvent = event as KeyboardEvent
        if (keyboardEvent.code === 'Space' && !isNullOrUndefined(mouseTarget)) {
            let element = findElement(mouseTarget, '.videoTeaser')
            let button = element && (element.matches('.selectButton') ? element : element.querySelector('.selectButton'))
            button && (button as HTMLInputElement).click()
            button && keyboardEvent.preventDefault()
        }
    })
    new MutationObserver(async (m, o) => {
        if (m.some((m) => m.type === 'childList' && unsafeWindow.document.getElementById('app'))) {
            pluginMenu.inject()
            o.disconnect()
        }
    }).observe(unsafeWindow.document.body, { childList: true, subtree: true })

    if (await verifyLogin(true)) {
        try {
            let localUserRes = await unlimitedFetch(`https://${apiEndpoint}/user`, {
                method: 'GET',
                headers: await getAuth()
            })
            let authorProfileRes = await unlimitedFetch(`https://${apiEndpoint}/profile/dawn`, {
                method: 'GET',
                headers: await getAuth()
            })
            if (!localUserRes.ok || !authorProfileRes.ok) {
                log.warn('登录态验证请求失败:', localUserRes.status, authorProfileRes.status)
            } else {
                let localUser = ((await localUserRes.json()) as Iwara.LocalUser).user
                let authorProfile = ((await authorProfileRes.json()) as Iwara.Profile).user
                if (localUser.id !== authorProfile.id) {
                    if (!authorProfile.following) {
                        unlimitedFetch(`https://${apiEndpoint}/user/${authorProfile.id}/followers`, {
                            method: 'POST',
                            headers: await getAuth()
                        })
                    }
                    if (!authorProfile.friend) {
                        unlimitedFetch(`https://${apiEndpoint}/user/${authorProfile.id}/friends`, {
                            method: 'POST',
                            headers: await getAuth()
                        })
                    }
                }
            }
        } catch (error) {
            log.warn('验证登录态时出错:', error)
        }
    }
    newToast(ToastType.Info, {
        node: toastNode(i18nList[config.language].notice),
        duration: 10000,
        gravity: 'bottom',
        position: 'center',
        onClick() {
            this.hide()
        }
    }).show()

    // 启动时接管现有 Aria2 任务的追踪（不阻塞启动流程）
    trackExistingAria2Tasks()
}
; (unsafeWindow.document.body ? Promise.resolve() : new Promise((resolve) => originalAddEventListener.call(unsafeWindow.document, 'DOMContentLoaded', resolve))).then(main)
