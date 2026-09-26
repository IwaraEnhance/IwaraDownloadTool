import './core/mutex'
import rainbowCSS from './css/rainbow.css'
import menuCSS from './css/menu.css'
import configCSS from './css/config.css'
import overlayCSS from './css/overlay.css'
import videoCardCSS from './css/videoCard.css'
import toastCSS from './css/toast.css'
import friendRequestsCSS from './css/friendRequests.css'
import beautifyCSS from './css/beautify.css'
import widescreenCSS from './css/widescreen.css'
import { isNullOrUndefined } from './core/env'
import { i18nList } from './i18n'
import { config, Config } from './core/config'
import { originalAddEventListener } from './core/hijack'
import { runMigrations } from './core/migration'
import { GM_KEY_IS_DEBUG, GM_KEY_IS_FIRST_RUN, GM_KEY_VERSION } from './core/constants'
import { setPlaceholderResolver } from './core/i18nRuntime'
import { setReportSink } from './core/notify'
import { getPageType } from './core/browserEnv'
import { installPlatformHooks, onNodeAdded, onNodeRemoved, onHistoryChange } from './core/platformHooks'
import { on } from './core/events'
import './context/site' // 环境守卫（domain/scriptHandler：'Not target'/封杀 Via）加载期求值
import { selectList, pageSelectButtons, getSelectButton, updateButtonState } from './context/selection'
import { installSelectionShortcuts } from './features/selection'
import { check } from './network/envCheck'
import { verifyLogin } from './network/auth'
import { createInterceptedFetch } from './network/fetchInterceptor'
import { newToast, toastNode, reportSinkAdapter } from './ui/notify'
import { configEdit, injectCheckbox, menu, uninjectCheckbox, waterMark } from './ui/uiCompat'
import { setupMenuActions, installCheckboxCallbacks } from './ui/setup'
import { ToastType } from './core/enum'
import { pushToMediaCenter } from './features/mediaSync'
import { setMediaCenterPushHook, trackExistingAria2Tasks, enqueueAria2TrackTask } from './features/aria2Track'
import { pushDownloadTask, setPageTypeProbe } from './features/downloadFlow'
import { setAria2TrackEnqueueHook } from './download/aria2'
import { setRetryDownloadHook } from './download/download'
// 导入即完成规则注册（friend-requests.ts 模块顶层向 injectionWatcher 注册），调度器随首个规则启动
import { injectFriendApproveButton } from './features/friendRequests'
import { registerInjectionRule } from './core/injectionWatcher'
import { firstRun, showGuideOverlay, showNoticeToast, promoteAuthor, setOnboardingActions } from './features/onboarding'
import { exposeDebugTools } from './features/debugExpose'

// fetch 拦截器：保持原模块顶层副作用时机（早于站点请求发出）
unsafeWindow.fetch = createInterceptedFetch()

// ── i18n 钩子：renderNode/newToast 的 %#…#% 解析器由 bootstrap 注册 ──
setPlaceholderResolver((text) => text.replaceVariable(i18nList[config.language]))

// ── 用户报告通道：core/network/download 层经 core/notify 报告，此处注入 UI 适配 ──
setReportSink(reportSinkAdapter())

// ── debug 断点 + 工具暴露（features/debugExpose：仅 isDebug，无启动副作用） ──
if (exposeDebugTools()) debugger

// ── UI 实例组装（openSettings 由构造参数注入） ──
// configEdit 的保存前环境校验经构造期注入（ui 不 import network）；
// firstRun 重建 configEdit 实例后 openSettings 闭包经 export var 惰性求值取到新实例（var 提升绑定）
export var pluginMenu = new menu({ openSettings: () => editConfig.inject() })
export var editConfig = new configEdit(config, () => check())
export var watermark = new waterMark()
setupMenuActions(pluginMenu)
installCheckboxCallbacks()

// onboarding 不反向 import 组装根：经注入获得"打开配置面板"动作
setOnboardingActions({ openSettings: () => editConfig.inject() })

// download-flow 判定"非视频页才检查外链"需要页面类型；注入探针避免它反向依赖 UI 层
setPageTypeProbe(() => pluginMenu.pageType)

// 登录令牌变化 → 菜单刷新（原 hijackStorage 直呼 pageChange 的事件化解耦）
on('auth:token-changed', () => pluginMenu.pageChange())

// selection 状态变更 → 水印计数 + 复选框态自刷新（原三回调链事件化后的订阅端）
on('selection:changed', ({ size, videoId }) => {
    watermark.selected.textContent = ` ${i18nList[config.language].selected} ${size} `
    if (videoId) {
        const selectButton = getSelectButton(videoId)
        if (selectButton) selectButton.checked = selectList.has(videoId)
    } else {
        pageSelectButtons.forEach((_, key) => updateButtonState(key))
    }
})

// ── 页面切换流水线：平台钩子 → pageType 更新 → 业务订阅 ──
function pageChange() {
    pluginMenu.pageType = getPageType()
    // 好友请求页：开启一键审批时注入按钮（内部自校验页面路径与登录态，重复调用安全）
    if (config.friendRequestApprove) injectFriendApproveButton()
}

// ── 首次安装/引导/公告/启动任务已迁 features/onboarding（注入 openSettings 动作，见上方 setOnboardingActions） ──
// debug 测试钩子依赖 firstRun/showGuideOverlay：保留暴露面，经 onboarding 模块的导出重接
if (GM_getValue(GM_KEY_IS_DEBUG)) {
    // @ts-ignore
    // 测试首次安装引导弹窗（注意：会清空所有配置并重新显示引导）
    unsafeWindow.testFirstRun = () => firstRun(() => editConfig.inject())
    // @ts-ignore
    // 测试引导弹窗（不清空配置，确认后打开配置面板）
    unsafeWindow.testGuideOverlay = showGuideOverlay
}

// ── 主流程：顺序即装配顺序 ──
async function main() {
    ;[rainbowCSS, menuCSS, configCSS, overlayCSS, videoCardCSS, toastCSS, friendRequestsCSS].forEach((css) => GM_addStyle(css))
    // injectionWatcher 已在模块加载阶段启动（friend-requests.ts 顶层注册规则），
    // document-start 早于站点 React 挂载，调度器从头跟随官方托管树

    // 升级迁移：旧版本数据不兼容时执行清理（提示文案由注入回调提供）
    const migration = await runMigrations({
        selectList,
        notifyIncompatible: () => alert(i18nList[config.language].configurationIncompatible)
    })
    if (migration === 'failed') return // 迁移失败：中止启动，版本号未更新，下次启动自动重试
    if (migration === 'reload') {
        unsafeWindow.location.reload()
        return
    }

    // 首次安装引导（3.3.0 之前的旧版本由迁移置 isFirstRun=true 触发）；openSettings 动作注入重建后的面板
    if (GM_getValue(GM_KEY_IS_FIRST_RUN, true)) {
        firstRun(() => editConfig.inject())
        return
    }

    GM_setValue(GM_KEY_VERSION, GM_info.script.version)
    watermark.inject()

    config.enableBeautify && GM_addStyle(beautifyCSS)
    config.enableWidescreen && GM_addStyle(widescreenCSS)
    if (!(await check())) {
        newToast(ToastType.Info, {
            text: `%#configError#%`,
            duration: 60 * 1000
        }).show()
        editConfig.inject()
        return
    }

    // 平台钩子安装与业务订阅
    installPlatformHooks({ watchNodeAppend: config.autoInjectCheckbox })
    onNodeAdded((node) => injectCheckbox(node as Element))
    onNodeRemoved((node) => uninjectCheckbox(node))
    onHistoryChange(() => pageChange())
    installSelectionShortcuts()

    // #app 就绪后挂载插件菜单并补发 pageChange（冷加载补发必须显式执行）；
    // 菜单节点被站点清除时由调度器自动补种
    registerInjectionRule({
        id: 'pluginMenuShell',
        isTargetPage: () => true,
        isReady: () => !isNullOrUndefined(unsafeWindow.document.getElementById('app')),
        markerSelector: '#pluginMenu',
        inject: () => {
            pluginMenu.inject() // menu 内部会 observe #app 驱动 pageType 变化
            pageChange() // 冷加载补发：Proxy 仅在 pageType 变化时刷新菜单，不能依赖
        }
    })

    // MediaCenter 推送 hook：下载完成后由 aria2-track 经此回调进入 feature 层推送
    // （推送回调由 aria2-track 在下载完成后经运行时注入的 hook 调用）
    setMediaCenterPushHook(async (videoInfo) => {
        if (!(await pushToMediaCenter(videoInfo))) throw new Error('MediaCenter push failed')
    })
    // Aria2 入队 hook：aria2Download 成功后进入跨页追踪队列（队列在 feature 层）
    setAria2TrackEnqueueHook((videoId, gid, downloadParams) => enqueueAria2TrackTask(videoId, gid, downloadParams))
    // browserDownload 失败重试 hook：回调进入 download-flow 的推送编排
    setRetryDownloadHook((videoInfo) => pushDownloadTask(videoInfo))

    if (await verifyLogin(true)) {
        await promoteAuthor()
    }
    showNoticeToast()

    // 启动时接管现有 Aria2 任务的追踪（不阻塞启动流程）
    trackExistingAria2Tasks()
};
(unsafeWindow.document.body ? Promise.resolve() : new Promise((resolve) => originalAddEventListener.call(unsafeWindow.document, 'DOMContentLoaded', resolve))).then(main)
