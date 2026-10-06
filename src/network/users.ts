/**
 * 用户资源 API 客户端（纯 HTTP，无 toast/DOM/编排）。
 * getLocalUser 带 Promise 缓存（避免并发重复请求）。
 */
import { isNullOrUndefined } from '../core/env'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { getAuth, isLoggedIn, verifyLogin } from './auth'
import { apiUrl } from '../context/site'

const log = createLogger('Users')

/** 当前登录用户 Promise 缓存（页面生命周期内复用；refresh 调用会刷新缓存） */
let localUserPromise: Promise<Iwara.User | null> | null = null

/**
 * 获取当前登录用户（未登录或请求失败返回 null）。
 * - 缺省：isLoggedIn 快检 + 缓存复用（页面内多次调用零额外请求）；
 * - { refresh: true }：先 verifyLogin（必要时刷新 token）+ 绕过缓存实时拉取
 *   （长作业入口用，如一键批准前确认在线与最新 profile），结果回写缓存。
 */
export function getLocalUser(options: { refresh?: boolean } = {}): Promise<Iwara.User | null> {
    if (options.refresh || localUserPromise === null) {
        localUserPromise = (async () => {
            try {
                if (options.refresh ? !(await verifyLogin()) : !isLoggedIn()) return null
                const res = await unlimitedFetch(apiUrl('/user'), {
                    method: 'GET',
                    headers: await getAuth()
                })
                if (!res.ok) return null
                return ((await res.json()) as Iwara.LocalUser).user ?? null
            } catch (error) {
                log.warn('Failed to get local user:', error)
                return null
            }
        })()
    }
    return localUserPromise
}

/** 判断当前登录用户是否为指定用户（ownerId 为空时恒 false）；isNullOrUndefined 收敛判断 */
export async function isLocalUser(ownerId: string): Promise<boolean> {
    const localUser = await getLocalUser()
    return !isNullOrUndefined(localUser) && ownerId !== '' && localUser.id === ownerId
}
