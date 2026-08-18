/** 构建工具统一日志输出 */

export type Tag = 'build' | 'release' | 'i18n' | 'git'

export function log(tag: Tag, message: string): void {
    console.log(`[${tag}] ${message}`)
}

export function success(tag: Tag, message: string): void {
    console.log(`[${tag}] ✓ ${message}`)
}

export function error(tag: Tag, message: string): void {
    console.error(`[${tag}] ✗ ${message}`)
}

export function warn(tag: Tag, message: string): void {
    console.warn(`[${tag}] ⚠ ${message}`)
}
