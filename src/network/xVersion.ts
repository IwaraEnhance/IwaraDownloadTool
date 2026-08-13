import "../core/env";

/** X-Version 签名密钥（前端与脚本均用同一密钥与算法，服务端据此校验请求签名） */
const X_VERSION_SECRET = 'mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN';

/**
 * 生成 Iwara 请求的 X-Version 头值：对 [文件名, expires, 固定密钥] 拼接串做 SHA-1 摘要。
 * 前端与脚本均用同一密钥与算法，服务端据此校验请求签名。
 * 抽为独立模块以便单元测试（auth.ts 依赖 main.ts，无法在 Node 测试中直接加载）。
 * @param urlString 请求 URL（含 expires 查询参数时参与签名）
 * @returns 40 位小写 hex SHA-1 摘要
 */
export async function getXVersion(urlString: string): Promise<string> {
    let url = urlString.toURL()
    const data = new TextEncoder().encode([url.pathname.split("/").pop(), url.searchParams.get('expires'), X_VERSION_SECRET].join('_'))
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}
