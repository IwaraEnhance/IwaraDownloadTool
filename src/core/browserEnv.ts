/**
 * 浏览器环境函数（location 读取，供 pageType/路由参数解析）。
 * "读 location 的平台函数"归 core：纯路由匹配逻辑在 core/pageType.ts，
 * 本模块只负责 location 双源解析（hash 优先 + pathname）与路由参数提取。
 */
import { getPageTypeFromPath, PAGE_TYPE_ROUTES, matchPathPattern, type PathPattern } from './pageType'
import { PageType } from './enum'

/** location 双源解析：hash 路由优先（#/path 或 #!/path），否则 pathname */
function currentPath(): string {
    const hashPath = unsafeWindow.location.hash.trimHead('#').trimHead('!').split('?')[0]
    return hashPath || unsafeWindow.location.pathname
}

/** 解析当前页面类型（原 main.ts getPageType） */
export function getPageType(): PageType {
    return getPageTypeFromPath(currentPath())
}

/**
 * 解析当前路径的路由参数段（matchPathPattern 的提取面），键保留 `:name` 冒号前缀。
 * 返回按模式 `:name` 命名的参数表（键保留冒号前缀，与 PAGE_TYPE_ROUTES 声明一致），
 * 如 /video/abc → { ':id': 'abc' }；无匹配模式时返回空对象。
 */
export function getPageParams(): Record<string, string> {
    const segments = currentPath().split('/').filter(Boolean)
    for (const [pattern] of PAGE_TYPE_ROUTES as ReadonlyArray<readonly [PathPattern, PageType]>) {
        if (!matchPathPattern(segments, pattern)) continue
        const params: Record<string, string> = {}
        for (let i = 0; i < pattern.length; i++) {
            const seg = pattern[i]
            if (seg.startsWith(':')) params[seg] = segments[i] ?? ''
        }
        return params
    }
    return {}
}
