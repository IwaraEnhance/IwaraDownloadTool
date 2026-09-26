import '../core/env'
import { isNullOrUndefined } from '../core/env'
import { i18nList } from '../i18n'
import { ToastType } from '../core/enum'
import { config } from '../core/config'
import { renderNode } from '../core/extension'
import { activeToasts, Toast, ToastOptions } from './toastify'
import { createLogger } from '../core/log'
// 正文节点工厂的机制在 core/notify（协议），此处 re-export 维持既有调用点不变
import { toastNode, buildToastParamsFromReport } from '../core/notify'
import { resolvePlaceholders } from '../core/i18nRuntime'
import type { ReportOptions, ReportSink, ReportHandle } from '../core/notify'

export { toastNode }

const log = createLogger('Toast')

/**
 * ReportSink 适配器 —— 把 core/notify 的语义化报告翻译为 newToast。
 * 由 main 组装根在 bootstrap 阶段注入（core 层零 UI 反向依赖）。
 */
export function reportSinkAdapter(): ReportSink {
    return {
        info(options: ReportOptions) {
            showToastFromReport(ToastType.Info, options)
        },
        warn(options: ReportOptions) {
            showToastFromReport(ToastType.Warn, options)
        },
        error(options: ReportOptions) {
            showToastFromReport(ToastType.Error, options)
        },
        progress(options: ReportOptions): ReportHandle {
            // 常驻任务进度：duration -1 + 无点击兑底（ensureCloseMethod 因 duration 非空不补，
            // 进度条不可被误点消失）；文本与 ratio 更新都经 Toast 一等能力（setText/setProgressRatio）
            const toast = showToastFromReport(ToastType.Info, { ...options, duration: -1, close: false })
            return {
                update(next) {
                    if (typeof next.body === 'string') toast.setText(resolvePlaceholders(next.body))
                    if (next.progressRatio !== undefined) toast.setProgressRatio(next.progressRatio)
                },
                dismiss: () => toast.hide()
            }
        }
    }
}

function showToastFromReport(type: ToastType, options: ReportOptions): Toast {
    // 参数合成经 core/notify.buildToastParamsFromReport（纯函数，契约测试锁死：
    // 未传字段不产生自有键，底座默认语义不被 undefined/主动注入破坏）
    const params = buildToastParamsFromReport(options) as ToastOptions
    if (options.onClick !== undefined) {
        params.onClick = function (this: Toast) {
            this.hide()
            options.onClick?.(this)
        }
    }
    const toast = newToast(type, params)
    // 常驻报告回传 dismiss 句柄（供 ProgressTracker.close 等主动收起）
    options.onDismiss?.(() => toast.hide())
    toast.show()
    return toast
}

/**
 * 创建Toast通知的DOM节点 —— 机制已迁至 core/notify.toastNode，此处 re-export
 */

/**
 * 从DOM节点中提取文本内容
 * @param {Node|Element} node - 要提取文本的DOM节点
 * @returns {string} 返回提取的文本内容
 */
export function getTextNode(node: Node | Element): string {
    return node.nodeType === Node.TEXT_NODE ? node.textContent || '' : node.nodeType === Node.ELEMENT_NODE ? Array.from(node.childNodes).map(getTextNode).join('') : ''
}

/**
 * 创建新的Toast通知
 * @param {ToastType} type - Toast类型(Info/Warn/Error/Log)
 * @param {ToastOptions} params - Toast配置选项
 * @returns {Toast} 返回创建的Toast实例
 */
export function newToast(type: ToastType, params?: ToastOptions): Toast {
    const logFunc =
        {
            [ToastType.Warn]: log.warn,
            [ToastType.Error]: log.error,
            [ToastType.Log]: log.info,
            [ToastType.Info]: log.info
        }[type] || log.info
    if (isNullOrUndefined(params)) params = {}
    if (!isNullOrUndefined(params.id) && activeToasts.has(params.id)) activeToasts.get(params.id)?.hide()
    switch (type) {
        case ToastType.Info:
            params = Object.assign(
                {
                    duration: 2000,
                    style: {
                        background: 'linear-gradient(-30deg, rgb(0, 108, 215), rgb(0, 180, 255))'
                    }
                },
                params
            )
            break
        case ToastType.Warn:
            params = Object.assign(
                {
                    duration: -1,
                    style: {
                        background: 'linear-gradient(-30deg, rgb(119, 76, 0), rgb(255, 165, 0))'
                    }
                },
                params
            )
            break
        case ToastType.Error:
            params = Object.assign(
                {
                    duration: -1,
                    style: {
                        background: 'linear-gradient(-30deg, rgb(108, 0, 0), rgb(215, 0, 0))'
                    }
                },
                params
            )
            break
        default:
            break
    }
    if (!isNullOrUndefined(params.text)) {
        params.text = params.text.replaceVariable(i18nList[config.language]).toString()
    }
    // 交互按钮文本支持 %#i18nKey#% 占位符替换
    if (params.buttons && params.buttons.length > 0) {
        params.buttons = params.buttons.map((b) => ({ ...b, text: b.text.replaceVariable(i18nList[config.language]).toString() }))
    }
    logFunc((!isNullOrUndefined(params.text) ? params.text : !isNullOrUndefined(params.node) ? getTextNode(params.node) : 'undefined').replaceVariable(i18nList[config.language]))
    return new Toast(params)
}
