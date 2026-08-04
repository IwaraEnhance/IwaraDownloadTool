import { isNullOrUndefined } from "../core/env";
import { config } from "../core/config";
import downloadLinkPatterns from "../data/downloadLinks.json";

/** 评论中检测下载链接的特征片段（纯数据，见 src/data/downloadLinks.json） */
const DOWNLOAD_LINK_PATTERNS = downloadLinkPatterns as readonly string[];

/**
 * 检查评论中是否包含下载链接
 * @param {string} comment - 要检查的评论内容
 * @returns {boolean} 如果包含下载链接返回true，否则返回false
 */
export function checkIsHaveDownloadLink(comment: string): boolean {
    if (!config.checkDownloadLink || isNullOrUndefined(comment) || comment.isEmpty()) {
        return false
    }
    return DOWNLOAD_LINK_PATTERNS.filter(i => comment.toLowerCase().includes(i)).any()
}
