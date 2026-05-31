import "./env"
import { i18nList } from "./i18n";
import { config } from "./config";
import { originalAddEventListener, originalFetch } from "./hijack";
import { delay, isArray, isNullOrUndefined, prune } from "./env";
import dayjs from "dayjs";

Date.prototype.format = function (format?: string) {
    return dayjs(this).format(format)
}

Date.prototype.add = function ({ years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0, ms = 0 } = {}) {
    return dayjs(this)
        .add(years, 'year').add(months, 'month').add(days, 'day')
        .add(hours, 'hour').add(minutes, 'minute').add(seconds, 'second')
        .add(ms, 'millisecond')
        .toDate();
};

Date.prototype.sub = function ({ years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0, ms = 0 } = {}) {
    return dayjs(this)
        .subtract(years, 'year').subtract(months, 'month').subtract(days, 'day')
        .subtract(hours, 'hour').subtract(minutes, 'minute').subtract(seconds, 'second')
        .subtract(ms, 'millisecond')
        .toDate();
};

/** GM_xmlhttpRequest 的 Promise 封装 */
function gmFetch(url: string, init: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: init.method as Tampermonkey.Request['method'],
            url,
            headers: (init.headers as Tampermonkey.RequestHeaders) || {},
            data: (init.body as Tampermonkey.Request['data']) || undefined,
            onload: (res) => resolve(new Response(res.responseText, { status: res.status, statusText: res.statusText })),
            onerror: (err) => reject(new Error(
                (err as any)?.error ?? (err as any)?.statusText ?? 'GM_xmlhttpRequest network error'
            )),
            ontimeout: () => reject(new Error('Request timeout')),
        });
    });
}

/**
 * 通用增强版 fetch，支持跨域请求与自动重试。
 * 
 * - 同源请求走原生 fetch，跨域自动切换 GM_xmlhttpRequest
 * - 可选自动重试，可配置成功/失败状态码
 * 
 * @param retryOptions.force - 强制使用 GM_xmlhttpRequest
 * @param retryOptions.retry - 启用自动重试
 * @param retryOptions.maxRetries - 最大重试次数（默认 3）
 * @param retryOptions.retryDelay - 重试间隔毫秒（默认 3000）
 * @param retryOptions.successStatus - 视为成功的状态码（默认 [200,201]）
 * @param retryOptions.failStatus - 视为失败不重试的状态码（默认 [403,404]）
 * @param retryOptions.onRetry - 每次重试前的回调
 * @param retryOptions.onFail - 最终失败时的回调
 */
export const unlimitedFetch = async (
    input: RequestInfo,
    init: RequestInit = {},
    retryOptions?: {
        force?: boolean;
        retry?: boolean;
        maxRetries?: number;
        retryDelay?: number;
        successStatus?: number | number[];
        failStatus?: number | number[];
        onRetry?: (response: Response) => Promise<void> | void;
        onFail?: (response: Response) => Promise<void> | void;
    }
): Promise<Response> => {
    const { force = false, retry = false, maxRetries = 3, retryDelay = 3000, successStatus = [200, 201], failStatus = [403, 404], onRetry, onFail } = retryOptions ?? {};

    const url = typeof input === 'string' ? input : input.url;
    const useGM = force || new URL(url).hostname !== unsafeWindow.location.hostname;
    const execFetch = () => useGM ? gmFetch(url, init) : originalFetch(input, init);

    // 未启用重试：一次请求直接返回
    if (!retry) return execFetch();

    const okStatus = Array.isArray(successStatus) ? successStatus : [successStatus];
    const failCodes = Array.isArray(failStatus) ? failStatus : [failStatus];

    let response = await execFetch();
    for (let attempt = 1; attempt < maxRetries; attempt++) {
        if (okStatus.includes(response.status)) return response;
        if (failCodes.includes(response.status)) break;
        await onRetry?.(response);
        await delay(retryDelay);
        response = await execFetch();
    }
    await onFail?.(response);
    return response;
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