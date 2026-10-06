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
 *   4. 行为联动（选择框 ↔ 水印计数；开关选择框移除/恢复）——测试点 /videos
 *      （纯视频列表，排序稳定；首页混合流实测会轮换换卡，不作为点击竞态测试点）
 *   5. SPA 导航（列表页卡片 → 视频详情页，菜单随 pageType 重绘——不整页重载）
 *
 * serial 模式：前一用例失败即跳过后续（生命周期链断裂，后续断言无意义）。
 * 对照：隔离形态（testWithScript，每用例独立 profile + 启动）见 smoke.spec.ts。
 */
import { expect, type Page } from '@playwright/test'
import { testSharedScript as test, withHuman } from '../helpers/fixtures'
import { humanTimeoutMs, isHumanMode } from '../helpers/human'
import { diagPage, traceStep, throwWithDiag } from '../helpers/diag'
import { getTargetSite } from '../helpers/mataInfo'

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
            // 保存触发 reload：等装配态重新就绪
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

            // 测试点用 /videos（纯视频按时间倒序列表）：首页混合流实测会轮换换卡且
            // 体积随浏览变化（6→12），对点击竞态极不友好；/videos 排序稳定。
            // SPA 内导航即可（脚本 onHistoryChange 会走 pageChange 重绘，菜单仍可用）
            const videosUrl = `${getTargetSite().replace(/\/+$/, '')}/videos`
            if (!page.url().startsWith(videosUrl)) {
                await page.goto(videosUrl, { waitUntil: 'domcontentloaded' })
            }

            // autoInjectCheckbox=true（默认）：列表卡片应自动注入选择框（.videoTeaser
            // 追加钩子对列表页同样生效）。语义是「至少两张」——先等首卡 attached，
            // 再 poll count ≥ 2，不锚死具体数量
            const checkboxes = page.locator('input.selectButton')
            await expect(
                checkboxes.first(),
                '列表页应有卡片注入选择框'
            ).toBeAttached({ timeout: 60_000 })
            await expect
                .poll(
                    async () => page.evaluate(() => document.querySelectorAll('input.selectButton').length),
                    { timeout: 30_000, message: '列表页应有多张卡片的选择框' }
                )
                .toBeGreaterThan(1)

            /**
             * 列表仍是响应式渲染（站点可在测试期间插入新卡/重排），且不假设已勾卡
             * 一定留存在 DOM。锚定具体卡必坏，改用「状态驱动点击」：点未勾选的选择框
             * （checked 属性由 GMSyncDictionary 同步），点击失败就换下一张、每轮重查
             * 卡组——计数断言是最终一致的可靠信号，点哪张卡无所谓。
             */
            /** 状态驱动勾选：点未勾选的选择框；每轮打全量 videoID 清单（便于观察卡组构成变化） */
            const clickByState = async (): Promise<void> => {
                const maxAttempts = 6
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    // 诊断：每轮打页面状态 + 全量 videoID 快照（DOM 快照，非活 Locator）
                    const d = await diagPage(page)
                    traceStep('clickByState', attempt, d)
                    const ids: string[] = await page.evaluate(() => {
                        return [...document.querySelectorAll<HTMLInputElement>('input.selectButton')]
                            .map((el) => el.getAttribute('videoID')!)
                            .filter(Boolean)
                    })
                    console.log(`[diag] clickByState#${attempt}: 卡组 ${ids.length} 张 [${ids.join(', ')}]`)
                    const clickable = (await page.evaluate(() => {
                        return [...document.querySelectorAll<HTMLInputElement>('input.selectButton')]
                            .filter((el) => !el.checked)
                            .map((el) => el.getAttribute('videoID')!)
                            .filter(Boolean)
                    }))
                    if (clickable.length === 0) {
                        console.log(`[diag] clickByState#${attempt}: 无未勾选的选择框，等 1s 重查`)
                        await page.waitForTimeout(1_000)
                        continue
                    }
                    console.log(`[diag] clickByState#${attempt}: 候选 videoID=[${clickable.slice(0, 3).join(', ')}]`)
                    for (const id of clickable.slice(0, 3)) {
                        try {
                            await page
                                .locator(`input.selectButton[videoID="${id}"]`)
                                .click({ timeout: 5_000, noWaitAfter: true })
                            return
                        } catch (e) {
                            // 保留 Playwright 判定原因（截断放宽到 200 字符），不再吞成一句 detach 猜测
                            console.log(`[diag] clickByState#${attempt}: 点击 ${id} 失败（${String(e).split('\n').slice(0, 3).join(' ').slice(0, 200)}），换下一张`)
                        }
                    }
                }
                await throwWithDiag('clickByState', `未找到可点击的未勾选选择框（${maxAttempts} 轮耗尽）`, page)
            }

            /** 读水印「已选中 N」计数（水印未挂载/解析失败返回 -1） */
            const watermarkCount = async (): Promise<number> =>
                page.evaluate(() => {
                    const m = document.querySelector('p.fixed-bottom-right')?.textContent?.match(/已选中\s*(\d+)/)
                    return m ? Number(m[1]) : -1
                })

            /** 等水印计数满足谓词（selection:changed 事件链最终一致；超时抛最后读数） */
            const awaitCount = async (ok: (n: number) => boolean, label: string, timeoutMs = 15_000): Promise<number> => {
                const deadline = Date.now() + timeoutMs
                let last = -1
                while (Date.now() < deadline) {
                    last = await watermarkCount()
                    if (ok(last)) return last
                    await page.waitForTimeout(400)
                }
                throw new Error(`[awaitCount] 水印计数未${label}（最后读取 ${last}）`)
            }

            /**
             * 水印计数断言（快照实证的水印语义：watermark 恒等于 selectList.size；
             * DOM checkbox 的 checked 是 selectList 的投影，卡片不在页面时投影缺失
             * ——故「DOM 数 vs 水印」等式无稳定依据，断言只以水印计数为单一场）。
             * 点击后计数未动（事件链偶发滞后）→ 再点一张（计数随 set 单调不减）。
             */
            const selectAndAwaitCount = async (ok: (n: number) => boolean, label: string): Promise<number> => {
                for (let round = 1; round <= 3; round++) {
                    await clickByState()
                    try {
                        return await awaitCount(ok, label, 8_000)
                    } catch {
                        console.log(`[diag] selectAndAwaitCount#${round}: 点击后计数未${label}，再点一张补发`)
                    }
                }
                throw new Error(`[selectAndAwaitCount] 3 轮点击后水印计数仍未${label}`)
            }

            // 行为：勾选 → 水印计数联动（selection:changed 事件链 → watermark.selected）
            const first = await selectAndAwaitCount((n) => n >= 1, '上升至 ≥1')
            expect(first, '勾选一次后至少选中 1').toBeGreaterThanOrEqual(1)
            // 再勾一张 → 计数递增
            const second = await selectAndAwaitCount((n) => n > first, `递增至 >${first}`)
            expect(second, '再勾一张后计数应递增').toBeGreaterThan(first)

            // 取消 → 回落 0。已勾视频可能已不在当前页卡列（DOM 无对应 checkbox），
            // 点击式取消无目标可点；走产品数据驱动路径——菜单「取消所有选中」
            // （deselectAll 逐个 delete selectList），事件链必然把水印计数拉回 0。
            await clickMenuItem(page, '取消所有选中')
            const after = await awaitCount((n) => n === 0, '回落为 0')
            expect(after, '取消全选后水印计数应回落为 0').toBe(0)

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
     * 列表页卡片点击 → 视频详情页（/videos 首卡必为视频 teaser），菜单随
     * pageType 重绘出现「下载当前视频」。
     */
    test(
        'SPA 导航至视频详情页：菜单按钮随页面类型变化（出现「下载当前视频」）',
        humanCase('SPA 导航与页面类型菜单', async (fixtures) => {
            test.setTimeout(caseTimeout(120_000))
            const page = usePage(fixtures)

            // 前置：面板已关（同用例 3，全屏遮罩会拦截卡片点击）
            await expect(page.locator('#pluginConfig'), '配置面板应已关闭（否则拦截卡片点击）').toHaveCount(0)
            // 列表页（VideoList 组）不应有「下载当前视频」
            await expect(page.locator('#pluginMenu')).not.toContainText('下载当前视频')
            // 进入视频详情页（若用例 3 已在 /videos 则直接点首卡；否则先回列表页）
            if (!page.url().includes('/videos')) {
                await page.goto(`${getTargetSite().replace(/\/+$/, '')}/videos`, { waitUntil: 'domcontentloaded' })
            }
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
