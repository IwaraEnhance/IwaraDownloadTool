const ConvertibleNumber: unique symbol = Symbol("ConvertibleNumber");
const PositiveInteger: unique symbol = Symbol("PositiveInteger");
const NegativeInteger: unique symbol = Symbol("NegativeInteger");
const PositiveFloat: unique symbol = Symbol("PositiveFloat");
const NegativeFloat: unique symbol = Symbol("NegativeFloat");
export type ConvertibleNumber = any & { [ConvertibleNumber]: true };
export type PositiveInteger = number & { [PositiveInteger]: true };
export type NegativeInteger = number & { [NegativeInteger]: true };
export type PositiveFloat = number & { [PositiveFloat]: true };
export type NegativeFloat = number & { [NegativeFloat]: true };
declare global {
    interface NumberConstructor {
        isPositiveInteger(value: unknown): value is PositiveInteger;
        isNegativeInteger(value: unknown): value is NegativeInteger;
        isPositiveFloat(value: unknown): value is PositiveFloat;
        isNegativeFloat(value: unknown): value is NegativeFloat;
        isConvertibleNumber(value: unknown, includeInfinity?: boolean): value is ConvertibleNumber;
        toPositiveInteger(value: number): PositiveInteger;
        toNegativeInteger(value: number): NegativeInteger;
        toPositiveFloat(value: number): PositiveFloat;
        toNegativeFloat(value: number): NegativeFloat;
    }
    interface Array<T> {
        /**
          * 判断数组是否包含至少一个非空值
          * @returns {boolean} 如果数组中至少有一个非 null 或 undefined 元素，返回 true，否则返回 false
          */
        any(): this is [T, ...T[]];
        //prune(): Array<T>;
        /**
         * @name unique
         * @description 根据元素值或特定属性移除数组中的重复元素。
         * @param {keyof T} [prop] - 可选的属性键，用于唯一性比较。
         * @returns {T[]} 一个新的数组，去除了重复项。
         */
        unique(prop?: keyof T): T[];
        /**
         * @name union
         * @description 计算两个数组的并集，去除重复元素。
         * @param {T[]} that - 与当前数组合并的第二个数组。
         * @param {keyof T} [prop] - 可选的属性键，用于唯一性比较。
         * @returns {T[]} 一个新的数组，代表两个数组的并集。
         */
        union(that: T[], prop?: keyof T): T[];
        /**
         * @name intersect
         * @description 计算两个数组的交集。
         * @param {T[]} that - 与当前数组求交集的第二个数组。
         * @param {keyof T} [prop] - 可选的属性键，用于等价比较。
         * @returns {T[]} 一个新的数组，包含两个数组共有的元素。
         */
        intersect(that: T[], prop?: keyof T): T[];
        /**
         * @name difference
         * @description 计算两个数组的差集（第一个数组中不在第二个数组中的元素）。
         * @param {T[]} that - 其元素将从当前数组中减去的第二个数组。
         * @param {keyof T} [prop] - 可选的属性键，用于等价比较。
         * @returns {T[]} 一个新的数组，包含当前数组中但不在第二个数组中的元素。
         */
        difference(that: T[], prop?: keyof T): T[];
        /**
         * @name complement
         * @description 计算两个数组的补集（不在交集中的元素）。
         * @param {T[]} that - 用于计算补集的第二个数组。
         * @param {keyof T} [prop] - 可选的属性键，用于等价比较。
         * @returns {T[]} 一个新的数组，包含仅在一个数组中出现的元素。
         */
        complement(that: T[], prop?: keyof T): T[];
    }
    interface String {
        /**
         * 字符串变量替换方法
         * @param {Record<string, unknown>} replacements - 替换键值对对象
         * @param {string} [prefix=%#] - 键前缀
         * @param {string} [suffix=%#] - 键后缀
         * @returns {string} 返回替换后的字符串
         * @example 
         * 'Hello AAAnameBBB'.replaceVariable({name: 'World'},'AAA','BBB') // 'Hello World'
         */
        replaceVariable(replacements: Record<string, unknown>, prefix?: string, suffix?: string): string;
        /**
         * 替换字符串中的所有表情符号
         * @param {string | null} [replace] - 可选参数，替换为的字符串（默认替换为空字符串）
         * @returns {string} 返回替换后的字符串
         */
        replaceEmojis(replace?: string | null): string
        /**
         * 判断字符串是否为空
         * @returns {boolean} 如果字符串为空，返回 true，否则返回 false
         */
        isEmpty(): boolean;
        /**
         * 将字符串转换为 URL 对象
         * @returns {URL} 返回解析后的 URL 对象
         */
        toURL(): URL;
        /**
         * 反转字符串中的字符（考虑到Unicode字符）
         * @returns {string} 返回反转后的字符串
         */
        reversed(): string;
        /**
         * 获取字符串中两个指定字符串之间的内容
         * @param {string} start - 开始标记
         * @param {string} end - 结束标记
         * @param {boolean} [greedy=false] - 是否贪婪匹配，默认不贪婪
         * @param {boolean} [reverse=false] - 是否反向查找，默认从左到右查找
         * @returns {string} 返回两个标记之间的子串
         */
        among(start: string, end: string, greedy?: boolean, reverse?: boolean): string;
        /**
         * 根据分隔符分割字符串，并限制返回的部分数
         * @param {string} separator - 分隔符
         * @param {number} [limit] - 可选参数，限制分割的部分数
         * @returns {string[]} 返回分割后的数组
         */
        splitLimit(separator: string, limit?: number): string[];
        /**
         * 截断字符串至指定长度
         * @param {number} maxLength - 最大长度
         * @returns {string} 返回截断后的字符串
         */
        truncate(maxLength: number): string
        /**
         * 删除字符串开头的指定前缀
         * @param {string} prefix - 要去除的前缀
         * @returns {string} 返回去除前缀后的字符串
         */
        trimHead(prefix: string): string;
        /**
         * 删除字符串结尾的指定后缀
         * @param {string} suffix - 要去除的后缀
         * @returns {string} 返回去除后缀后的字符串
         */
        trimTail(suffix: string): string;
        /**
         * 判断字符串是否可被转换为数字
         * @param {boolean} [includeInfinity=false] - 可选参数，是否包含无穷大，默认不包含
         * @returns {boolean} 如果字符串可被转换为数字，返回 true，否则返回 false
         */
        isConvertibleToNumber(includeInfinity?: boolean): boolean;
    }

    interface Date {
        format(format?: string): string;
        add({ years, months, days, hours, minutes, seconds, ms }?: {
            years?: number | undefined;
            months?: number | undefined;
            days?: number | undefined;
            hours?: number | undefined;
            minutes?: number | undefined;
            seconds?: number | undefined;
            ms?: number | undefined;
        }): Date
        sub({ years, months, days, hours, minutes, seconds, ms }?: {
            years?: number | undefined;
            months?: number | undefined;
            days?: number | undefined;
            hours?: number | undefined;
            minutes?: number | undefined;
            seconds?: number | undefined;
            ms?: number | undefined;
        }): Date
    }

    interface Window {
        IwaraDownloadTool: boolean;
    }
}

// emoji 正则复制自 emoji-regex 库（slevithan/emoji-regex-xs，MIT License）
// 因仅需此一处使用而内嵌源码，未通过包管理器引入
const emojiBase = String.raw`\p{Emoji}(?:\p{EMod}|[\u{E0020}-\u{E007E}]+\u{E007F}|\uFE0F?\u20E3?)`;
export const emojiRegex = new RegExp(String.raw`\p{RI}{2}|(?![#*\d](?!\uFE0F?\u20E3))${emojiBase}(?:\u200D${emojiBase})*`, 'gu');

export const isNull = (obj: unknown): obj is null => obj === null;
export const isUndefined = (obj: unknown): obj is undefined => typeof obj === 'undefined';
export const isNullOrUndefined = (obj: unknown): obj is null | undefined => isUndefined(obj) || isNull(obj);
export const isObject = (obj: unknown): obj is Object => !isNullOrUndefined(obj) && typeof obj === 'object' && !Array.isArray(obj)
export const isString = (obj: unknown): obj is string => !isNullOrUndefined(obj) && typeof obj === 'string';
export const isNumber = (obj: unknown): obj is number => !isNullOrUndefined(obj) && typeof obj === 'number';
export const isArray = (obj: unknown): obj is Array<any> => Array.isArray(obj)
export const isElement = (obj: unknown): obj is Element => !isNullOrUndefined(obj) && obj instanceof Element
export const isNode = (obj: unknown): obj is Node => !isNullOrUndefined(obj) && obj instanceof Node
export const isNotEmpty = (obj: unknown): boolean => {
    if (isNullOrUndefined(obj)) {
        return false
    }
    if (Array.isArray(obj)) {
        return obj.some(isNotEmpty);
    }
    if (isString(obj)) {
        return !obj.isEmpty();
    }
    if (isNumber(obj)) {
        return !Number.isNaN(obj)
    }
    if (isElement(obj) || isNode(obj)) {
        return true
    }
    if (isObject(obj)) {
        return Object.values(obj).some(isNotEmpty)
    }
    return true
}
export const isVideoInfo = (obj: unknown): obj is VideoInfo => {
    if (obj === null || typeof obj !== 'object') return false;
    const info = obj as VideoInfo;

    return (
        isInitVideoInfo(info) ||
        isFullVideoInfo(info) ||
        isPartialVideoInfo(info) ||
        isCacheVideoInfo(info) ||
        isFailVideoInfo(info)
    );
};
const hasValidID = (info: VideoInfo) => isString(info.ID) && isNotEmpty(info.ID);

export const isInitVideoInfo = (info: VideoInfo): info is InitVideoInfo =>
    !isNullOrUndefined(info) &&
    info.Type === 'init' &&
    hasValidID(info);

export const isFullVideoInfo = (info: VideoInfo): info is FullVideoInfo =>
    !isNullOrUndefined(info) &&
    info.Type === 'full' &&
    hasValidID(info) &&
    isNumber(info.UploadTime) &&
    isString(info.Title) && isNotEmpty(info.Title) &&
    isString(info.FileName) && isNotEmpty(info.FileName) &&
    isNumber(info.Size) &&
    isArray(info.Tags) &&
    typeof info.Liked === 'boolean' &&
    typeof info.Following === 'boolean' &&
    typeof info.Friend === 'boolean' &&
    isString(info.Author) && isNotEmpty(info.Author) &&
    isString(info.AuthorID) && isNotEmpty(info.AuthorID) &&
    typeof info.Private === 'boolean' &&
    typeof info.Unlisted === 'boolean' &&
    isString(info.DownloadQuality) &&
    typeof info.External === 'boolean' &&
    isString(info.DownloadUrl) && isNotEmpty(info.DownloadUrl) &&
    isObject(info.RAW);

export const isPartialVideoInfo = (info: VideoInfo): info is PartialVideoInfo =>
    !isNullOrUndefined(info) &&
    info.Type === 'partial' &&
    hasValidID(info) &&
    isNumber(info.UploadTime) &&
    isString(info.Title) && isNotEmpty(info.Title) &&
    isArray(info.Tags) &&
    typeof info.Liked === 'boolean' &&
    isString(info.Author) && isNotEmpty(info.Author) &&
    isString(info.AuthorID) && isNotEmpty(info.AuthorID) &&
    typeof info.Private === 'boolean' &&
    typeof info.Unlisted === 'boolean' &&
    typeof info.External === 'boolean' &&
    isObject(info.RAW);

export const isCacheVideoInfo = (info: VideoInfo): info is CacheVideoInfo =>
    !isNullOrUndefined(info) &&
    info.Type === 'cache' &&
    hasValidID(info) &&
    isObject(info.RAW);

export const isFailVideoInfo = (info: VideoInfo): info is FailVideoInfo =>
    !isNullOrUndefined(info) &&
    info.Type === 'fail' &&
    hasValidID(info);

export const assertVideoInfoType = (info: VideoInfo) => {
    switch (info.Type) {
        case 'init':
            return info as InitVideoInfo;
        case 'full':
            return info as FullVideoInfo;
        case 'partial':
            return info as PartialVideoInfo;
        case 'cache':
            return info as CacheVideoInfo;
        case 'fail':
            return info as FailVideoInfo;
        default:
            throw new Error(`未知的 VideoInfo 类型: ${(info as any).Type}`);
    }
}
export function isConvertibleToNumber(obj: unknown, includeInfinity: boolean = false): boolean {
    if (isNullOrUndefined(obj)) {
        return false;
    }
    if (isString(obj)) {
        return obj.isConvertibleToNumber(includeInfinity);
    }
    if (isNumber(obj)) {
        return isNaN(obj) ? false : includeInfinity ? true : isFinite(obj);
    }
    return false;
}
Number.isConvertibleNumber = (value: unknown, includeInfinity: boolean = false): value is ConvertibleNumber => {
    if (isNullOrUndefined(value)) {
        return false;
    }
    if (isString(value)) {
        return value.isConvertibleToNumber(includeInfinity);
    }
    if (isNumber(value)) {
        return isNaN(value) ? false : includeInfinity ? true : isFinite(value);
    }
    return false;
}
Number.isPositiveInteger = (value: unknown): value is PositiveInteger =>
    typeof value === "number" && Number.isInteger(value) && value > 0;

Number.isNegativeInteger = (value: unknown): value is NegativeInteger =>
    typeof value === "number" && Number.isInteger(value) && value < 0;

Number.isPositiveFloat = (value: unknown): value is PositiveFloat =>
    typeof value === "number" && !Number.isInteger(value) && value > 0;

Number.isNegativeFloat = (value: unknown): value is NegativeFloat =>
    typeof value === "number" && !Number.isInteger(value) && value < 0;

// 实现转换函数
Number.toPositiveInteger = (value: number): PositiveInteger => {
    if (!Number.isPositiveInteger(value)) {
        throw new Error("值必须为正整数");
    }
    return value as PositiveInteger;
};

Number.toNegativeInteger = (value: number): NegativeInteger => {
    if (!Number.isNegativeInteger(value)) {
        throw new Error("值必须为负整数");
    }
    return value as NegativeInteger;
};

Number.toPositiveFloat = (value: number): PositiveFloat => {
    if (!Number.isPositiveFloat(value)) {
        throw new Error("值必须为正浮点数");
    }
    return value as PositiveFloat;
};

Number.toNegativeFloat = (value: number): NegativeFloat => {
    if (!Number.isNegativeFloat(value)) {
        throw new Error("值必须为负浮点数");
    }
    return value as NegativeFloat;
};

Array.prototype.any = function <T>(this: T[]): this is [T, ...T[]] {
    return this.filter(i => !isNullOrUndefined(i)).length > 0
}
Array.prototype.unique = function <T>(this: T[], prop?: keyof T): T[] {
    if (isNullOrUndefined(prop)) {
        const seen = new Set<T>();
        return this.filter(item => {
            if (seen.has(item)) return false;
            seen.add(item);
            return true;
        });
    } else {
        const seen = new Map<unknown, boolean>();
        const nanSymbol = Symbol();
        return this.filter(item => {
            const rawKey = item[prop];
            const key = isNumber(rawKey) && Number.isNaN(rawKey) ? nanSymbol : rawKey;
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
        });
    }
};
Array.prototype.union = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return [...this, ...that].unique(prop)
}
Array.prototype.intersect = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.filter((item) =>
        that.some((t) => isNullOrUndefined(prop) ? t === item : t[prop] === item[prop])
    ).unique(prop)
}
Array.prototype.difference = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.filter((item) =>
        !that.some((t) => isNullOrUndefined(prop) ? t === item : t[prop] === item[prop])
    ).unique(prop)
}
Array.prototype.complement = function <T>(this: T[], that: T[], prop?: keyof T): T[] {
    return this.union(that, prop).difference(this.intersect(that, prop), prop)
}

String.prototype.isEmpty = function () {
    return !isNullOrUndefined(this) && this.length === 0
}
String.prototype.isConvertibleToNumber = function (includeInfinity: boolean = false) {
    const trimmed = this.trim();
    if (trimmed === "") return false;
    return Number.isConvertibleNumber(Number(trimmed), includeInfinity);
}
String.prototype.reversed = function () {
    const segmenter = new Intl.Segmenter(navigator.language, { granularity: 'grapheme' });
    return [...segmenter.segment(this.toString())].reverse().join('');
}
String.prototype.among = function (start: string, end: string, greedy: boolean = false, reverse: boolean = false) {
    if (this.isEmpty() || start.isEmpty() || end.isEmpty()) return ''
    if (!reverse) {
        const startIndex = this.indexOf(start);
        if (startIndex === -1) return '';
        const adjustedStartIndex = startIndex + start.length;
        const endIndex = greedy
            ? this.lastIndexOf(end)
            : this.indexOf(end, adjustedStartIndex);
        if (endIndex === -1 || endIndex < adjustedStartIndex) return '';
        return this.slice(adjustedStartIndex, endIndex);
    } else {
        const endIndex = this.lastIndexOf(end);
        if (endIndex === -1) return '';
        const adjustedEndIndex = endIndex - end.length;
        const startIndex = greedy
            ? this.indexOf(start)
            : this.lastIndexOf(start, adjustedEndIndex);
        if (startIndex === -1 || startIndex + start.length > adjustedEndIndex) return '';
        return this.slice(startIndex + start.length, endIndex);
    }
}
String.prototype.splitLimit = function (separator: string, limit?: number) {
    if (this.isEmpty() || isNullOrUndefined(separator)) {
        throw new Error('Empty')
    }
    let body = this.split(separator)
    return limit ? body.slice(0, limit).concat(body.slice(limit).join(separator)) : body
}
String.prototype.truncate = function (maxLength) {
    return this.length > maxLength ? this.substring(0, maxLength) : this.toString()
}
String.prototype.trimHead = function (prefix: string) {
    return this.startsWith(prefix) ? this.slice(prefix.length) : this.toString()
}
String.prototype.trimTail = function (suffix: string) {
    return this.endsWith(suffix) ? this.slice(0, -suffix.length) : this.toString()
}
String.prototype.replaceEmojis = function (replace?: string | null) {
    return this.replaceAll(emojiRegex, replace ?? '')
}
String.prototype.toURL = function () {
    try {
        return new URL(this.toString())
    } catch (error) {
        if (error instanceof TypeError && this.toString().startsWith('//')) {
            return new URL(unsafeWindow.location.protocol + this.toString())
        }
        throw error
    }
}



/**
 * 节流函数，限制函数执行频率
 * @param fn 需要节流的函数
 * @param delay 节流时间间隔（毫秒）
 * @param options 配置选项
 * @returns 带有 cancel 方法的节流后函数
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    delay: number,
    { leading = true, trailing = true }: ThrottleOptions = {}
) {
    let lastCall = 0      // 上次执行时间戳
    let timer: ReturnType<typeof setTimeout> | null = null  // 定时器引用

    // 节流处理函数
    const throttled = function (this: any, ...args: Parameters<T>) {
        const now = Date.now()

        // 处理 leading=false 的首次调用
        if (!lastCall && !leading) {
            lastCall = now
        }

        const remaining = delay - (now - lastCall)  // 剩余等待时间

        // 到达可执行时间点
        if (remaining <= 0) {
            // 清除已有的 trailing 定时器
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            lastCall = now
            fn.apply(this, args)
        }
        // 需要设置 trailing 调用
        else if (trailing && !timer) {
            timer = setTimeout(() => {
                // 根据 leading 配置决定下次起始时间
                lastCall = leading ? Date.now() : 0
                timer = null
                fn.apply(this, args)
            }, remaining)
        }
    } as T & { cancel: () => void }

    /** 取消待执行的 trailing 调用 */
    throttled.cancel = () => {
        if (timer) {
            clearTimeout(timer)
            timer = null
        }
        lastCall = 0
    }

    return throttled
}
/**
 * 防抖函数，延迟执行直到停止调用指定时间
 * @param fn 需要防抖的函数
 * @param delay 防抖延迟时间（毫秒）
 * @param options 配置选项
 * @returns 带有 cancel 方法的防抖后函数
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number,
    { immediate = false }: DebounceOptions = {}
) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = function (this: any, ...args: Parameters<T>) {
        const callNow = immediate && !timer
        if (timer) {
            clearTimeout(timer)
        }
        timer = setTimeout(() => {
            timer = null
            if (!immediate) {
                fn.apply(this, args)
            }
        }, delay)
        if (callNow) {
            fn.apply(this, args)
        }
    } as T & { cancel: () => void }
    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer)
            timer = null
        }
    }
    return debounced
}
export function delay(time: number) {
    return new Promise(resolve => setTimeout(resolve, time))
}
export function hasProperty(element: HTMLElement, property: string): boolean {
    return property in element;
}
export function hasOwnProperty<T extends HTMLElement, K extends PropertyKey>(element: T, prop: K): element is T & Record<K, unknown> {
    return prop in element;
}
export function hasFunction<T, K extends string>(obj: T, method: K): obj is T & { [P in K]: Function } {
    return (
        isObject(obj) &&
        method in obj &&
        typeof (obj as Record<K, unknown>)[method] === 'function'
    );
};
export function UUID() {
    return isNullOrUndefined(crypto) ? Array.from({ length: 8 }, () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)).join('') : crypto.randomUUID().replaceAll('-', '')
}
export function stringify(data: unknown): string {
    switch (typeof data) {
        case 'undefined':
            return 'undefined'
        case 'boolean':
            return data ? 'true' : 'false'
        case 'number':
            return String(data)
        case 'string':
            return data
        case 'symbol':
            return data.toString()
        case 'function':
            return data.toString()
        case 'object':
            if (isNull(data)) {
                return 'null'
            }
            if (data instanceof Error) {
                return data.toString()
            }
            if (data instanceof Date) {
                return data.toISOString()
            }
            return JSON.stringify(data, null, 2)
        default:
            return 'unknown'
    }
}

export function prune<T>(data: T): Pruned<T> {
    if (isElement(data) || isNode(data)) {
        return data as Pruned<T>;
    }
    if (Array.isArray(data)) {
        return data.map(item => prune(item)).filter(isNotEmpty) as Pruned<T>;
    }
    if (isObject(data)) {
        const result = Object.fromEntries(
            Object.entries(data)
                .filter(([, v]) => isNotEmpty(v))
                .map(([k, v]) => [k, prune(v)])
                .filter(([, v]) => isNotEmpty(v))
        );
        return result as Pruned<T>;
    }
    return data as Pruned<T>;
}

/**
 * 字符串变量替换方法
 * @param {Record<string, unknown>} replacements - 替换键值对对象
 * @returns {string} 返回替换后的字符串
 * @example 
 * 'Hello AAAnameBBB'.replaceVariable({name: 'World'},'AAA','BBB') // 'Hello World'
 */
String.prototype.replaceVariable = function (replacements: Record<string, unknown>, prefix: string = '%#', suffix: string = '#%'): string {
    function escapeRegex(str: string): string {
        return str.replace(/[\.\*\+\?\^\$\{\}\(\)\|\[\]\\]/g, '\\$&');
    }
    let current = this.toString();
    prefix = escapeRegex(prefix);
    suffix = escapeRegex(suffix);
    const seen = new Set<string>();
    const patterns = Object.keys(replacements).map(key => {
        const escKey = escapeRegex(key);
        return {
            value: replacements[key],
            placeholderRegex: new RegExp(`${prefix}${escKey}(?=(?::.*?${suffix}|${suffix}))(?::.*?)?${suffix}`, 'gs'),
            placeholderFormatRegex: new RegExp(`(?<=${prefix}${escKey}(?=(?::.*?${suffix}|${suffix})):).*?(?=${suffix})`, 'gs')
        };
    });
    while (true) {
        if (seen.has(current)) {
            console.warn("检测到循环替换！", `终止于: ${current}`);
            break;
        }
        seen.add(current);
        let next = current;
        for (const { value, placeholderRegex, placeholderFormatRegex } of patterns) {
            if (placeholderRegex.test(next)) {
                let format = next.match(placeholderFormatRegex)
                if (!isNullOrUndefined(format) && format.any() && !format[0].isEmpty() && hasFunction(value, 'format')) {
                    next = next.replace(placeholderRegex, stringify(value.format(format[0])));
                } else {
                    next = next.replace(placeholderRegex, stringify(value instanceof Date ? value.format('YYYY-MM-DD') : value));
                }
            }
        }
        if (current === next) break;
        current = next;
    }
    return current;
};
