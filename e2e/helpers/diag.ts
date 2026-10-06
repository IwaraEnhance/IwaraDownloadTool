/**
 * e2e 诊断输出助手：等待/重试循环的**逐步状态打印**。
 *
 * 为什么需要：多次调试中循环卡到超时，但日志只有最终错误——每轮尝试时 DOM 处于
 * 什么状态（选择框有几个/计数是多少/面板开没开/URL 在哪）全被吞掉，只能靠猜。
 * 本模块提供两类原语：
 * - traceStep：循环每轮打一行关键状态（带轮次前缀，便于事后 grep）；
 * - diagPage：一行汇总页面关键状态（URL/选择框计数/水印文本/面板与菜单在位情况），
 *   循环失败抛错前带上最后一次现场，替代"干等到超时"。
 */

/** 页面关键状态快照（全部容错：导航中/节点缺失时逐项返回 null） */
export interface PageDiag {
    url: string
    /** 选择框总数与已勾选数 */
    checkboxes: { total: number; checked: number }
    /** 水印文本（无则 null） */
    watermark: string | null
    /** 配置面板是否在 DOM */
    configPanel: boolean
    /** 插件菜单是否可见 */
    menuVisible: boolean
}

/** 采集页面诊断快照（任一子项失败不影响其余，全部容错） */
export async function diagPage(page: import('@playwright/test').Page): Promise<PageDiag> {
    const pick = async <T>(fn: () => T | Promise<T>, fallback: T): Promise<T> => {
        try {
            return await fn()
        } catch {
            return fallback
        }
    }
    const url = await pick(() => page.url(), '(url unavailable)')
    const checkboxes = await pick(
        () =>
            page.evaluate(() => {
                const all = [...document.querySelectorAll<HTMLInputElement>('input.selectButton')]
                return { total: all.length, checked: all.filter((el) => el.checked).length }
            }),
        { total: -1, checked: -1 }
    )
    const watermark = await pick(
        () => page.locator('p.fixed-bottom-right').innerText({ timeout: 1_000 }).catch(() => null),
        null
    )
    const configPanel = await pick(() => page.locator('#pluginConfig').count().then((n) => n > 0), false)
    const menuVisible = await pick(() => page.locator('#pluginMenu').isVisible(), false)
    return { url, checkboxes, watermark, configPanel, menuVisible }
}

/** 单行格式化诊断快照（便于日志 grep：`[diag] ...`） */
export function fmtDiag(d: PageDiag): string {
    return (
        `url=${d.url} | 选择框 ${d.checkboxes.checked}/${d.checkboxes.total} 已勾 | ` +
        `水印=${d.watermark === null ? '(无)' : JSON.stringify(d.watermark)} | ` +
        `面板=${d.configPanel ? '开' : '关'} 菜单=${d.menuVisible ? '可见' : '不可见'}`
    )
}

/**
 * 循环单轮诊断：打一行当前状态。start 时传 attempt=0 打标题行。
 * 用法：
 *   for (let attempt = 1; attempt <= max; attempt++) {
 *       traceStep('clickByState', attempt, await diagPage(page))
 *       ...
 *   }
 */
export function traceStep(scope: string, attempt: number, d: PageDiag): void {
    console.log(`[diag] ${scope}#${attempt}: ${fmtDiag(d)}`)
}

/**
 * 循环耗尽抛错：带最后一次现场快照，替代干抛（不再只有一句超时）。
 */
export async function throwWithDiag(scope: string, message: string, page: import('@playwright/test').Page): Promise<never> {
    const last = await diagPage(page)
    throw new Error(`${message}\n[diag] ${scope} 最终现场: ${fmtDiag(last)}`)
}
