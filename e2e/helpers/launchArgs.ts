/**
 * Chrome 显示模式开关 —— 不依赖 @playwright/test。
 *
 * 默认**有头**窗口（本机调试可旁观）；`E2E_HEADLESS=1`
 * （或 true/yes）切无头：CI / 无显示服务器必须用。
 *
 * ⚠️ 跨平台实证（2026-10-02）：launchPersistentContext 的 `headless` 选项**默认 true**
 * ——只去掉 `--headless=new` 启动参数并不会开出窗口（Playwright 会自行注入无头开关），
 * 反之「headless:false + --headless=new 参数」也会被参数覆盖。两项必须一致下发：
 * - 无头：headless: true + `--headless=new` 参数（新无头才允许 --load-extension 加载扩展）；
 * - 有头：headless: false，不传任何无头参数。
 */
export interface DisplayOptions {
    /** 传给 launchPersistentContext 的 headless 选项（必须显式，缺省 true 是无头的隐藏根因） */
    headless: boolean
    /** 追加启动参数（无头含 --headless=new；有头为空） */
    args: string[]
}

export function displayOptions(value = process.env.E2E_HEADLESS): DisplayOptions {
    const headless = /^(1|true|yes)$/i.test(value?.trim() ?? '')
    return headless ? { headless: true, args: ['--headless=new'] } : { headless: false, args: [] }
}

/**
 * 启动通道（Playwright 官方「Google Chrome & Microsoft Edge」章节）：
 * Playwright 缺省发开源 Chromium 构建——Cloudflare 等风控对自动化构建指纹最敏感；
 * `channel: 'chrome'` 用本机真实品牌 Chrome（真实 UA/字体/编解码器/组件）。
 * `E2E_BROWSER=chromium` 可切回开源 Chromium（扩展兼容性排查用）。
 */
export function browserChannel(value = process.env.E2E_BROWSER): 'chrome' | 'chromium' {
    return /^(chromium|chromium-headless|chrome-headless-shell)$/i.test(value?.trim() ?? '') ? 'chromium' : 'chrome'
}

/**
 * 反自动化指纹参数（GitHub 实证：fingerprintjs/BotD#112、microsoft/playwright#37424——
 * 有头模式下主要检测信号是 navigator.webdriver；AutomationControlled 即其开关）。
 * - 摘除 blink 的 AutomationControlled：navigator.webdriver 不再为 true；
 * - ignoreDefaultArgs 去掉 --enable-automation（自动化信息条 + 更多暴露面），在 fixtures 里配。
 */
export const ANTI_FINGERPRINT_ARGS = ['--disable-blink-features=AutomationControlled'] as const

/** 当前是否无头模式（CI/无显示服务器）：人在模式据此决定是否弹浏览器内确认面板 */
export function isHeadless(): boolean {
    return displayOptions().headless
}
