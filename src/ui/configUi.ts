import "../core/env";
import { isNullOrUndefined, stringify } from "../core/env";
import { i18nList } from "../i18n";
import { ToastType } from "../core/enum";
import { Config, config } from "../core/config";
import { renderNode } from "../core/extension";
import { newToast } from "./notify";

/**
 * 导入配置文件到脚本（通过文本框粘贴 JSON 配置）
 */
export async function importConfig() {
    // 防连点叠加多个输入弹窗
    if (unsafeWindow.document.querySelector('#pluginOverlay')) return
    let textArea = renderNode({
        nodeType: "textarea",
        attributes: {
            placeholder: i18nList[config.language].importConfig,
            style: 'margin-bottom: 10px;',
            rows: "16",
            cols: "96"
        }
    })
    let body = renderNode({
        nodeType: "div",
        attributes: {
            id: "pluginOverlay"
        },
        childs: [
            textArea,
            {
                nodeType: "button",
                events: {
                    click: (e: Event) => {
                        if (!isNullOrUndefined(textArea.value) && !textArea.value.isEmpty()) {
                            try {
                                let tempConfig = JSON.parse(textArea.value)
                                if (!tempConfig || typeof tempConfig !== 'object') {
                                    throw "配置校验失败"
                                }
                                Config.initInstance(tempConfig)
                                unsafeWindow.location.reload()
                            } catch (error) {
                                newToast(ToastType.Error, {
                                    node: renderNode({
                                        nodeType: 'p',
                                        childs: [
                                            "%#importConfigFail#%",
                                            stringify(error)
                                        ]
                                    })
                                }).show()
                            }
                        }
                        body.remove()
                    }
                },
                childs: i18nList[config.language].ok
            }
        ]
    })
    unsafeWindow.document.body.appendChild(body)
}
