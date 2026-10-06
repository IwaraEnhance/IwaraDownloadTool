/**
 * 插件菜单（纯渲染壳：所有业务动作均经 setup 注入，不 import 任何 feature/network）。
 */
import { config } from '../core/config'
import { PageType } from '../core/enum'
import { isNullOrUndefined } from '../core/env'
import { renderNode } from '../core/extension'
import { originalNodeAppendChild, originalAddEventListener } from '../core/hijack'
import { createLogger } from '../core/log'
import { getPageType } from '../core/browserEnv'

const log = createLogger('Menu')

/** 菜单业务动作（main 组装期经 setup 注入） */
export interface MenuActions {
    /** 手动下载弹窗 */
    manualDownload: () => void
    /** 导出配置（返回剪贴板载荷） */
    exportConfig: () => void
    /** 导入配置（打开文件选择） */
    importConfig: () => void
    /** 下载当前页视频 */
    downloadThis: () => void
    /** VideoList 页条件触发的订阅页遍历（含 addUnlistedAndPrivate 判定） */
    parseUnlistedAndPrivate: () => void
}

/** 选择域提供者（checkbox 注入/清除 + 选择操作按钮 + 批量动作注册表按钮） */
export interface MenuProviders {
    /** 注入/移除勾选框按钮回调 */
    toggleInjectCheckbox: () => void
    /** 选择操作按钮（由 features/selection 定义，menu 仅渲染） */
    selectionButtons: { id: string; click: () => void }[]
    /** 批量动作注册表按钮（由 registerBatchAction 注册，menu 仅渲染） */
    actionButtons: { id: string; labelKey: string; click: () => void }[]
}

export class menu {
    [key: string | symbol]: any
    observer!: MutationObserver
    pageType!: PageType
    interface!: HTMLDivElement
    interfacePage!: HTMLUListElement
    isTouchDevice!: boolean
    /** 打开配置面板（构造期注入的回调） */
    private openSettings?: () => void
    private actions: Partial<MenuActions> = {}
    private providers: Partial<MenuProviders> = {}

    constructor(actions?: { openSettings?: () => void }) {
        this.openSettings = actions?.openSettings
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
        body.isTouchDevice = unsafeWindow.matchMedia('(pointer: coarse)').matches || (unsafeWindow.navigator.maxTouchPoints ?? 0) > 0

        if (config.autoCollapseMenu) {
            if (body.isTouchDevice) {
                // 移动端：点击菜单容器切换展开/收起
                originalAddEventListener.call(body.interface, 'click', (event: Event) => {
                    // 只响应直接点击菜单容器（非子元素冒泡）
                    if (event.target === body.interface) {
                        body.interface.classList.toggle('expanded')
                    }
                })

                // 移动端：点击菜单外部区域时收起菜单
                originalAddEventListener.call(unsafeWindow.document, 'click', (event: Event) => {
                    if (body.interface.classList.contains('expanded') && !body.interface.contains(event.target as Node)) {
                        body.interface.classList.remove('expanded')
                    }
                })
            } else {
                // 桌面端：保持原有的 hover 行为
                let mouseoutTimer: number | null = null

                originalAddEventListener.call(body.interface, 'mouseover', (event: Event) => {
                    if (mouseoutTimer !== null) {
                        clearTimeout(mouseoutTimer)
                        mouseoutTimer = null
                    }
                    body.interface.classList.add('expanded')
                })

                originalAddEventListener.call(body.interface, 'mouseout', (event: Event) => {
                    const e = event as MouseEvent
                    const relatedTarget = e.relatedTarget as Node

                    if (relatedTarget && body.interface.contains(relatedTarget)) {
                        return
                    }

                    mouseoutTimer = setTimeout(() => {
                        body.interface.classList.remove('expanded')
                        mouseoutTimer = null
                    }, 300)
                })

                originalAddEventListener.call(body.interface, 'click', (event: Event) => {
                    if (event.target === body.interface) {
                        body.interface.classList.toggle('expanded')
                    }
                })
            }
        } else {
            // 禁用自动收起：菜单始终保持展开
            body.interface.classList.add('expanded')
        }

        body.observer = new MutationObserver(() => (body.pageType = getPageType()))
        body.pageType = PageType.Page
        return body
    }

    /** 注入业务动作与选择域提供者（main 组装期调用，晚于构造早于首帧渲染） */
    public setup(actions: MenuActions, providers: MenuProviders): void {
        this.actions = actions
        this.providers = providers
    }
    private button(name: string, click?: (name: string, e: Event) => void) {
        const self = this
        return renderNode({
            nodeType: 'li',
            childs: `%#${name}#%`,
            events: {
                click: (event: Event) => {
                    if (!isNullOrUndefined(click)) click(name, event)
                    // 移动端：点击菜单项后自动收起菜单
                    if (self.isTouchDevice && config.autoCollapseMenu) {
                        setTimeout(() => self.interface.classList.remove('expanded'), 150)
                    }
                    event.stopPropagation()
                    return false
                }
            }
        })
    }

    /** 将所有按钮追加到菜单（移动已挂载的节点） */
    private appendAll(items: (Element | Node)[]) {
        items.forEach((i) => originalNodeAppendChild.call(this.interfacePage, i))
    }

    public async pageChange() {
        while (this.interfacePage.hasChildNodes()) {
            this.interfacePage.removeChild(this.interfacePage.firstChild!)
        }
        const baseButtons = [
            this.button('manualDownload', () => this.actions.manualDownload?.()),
            this.button('exportConfig', () => this.actions.exportConfig?.()),
            this.button('importConfig', () => this.actions.importConfig?.()),
            this.button('settings', () => this.openSettings?.())
        ]

        let injectCheckboxButton = this.button('injectCheckbox', () => this.providers.toggleInjectCheckbox?.())

        // 选择操作与批量动作均经提供者/注册表渲染
        const selectionButtons = (this.providers.selectionButtons ?? []).map((s) => this.button(s.id, () => s.click()))
        const actionButtons = (this.providers.actionButtons ?? []).map((a) => this.button(a.labelKey ?? a.id, () => a.click()))

        let selectButtons = [injectCheckboxButton, ...selectionButtons, ...actionButtons]

        let downloadThisButton = this.button('downloadThis', () => this.actions.downloadThis?.())

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
                break
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
                break
        }

        if (config.addUnlistedAndPrivate && !config.filterUnlistedAndPrivate && this.pageType === PageType.VideoList) {
            this.actions.parseUnlistedAndPrivate?.()
        } else {
            log.debug('Conditions not met: addUnlistedAndPrivate or pageType mismatch.')
        }
    }
    public inject() {
        try {
            this.observer.observe(unsafeWindow.document.getElementById('app')!, { childList: true, subtree: true })
            if (!unsafeWindow.document.querySelector('#pluginMenu')) {
                originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
                this.pageType = getPageType()
            }
        } catch (error) {
            originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
        }
    }
}
