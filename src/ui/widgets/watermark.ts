/**
 * 水印组件（选中计数 + debug 入口五连击）。
 */
import { config } from '../../core/config'
import { GM_KEY_IS_DEBUG, GM_KEY_VERSION } from '../../core/constants'
import { renderNode } from '../../core/extension'
import { originalNodeAppendChild } from '../../core/hijack'
import { i18nList } from '../../i18n'
import { selectList } from '../../context/selection'

const DEBUG_SWITCH_THRESHOLD = 5

export class waterMark {
    debugSwitchCount = 0
    selected = renderNode({
        nodeType: 'span',
        childs: ` %#selected#% ${selectList.size} `
    })
    debugFlag = renderNode({
        nodeType: 'span',
        childs: `${GM_getValue(GM_KEY_IS_DEBUG) ? `${i18nList[config.language].isDebug} ${GM_info.scriptHandler}` : ''}`
    })
    body = renderNode({
        nodeType: 'p',
        className: 'fixed-bottom-right',
        childs: [`%#appName#% ${GM_getValue(GM_KEY_VERSION)} `, this.selected, this.debugFlag],
        events: {
            click: (e: Event) => {
                if (GM_getValue(GM_KEY_IS_DEBUG)) return
                if (this.debugSwitchCount < DEBUG_SWITCH_THRESHOLD) {
                    this.debugSwitchCount++
                    return
                } else {
                    GM_setValue(GM_KEY_IS_DEBUG, true)
                    this.debugFlag.textContent = `${GM_getValue(GM_KEY_IS_DEBUG) ? i18nList[config.language].isDebug : ''}`
                    unsafeWindow.location.reload()
                }
            }
        }
    })
    public inject() {
        originalNodeAppendChild.call(unsafeWindow.document.body, this.body)
    }
}
