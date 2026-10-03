/**
 * Cloudflare 管理挑战（Managed Challenge）检测与应对。
 *
 * 真实站点风控对自动化指纹偶发派发挑战（「Performing security verification」）：
 * 脚本照常注入（水印可见）但站点 #app 不挂载 → 菜单/卡片断言全部落空。
 * 挑战文本在 goto/reload 后有数秒渲染延迟——一次性探测会漏判，必须在循环内反复复查。
 *
 * 两处消费：
 * - fixtures.ts 的 warmSiteCookie：Phase 1 预热 cf_clearance 到基准 profile，
 *   Phase 2 每用例拷贝即继承（UA/指纹同源，cookie 绑定有效）；
 * - uiBehavior.spec.ts 的 waitForScriptReady 安定循环：挑战迟到渲染/过期重派发时兜底。
 *
 * 降低挑战派发率本身在 launchArgs/fixtures（channel: 'chrome' 真实浏览器 +
 * AutomationControlled 摘除），本模块只负责「派发了就等它过」。
 */
import type { Page } from '@playwright/test'
import { humanTimeoutMs, isHumanMode } from './human'
import { mataInfo } from './mataInfo'

/** 挑战页探测：正文特征文本 + turnstile DOM 标记 */
export async function isChallengePage(page: Page): Promise<boolean> {
    return page
        .evaluate(() => {
            const text = document.body?.innerText?.slice(0, 4000) ?? ''
            if (/Performing security verification|Verify you are human|Just a moment/i.test(text)) return true
            return !!document.querySelector('#challenge-form, #challenge-running, input[name="cf-turnstile-response"]')
        })
        .catch(() => false)
}

/** 尝试点选 turnstile 交互验证框（仅交互式挑战存在；非交互挑战/结构不符静默跳过） */
export async function clickTurnstileIfPresent(page: Page): Promise<void> {
    const frame = page.frames().find((f) => f.url().includes('challenges.cloudflare.com'))
    if (!frame) return
    try {
        await frame.locator('input[type="checkbox"]').first().click({ timeout: 2_000 })
        console.log('[e2e] 已尝试点选 turnstile 验证框')
    } catch {
        /* 非交互挑战或点选被拒：忽略，交由等待/人工 */
    }
}

/**
 * 等挑战通过（轮询复查，直至文本消失/DOM 标记移除）。
 * 返回是否观察到挑战并通过；从未出现挑战返回 false（调用方据此记日志，不报错）。
 * 人在模式预算放宽至人工可点选的时长，自动化模式 90s（非交互挑战通常数秒自动过）。
 */
export async function waitChallengeCleared(page: Page, opts?: { budgetMs?: number }): Promise<boolean> {
    if (!(await isChallengePage(page))) return false
    console.log('[e2e] 检测到 Cloudflare 挑战页，等待通过（有头模式可人工点选）…')
    const budget = opts?.budgetMs ?? (isHumanMode() ? humanTimeoutMs() : 90_000)
    const deadline = Date.now() + budget
    while ((await isChallengePage(page)) && Date.now() < deadline) {
        await clickTurnstileIfPresent(page)
        await page.waitForTimeout(1_000)
    }
    return !(await isChallengePage(page))
}

/**
 * 目标站点（fixtures 共享会话 / spec 共用单一来源，read mata.json，E2E_SITE_URL 可覆盖）。
 * 无站点项目（mata.json 未声明 targetSite 且 include/match 无法推导）= 空串；
 * 消费方（fixtures/warmSiteCookie/spec 自导航）必须判空跳过站点导航。
 */
export const TARGET_SITE: string = process.env.E2E_SITE_URL ?? mataInfo().targetSite ?? ''

/**
 * Phase 1 站点 cookie 预热：开一个标签页访问目标站点，若遇挑战则等它通过，
 * 使 cf_clearance 等过盾 cookie 持久化进基准 profile——Phase 2 每用例拷贝即继承，
 * 大幅降低用例期被拦概率（同通道同 UA 同指纹，cookie 绑定有效）。
 * 预热失败不阻塞 Phase 1（挑战硬挡时后续用例仍有各自的挑战兜底循环）。
 */
export async function warmSiteCookie(context: import('@playwright/test').BrowserContext): Promise<void> {
    if (!TARGET_SITE) return // 项目无目标站点（不面向特定网站）：跳过预热
    const page = await context.newPage()
    try {
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded' })
        const cleared = await waitChallengeCleared(page)
        console.log(`[fixtures] 站点 cookie 预热${cleared ? '（经挑战页）' : '（无挑战直过）'}完成: ${page.url()}`)
    } catch (e) {
        console.log(`[fixtures] 站点 cookie 预热失败（不阻塞）: ${String(e).slice(0, 120)}`)
    } finally {
        await page.close().catch(() => undefined)
    }
}
