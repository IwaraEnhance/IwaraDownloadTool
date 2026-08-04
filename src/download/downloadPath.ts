import "../core/env";
import { stringify } from "../core/env";
import { Path } from "../core/class";
import { ToastType } from "../core/enum";
import { config } from "../core/config";
import { newToast, toastNode } from "../ui/notify";

/**
 * 根据视频信息生成下载路径
 * @param {FullVideoInfo} videoInfo - 视频信息对象
 * @returns {Path} 返回生成的路径对象
 */
export function getDownloadPath(videoInfo: FullVideoInfo): Path {
    return analyzeLocalPath(
        config.downloadPath.trim().replaceVariable({
            NowTime: new Date(),
            UploadTime: new Date(videoInfo.UploadTime),
            AUTHOR: videoInfo.Author,
            ID: videoInfo.ID,
            TITLE: videoInfo.Title.normalize('NFKC').replaceEmojis('_').replaceAll(/(\P{Mark})(\p{Mark}+)/gu, '_').replace(/^\.|[\\\\/:*?\"<>|]/img, '_').truncate(72),
            ALIAS: videoInfo.Alias.normalize('NFKC').replaceAll(/(\P{Mark})(\p{Mark}+)/gu, '_').replace(/^\.|[\\\\/:*?\"<>|]/img, '_').truncate(64),
            QUALITY: videoInfo.DownloadQuality,
        })
    )
}

/**
 * 分析本地路径并返回Path对象
 * @param {string} path - 要分析的路径字符串
 * @returns {Path} 返回Path对象
 * @throws {Error} 如果路径无效会抛出错误并显示Toast通知
 */
export function analyzeLocalPath(path: string): Path {
    try {
        return new Path(path)
    } catch (error) {
        let toast = newToast(
            ToastType.Error,
            {
                node: toastNode([
                    `%#downloadPathError#%`,
                    { nodeType: 'br' },
                    stringify(error)
                ], '%#settingsCheck#%'),
                position: 'center',
                onClick() {
                    toast.hide()
                }
            }
        )
        toast.show()
        throw new Error(`%#downloadPathError#% ["${path}"]`)
    }
}
