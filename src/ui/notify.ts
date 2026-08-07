import "../core/env";
import { isNullOrUndefined } from "../core/env";
import { i18nList } from "../i18n";
import { ToastType } from "../core/enum";
import { config } from "../core/config";
import { renderNode } from "../core/extension";
import { activeToasts, Toast, ToastOptions } from "./toastify";
import { createLogger } from "../core/log";

const log = createLogger('Toast');

/**
 * 创建Toast通知的DOM节点
 * @param {RenderCode<any>["childs"]} body - 通知主体内容
 * @param {string} [title] - 可选的通知标题
 * @returns {Element|Node} 返回创建的DOM节点
 */
export function toastNode(body: RenderCode<any>["childs"], title?: string): Element | Node {
    return renderNode({
        nodeType: 'div',
        childs: [
            !isNullOrUndefined(title) && !title.isEmpty() ? {
                nodeType: 'h3',
                childs: `%#appName#% - ${title}`
            } : {
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

/**
 * 从DOM节点中提取文本内容
 * @param {Node|Element} node - 要提取文本的DOM节点
 * @returns {string} 返回提取的文本内容
 */
export function getTextNode(node: Node | Element): string {
    return node.nodeType === Node.TEXT_NODE
        ? node.textContent || ''
        : node.nodeType === Node.ELEMENT_NODE
            ? Array.from(node.childNodes)
                .map(getTextNode)
                .join('')
            : ''
}

/**
 * 创建新的Toast通知
 * @param {ToastType} type - Toast类型(Info/Warn/Error/Log)
 * @param {ToastOptions} params - Toast配置选项
 * @returns {Toast} 返回创建的Toast实例
 */
export function newToast(type: ToastType, params?: ToastOptions): Toast {
    const logFunc = {
        [ToastType.Warn]: log.warn,
        [ToastType.Error]: log.error,
        [ToastType.Log]: log.info,
        [ToastType.Info]: log.info,
    }[type] || log.info
    if (isNullOrUndefined(params)) params = {}
    if (!isNullOrUndefined(params.id) && activeToasts.has(params.id)) activeToasts.get(params.id)?.hide()
    switch (type) {
        case ToastType.Info:
            params = Object.assign({
                duration: 2000,
                style: {
                    background: 'linear-gradient(-30deg, rgb(0, 108, 215), rgb(0, 180, 255))'
                }
            }, params)
            break;
        case ToastType.Warn:
            params = Object.assign({
                duration: -1,
                style: {
                    background: 'linear-gradient(-30deg, rgb(119, 76, 0), rgb(255, 165, 0))'
                }
            }, params)
            break;
        case ToastType.Error:
            params = Object.assign({
                duration: -1,
                style: {
                    background: 'linear-gradient(-30deg, rgb(108, 0, 0), rgb(215, 0, 0))'
                }
            }, params)
            break;
        default:
            break;
    }
    if (!isNullOrUndefined(params.text)) {
        params.text = params.text.replaceVariable(i18nList[config.language]).toString()
    }
    logFunc((!isNullOrUndefined(params.text) ? params.text : !isNullOrUndefined(params.node) ? getTextNode(params.node) : 'undefined').replaceVariable(i18nList[config.language]))
    return new Toast(params)
}
