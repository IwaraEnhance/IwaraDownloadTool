import "../core/env";
import { delay, isNullOrUndefined, stringify } from "../core/env";
import { ToastType } from "../core/enum";
import { unlimitedFetch, renderNode } from "../core/extension";
import { createLogger } from "../core/log";
import { db } from "../core/db";
import { getAuth, refreshToken } from "./auth";
import { newToast, toastNode } from "../ui/notify";
import { parseVideoInfo } from "./video";
import { apiEndpoint, isLoggedIn } from "../main";
import site from "../data/site.json";

const log = createLogger('SyncPages');

/**
 * 抓取单页视频列表并缓存到 IndexedDB
 * @returns true 表示成功(含空页)，false 表示请求失败，'last' 表示已是最后一页
 */
async function fetchAndCachePage(page: number): Promise<true | false | 'last'> {
    const auth = await getAuth();
    const response = await unlimitedFetch(
        `https://${apiEndpoint}/videos?sort=date&page=${page}&limit=50`,
        { headers: auth as any },
        {
            retry: true,
            maxRetries: 3,
            retryDelay: 3000,
            failStatus: [403, 404, 429],
            onRetry: async () => { await refreshToken(); },
        }
    );

    if (!response.ok) return false;

    const pageData = await response.json() as Iwara.IPage;
    const rawVideos = pageData.results as Iwara.Video[];

    // 判断是否还有下一页
    if (pageData.page * pageData.limit >= pageData.count) return 'last';
    if (isNullOrUndefined(rawVideos) || rawVideos.length === 0) return true;

    // 解析并批量写入 DB（与 handleVideosResponse 一致）
    const list: Array<PartialVideoInfo | FullVideoInfo> = [];
    let idx = 0;
    const concurrency = 6;
    const nextParse = async () => {
        if (idx >= rawVideos.length) return;
        const i = idx++;
        try {
            const info = await parseVideoInfo({ Type: 'cache', ID: rawVideos[i].id, RAW: rawVideos[i] });
            if (info.Type === 'partial' || info.Type === 'full') {
                list.push(info);
            }
        } catch { } finally {
            if (idx < rawVideos.length) await delay(100);
            await nextParse();
        }
    };
    await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, rawVideos.length) }, () => nextParse())
    );

    if (list.length > 0) {
        const ids = list.map(v => v.ID);
        const existing = await db.getVideosByIds(ids);
        const fullVideos = existing.filter(v => v.Type === 'full');
        const toUpdate = list.difference(fullVideos, 'ID');
        if (toUpdate.any()) {
            await db.bulkPutVideos(toUpdate);
            log.info(`update: ${toUpdate.length} ${toUpdate[0].Title}`)
        }
    }

    return true;
}

/**
 * 遍历 iwara 视频列表的所有页面，逐页抓取并通过 fetchAndCachePage 缓存到 IndexedDB
 * 使用 unlimitedFetch（自动处理跨域）手动解析响应并写入数据库
 * 每页请求间隔加入随机 jitter 避免触发限流
 */
export async function syncAllVideosPages(): Promise<void> {
    if (!isLoggedIn()) {
        newToast(ToastType.Warn, {
            node: toastNode(`请先登录 iwara`, '页面遍历'),
            duration: 3000
        }).show();
        return;
    }

    // 显示进度
    const progressNode = renderNode({
        nodeType: 'p',
        childs: `正在遍历视频页面...`
    });
    const progressToast = newToast(ToastType.Info, {
        node: progressNode,
        duration: -1
    });
    progressToast.show();

    let succeeded = 0;
    const failedPages: number[] = [];
    let page = site.syncStartPage;

    while (true) {
        try {
            const result = await fetchAndCachePage(page);

            if (result === 'last') {
                succeeded++;
                progressNode.firstChild!.textContent = `正在遍历视频页面... 已是最后一页 (${page})，提前结束`;
                break;
            }

            if (result === false) {
                log.warn(`页面 ${page} 失败`);
                failedPages.push(page);
                await delay(5000 + Math.random() * 1000);
                page++;
                continue;
            }

            // true: 成功（含空页）
            succeeded++;
            progressNode.firstChild!.textContent = `正在遍历视频页面... 第 ${page} 页 (失败: ${failedPages.length})`;

        } catch (error) {
            log.warn(`页面 ${page} 异常:`, stringify(error));
            failedPages.push(page);
        }

        await delay(500 + Math.random() * 1000);
        page++;
    }

    // ── 重试失败的页面 ──
    let retryFailed: number[] = [];
    if (failedPages.length > 0) {
        progressNode.firstChild!.textContent = `正在重试 ${failedPages.length} 个失败页面...`;

        for (const retryPage of failedPages) {
            try {
                const result = await fetchAndCachePage(retryPage);

                if (result === false) {
                    log.warn(`重试页面 ${retryPage} 仍失败`);
                    retryFailed.push(retryPage);
                    continue;
                }

                succeeded++;
                progressNode.firstChild!.textContent = `正在重试失败页面... ${retryPage} 成功 (剩余 ${failedPages.length - retryFailed.length - (failedPages.indexOf(retryPage) + 1 - retryFailed.length)} 个待重试)`;

            } catch (error) {
                log.warn(`重试页面 ${retryPage} 异常:`, stringify(error));
                retryFailed.push(retryPage);
            }

            await delay(500 + Math.random() * 1000);
        }
    }

    progressToast.hide();

    newToast(ToastType.Info, {
        text: `页面遍历完成！成功: ${succeeded} 页${retryFailed.length > 0 ? `，重试后仍失败: ${retryFailed.length} 页` : '，无失败'}`,
        close: true,
        onClick() { this.hide(); }
    }).show();

    if (retryFailed.length > 0) {
        log.warn(`始终失败的页码: ${retryFailed.join(', ')}`);
    }
}
