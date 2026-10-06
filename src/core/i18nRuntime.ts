/**
 * i18n 运行时钩子（占位符解析函数由 bootstrap 注入）。
 *
 * 反转 core/extension 对 i18n+config 的直接依赖：extension 的 renderNode 处理
 * `%#key#%` 占位符时不再 import i18nList/config，而是调用本模块注册的解析器；
 * bootstrap（main.ts）负责把「i18nList[config.language] 查表替换」注册进来。
 *
 * 128 处 `%#…#%` 调用点零改动；测试环境未注册解析器时原样返回（占位符保留）。
 */

type Resolver = (text: string) => string

let resolver: Resolver = (text) => text

/** 注册占位符解析器（bootstrap 时机调用；重复注册以最后一次为准） */
export function setPlaceholderResolver(fn: Resolver): void {
    resolver = fn
}

/** 解析文本中的占位符（未注册时恒等返回） */
export function resolvePlaceholders(text: string): string {
    return resolver(text)
}

/** 当前解析器是否已被 bootstrap 注册（测试可据此断言装载状态） */
export function hasPlaceholderResolver(): boolean {
    return resolver !== identity
}

function identity(text: string): string {
    return text
}
