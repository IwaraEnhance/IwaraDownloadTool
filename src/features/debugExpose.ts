/**
 * debug 工具暴露：仅 GM_KEY_IS_DEBUG 开启时把调试句柄挂到 unsafeWindow，
 * 注意 syncAllVideosPages 与 db 导出是纯调试句柄；不含任何启动副作用。
 */
import { stringify } from '../core/env'
import { db } from '../core/db'
import { GM_KEY_IS_DEBUG } from '../core/constants'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { syncAllVideosPages } from './pageSync'
import { syncCachedToMediaCenter } from './mediaSync'

const log = createLogger('DebugExpose')

/** isDebug 开启时暴露调试句柄（返回是否为 debug 模式，供 main 的 debugger 断点分支复用） */
export function exposeDebugTools(): boolean {
    if (!GM_getValue(GM_KEY_IS_DEBUG)) return false
    Object.assign(unsafeWindow, {
        // @ts-ignore
        syncCachedToMediaCenter,
        // @ts-ignore
        syncAllVideosPages,
        // @ts-ignore
        exportAllToJsonFiles: db.exportAllToJsonFiles.bind(db),
        // @ts-ignore
        exportToJsonFiles: db.exportToJsonFiles.bind(db),
        // @ts-ignore
        debugGMFetch: unlimitedFetch
    })
    log.debug(stringify(GM_info))
    return true
}
