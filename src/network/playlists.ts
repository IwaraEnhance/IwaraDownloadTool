/**
 * 播放列表资源 API 客户端（纯 HTTP，无 toast/DOM/编排）。
 * getPlaylistOwnerId 带 Promise 缓存（同列表重复请求）。
 */
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { getAuth } from './auth'
import { apiUrl } from '../context/site'

const log = createLogger('Playlists')

/** 播放列表所有者 ID 缓存（按 playlistId 缓存 Promise，避免同列表重复请求） */
let playlistOwnerPromise: { playlistId: string; promise: Promise<string> } | null = null

/** 获取播放列表所有者的用户 ID（缓存；请求失败返回空串） */
export function getPlaylistOwnerId(playlistId: string): Promise<string> {
    if (playlistOwnerPromise?.playlistId !== playlistId) {
        playlistOwnerPromise = {
            playlistId,
            promise: (async () => {
                try {
                    const res = await unlimitedFetch(apiUrl(`/playlist/${playlistId}`), {
                        method: 'GET',
                        headers: await getAuth()
                    })
                    if (!res.ok) return ''
                    return ((await res.json()) as Iwara.Playlist).playlist?.user?.id ?? ''
                } catch (error) {
                    log.warn('Failed to get playlist owner:', error)
                    return ''
                }
            })()
        }
    }
    return playlistOwnerPromise.promise
}

/** 从播放列表移除视频（DELETE /playlist/:id/:vid；成功 true，失败 false） */
export async function removePlaylistVideo(playlistId: string, videoId: string): Promise<boolean> {
    try {
        return (
            await unlimitedFetch(apiUrl(`/playlist/${playlistId}/${videoId}`), {
                method: 'DELETE',
                headers: await getAuth()
            })
        ).ok
    } catch (error) {
        log.warn(`Failed to remove video ${videoId} from playlist ${playlistId}:`, error)
        return false
    }
}
