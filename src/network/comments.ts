/**
 * 评论资源 API 客户端（通用 `/{type}/{id}/comments` 端点，官方前端同构形态：
 * bundle 实证 `A(e, concat(t,"/",n,"/comments"), {query:{page}})`，资源类型变量
 * 覆盖 video/profile/forumThread 等）。
 *
 * 端点实证（2026-09-26 匿名实测）：`GET /profile/{userId}/comments?page=N` 返回
 * 标准 `Iwara.IPage<Iwara.Comment>`（count/limit/page/results，comment 带 user 对象）。
 * 分页终止：不足一页即取完（与 fetchAllFriendRequests 同款）。
 */
import { unlimitedFetch } from '../core/extension'
import { getAuth } from './auth'
import { apiUrl } from '../context/site'

/** 拉取单页评论（parent 指定时拉取该评论的回复） */
async function fetchCommentPage(type: string, id: string, page: number, parent?: string): Promise<Iwara.IPage<Iwara.Comment>> {
    const query = new URLSearchParams({ page: String(page) })
    if (parent !== undefined) query.set('parent', parent)
    const res = await unlimitedFetch(apiUrl(`/${type}/${id}/comments`, query), { headers: await getAuth() })
    if (!res.ok) throw new Error(`fetch comments failed: HTTP ${res.status}`)
    return (await res.json()) as Iwara.IPage<Iwara.Comment>
}

/**
 * 递归拉取资源下的全部评论（含嵌套回复：numReplies > 0 的评论递归拉取其 parent 视角子树）。
 * 树形分页与 video.ts 的 getCommentDatas 同构（预计算页数 Math.ceil(count/limit)），
 * 但请求端为通用 type 形态；调用方（审批批级缓存）只消费扁平化结果。
 */
export async function fetchAllComments(type: string, id: string, parent?: string): Promise<Iwara.Comment[]> {
    const comments: Iwara.Comment[] = []
    const base = await fetchCommentPage(type, id, 0, parent)
    comments.push(...base.results)
    for (let page = 1; page < Math.ceil(base.count / base.limit); page++) {
        comments.push(...(await fetchCommentPage(type, id, page, parent)).results)
    }
    const replies: Iwara.Comment[] = []
    for (const comment of comments) {
        if (parent === undefined && comment.numReplies > 0) {
            // 嵌套回复递归（parent 视角）；回复内部理论上无二级嵌套，numReplies 仍按官方数据防御递归
            replies.push(...(await fetchAllComments(type, id, comment.id)))
        }
    }
    return [...comments, ...replies]
}
