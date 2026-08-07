import "../core/env";
import { isNullOrUndefined, prune } from "../core/env";
import { config } from "../core/config";
import { createLogger } from "../core/log";
import { unlimitedFetch } from "../core/extension";
import { apiEndpoint, isLoggedIn } from "../main";
import { getXVersion } from "./xVersion";

const log = createLogger('Auth');

/**
 * 刷新Iwara.tv的访问令牌
 * @async
 * @returns {Promise<string>} 返回新的访问令牌或回退到配置中的授权令牌
 */
export async function refreshToken(): Promise<string> {
    const { authorization } = config;
    if (!isLoggedIn()) throw new Error(`Refresh token failed: Not logged in`)
    const refreshToken = localStorage.getItem('token') ?? authorization;
    if (isNullOrUndefined(refreshToken) || refreshToken.isEmpty()) {
        throw new Error(`Refresh token failed: no refresh token`);
    }

    const oldAccessToken = localStorage.getItem('accessToken');
    try {
        const res = await unlimitedFetch(
            `https://${apiEndpoint}/user/token`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${refreshToken}`
                }
            }
        );

        if (!res.ok) {
            throw new Error(`Refresh token failed with status: ${res.status}`);
        }

        const { accessToken } = await res.json();
        if (!accessToken) {
            throw new Error(`No access token in response`);
        }

        if (!oldAccessToken || oldAccessToken !== accessToken) {
            localStorage.setItem('accessToken', accessToken);
        }

        return accessToken;

    } catch (error) {
        log.warn('Failed to refresh token:', error);

        if (!oldAccessToken?.trim()) {
            throw new Error(`Refresh token failed and no valid access token available`);
        }

        return oldAccessToken;
    }
}

/**
 * 获取请求认证头信息
 * @async
 * @param {string} [url] - 可选URL参数，用于生成X-Version头
 * @returns 包含Cookie和Authorization的请求头对象
 */
export async function getAuth(url?: string): Promise<{ Cooike: string; Authorization: string; } & { 'X-Version': string; }> {
    return prune({
        'Referer': `${window.location.origin}/`,
        'Accept': 'application/json',
        'Cooike': unsafeWindow.document.cookie,
        'Authorization': isLoggedIn() ? `Bearer ${localStorage.getItem('accessToken') ?? await refreshToken()}` : undefined,
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
