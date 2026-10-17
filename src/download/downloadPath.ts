import '../core/env'
import { stringify } from '../core/env'
import { Path } from '../core/path'
import { config } from '../core/config'
import { report, toastNode } from '../core/notify'

/** 从视频信息构建带 videoid/download 参数的下载地址：
 * - videoid：任务反查视频 ID 的机制基础（aria2TaskExtractVideoID / 跨页追踪依赖）；
 * - download：本地文件名（执行器识别下载文件名）。
 * 三个执行器（aria2 / others）统一从本入口取富化后的地址，禁止裸传 DownloadUrl。 */
export function buildDownloadUrl(videoInfo: FullVideoInfo, localPath: Path): URL {
    const url = videoInfo.DownloadUrl.toURL()
    url.searchParams.set('videoid', videoInfo.ID)
    url.searchParams.set('download', localPath.fullName)
    return url
}

/**
 * 当前脚本管理器是否为 Violentmonkey（GM_info.scriptHandler 为 VM 固定标识）。
 * 管理器差异适配集中在此判定，业务层不直接比较 scriptHandler。
 */
export function isViolentmonkey(): boolean {
    return GM_info.scriptHandler === 'Violentmonkey'
}

/**
 * GM_download 文件名适配（管理器差异集中点）。
 *
 * - Tampermonkey / ScriptCat：支持绝对路径与子目录，原样使用 fullPath；
 * - Violentmonkey browser API 模式（downloadMode='browser'）：
 *   browser.downloads 的 filename 必须相对 Downloads 目录，绝对路径会报错 →
 *   去掉盘符/根前缀，保留相对子目录；
 * - Violentmonkey native 模式（默认，内部走 <a download>）：不支持子目录 →
 *   退化为纯文件名（老版本无 downloadMode 字段，同样按 native 处理）。
 */
export function getGMDownloadName(path: Path): string {
    if (!isViolentmonkey()) return path.fullPath
    const relative = path.fullPath.replace(/^[A-Za-z]:[\\/]/, '').replace(/^[\\/]+/, '')
    return GM_info.downloadMode === 'browser' ? relative : path.fullName
}

/**
 * 根据视频信息生成下载路径
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 * @returns {Path} 返回生成的路径对象
 */
export function getDownloadPath(videoInfo: FullVideoInfo): Path {
    // 按 config 开关逐项应用文件名规范化（TITLE/ALIAS 共用一套规则，仅截断长度不同）
    const sanitize = (source: string, maxLength: number): string => {
        let name = source
        if (config.pathNormalize) name = name.normalize('NFKC')
        if (config.pathReplaceEmojis) name = name.replaceEmojis('_')
        if (config.pathFoldMarks) name = name.replaceAll(/(\P{Mark})(\p{Mark}+)/gu, '_')
        if (config.pathSanitize) name = name.replace(/^\.|[\\\\/:*?\"<>|]/gim, '_')
        if (config.pathTruncate) name = name.truncate(maxLength)
        return name
    }
    return analyzeLocalPath(
        config.downloadPath.trim().replaceVariable({
            NowTime: new Date(),
            UploadTime: new Date(videoInfo.UploadTime),
            AUTHOR: videoInfo.Author,
            ID: videoInfo.ID,
            TITLE: sanitize(videoInfo.Title, config.pathTitleMaxLength),
            ALIAS: sanitize(videoInfo.Alias, config.pathAliasMaxLength),
            QUALITY: videoInfo.DownloadQuality
        })
    )
}

/**
 * 分析本地路径并返回Path对象
 * @param {string} path - 要分析的路径字符串
 * @returns {Path} 返回生成的路径对象
 * @throws {Error} 如果路径无效会抛出错误（报告经 core/notify，展示由 sink 完成）
 */
export function analyzeLocalPath(path: string): Path {
    try {
        return new Path(path)
    } catch (error) {
        // 报告经 core/notify 通道（报告展示由 sink 完成，见 main 组装）
        report('error', {
            title: '%#settingsCheck#%',
            body: toastNode(['%#downloadPathError#%', { nodeType: 'br' }, stringify(error)], '%#settingsCheck#%'),
            position: 'center',
            onClick: (host) => (host as { hide(): void })?.hide()
        })
        throw new Error(`%#downloadPathError#% ["${path}"]`)
    }
}
