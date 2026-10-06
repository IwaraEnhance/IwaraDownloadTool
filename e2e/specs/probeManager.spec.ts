import { expect } from '@playwright/test'
import { testSharedScript as test } from '../helpers/fixtures'
import { getTargetSite } from '../helpers/mataInfo'

/** 本项目守卫标记键名（与 src/core/mutex.ts 的 unsafeWindow.<Key> 赋值行保持一致） */
const GUARD_KEY = 'IwaraDownloadTool'

test.describe.configure({ mode: 'serial' })

test('驱动探针：脚本安装后应在目标站点注入', async ({ sharedSession }) => {
    const TARGET_SITE = getTargetSite()
    const page = sharedSession.page
    // 自导航回站点：gmBehavior 等本地宿主页用例会改变共享页位置（宿主页上主脚本
    // 因 @include 不匹配而不注入）——不依赖文件执行顺序
    if (!page.url().startsWith(TARGET_SITE)) {
        await page.goto(TARGET_SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    }
    // 回调容错：iwara SPA 偫发软导航会摧毁 evaluate 上下文（poll 对回调异常不重试而直接失败）
    await expect
        .poll(
            async () => {
                try {
                    return await page.evaluate((key) => !!(window as any)[key], GUARD_KEY)
                } catch {
                    return false
                }
            },
            { timeout: 60_000 }
        )
        .toBe(true)
    console.log(`[probe] ★ 脚本已注入（${GUARD_KEY} 守卫存在）`)
})
