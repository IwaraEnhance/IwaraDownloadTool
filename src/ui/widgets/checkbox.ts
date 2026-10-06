/**
 * 勾选框视图组件（卡片级勾选 + DB 状态标记）。
 *
 * playlist 删除按钮的
 * API 调用与所有者判定经构造参数注入（togglePlaylistDelete 回调），本模块不再
 * import network 层（ui 层仅依赖 core + context）。
 */
import { config } from '../../core/config'
import { db } from '../../core/db'
import { PageType, ToastType } from '../../core/enum'
import { isNullOrUndefined } from '../../core/env'
import { renderNode } from '../../core/extension'
import { newToast } from '../notify'
import { originalNodeAppendChild } from '../../core/hijack'
import { getPageType } from '../../core/browserEnv'
import { selectList, pageSelectButtons } from '../../context/selection'
import { currentPlaylistId } from '../../context/pageContext'

/** playlist 删除按钮回调（main 组装期注入：所有者判定 + API 调用在 network/客户端） */
export interface CheckboxCallbacks {
    /** 判定当前用户能否删除该播放列表的视频（所有者判定，含缓存） */
    canDeletePlaylistItem: (playlistId: string) => Promise<boolean>
    /** 执行删除（DELETE /playlist/:id/:vid）；成功 true */
    deletePlaylistItem: (playlistId: string, videoId: string) => Promise<boolean>
}

let callbacks: CheckboxCallbacks | undefined
/** 由 main 组装根注入（依赖倒置：ui 不 import network） */
export function setCheckboxCallbacks(cb: CheckboxCallbacks): void {
    callbacks = cb
}

export function uninjectCheckbox(element: Element | Node) {
    if (element instanceof HTMLElement) {
        if (element instanceof HTMLInputElement && element.classList.contains('selectButton')) {
            element.hasAttribute('videoID') && pageSelectButtons.delete(element.getAttribute('videoID')!)
        }
        if (element.querySelector('input.selectButton')) {
            element.querySelectorAll('.selectButton').forEach((i) => i.hasAttribute('videoID') && pageSelectButtons.delete(i.getAttribute('videoID')!))
        }
    }
}
export async function injectCheckbox(element: Element) {
    const thumbnail = element.querySelector('a.videoTeaser__thumbnail') as HTMLLinkElement | null
    if (isNullOrUndefined(thumbnail)) return
    // ⚠️ 这里是卡片自身的视频 ID（每张卡片不同），从缩略图链接解析；不能用 currentVideoId()（那是"当前页面 URL"的资源 ID）
    let ID = thumbnail.href.toURL().pathname.split('/')[2]
    if (isNullOrUndefined(ID)) return
    let info = await db.getVideoById(ID)
    const hasFullInfo = info?.Type === 'full' || info?.Type === 'partial'
    const authorLink = element.querySelector('a.username') as HTMLLinkElement | null
    let Title = hasFullInfo ? info?.Title : (info?.RAW?.title ?? element.querySelector('.videoTeaser__title')?.getAttribute('title') ?? undefined)
    let Alias = hasFullInfo ? info?.Alias : (info?.RAW?.user.name ?? authorLink?.getAttribute('title') ?? undefined)
    let Author = hasFullInfo ? info?.Author : (info?.RAW?.user.username ?? authorLink?.href.toURL().pathname.split('/').pop())
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
                ; (event.target as HTMLInputElement).checked
                    ? selectList.set(ID, {
                        Type: 'init',
                        ID,
                        Title,
                        Alias,
                        Author,
                        UploadTime
                    })
                    : selectList.delete(ID)
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
            originalNodeAppendChild.call(
                thumbnail,
                renderNode({
                    nodeType: 'div',
                    className: 'follow',
                    childs: {
                        nodeType: 'div',
                        className: ['text', 'text--white', 'text--tiny', 'text--bold'],
                        childs: '%#following#%'
                    }
                })
            )
        }
    }

    // 检查 MediaCenter 映射，显示是否已下载（仅在配置了 MediaCenter 时启用）
    if (!config.mediaCenterApi.isEmpty() && !config.mediaCenterApiKey.isEmpty()) {
        const mediaCenterId = await db.getMediaCenterIdMap(ID)
        if (!isNullOrUndefined(mediaCenterId) && !mediaCenterId.isEmpty() && thumbnail.querySelector('.downloaded') === null) {
            originalNodeAppendChild.call(
                thumbnail,
                renderNode({
                    nodeType: 'div',
                    className: 'downloaded',
                    childs: {
                        nodeType: 'div',
                        className: ['text', 'text--white', 'text--tiny', 'text--bold'],
                        childs: '%#downloaded#%'
                    }
                })
            )
        }
    }

    if (getPageType() === PageType.Playlist && callbacks) {
        // 仅在当前用户是该播放列表的所有者时才显示删除按钮（判定经注入回调）
        const playlistId = currentPlaylistId()
        if (playlistId && (await callbacks.canDeletePlaylistItem(playlistId))) {
            let deletePlaylistItme = renderNode({
                nodeType: 'button',
                attributes: {
                    videoID: ID
                },
                childs: '%#delete#%',
                className: 'deleteButton',
                events: {
                    click: async (event: Event) => {
                        if (await callbacks!.deletePlaylistItem(playlistId, ID)) {
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
