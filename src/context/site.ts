/**
 * 站点环境上下文（domain/apiEndpoint 只读信息 + 目标域守卫，加载期求值一次）。
 *
 * 原 main.ts 顶层副作用（domain 求值 + 'Not target' 守卫 + scriptHandler 白名单）
 * 迁移至此：环境判定属于"上下文"职责而非入口职责，模块加载期求值一次。
 * 所有需要 apiEndpoint/domain/rating 的模块从这里导入，不再 import '../main'。
 */
import site from '../data/site.json'
import { LS_KEY_RATING } from '../core/constants'

const hostname = unsafeWindow.location.hostname
// 从支持域名中匹配注册域名（无需 tldts：对固定域名直接用 hostname 相等/后缀匹配）
export const domain = site.supportedDomains.find((d) => hostname === d || hostname.endsWith('.' + d)) ?? ''
if (!domain) {
    throw 'Not target'
}

switch (GM_info.scriptHandler) {
    case 'Tampermonkey':
    case 'ScriptCat':
        break
    case 'Via':
        // Via 内置油猴引擎不支持 GM_getTabs/GM_saveTab，且跨页 GM_addValueChangeListener 不可靠，
        // 会导致跨页同步（selectList/配置/GMLock）静默失效，因此封杀
        throw `Not support ${GM_info.scriptHandler} (内置油猴引擎不完整，跨页同步不可用)`
    default:
        throw `Not support ${GM_info.scriptHandler}`
}

export const apiEndpoint: string = site.apiEndpoint

/**
 * 构造 API 端点 URL（全库统一入口；替代手拼 `https://${apiEndpoint}/…` 模板串）。
 * 路径段用相对 segment 拼接（api 路径段的 ID 均为服务端下发的 hex/UUID，无编码需求），
 * query 一律用 URLSearchParams（编码责任集中在 URL 类型上）。
 */
export function apiUrl(path: string, query?: URLSearchParams): URL {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `https://${apiEndpoint}`)
    if (query !== undefined) url.search = query.toString()
    return url
}

/** 内容分级偏好（唯一来源；原 main.ts 的 rating 导出） */
export const rating = (): string => localStorage.getItem(LS_KEY_RATING) ?? 'all'
