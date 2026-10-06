/**
 * 语义化用户报告协议
 *
 * 职责：core/network/download 层的"用户报告"机制，无任何 UI 依赖（sink 由
 * main 组装根注入）。下层模块通过意图函数报告，不再 import ui/notify。
 *
 * 双通道设计：
 * - report(level, options)：意图函数（级别 + 载荷 + 选项），零 DOM 细节 ——
 *   下层模块唯一消费面；未注入 sink 时 console 降级（测试环境安全）。
 * - toastNode：结构化正体裁荷工厂（原 ui/notify.toastNode 的机制部分迁入，
 *   渲染仍由 ui 层 newToast 适配链完成）—— 供需要行结构/br 的调用方构造 body。
 *
 * 不收敛为通用报告的场景：与领域强绑定的交互式 toast（aria2Track
 * 的 trackStatusToast、downloadFlow 的 checkDownloadLink 按钮行等）保留原样。
 */
import { isNullOrUndefined } from './env'
import { renderNode } from './extension'

// ── 报告通道协议（ui/notify.newToast 适配为 sink，main 注入） ──

/** 报告级别（ui 层适配为 ToastType：info→Info、warn→Warn、error→Error） */
export type ReportLevel = 'info' | 'warn' | 'error'

/** 结构化正体裁荷：纯字符串（支持 %#i18nKey#%）或 DOM 节点 */
export type ReportBody = string | Node

/** 报告选项（toast 属性的无 UI 依赖子集） */
/**
 * 语义化报告选项。body 为**意图描述**（字符串或结构化节点工厂产物），
 * 展示细节全部由 sink 适配层决策——core 不构造带样式补丁的 DOM。
 */
export interface ReportOptions {
    /** 报告标题（toast h3 行；省略则只显示 appName） */
    title?: string
    /** 正体裁荷 */
    body: ReportBody
    /** 停留时长 ms；-1 = 常驻（须配 close 或 onClick 才可手动关闭） */
    duration?: number
    /** 是否显示 × 关闭钮 */
    close?: boolean
    /** 确定性任务进度（0~1）：sink 适配层映射为 toast 的 progressRatio 能力 */
    progressRatio?: number
    /** 整块点击回调（sink 实现 hide 语义） */
    onClick?: (host: unknown) => void
    /** 常驻报告（duration:-1）时，sink 回传收起句柄供调用方主动关闭 */
    onDismiss?: (dismiss: () => void) => void
    /** 定位（可选；语义层通常不关心） */
    gravity?: 'top' | 'bottom'
    position?: 'left' | 'center' | 'right'
}

/** 常驻报告的活动句柄：update（文本/进度原地刷新）与 dismiss（收起）。
 * 替代「调用方自持 DOM 节点 + onDismiss 回传 hide」的补丁组合：文本与进度
 * 都经语义通道传递，DOM 归 sink。*/
export interface ReportHandle {
    /** 原地刷新文本（Node 载荷的常驻报告由 sink 决定如何更新） */
    update(options: Partial<Pick<ReportOptions, 'body' | 'progressRatio'>>): void
    /** 收起报告 */
    dismiss(): void
}

/** 报告 sink：由 main 用 ui/notify.newToast 适配后注入 */
export interface ReportSink {
    info(options: ReportOptions): void
    warn(options: ReportOptions): void
    error(options: ReportOptions): void
    /** 显示常驻进度报告并返回活动句柄（update/dismiss 原地生效）；默认实现可由适配器基于 info 提钢 */
    progress?(options: ReportOptions): ReportHandle
}

let sink: ReportSink | undefined

/** 由 main 组装根调用（bootstrap 阶段，必须先于任何报告调用） */
export function setReportSink(s: ReportSink): void {
    sink = s
}

/** 语义化报告入口：下层模块唯一消费面，未注入 sink 时 console 降级 */
export function report(level: ReportLevel, options: ReportOptions): void {
    if (!isNullOrUndefined(sink)) {
        sink[level](options)
        return
    }
    const text = typeof options.body === 'string' ? options.body : (options.body.textContent ?? '')
    const line = `[report:${level}]${options.title ? ` (${options.title})` : ''} ${text}`
    if (level === 'error') console.error(line)
    else console.warn(line)
}

/**
 * 常驻任务进度报告（句柄型）：返回 update/dismiss 句柄，文本与确定性进度条
 * 原地刷新。sink 未实现 progress 时一次性降级（console + no-op 句柄）。
 */
export function progress(options: ReportOptions): ReportHandle {
    if (!isNullOrUndefined(sink?.progress)) return sink.progress!(options)
    const text = typeof options.body === 'string' ? options.body : (options.body.textContent ?? '')
    console.warn(`[report:progress] ${text}`)
    return { update: () => undefined, dismiss: () => undefined }
}

/**
 * ReportOptions → Toast 参数的纯合并函数（无 DOM，可单测）。
 *
 * 契约（守护测试 test/tests/notifyMerge.test.ts 锁死）：
 * 1. 未传字段不产生自有键——底座 newToast 用 Object.assign(默认值, params) 合并，
 *    `{duration: undefined}` 的自有键会把类型默认 duration 覆盖为 undefined，
 *    导致 toast 永不自动消失（已发生的三连回归之一）。
 * 2. 不合成默认 onClick（含常驻报告）——点击兜底由底座 ensureCloseMethod
 *    按「duration/close/onClick/buttons 四项全空才补」的语义自然处理；适配器
 *    注入点击隐藏会让常驻进度条可被误点消失（已发生率第二）。
 */
export function buildToastParamsFromReport(options: ReportOptions): Record<string, unknown> {
    const params: Record<string, unknown> = {
        text: typeof options.body === 'string' ? options.body : undefined,
        node: typeof options.body === 'string' ? undefined : options.body
    }
    if (options.duration !== undefined) params.duration = options.duration
    if (options.close !== undefined) params.close = options.close
    if (options.gravity !== undefined) params.gravity = options.gravity
    if (options.position !== undefined) params.position = options.position
    if (options.progressRatio !== undefined) params.progressRatio = options.progressRatio
    // 注意：不合成默认 onClick/duration/close——未传字段让底座按自身默认语义自然补齐
    return params
}

// ── 结构化正体裁荷工厂（原 ui/notify.toastNode：h3 标题 + p 正体） ──

/**
 * 创建报告正体节点（%#…#% 渲染由 ui/newToast 的 placeholder resolver 在 show 时完成）
 */
export function toastNode(body: RenderCode<any>['childs'], title?: string): Node {
    return renderNode({
        nodeType: 'div',
        childs: [
            !isNullOrUndefined(title) && !title.isEmpty()
                ? {
                    nodeType: 'h3',
                    childs: `%#appName#% - ${title}`
                }
                : {
                    nodeType: 'h3',
                    childs: '%#appName#%'
                },
            {
                nodeType: 'p',
                childs: body
            }
        ]
    })
}
