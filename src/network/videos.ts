/**
 * 视频列表资源 API 客户端（GET /videos 的两个变体：全站最新 / 订阅流）。
 *
 * 自 features/pageSync.ts 下沉（同型 #8 的 videos 端点收口）；重试参数随
 * fetchAndCachePage / parseUnlistedAndPrivate 的原值迁入（3000/1000ms）。
 * 返回原始 IPage 分页结构，编排（解析/入库/并发/进度）由调用方负责。
 */
import { unlimitedFetch, type FetchRetryOptions } from '../core/extension'
import { getAuth, refreshToken } from './auth'
import { apiUrl, rating } from '../context/site'
import site from '../data/site.json'

/** 分页拉取视频列表（全站最新，按修改时间排序）——fetchAndCachePage 的请求段 */
export async function fetchVideoPage(page: number): Promise<Iwara.IPage<Iwara.Video>> {
    const response = await unlimitedFetch(
        apiUrl('/videos', new URLSearchParams({ sort: 'date', page: String(page), limit: String(site.pageLimit) })),
        { headers: await getAuth() },
        {
            retry: true,
            maxRetries: 3,
            retryDelay: 3000,
            failStatus: [403, 404, 429],
            onRetry: async () => {
                await refreshToken()
            }
        } satisfies FetchRetryOptions
    )
    return (await response.json()) as Iwara.IPage<Iwara.Video>
}

/** 分页拉取订阅流视频列表（仅已关注，含分级过滤）——parseUnlistedAndPrivate 的请求段 */
export async function fetchSubscribedVideos(page: number, retryDelay = 1000): Promise<Iwara.IPage<Iwara.Video>> {
    const response = await unlimitedFetch(
        apiUrl('/videos', new URLSearchParams({ subscribed: 'true', limit: String(site.pageLimit), rating: rating(), page: String(page) })),
        { headers: await getAuth() },
        {
            retry: true,
            retryDelay,
            onRetry: async () => {
                await refreshToken()
            }
        } satisfies FetchRetryOptions
    )
    return (await response.json()) as Iwara.IPage<Iwara.Video>
}
