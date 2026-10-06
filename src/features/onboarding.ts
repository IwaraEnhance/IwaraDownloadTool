/**
 * 首装引导 / 公告 / 启动任务。
 * configEdit 实例由 main 组装根经 setOnboardingActions 注入（本模块不反向 import 组装根）；
 * 依赖倒置：configEdit 实例由 main 组装根经 setOnboardingActions 注入（feature
 * 不反向 import 组装根）；脚本作者关注受 config.promoteScriptAuthor 开关控制（默认
 * true 保持原行为）。
 */
import '../core/env'
import { isNullOrUndefined } from '../core/env'
import { createLogger } from '../core/log'
import { config, Config } from '../core/config'
import { renderNode, unlimitedFetch } from '../core/extension'
import { i18nList } from '../i18n'
import { newToast, toastNode } from '../ui/notify'
import { ToastType } from '../core/enum'
import { GM_KEY_IS_FIRST_RUN, GM_KEY_VERSION } from '../core/constants'
import { originalNodeAppendChild } from '../core/hijack'
import { getAuth } from '../network/auth'
import { getLocalUser } from '../network/users'
import { followUser, addFriend } from '../network/interactions'
import { apiUrl } from '../context/site'

const log = createLogger('Onboarding')

/** 组装根注入的动作（configEdit 实例在 main 组装期才存在） */
let actions: { openSettings: () => void } | undefined
export function setOnboardingActions(a: { openSettings: () => void }): void {
    actions = a
}

/** 首次安装引导弹窗（不清空配置；确认后打开配置面板） */
export function showGuideOverlay(confirm?: () => void) {
    let confirmButton = renderNode({
        nodeType: 'button',
        attributes: {
            disabled: true,
            title: i18nList[config.language].ok
        },
        childs: '%#ok#%',
        events: {
            click: () => {
                unsafeWindow.document.querySelector('#pluginOverlay')?.remove()
                if (confirm) {
                    confirm()
                } else {
                    actions?.openSettings()
                }
            }
        }
    })
    originalNodeAppendChild.call(
        unsafeWindow.document.body,
        renderNode({
            nodeType: 'div',
            attributes: {
                id: 'pluginOverlay'
            },
            childs: [
                {
                    nodeType: 'div',
                    className: 'main',
                    childs: [
                        { nodeType: 'p', childs: i18nList[config.language].useHelpForBase },
                        { nodeType: 'p', childs: '%#useHelpForInjectCheckbox#%' },
                        { nodeType: 'p', childs: '%#useHelpForCheckDownloadLink#%' },
                        { nodeType: 'p', childs: i18nList[config.language].useHelpForManualDownload },
                        { nodeType: 'p', childs: '%#useHelpForBugreport#%' }
                    ]
                },
                {
                    nodeType: 'div',
                    className: 'checkbox-container',
                    childs: {
                        nodeType: 'label',
                        className: ['checkbox-label', 'rainbow-text'],
                        childs: [
                            {
                                nodeType: 'input',
                                className: 'checkbox',
                                attributes: {
                                    type: 'checkbox',
                                    name: 'agree-checkbox'
                                },
                                events: {
                                    change: (event: Event) => {
                                        confirmButton.disabled = !(event.target as HTMLInputElement).checked
                                    }
                                }
                            },
                            '%#alreadyKnowHowToUse#%'
                        ]
                    }
                },
                confirmButton
            ]
        })
    )
}

/**
 * 首次安装流程：清空全部 GM 存储 → 重建配置实例 → 显示引导（确认后写回标志并打开配置面板）。
 * 注意：openSettings 回调需捕获重建后的 configEdit——经 actions 闭包保证取到最新实例。
 */
export function firstRun(openSettings: () => void) {
    GM_listValues().forEach((i) => GM_deleteValue(i))
    Config.destroyInstance()
    setOnboardingActions({ openSettings })
    showGuideOverlay(() => {
        GM_setValue(GM_KEY_IS_FIRST_RUN, false)
        GM_setValue(GM_KEY_VERSION, GM_info.script.version)
        openSettings()
    })
}

/** 启动公告 toast（i18n notice，10s，点击收起） */
export function showNoticeToast(): void {
    newToast(ToastType.Info, {
        node: toastNode(i18nList[config.language].notice),
        duration: 10000,
        gravity: 'bottom',
        position: 'center',
        onClick() {
            this.hide()
        }
    }).show()
}

/** 账号可互动判定：官方前端枚举（main bundle 常量区实证）为 ["inactive", "active", "banned"]。
 * verifyLogin 只验 token 有效性——banned 账号 token 有效但无互动权限（POST /followers 会失败），
 * 需在发起互动前检查；status 字段缺省时保守视为可互动（不阻塞旧行为）。*/
function isAccountActive(user: Iwara.User): boolean {
    return user.status === undefined || user.status === 'active'
}

export async function promoteAuthor(): Promise<void> {
    if (!config.promoteScriptAuthor) return
    try {
        const localUser = await getLocalUser({ refresh: true })
        const authorProfileRes = await unlimitedFetch(apiUrl('/profile/dawn'), {
            method: 'GET',
            headers: await getAuth()
        })
        if (isNullOrUndefined(localUser) || !authorProfileRes.ok) {
            log.warn('登录态验证请求失败:', !authorProfileRes.ok ? authorProfileRes.status : 'localUser null')
            return
        }
        const authorProfile = (await authorProfileRes.json()) as Iwara.Profile
        const author = authorProfile.user
        if (localUser.id !== author.id) {
            if (!author.following) followUser(author.id).catch(() => undefined)
            if (!author.friend) addFriend(author.id).catch(() => undefined)
        }
    } catch (error) {
        log.warn('验证登录态时出错:', error)
    }
}
