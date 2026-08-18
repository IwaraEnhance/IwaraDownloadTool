import '../core/env'
import { isNullOrUndefined, prune } from '../core/env'
import { config } from '../core/config'
import { createLogger } from '../core/log'
import { unlimitedFetch } from '../core/extension'
import { LS_KEY_ACCESS_TOKEN, LS_KEY_TOKEN } from '../core/constants'
import { apiEndpoint } from '../main'
import { getXVersion } from './xVersion'

const log = createLogger('Auth')

/**
 * 判断是否已登录（同步）。
 * 仅凭 localStorage 中存在非空 token 并不可靠（可能已过期、被吊销或为垃圾值），
 * 这里进一步校验：
 * 1. token 必须是可解析的 JWT（解析失败视为未登录）；
 * 2. payload.type 必须是 refresh_token（Iwara 登录写入的 token 类型）；
 * 3. 若 payload 携带 exp 且已过期，则视为未登录。
 * @returns 登录状态
 */
export function isLoggedIn(): boolean {
    const refreshToken = unsafeWindow.localStorage.getItem(LS_KEY_TOKEN)
    if (isNullOrUndefined(refreshToken) || refreshToken.isEmpty()) return false

    try {
        const payload = getPlayload(`Bearer ${refreshToken}`)
        if (payload.type && payload.type !== 'refresh_token') return false
        if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false
    } catch {
        // 非 JWT（异常写入/损坏数据）视为未登录
        return false
    }
    return true
}

/** 远端登录校验结果缓存时长（毫秒） */
const LOGIN_VERIFY_TTL = 60 * 1000
let lastVerifyTime = 0
let lastVerifyResult = false

/**
 * 通过 API 远端校验登录态（最彻底保证）。
 * 同步的 isLoggedIn() 只能证明本地存在未过期的 JWT，无法发现服务端吊销、
 * 凭据轮换等情况；本函数用 /user 请求实测：
 * - accessToken 失效时先刷新 token 再重试一次；
 * - 最终仍失败（401）则清理本地凭据，避免后续请求反复携带失效 token；
 * - 网络异常时不清理凭据（无法断定失效），按未验证处理。
 * 结果缓存 60 秒，force=true 时跳过缓存强制校验（如启动时）。
 * @param force 是否跳过缓存强制重新校验
 */
export async function verifyLogin(force = false): Promise<boolean> {
    const now = Date.now()
    if (!force && now - lastVerifyTime < LOGIN_VERIFY_TTL) return lastVerifyResult

    const cache = (result: boolean) => {
        lastVerifyResult = result
        lastVerifyTime = Date.now()
    }

    if (!isLoggedIn()) {
        cache(false)
        return false
    }

    let res: Response | undefined
    try {
        res = await unlimitedFetch(`https://${apiEndpoint}/user`, {
            method: 'GET',
            headers: await getAuth()
        })
        if (!res.ok) {
            // accessToken 可能已过期：刷新后重试一次
            await refreshToken().catch(() => undefined)
            res = await unlimitedFetch(`https://${apiEndpoint}/user`, {
                method: 'GET',
                headers: await getAuth()
            })
        }
    } catch (error) {
        // 网络异常：无法断定凭据失效，不清理本地 token，按未验证处理
        log.warn('Failed to verify login:', error)
        cache(false)
        return false
    }

    if (!res.ok) {
        // 刷新后仍被拒绝：凭据已彻底失效，清理本地状态
        log.warn('Login credential rejected by server, clearing local credentials')
        localStorage.removeItem(LS_KEY_TOKEN)
        localStorage.removeItem(LS_KEY_ACCESS_TOKEN)
        config.authorization = ''
    }
    cache(res.ok)
    return res.ok
}

/**
 * 刷新Iwara.tv的访问令牌
 * @async
 * @returns {Promise<string>} 返回新的访问令牌或回退到配置中的授权令牌
 */
export async function refreshToken(): Promise<string> {
    const { authorization } = config
    if (!isLoggedIn()) throw new Error(`Refresh token failed: Not logged in`)
    const refreshToken = localStorage.getItem(LS_KEY_TOKEN) ?? authorization
    if (isNullOrUndefined(refreshToken) || refreshToken.isEmpty()) {
        throw new Error(`Refresh token failed: no refresh token`)
    }

    const oldAccessToken = localStorage.getItem(LS_KEY_ACCESS_TOKEN)
    try {
        const res = await unlimitedFetch(`https://${apiEndpoint}/user/token`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${refreshToken}`
            }
        })

        if (!res.ok) {
            throw new Error(`Refresh token failed with status: ${res.status}`)
        }

        const { accessToken } = await res.json()
        if (!accessToken) {
            throw new Error(`No access token in response`)
        }

        if (!oldAccessToken || oldAccessToken !== accessToken) {
            localStorage.setItem(LS_KEY_ACCESS_TOKEN, accessToken)
        }

        return accessToken
    } catch (error) {
        log.warn('Failed to refresh token:', error)

        if (!oldAccessToken?.trim()) {
            throw new Error(`Refresh token failed and no valid access token available`)
        }

        return oldAccessToken
    }
}

/**
 * 获取请求认证头信息
 * @async
 * @param {string} [url] - 可选URL参数，用于生成X-Version头
 * @returns 包含Cookie和Authorization的请求头对象
 */
export async function getAuth(url?: string): Promise<{ Cooike: string; Authorization: string } & { 'X-Version': string }> {
    return prune({
        Referer: `${window.location.origin}/`,
        Accept: 'application/json',
        Cooike: unsafeWindow.document.cookie,
        Authorization: isLoggedIn() ? `Bearer ${localStorage.getItem(LS_KEY_ACCESS_TOKEN) ?? (await refreshToken())}` : undefined,
        'X-Version': !isNullOrUndefined(url) && !url.isEmpty() ? await getXVersion(url) : undefined,
        'X-Site': unsafeWindow.location.hostname
    })
}

/**
 * 解析JWT令牌的payload部分
 * @param {string} authorization - 授权令牌字符串
 * @returns {Object} 返回解析后的payload对象
 */
export function getPlayload(authorization: string): { [key: string]: any } {
    return JSON.parse(decodeURIComponent(encodeURIComponent(window.atob(authorization.split(' ').pop()!.split('.')[1]))))
}
