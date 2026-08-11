import { PageType } from "./enum";

/** 路径段模式：`:name` 匹配任意单段；`:name?` 为可选尾段（可省略）。与前端 React Router v3 的 path 一致 */
export type PathPattern = readonly string[]

/**
 * 基于 Iwara 前端 React Router v3 路由表（前端 chunk-9614 提取）的页面类型识别。
 * URL pathname 按 `/` 切段后与声明式段模式匹配（`:` 前缀为参数段），
 * 相比正则更安全可读：纯字符串比较、无元字符/回溯风险，且与前端路由 path 一一对应。
 * 数组顺序即匹配优先级：论坛线程必须先于版块、`admin` 宽泛匹配先于 `:userId/messages` 兜底。
 */
export const PAGE_TYPE_ROUTES: ReadonlyArray<readonly [PathPattern, PageType]> = [
    // ── 论坛：/forum/:section/:id[/:slug]（线程）→ /forum/:id（版块）→ /forum（首页）──
    [['forum', ':section', ':id', ':slug?'], PageType.ForumThread],
    [['forum', ':id'], PageType.ForumSection],
    [['forum'], PageType.Forum],
    // ── 视频 ──
    [['video', ':id', ':slug?'], PageType.Video], // /video/:id[/:slug|edit|delete]
    [['v', ':id'], PageType.Video], // /v/:id 短链
    [['videos'], PageType.VideoList],
    // ── 图片 ──
    [['image', ':id', ':slug?'], PageType.Image],
    [['i', ':id'], PageType.Image], // /i/:id 短链
    [['images'], PageType.ImageList],
    // ── 播放列表 ──
    [['playlist', ':id', ':item?'], PageType.Playlist], // /playlist/:id[/:videoId|edit|delete]
    // ── 收藏 / 订阅 / 观看历史 ──
    [['favorites', ':type?'], PageType.Favorites],
    [['subscriptions', ':type?'], PageType.Subscriptions],
    [['history', ':type?'], PageType.History], // /history[/:type]，video 类型渲染视频卡片
    // ── 个人主页 ──
    [['profile', ':id', ':section?'], PageType.Profile], // /profile/:id[/:section]
    [['p', ':id'], PageType.Profile], // /p/:id 短链
    // ── 搜索 ──
    [['search'], PageType.Search],
    // ── 账户 / 兑换券 ──
    [['account', ':page?', ':subPage?'], PageType.Account], // /account[/:page[/:subPage]]
    [['dashboard', ':page?'], PageType.Account], // /dashboard[/:page] 账户仪表盘
    [['user', 'voucher'], PageType.Account], // /user/voucher 兑换券归账户
    // ── 帖子 ──
    [['post', ':id', ':action?'], PageType.Post], // /post/:id[/:edit|delete]
    // ── 好友 / 通知 / 私信 ──
    [['friends', ':page?'], PageType.Friends], // /friends[/:page]
    [['notifications'], PageType.Notifications],
    [['messages', ':conversationId?'], PageType.Messages], // /messages[/:id]
    // ── 认证 ──
    [['login'], PageType.Auth],
    [['register'], PageType.Auth],
    [['activate'], PageType.Auth],
    [['password-reset'], PageType.Auth],
    [['forgot-password'], PageType.Auth],
    [['verify-email'], PageType.Auth],
    [['auth', ':service', 'callback'], PageType.Auth], // OAuth 回调
    // ── 产品商店 ──
    [['products'], PageType.Product],
    [['product', ':id', ':action?'], PageType.Product], // /product/:id[/:edit]
    // ── 创建 ──
    [['create', ':type?'], PageType.Create], // /create[/:type]
    // ── 规则 / 信息页 ──
    [['rules'], PageType.Rule],
    [['rule', ':id', ':action?'], PageType.Rule], // /rule/:id[/:edit]
    [['faq'], PageType.Rule],
    [['changelog'], PageType.Rule],
    [['flags'], PageType.Rule],
    // ── 管理端（宽泛兜底，须在 `:userId/messages` 之前，避免 /admin/messages 误判为私信）──
    [['admin', ':a?', ':b?', ':c?', ':d?'], PageType.Admin], // /admin[/...]
    // ── 用户私信（动态首段，兜底放最后）──
    [[':userId', 'messages', ':conversationId?'], PageType.Messages], // /:userId/messages[/:id]
    // ── 首页 ──
    [[], PageType.Home], // /（空路径）
]

/** 匹配路径段与模式：支持 `:name` 参数段与尾随可选段 `:name?`（纯字符串比较，无正则） */
export function matchPathPattern(segments: readonly string[], pattern: PathPattern): boolean {
    // 空模式仅匹配空路径（首页）
    if (pattern.length === 0) return segments.length === 0
    // 计算必需段数：去掉尾随可选段
    let required = pattern.length
    while (required > 0 && pattern[required - 1].endsWith('?')) required--
    if (segments.length < required || segments.length > pattern.length) return false
    for (let i = 0; i < segments.length; i++) {
        const p = pattern[i]
        if (!p.startsWith(':') && p !== segments[i]) return false
    }
    return true
}

/** 从 URL 路径（pathname 或 hash 路由路径）解析页面类型；未匹配任何路由时返回 Page */
export function getPageTypeFromPath(path: string): PageType {
    const segments = path.split('/').filter(Boolean)
    for (const [pattern, type] of PAGE_TYPE_ROUTES) {
        if (matchPathPattern(segments, pattern)) return type
    }
    return PageType.Page
}
