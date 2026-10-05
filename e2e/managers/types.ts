/**
 * 脚本管理器驱动抽象：把「管理器特定」的扩展装载与脚本安装收敛为策略接口，
 * fixtures 的通用链路（两阶段 userScriptsAccess 权限预配置、profile 隔离、
 * 事件/产物解析）全部同源共享。E2E_MANAGER=scriptcat|tampermonkey|violentmonkey
 * 是切换点——安装驱动是唯一需要按管理器分叉的部分。
 */
import type { BrowserContext } from '@playwright/test'

export type ManagerId = 'scriptcat' | 'tampermonkey' | 'violentmonkey'

export interface ManagerDriver {
    /** 管理器标识（与 E2E_MANAGER 取值一致） */
    readonly id: ManagerId
    /** 解析扩展目录（需含 manifest.json）；不可用时抛出带修复指引的错误 */
    resolveExtension(): Promise<string>
    /**
     * 管理器自身配置预配置（可选，Phase 1 权限预配置后调用）。
     * 例：TM 需把 scriptUrlDetection 写为 legacy——5.x auto 模式不接管 http(s)
     * 的 .user.js 导航，legacy 才会自动弹安装页。写入进基准 profile，Phase 2 生效。
     */
    prepareProfile?(context: BrowserContext, extensionId: string): Promise<void>
    /**
     * 运行时权限/配置预配置（可选，Phase 2 扩展载入后、installScript 前调用）。
     * 与 prepareProfile 的区别：直接操作**当前 context 里当前扩展实例**的
     * chrome://extensions 管理页（developerPrivate）写权限，不依赖基准 profile
     * 持久化与哨兵时序——「每次载入扩展实例都需要」的权限归这里（如 TM 的
     * fileAccess=true 需对本次 CDP 动态 loadUnpacked 的实例生效）。
     */
    prepareRuntime?(context: BrowserContext, extensionId: string): Promise<void>
    /** 在扩展上下文中安装脚本；返回脚本引用句柄（各管理器唯一分叉点） */
    installScript(context: BrowserContext, extensionId: string, scriptPath: string): Promise<string>
    /**
     * 安装页 URL 判定（可选，默认 /install/i）。
     * 用途：管理器首启/启用时会自动弹「安装成功/权限引导」页，抑制器据此
     * 只保留真正的安装页，其余自启扩展页面一律自动关闭。
     */
    isInstallPageUrl?(url: string): boolean
    /**
     * 可选：在扩展 SW 层面拦截 tabs.create，非安装页的创建请求直接丢弃
     * （源头拦截，比「弹出后关闭」更彻底，不产生窗口闪烁）。返回恢复函数。
     */
    patchTabsCreate?(context: BrowserContext, extensionId: string): Promise<() => void>
    /**
     * 可选：该管理器自启「噪音外链页」的 URL 前缀列表（fixtures 兜底清扫用，
     * 与 chrome-extension:// 页一并事件级自动关闭）。管理器专有知识归驱动声明，
     * fixtures 不硬编码任何具体管理器的域名。
     */
    noiseUrlPatterns?: string[]
}
