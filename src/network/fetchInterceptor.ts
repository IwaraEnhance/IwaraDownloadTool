import { originalConsole, originalFetch } from "../core/hijack";
import { config } from "../core/config";
import { db } from "../core/db";
import { getAuth, getPlayload } from "./auth";
import { parseVideoInfo } from "./video";
import { isNull, isNullOrUndefined, isString, isUndefined } from "../core/env";

/**
 * 处理请求头中的 Authorization，如果是 refresh_token 则隐藏凭证并更新本地存储
 */
function handleAuthorizationHeader(init?: RequestInit): void {
    if (!init || !init.headers) return;

    let authorization: string | null = null;
    if (init.headers instanceof Headers) {
        authorization = init.headers.has('Authorization') ? init.headers.get('Authorization') : null;
    } else if (Array.isArray(init.headers)) {
        const index = init.headers.findIndex(([key]) => key.toLowerCase() === 'authorization');
        if (index >= 0) authorization = init.headers[index][1];
    } else if (typeof init.headers === 'object') {
        for (const key in init.headers) {
            if (key.toLowerCase() === 'authorization') {
                authorization = init.headers[key];
                break;
            }
        }
    }

    if (!authorization) return;

    const payload = getPlayload(authorization);
    const token = authorization.split(' ').pop();
    if (payload['type'] === 'refresh_token' && !isUndefined(token)) {
        localStorage.setItem('token', token);
        config.authorization = token;
        GM_getValue('isDebug') && originalConsole.debug(`[Debug] refresh_token: 凭证已隐藏`);
    }
}

/**
 * 处理 /user/token 响应，更新 accessToken
 */
async function handleUserTokenResponse(response: Response): Promise<void> {
    const cloneResponse = response.clone();
    if (!cloneResponse.ok) return;
    const { accessToken } = await cloneResponse.json();
    const token = localStorage.getItem('accessToken');
    if (isNull(token) || token !== accessToken) {
        localStorage.setItem('accessToken', accessToken);
    }
}

/**
 * 处理 /videos 响应，更新数据库并修改返回结果
 */
async function handleVideosResponse(response: Response, url: URL): Promise<Response> {
    const cloneResponse = response.clone();
    if (!cloneResponse.ok) return response;

    const cloneBody = await cloneResponse.json() as Iwara.IPage;
    const rawVideos = cloneBody.results as Iwara.Video[];

    // 解析视频信息并更新数据库
    const parsePromises = rawVideos.map(info =>
        parseVideoInfo({ Type: 'cache', ID: info.id, RAW: info })
    );
    const settled = await Promise.allSettled(parsePromises);
    const list = settled
        .filter(i => i.status === 'fulfilled')
        .map(i => (i as PromiseFulfilledResult<VideoInfo>).value)
        .filter(i => i.Type === 'partial' || i.Type === 'full');

    const ids = list.map(v => v.ID);
    const existing = await db.getVideosByIds(ids);
    const fullVideos = existing.filter(v => v.Type === 'full');
    const toUpdate = list.difference(fullVideos, 'ID');

    if (toUpdate.any()) {
        await db.bulkPutVideos(toUpdate);
    }

    // 过滤已点赞视频
    if (config.filterLikedVideos) {
        cloneBody.results = rawVideos.filter(i => !i.liked);

        cloneBody.limit = cloneBody.results.length;
        cloneBody.count = cloneBody.limit * (cloneBody.page + 1) + 1;
    }

    // 过滤不公开和私有视频（订阅页 /videos?subscribed=true）
    if (config.filterUnlistedAndPrivate && url.searchParams.has('subscribed')) {
        cloneBody.results = (cloneBody.results as Iwara.Video[]).filter(i => !i.private && !i.unlisted);

        cloneBody.limit = cloneBody.results.length;
        cloneBody.count = cloneBody.limit * (cloneBody.page + 1) + 1;
    }

    let preResponse = new Response(JSON.stringify(cloneBody), {
        status: cloneResponse.status,
        statusText: cloneResponse.statusText,
        headers: Object.fromEntries(cloneResponse.headers.entries())
    });

    // 添加未列出和私有视频缓存（与“过滤订阅页不公开/私有视频”功能互斥）
    if (!config.addUnlistedAndPrivate || config.filterUnlistedAndPrivate) return preResponse;

    // 检查是否满足添加缓存的条件
    if (url.searchParams.has('user')) return preResponse;
    if (url.searchParams.has('subscribed')) return preResponse;
    if (url.searchParams.has('sort') && url.searchParams.get('sort') !== 'date') return preResponse;

    // 获取时间范围并添加缓存视频
    const sortedList = list.sort((a, b) => a.UploadTime - b.UploadTime);
    if (sortedList.length === 0) return preResponse;
    const minTime = sortedList[0].UploadTime;
    const maxTime = sortedList[sortedList.length - 1].UploadTime;
    const startTime = new Date(minTime).sub({ hours: 4 }).getTime();
    const endTime = new Date(maxTime).add({ hours: 4 }).getTime();

    const cacheVideos = (await db.getFilteredVideos(startTime, endTime))
        .filter(i => i.Type === 'partial' || i.Type === 'full')
        .sort((a, b) => b.UploadTime - a.UploadTime)
        .map(i => i.RAW);

    cloneBody.results.push(...cacheVideos);


    cloneBody.limit = cloneBody.results.length;
    cloneBody.count = cloneBody.limit * (cloneBody.page + 1) + 1;


    preResponse = new Response(JSON.stringify(cloneBody), {
        status: cloneResponse.status,
        statusText: cloneResponse.statusText,
        headers: Object.fromEntries(cloneResponse.headers.entries())
    });

    return preResponse
}

/**
 * 创建拦截后的 fetch 函数
 */
export function createInterceptedFetch(): typeof unsafeWindow.fetch {
    return async function (input: Request | string | URL, init?: RequestInit): Promise<Response> {
        GM_getValue('isDebug') && originalConsole.debug(`[Debug] Fetch ${input}`);
        const url = (input instanceof Request ? input.url : input instanceof URL ? input.href : input).toURL();
        if (!isUndefined(init) && init.headers) {
            handleAuthorizationHeader(init);
        }
        return new Promise((resolve, reject) =>
            originalFetch(input, init)
                .then(async (response) => {
                    if (!url.pathname.isEmpty()) {
                        const path = url.pathname.toLowerCase().split('/').slice(1);
                        if (url.hostname === 'apiq.iwara.tv' || url.hostname === 'api.iwara.tv') {
                            switch (path[0]) {
                                case 'user':
                                    if (path[1] === 'token') await handleUserTokenResponse(response);
                                    break;
                                case 'videos':
                                    return resolve(await handleVideosResponse(response, url));
                                default:
                                    break;
                            }
                        }
                    }
                    return resolve(response);
                })
                .catch(err => reject(err))
        ) as Promise<Response>;
    };
}
