import { originalConsole } from "./hijack";

/**
 * 统一日志模块：所有运行时日志通过 createLogger(tag) 获取带前缀的 logger。
 * - 输出格式统一为 `[tag] 消息`，tag 为模块/子系统名；
 * - debug 级别仅 isDebug 开关开启时输出；
 * - 底层统一使用 originalConsole（绕过被劫持的 console）。
 */

export interface Logger {
    /** 调试日志：仅 isDebug 开启时输出 */
    debug(...args: any[]): void;
    /** 信息日志 */
    info(...args: any[]): void;
    /** 警告日志 */
    warn(...args: any[]): void;
    /** 错误日志 */
    error(...args: any[]): void;
}

/** 创建带统一前缀 `[tag]` 的 logger（debug 级别受 isDebug 开关控制） */
export function createLogger(tag: string): Logger {
    const prefix = `[${tag}]`;
    return {
        debug: (...args: any[]) => { GM_getValue('isDebug') && originalConsole.debug(prefix, ...args); },
        info: (...args: any[]) => { originalConsole.info(prefix, ...args); },
        warn: (...args: any[]) => { originalConsole.warn(prefix, ...args); },
        error: (...args: any[]) => { originalConsole.error(prefix, ...args); },
    };
}
