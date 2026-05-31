import "./env"
import { i18nList } from "./i18n";
import { config } from "./config";
import { originalAddEventListener, originalFetch } from "./hijack";
import { delay, isArray, isNullOrUndefined, prune } from "./env";
import dayjs from "dayjs";

Date.prototype.format = function (format?: string) {
    return dayjs(this).format(format)
}
/**
 * 通用增强版 fetch 函数，支持跨域请求、重试机制、失败提示等特性。
 * 
 * - 自动检测同源，跨域时使用 GM_xmlhttpRequest 发起请求
 * - 可通过 options 强制跨域、开启重试、定制失败行为
 * 
 * @param {RequestInfo} input - 请求 URL 或 Request 对象
 * @param {RequestInit} [init] - 可选的请求配置对象
 * @param {Object} [options] - 扩展选项（不传则行为与原始 fetch 相同）
 * @param {boolean} [options.force=false] - 是否强制使用 GM_xmlhttpRequest 发起请求（无视同源判断）
 * @param {boolean} [options.retry=false] - 是否开启失败自动重试
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {number} [options.retryDelay=1000] - 重试间隔（毫秒）
 * @param {number|number[]} [options.successStatus=[200, 201]] - 判定为成功的响应状态码，可为单个或多个
 * @param {number|number[]} [options.failStatuses=[403, 404]] - 判定为失败且不重试的状态码列表，可为单个或多个
 * @param {(res: Response) => Promise<void> | void} [options.onFail] - 失败状态时调用函数
 * @param {(res: Response) => Promise<void> | void} [options.onRetry] - 重试状态时调用函数
 * 
 * @returns {Promise<Response>} - 返回 Response 对象 Promise
 */
export const unlimitedFetch = async (
    input: RequestInfo,
    init: RequestInit = {},
    options?: {
        force?: boolean;
        retry?: boolean;
        maxRetries?: number;
        retryDelay?: number;
        successStatus?: number | number[];
        failStatuses?: number | number[];
        onFail?: (response: Response) => Promise<void> | void;
        onRetry?: (response: Response) => Promise<void> | void;
    }
): Promise<Response> => {
    const {
        force = false,
        retry = false,
        maxRetries = 3,
        retryDelay = 3000,
        successStatus = [200, 201],
        failStatuses = [403, 404],
        onFail,
        onRetry,
    } = options || {};

    const successStatuses = Array.isArray(successStatus) ? successStatus : [successStatus];
    const failStatusList = Array.isArray(failStatuses) ? failStatuses : [failStatuses];

    const url = typeof input === 'string' ? input : input.url;
    const isCrossOrigin = force || new URL(url).hostname !== unsafeWindow.location.hostname;

    const doFetch = async (): Promise<Response> => {
        if (isCrossOrigin) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: init.method as Tampermonkey.Request['method'],
                    url,
                    headers: (init.headers as Tampermonkey.RequestHeaders) || {},
                    data: (init.body as Tampermonkey.Request['data']) || undefined,
                    onload: (response) => {
                        resolve(new Response(response.responseText, {
                            status: response.status,
                            statusText: response.statusText,
                        }));
                    },
                    onerror: (err) => {
                        reject(new Error(
                            typeof err === 'string'
                                ? err
                                : err?.error || err?.statusText || 'GM_xmlhttpRequest network error'
                        ));
                    },
                    ontimeout: () => {
                        reject(new Error('Request timeout'));
                    }
                });
            });
        } else {
            return originalFetch(input, init);
        }
    };

    if (!retry) return doFetch();
    let lastResponse: Response = await doFetch();
    let attempts = 1;
    while (attempts < maxRetries) {
        if (successStatuses.includes(lastResponse.status)) return lastResponse;
        if (failStatusList.includes(lastResponse.status)) break;
        attempts++;
        if (onRetry) await onRetry(lastResponse);
        await delay(retryDelay);
        lastResponse = await doFetch();
    }
    if (onFail) await onFail(lastResponse);
    return lastResponse;
};



/**
 * 查找匹配指定条件的DOM元素
 * @param {Element} element - 起始查找元素
 * @param {string} condition - CSS选择器条件
 * @returns {Element|undefined} 返回匹配的元素，未找到返回undefined
 */
export const findElement = (element: Element, condition: string): Element | undefined => {
    while (!isNullOrUndefined(element) && !element.matches(condition)) {
        if (isNullOrUndefined(element.parentElement)) return undefined
        element = element.parentElement
    }
    return element.querySelectorAll(condition).length > 1 ? undefined : element
}

/**
 * 渲染DOM节点
 * @template T HTML元素标签名
 * @param {RenderCode<T>|string} renderCode - 渲染代码，可以是字符串或RenderCode对象
 * @returns {HTMLElementTagNameMap[T]} 返回渲染后的HTML元素
 * @throws {Error} 当renderCode为null/undefined或无效参数时抛出错误
 */
export const renderNode = <T extends keyof HTMLElementTagNameMap>(renderCode: RenderCode<T> | string): HTMLElementTagNameMap[T] => {
    let code = prune(renderCode);
    if (isNullOrUndefined(code)) throw new Error("RenderCode null");
    if (typeof code === 'string') {
        return document.createTextNode(code.replaceVariable(i18nList[config.language])) as any;
    }
    if (renderCode instanceof Node) {
        return code as any;
    }
    if (typeof renderCode !== 'object' || !renderCode.nodeType) {
        throw new Error('Invalid arguments');
    }
    const { nodeType, attributes, events, className, childs } = renderCode;
    const node = document.createElement(nodeType);

    if (!isNullOrUndefined(events) && Object.keys(events).length > 0) {
        Object.entries(events).forEach(([eventName, eventHandler]) => originalAddEventListener.call(node, eventName, eventHandler))
    }
    if (!isNullOrUndefined(attributes) && Object.keys(attributes).length > 0) {
        Object.entries(attributes).forEach(([key, value]) => {
            node.setAttribute(key, value);
            (node as any)[key] = value
        })
    }
    if (!isNullOrUndefined(className) && className.length > 0) {
        node.classList.add(...(typeof className === 'string' ? [className] : className))
    }
    if (!isNullOrUndefined(childs)) {
        node.append(...(isArray(childs) ? childs : [childs]).filter(child => !isNullOrUndefined(child)).map(renderNode))
    }
    return node;
}