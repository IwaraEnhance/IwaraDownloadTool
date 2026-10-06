/**
 * 社交互动 API 客户端（follow/like/friend 的统一调用面）。
 *
 * follow/like/friend 三个资源的写操作此前在 main.ts（启动关注）、
 * downloadQueue（autoFollow/autoLike）、friendRequests（approve/reject）三处
 * 重复手写 POST 样板；本模块统一收敛为纯 HTTP 客户端（无 toast、无 UI），
 * 失败以返回值表达，由调用方（feature 层）决定用户提示。
 */
import { unlimitedFetch } from '../core/extension'
import { getAuth } from './auth'
import { apiUrl } from '../context/site'

/** 关注指定用户（POST /user/:id/followers） */
export async function followUser(userId: string): Promise<boolean> {
    try {
        return (await unlimitedFetch(apiUrl(`/user/${userId}/followers`), { method: 'POST', headers: await getAuth() })).ok
    } catch {
        return false
    }
}

/** 点赞视频（POST /video/:id/like） */
export async function likeVideo(videoId: string): Promise<boolean> {
    try {
        return (await unlimitedFetch(apiUrl(`/video/${videoId}/like`), { method: 'POST', headers: await getAuth() })).ok
    } catch {
        return false
    }
}

/** 加好友（POST /user/:id/friends，官方 requestFriend 语义，无 body） */
export async function addFriend(userId: string): Promise<boolean> {
    try {
        return (await unlimitedFetch(apiUrl(`/user/${userId}/friends`), { method: 'POST', headers: await getAuth() })).ok
    } catch {
        return false
    }
}

/** 删除好友/拒绝好友请求（DELETE /user/:id/friends，官方 destroyFriend 语义） */
export async function removeFriend(userId: string): Promise<boolean> {
    try {
        return (await unlimitedFetch(apiUrl(`/user/${userId}/friends`), { method: 'DELETE', headers: await getAuth() })).ok
    } catch {
        return false
    }
}

/** 分页拉取当前用户收到的全部好友请求（entry.user.id !== meId 为"收到的请求"，官方前端同语义）
 * 分页终止：不足一页即取完（limit 缺失时以本页长度兜底）；maxPages 上限防失控遍历 */
export async function fetchAllFriendRequests(meId: string, maxPages = 32): Promise<Iwara.FriendRequestEntry[]> {
    const received: Iwara.FriendRequestEntry[] = []
    for (let page = 0; page < maxPages; page++) {
        const res = await unlimitedFetch(apiUrl(`/user/${meId}/friends/requests`, new URLSearchParams({ page: String(page) })), {
            method: 'GET',
            headers: await getAuth()
        })
        if (!res.ok) throw new Error(`fetchFriendRequests failed: HTTP ${res.status}`)
        const data = (await res.json()) as Iwara.FriendRequestsPage
        received.push(...(data.results ?? []).filter((e) => e.user.id !== meId))
        const limit = data.limit > 0 ? data.limit : (data.results ?? []).length
        if ((data.results ?? []).length < limit || data.results.length === 0) break
    }
    return received
}
