/**
 * 注入与装配冒烟（项目特有用例，非框架恒定能力）。
 *
 * ⚠️ 归属（用户裁定）：「脚本是否注入」依赖 mutex 守卫标记（unsafeWindow.<Key> = true），
 * 这是**本项目特有能力**——其他用户脚本项目可能不实现。因此注入判定放在项目测试
 * 用例（本文件），e2e 框架（fixtures/managers/install）不碰任何 window 符号，
 * 保持对任意同结构用户脚本项目可复用。
 *
 * 本用例职责：脚本注入（守卫标记）+ 主链路装配态（#plugin* 容器挂载）。
 * 守卫键在 src/core/mutex.ts 单一来源，此处直书项目事实——项目用例允许耦合项目
 * 内部（这正是“框架复用”与“项目验收”的分界线）。
 *
 * 前置：npm run build（产物 dist/<displayName>.user.js）。
 * 运行：npm run e2e:smoke（真实站点，E2E_SITE_URL 可覆盖）
 */
import { expect } from '@playwright/test'
import { testSharedScript as test } from '../helpers/fixtures'
import { TARGET_SITE } from '../helpers/challenge'

/** 本项目守卫标记键名（与 src/core/mutex.ts 的 unsafeWindow.<Key> 赋值行保持一致） */
const GUARD_KEY = 'IwaraDownloadTool'

test.describe.configure({ mode: 'serial' })

test('冒烟：脚本安装后应在目标站点执行（mutex 守卫 + UI 挂载）', async ({ sharedSession }) => {
    const page = sharedSession.page
    // 自导航回站点：不依赖文件执行顺序（本地宿主页用例可能先执行并改页位置）
    if (!page.url().startsWith(TARGET_SITE)) {
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded' })
    }
    // ① mutex 守卫：脚本 @run-at document-start，注入成功即在 window 留守卫标记
    await expect
        .poll(async () => page.evaluate((key) => !!(window as any)[key], GUARD_KEY), { timeout: 30_000 })
        .toBe(true)
    // ② 主流程跑完的标志：脚本创建的 DOM（容器/水印/选择框根）已挂载
    await expect
        .poll(async () => page.evaluate(() => document.querySelectorAll('[id^="plugin"]').length > 0), { timeout: 30_000 })
        .toBe(true)
    console.log(`[smoke] 扩展 ${sharedSession.extensionId} 注入成功`)
})
