/**
 * 脚本 UI 与行为检测（共享会话 serial 套件，真实站点 iwara.tv）。
 *
 * ⚠️ 为什么共享会话：反复拉起浏览器 + 反复加载首页是 Cloudflare 拦截的最大诱因
 * （每次冷启动/冷加载都是一次独立风控评分）。本套件经 testSharedScript 只做
 * 1 次浏览器启动 / 1 次脚本安装 / 1 次站点首载，此后所有用例都在**同一个页面**
 * 上沿脚本真实生命周期验证：
 *
 *   1. 首装引导（isFirstRun → 勾选 → 配置面板；开关翻转写 GM）
 *   2. reload 一次（证明 GM 持久化，同时进入完整装配态）
 *   3. 装配态 UI（水印 / 菜单基础按钮）
 *   4. 行为联动（选择框 ↔ 水印计数；开关选择框移除/恢复）
 *   5. SPA 导航（首页卡片 → 视频详情页，菜单随 pageType 重绘——不整页重载）
 *
 * serial 模式：前一用例失败即跳过后续（生命周期链断裂，后续断言无意义）。
 * 对照：隔离形态（testWithScript，每用例独立 profile + 启动）见 smoke.spec.ts。
 */
import { expect, type Page } from '@playwright/test'
import { testSharedScript as test, withHuman } from '../helpers/fixtures'
import { humanTimeoutMs, isHumanMode } from '../helpers/human'
import { diagPage, traceStep, throwWithDiag } from '../helpers/diag'

/** 用例 fixtures 类型（共享会话上下文） */
type Fixtures = { sharedSession: import('../helpers/fixtures').SharedSession }

/** 用例快捷器：人在模式（E2E_HUMAN=1）下自动包 withHuman 等人工确认；自动化模式透传。
 *  ⚠️ 返回函数首参必须是对象解构（`{ sharedSession }`）——Playwright 收集用例时
 *  解析回调签名，普通标识符参数会抛 "First argument must use the object destructuring pattern"。
 *  fixtures 原样透传给 fn（fn 用 sharedSession）；withHuman 内部自行从 fixtures 提取
 *  isolatedContext/context 弹确认面板（fixtures.ts 已兼容两种会话形态）。 */
function humanCase(title: string, fn: (fixtures: Fixtures) => Promise<void>): (fixtures: Fixtures) => Promise<void> {
    return async ({ sharedSession }: Fixtures) => {
        await withHuman(title, fn)({ sharedSession } as unknown as Fixtures)
    }
}

/** 用例超时：人在模式下人工目视检查耗时不可控，放宽为 E2E_HUMAN_TIMEOUT + 自动化预算 */
function caseTimeout(autoMs: number): number {
    return isHumanMode() ? humanTimeoutMs() + 120_000 : autoMs
}

/** 共享页快捷解构 */
function usePage({ sharedSession }: Fixtures): Page {
    return sharedSession.page
}

/**
 * 展开插件菜单：autoCollapseMenu（默认开）下菜单收起态经 transform 悬在视口右缘外，
 * 菜单项（li）中心点在屏外 → 直接 click 会「<html> intercepts pointer events」无限重试
 * （Playwright 瞬移点击不会触发挥过把手展开的 mouseover）。本助手模拟真人路径：
 * 悬停可见把手条（元素左缘约 26px 可见区）触发 mouseover 展开，等 .expanded 就位。
 */
async function openPluginMenu(page: Page): Promise<void> {
    const menu = page.locator('#pluginMenu')
    if ((await menu.getAttribute('class'))?.includes('expanded')) return
    const box = await menu.boundingBox()
    if (!box) throw new Error('#pluginMenu 未挂载，无法展开')
    // 收起态仅左缘约 26px 露在视口内（把手条），悬停其垂直中点；steps 模拟移动路径触发 mouseover
    await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 4 })
    await expect(menu, '悬停把手后菜单应展开').toHaveClass(/expanded/)
}

/**
 * 点击菜单项（收起态安全）：每次点击前先确保展开态（openPluginMenu 幂等），
 * 点击后鼠标立即回移到把手区——防 300ms mouseout 收起定时器在下一项点击前
 * 把菜单重新悬出视口（实测：第二下「开关选择框」恢复注入因此拦截超时）。
 */
async function clickMenuItem(page: Page, label: string): Promise<void> {
    await openPluginMenu(page)
    await page.locator('#pluginMenu li', { hasText: label }).click({ timeout: 10_000 })
    // 点击后回移把手，保菜单展开（menu 的 mouseout 延时 300ms 才收起）
    const menu = page.locator('#pluginMenu')
    if (await menu.isVisible().catch(() => false)) {
        const box = await menu.boundingBox()
        if (box) await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 2 }).catch(() => undefined)
    }
}

test.describe.configure({ mode: 'serial' })

test.describe('脚本 UI 与行为（共享会话：一次启动 · 一次首载 · 同页验证）', () => {
    /**
     * 用例 1（生命周期起点：首装态）
     * GM 存储为空 → isFirstRun 缺省 true → main() 只挂引导层后提前 return。
     * 验证引导交互 + 配置面板打开 + 开关翻转写 GM；随后 reload（本套件唯一
     * 整页重载，兼作「GM 持久化跨重载」的证明），为后续用例进入完整装配态。
     */
    test(
        '首装引导勾选确认 → 配置面板打开；开关写回 GM 存储并跨重载保持',
        humanCase('首装引导与 GM 持久化', async (fixtures) => {
            test.setTimeout(caseTimeout(180_000))
            const page = usePage(fixtures)

            // ── 首装引导（isFirstRun 缺省 true）：#pluginOverlay + 协议复选框解锁确定按钮 ──
            const overlay = page.locator('#pluginOverlay')
            await expect(overlay).toBeVisible({ timeout: 30_000 })
            await expect(overlay).toContainText('我已知晓如何使用')
            const agree = overlay.locator('input[name="agree-checkbox"]')
            const confirm = overlay.locator('button')
            await expect(confirm).toBeDisabled() // 未勾选时确定不可用
            await agree.check()
            await expect(confirm).toBeEnabled() // 勾选解锁（行为检测：change 事件链）
            await confirm.click()
            await expect(overlay).toHaveCount(0) // 确认后弹窗移除
            // 确认动作 = isFirstRun=false + 打开配置面板
            const configPanel = page.locator('#pluginConfig')
            await expect(configPanel).toBeVisible({ timeout: 30_000 })
            await expect(configPanel).toContainText('Iwara 批量下载工具') // h2 应用名

            // ── 配置面板 schema 行为：开关翻转 → GM 写回 ──
            const linkCheck = configPanel.locator('input[name="checkDownloadLink"]')
            await linkCheck.waitFor({ state: 'attached', timeout: 30_000 })
            await expect(linkCheck).not.toBeChecked() // 缺省 false
            await linkCheck.click()
            // ── reload（本套件唯一整页重载）：GM 持久化证明 + 进入完整装配态 ──
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
            // 重载后非首装（isFirstRun 已写回 false）：不再出现引导，直接可见菜单
            await expect(page.locator('#pluginMenu'), '插件菜单容器应挂载（完整装配态）').toBeVisible({ timeout: 90_000 })
            await expect(page.locator('#pluginOverlay')).toHaveCount(0)
            // 水印（fixed-bottom-right，含版本与选中计数）是 main() 主链路 watermark.inject() 的产物
            await expect(page.locator('p.fixed-bottom-right'), '水印应挂载').toBeVisible({ timeout: 30_000 })

            // 打开配置面板复核持久化值：菜单点「打开设置」（clickMenuItem 内部先展开收起态菜单）
            await clickMenuItem(page, '打开设置')
            await expect(page.locator('#pluginConfig')).toBeVisible()
            await expect(page.locator('input[name="checkDownloadLink"]')).toBeChecked() // GM 持久化生效
            // ⚠️ 收尾必须关面板：#pluginConfig 是全屏 fixed 遮罩（z-index 2147483646），
            // 开着会拦住后续用例的所有卡片点击（实测：用例 3 因此卡在重试循环直到超时）。
            // 点「保存」= 真实用户路径：配置写回 GM + reload，面板随之消失
            await page.locator('#pluginConfig .buttonList button', { hasText: '保存' }).click()
            await expect(page.locator('#pluginConfig')).toHaveCount(0, { timeout: 30_000 })
            // 保存触发 reload：等装配态重新就绪（挑战由 fixtures 首载已过，此 reload 直过）
            await expect(page.locator('#pluginMenu'), '保存 reload 后插件菜单应重新挂载').toBeVisible({ timeout: 90_000 })
        })
    )

    /**
     * 用例 2（装配态 UI）：同一页面（非首装态），断言水印与菜单基础按钮组。
     * 水印初始计数「已选中 0」：上一用例只翻了开关未勾选视频。
     */
    test(
        '装配态水印与插件菜单基础按钮（手动下载/导出配置/导入配置/打开设置）',
        humanCase('装配态水印与基础菜单', async (fixtures) => {
            test.setTimeout(caseTimeout(60_000))
            const page = usePage(fixtures)

            const watermark = page.locator('p.fixed-bottom-right')
            await expect(watermark).toContainText('Iwara 批量下载工具')
            await expect(watermark).toContainText(/3\.\d+\.\d+/) // 版本号
            await expect(watermark).toContainText('已选中 0') // 初始计数
            const menuText = await page.locator('#pluginMenu').innerText()
            for (const item of ['手动下载', '导出配置', '导入配置', '打开设置']) {
                expect(menuText, `菜单应含「${item}」`).toContain(item)
            }
        })
    )

    test(
        '选择框点击 → 水印计数联动；「开关选择框」菜单项可移除/恢复注入',
        humanCase('选择框点击与水印计数联动', async (fixtures) => {
            test.setTimeout(caseTimeout(180_000))
            const page = usePage(fixtures)

            // 前置：用例 1 已点「保存」关面板；全屏遮罩残留会拦截一切点击——先断言干净
            await expect(page.locator('#pluginConfig'), '配置面板应已关闭（否则拦截卡片点击）').toHaveCount(0)

            // autoInjectCheckbox=true（默认）：列表卡片应自动注入选择框。
            // ⚠️ 首页信息流动态换卡且卡片数会涨（快照可能 2~12+ 不等），语义是
            // 「至少两张」——用 toHaveCount 轮询收敛到 ≥2（借助 Web-first：先等
            // 首卡 attached，再 poll count ≥ 2），不锚死具体数量
            const checkboxes = page.locator('input.selectButton')
            await expect(
                checkboxes.first(),
                '首页应有卡片注入选择框'
            ).toBeAttached({ timeout: 60_000 })
            await expect
                .poll(
                    async () => page.evaluate(() => document.querySelectorAll('input.selectButton').length),
                    { timeout: 30_000, message: '首页应有多张卡片的选择框（容忍信息流换卡抖动）' }
                )
                .toBeGreaterThan(1)

            /**
             * ⚠️ 首页信息流是动态重渲染的：卡片会被新内容彻底换掉（旧 videoID 移除后
             * 不再回来），锚定 videoID 等稳定必然超时。改用「状态驱动点击」：
             * 按勾选状态找选择框（复选框带 checked 属性由 GMSyncDictionary 同步），
             * 点到的卡被换掉（click 抛 detach/超时）就换下一张——计数断言是最终一致
             * 的可靠信号，点哪张卡无所谓。
             */
            const clickByState = async (checked: boolean): Promise<void> => {
                const maxAttempts = 6
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    // 诊断：每轮打页面状态（URL/选择框计数/水印/面板/菜单/挑战），失败时最后一轮现场随错误抛出
                    traceStep('clickByState', attempt, await diagPage(page))
                    // 读当前未勾选/已勾选集合的首个 videoID（DOM 快照，非活 Locator）
                    const ids: string[] = await page.evaluate((want) => {
                        return [...document.querySelectorAll<HTMLInputElement>('input.selectButton')]
                            .filter((el) => (want ? el.checked : !el.checked))
                            .map((el) => el.getAttribute('videoID')!)
                            .filter(Boolean)
                    }, checked)
                    if (ids.length === 0) {
                        console.log(`[diag] clickByState#${attempt}: 无匹配状态的选择框（wantChecked=${checked}），等 1s 重查`)
                        await page.waitForTimeout(1_000)
                        continue
                    }
                    console.log(`[diag] clickByState#${attempt}: 候选 videoID=[${ids.slice(0, 3).join(', ')}]`)
                    for (const id of ids.slice(0, 3)) {
                        try {
                            await page
                                .locator(`input.selectButton[videoID="${id}"]`)
                                .click({ timeout: 5_000, noWaitAfter: true })
                            return
                        } catch (e) {
                            console.log(`[diag] clickByState#${attempt}: 点击 ${id} 失败（${String(e).split('\n')[0].slice(0, 80)}），换下一张`)
                            /* 卡片被信息流换掉（detach）：换下一张 */
                        }
                    }
                }
                await throwWithDiag('clickByState', `未找到可点击的选择框（wantChecked=${checked}，${maxAttempts} 轮耗尽）`, page)
            }

            /**
             * 勾选状态计数 —— 水印的事件链在卡片 detach/重渲染竞态下可能丢发
             * （实测：两次勾选后水印仍显示 1，DOM checked 已有 2），对动态信息流
             * 过度敏感。改用「同帧双读」最终一致：轮询内每轮同时取 DOM 勾选数与
             * 水印文本数字，「相等」即收敛（取该轮 DOM 数返回）。
             * ⚠️ 不能先读 DOM 再等水位追这个固定值：收敛窗口内信息流可能换掉已勾卡，
             * DOM 自己会变（实测：水印 0/1 抖动），固定基准必然假差异。
             */
            const expectCountConsistent = async (): Promise<number> => {
                let domAtMatch = 0
                await expect
                    .poll(
                        async () => {
                            const { dom, wm } = await page.evaluate(() => {
                                const dom = [...document.querySelectorAll<HTMLInputElement>('input.selectButton')].filter((el) => el.checked).length
                                const m = document.querySelector('p.fixed-bottom-right')?.textContent?.match(/已选中\s*(\d+)/)
                                return { dom, wm: m ? Number(m[1]) : -1 }
                            })
                            if (dom === wm) domAtMatch = dom
                            return dom === wm
                        },
                        { timeout: 15_000, message: '水印计数应与 DOM 勾选数最终一致（同帧双读）' }
                    )
                    .toBe(true)
                return domAtMatch
            }

            // 行为：勾选 → 水印计数联动（selection:changed 事件链 → watermark.selected）。
            // 动态信息流下卡片随时被换掉，锚死「恰好 1/2」对重渲染竞态过度敏感——
            // 每次操作后以 DOM 实际勾选数为基准做最终一致断言（事件链补发后必然收敛）
            await clickByState(false)
            const first = await expectCountConsistent()
            expect(first, '勾选一次后至少选中 1').toBeGreaterThanOrEqual(1)
            // 再勾一张 → 计数递增
            await clickByState(false)
            const second = await expectCountConsistent()
            expect(second, '再勾一张后计数应递增').toBeGreaterThan(first)
            // 取消一张 → 回落（GMSyncDictionary delete → 事件广播 → 计数刷新）
            await clickByState(true)
            const after = await expectCountConsistent()
            expect(after, '取消一张后计数应递减').toBeLessThan(second)

            // 菜单「开关选择框」：移除全部选择框（toggleInjectCheckbox 的 remove 分支；先展开收起态菜单）
            await clickMenuItem(page, '开关选择框')
            await expect(page.locator('input.selectButton')).toHaveCount(0, { timeout: 15_000 })
            // 再点恢复注入（clickMenuItem 点击后回移把手，菜单保持展开态）
            await clickMenuItem(page, '开关选择框')
            await expect(page.locator('input.selectButton').first()).toBeAttached({ timeout: 15_000 })
        })
    )

    /**
     * 用例 4（生命周期终点：SPA 导航，套件内唯一导航且非整页重载）：
     * 首页卡片点击 → 视频详情页，菜单随 pageType 重绘出现「下载当前视频」。
     * 真实站点 SPA 路由（history API），无整页加载 → 无新增 CF 风险点。
     */
    test(
        'SPA 导航至视频详情页：菜单按钮随页面类型变化（出现「下载当前视频」）',
        humanCase('SPA 导航与页面类型菜单', async (fixtures) => {
            test.setTimeout(caseTimeout(120_000))
            const page = usePage(fixtures)

            // 前置：面板已关（同用例 3，全屏遮罩会拦截卡片点击）
            await expect(page.locator('#pluginConfig'), '配置面板应已关闭（否则拦截卡片点击）').toHaveCount(0)
            // 首页（VideoList 组）不应有「下载当前视频」
            await expect(page.locator('#pluginMenu')).not.toContainText('下载当前视频')
            // 进入视频详情页（真实站点为卡片点击导航）
            const firstCard = page.locator('a.videoTeaser__thumbnail').first()
            await firstCard.waitFor({ state: 'visible', timeout: 60_000 })
            await firstCard.click()
            await page.waitForURL(/\/video\//, { timeout: 60_000 })
            // pageType 变化（menu 内部 MutationObserver 驱动 pageChange 重绘按钮）
            await expect(page.locator('#pluginMenu')).toContainText('下载当前视频', { timeout: 30_000 })
            // Video 类型按钮组 = downloadThis + selectButtons + baseButtons
            const menuText = await page.locator('#pluginMenu').innerText()
            expect(menuText).toContain('手动下载')
        })
    )
})
