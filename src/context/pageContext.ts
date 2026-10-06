/**
 * 页面上下文（当前页资源 ID 提取；路由参数经 matchPathPattern 路由表解析）。
 *
 * matchPathPattern 本就支持 `:name` 参数段，但此前从未暴露提取结果，
 * ui 层 4 处 `pathname.split('/')[2]` 手写解析。本模块把「当前页面的资源 ID」
 * 收敛为唯一入口：路由表驱动，无正则、无手写索引。
 */
import { getPageParams } from '../core/browserEnv'

/** 当前视频页的视频 ID（/video/:id）；非视频页返回 undefined */
export function currentVideoId(): string | undefined {
    return getPageParams()[':id']
}

/** 当前播放列表 ID（/playlist/:id，含子路由）；非列表页返回 undefined */
export function currentPlaylistId(): string | undefined {
    const params = getPageParams()
    // /playlist/:id 与 /playlist/:id/:videoId 共享 :id 参数
    return params[':id'] && unsafeWindow.location.pathname.startsWith('/playlist') ? params[':id'] : undefined
}
