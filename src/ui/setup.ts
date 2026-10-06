/**
 * UI 组装器（menu/widgets 的业务接线集中在此；组件自身不 import features/network）。
 *
 * 组装者角色：把 features 的动作实现与 ui 的纯渲染接口接起来——menu/widgets
 * 自身零 feature/network 依赖，业务接线集中在此唯一文件（含 network 客户端
 * 调用，因为接线本身允许触达全部层，等同于 main 的延伸）。
 * 由 main 组装根调用：setupMenuActions(pluginMenu) + installCheckboxCallbacks()。
 */
import { ToastType } from '../core/enum'
import { isNullOrUndefined, stringify } from '../core/env'
import { config } from '../core/config'
import { i18nList } from '../i18n'
import { currentVideoId } from '../context/pageContext'
import { pushDownloadTask, addDownloadTask } from '../features/downloadFlow'
import { deselectAll, selectAll, toggleSelect, getBatchActions } from '../features/selection'
import { parseUnlistedAndPrivate } from '../features/pageSync'
import { importConfig } from './configUi'
import { isLocalUser } from '../network/users'
import { getPlaylistOwnerId, removePlaylistVideo } from '../network/playlists'
import { newToast, toastNode } from './notify'
import { setCheckboxCallbacks, injectCheckbox } from './widgets/checkbox'
import type { CheckboxCallbacks } from './widgets/checkbox'
import type { menu } from './menu'

/** 组装 checkbox 的 playlist 删除回调（ui/widgets 不 import network） */
export function installCheckboxCallbacks(): void {
    const callbacks: CheckboxCallbacks = {
        canDeletePlaylistItem: async (playlistId) => isLocalUser(await getPlaylistOwnerId(playlistId)),
        deletePlaylistItem: (playlistId, videoId) => removePlaylistVideo(playlistId, videoId)
    }
    setCheckboxCallbacks(callbacks)
}

/** 组装 menu 的业务动作与选择域提供者 */
export function setupMenuActions(instance: menu): void {
    instance.setup(
        {
            manualDownload: () => addDownloadTask(),
            exportConfig: () => {
                GM_setClipboard(stringify(config))
                newToast(ToastType.Info, {
                    node: toastNode(i18nList[config.language].exportConfigSucceed),
                    duration: 3000,
                    gravity: 'bottom',
                    position: 'center',
                    onClick() {
                        this.hide()
                    }
                }).show()
            },
            importConfig: () => importConfig(),
            downloadThis: () => {
                const ID = currentVideoId()
                // 直接传 init：由 pushDownloadTask 顶层同 ID 锁防连点重复推送（解析也一并纳入锁内）
                if (!isNullOrUndefined(ID)) void pushDownloadTask({ Type: 'init', ID })
            },
            parseUnlistedAndPrivate: () => {
                void parseUnlistedAndPrivate()
            }
        },
        {
            toggleInjectCheckbox: () => {
                if (unsafeWindow.document.querySelector('.selectButton')) {
                    unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
                        element.remove()
                    })
                } else {
                    unsafeWindow.document.querySelectorAll('.videoTeaser').forEach((element: Element) => {
                        injectCheckbox(element)
                    })
                }
            },
            selectionButtons: [
                { id: 'deselectAll', click: () => deselectAll() },
                { id: 'reverseSelect', click: () => toggleSelect() },
                { id: 'selectThis', click: () => selectAll(true) },
                { id: 'deselectThis', click: () => selectAll(false) }
            ],
            actionButtons: getBatchActions().map((action) => ({
                id: action.id,
                labelKey: action.labelKey ?? action.id,
                click: () => {
                    // 不弹确认 toast：批量动作自带常驻进度提示（原版行为），再弹确认是冗余回声
                    void action.run()
                }
            }))
        }
    )
}
