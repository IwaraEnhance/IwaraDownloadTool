/**
 * Playwright fixture：加载脚本管理器扩展（默认 ScriptCat，E2E_MANAGER 可切换）+ 注入本项目用户脚本。
 *
 * 机制参照 Playwright 官方 chrome-extensions 方案（launchPersistentContext +
 * --disable-extensions-except/--load-extension）与 ScriptCat 官方 e2e 设施（其仓库 e2e/fixtures.ts）。
 *
 * 环境 / 文件产物 / 安装方式（2026-10-02 更新：显示模式默认有头）：
 * - 默认有头窗口（调试可旁观、live 过盾更接近真人）；E2E_HEADLESS=1 切无头（--headless=new + channel: 'chromium'，CI/无显示服务器用）；
 * - 注入未压缩主产物（产物名/目标站点读自 src/mata/mata.json 权威信息源，见 helpers/mataInfo.ts）；
 * - 经管理器驱动安装脚本（ScriptCat 走官方安装页 chrome-extension://<id>/src/install.html?url=…）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test'
import { ANTI_FINGERPRINT_ARGS, browserChannel, displayOptions } from './launchArgs'
import { TARGET_SITE, isChallengePage, waitChallengeCleared, warmSiteCookie } from './challenge'
import { mataInfo, artifactNames } from './mataInfo'
import { resolveManager } from '../managers'
import { dumpTabs, registerTabTracing } from './tabs'
import { askVerdict, isHumanMode, type HumanVerdict } from './human'
import { askVerdictInBrowser } from './humanPanel'

/**
 * 解析当前脚本管理器的扩展目录（经 E2E_MANAGER 选择驱动，缺省 scriptcat；
 * ScriptCat 来源优先级：SCRIPTCAT_EXT_PATH → e2e/.scriptcatStore 商店解包自动下载）
 */
function resolveManagerExtension(): Promise<string> {
    return resolveManager().resolveExtension()
}

/** 当前管理器的扩展 options 页完整 URL（路径来自驱动声明的 manifest 事实，
 * 严禁在 spec 硬编码某一家的路径——TM 在根目录、ScriptCat 在 src/ 下） */
export function managerOptionsUrl(extensionId: string): string {
    return `chrome-extension://${extensionId}/${resolveManager().optionsPath}`
}

/** 本项目用户脚本产物（未压缩版；文件名读 mata.json displayName，E2E_USERSCRIPT_PATH 可覆盖） */
export function resolveUserScript(): string {
    const { mata } = mataInfo()
    const candidate = process.env.E2E_USERSCRIPT_PATH ?? path.resolve(import.meta.dirname, '../../dist', artifactNames(mata).userScript)
    if (!fs.existsSync(candidate)) {
        throw new Error(`未找到用户脚本产物 ${candidate}，请先 npm run build`)
    }
    return candidate
}

/**
 * e2e 探针脚本产物（真 GM 桥，供 gmBehavior 用例做"异地写入"）。
 * 不带 @noframes：ScriptCat 会把它注入主脚本创建的 iframe，形成第二个真实 GM
 * 执行上下文——远端事件由脚本管理器亲手派发，置换 test/ 时代的 remote 仿真器。
 * 仅 mata.e2e.probeEntry 声明了探针入口的项目可用（其余项目明确报错指引）。
 */
export function resolveE2EProbeScript(): string {
    const { mata } = mataInfo()
    const probe = artifactNames(mata).probeScript
    if (!probe) {
        throw new Error('mata.json 未声明 e2e.probeEntry——本项目未提供 GM 探针，跨上下文 GM 用例不适用')
    }
    const candidate = path.resolve(import.meta.dirname, '../../dist', probe)
    if (!fs.existsSync(candidate)) {
        throw new Error(`未找到 e2e 探针脚本 ${candidate}，请先 npm run build（构建器自动生成该产物）`)
    }
    return candidate
}

/** 服务器无输入设备时 Chromium 会把 (hover:hover) 报成 false，显式声明「有鼠标」保持桌面语义 */
const POINTER_ARGS = '--blink-settings=availableHoverTypes=2,primaryHoverType=2,availablePointerTypes=4,primaryPointerType=4'

interface TestOptions {
    /** 共享会话（worker 级唯一浏览器会话：单次启动/单次安装/单标签） */
    sharedSession: SharedSession
}

/**
 * 两阶段启动（参照 ScriptCat 官方 e2e/fixtures.ts 的 testWithUserScripts）：
 *
 * Phase 1（worker 级，每个 worker 只做一次）：启动浏览器 → 打开扩展管理页
 * ① 开「开发者模式」（Chrome 137+ 未开则侧载扩展一律 DISABLED，SW 不运行）
 * ② 开 userScriptsAccess（Chrome 138+ userScripts API 默认关闭，不开则脚本
 * 安装成功也不执行）→ 都持久化写入基准 profile 后关闭。
 *
 * Phase 2（每个用例）：拷贝 Phase 1 的已授权 profile 后重启（权限已持久化），
 * 避免每用例重复跑两次完整启动（并发时扩展 SW 启动会被拖到超时）。
 */
async function launchExtensionContext(userDataDir: string): Promise<BrowserContext> {
    const pathToExtension = await resolveManagerExtension()
    const display = displayOptions()
    // 随机 CDP 调试端口：供 tabs.ts 经 connectOverCDP 拿 Browser 级 Target 事件
    // （带 openerId/openerUrl，可归因「谁打开的标签页」；本版本 newBrowserCDPSession
    // 只在 Browser 上，BrowserContext 拿不到）
    const debugPort = 20000 + Math.floor(Math.random() * 20000)
    // 通道：真实品牌 Chrome（channel: 'chrome'）——Cloudflare 对开源 Chromium 构建
    // 的自动化指纹最敏感；E2E_BROWSER=chromium 可切回（扩展兼容性排查用）。
    // 有头用真实桌面视口（1440x900 常见笔记本物理分辨率，1280x720 是 CF 重点指纹）
    const channel = browserChannel()
    const isHeadless = display.headless
    const args = [
        ...display.args,
        ...ANTI_FINGERPRINT_ARGS, // --disable-blink-features=AutomationControlled
        '--disable-gpu',
        `--remote-debugging-port=${debugPort}`,
        POINTER_ARGS
    ]
    if (channel === 'chromium') {
        // ⚠️ 通道分派（源码级实证）：branded Chrome 137 起在 extension_service.cc 直接
        // 忽略 --load-extension（GOOGLE_CHROME_BRANDING 分支打 warning 后 return），
        // 139+ 连 --disable-extensions-except 也移除了——真实 Chrome 下 SW 永不启动即此因。
        // 开源 Chromium 构建不受影响，保留 Playwright 官方扩展方案（launch args 侧载）
        args.push(`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`)
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel,
        // ⚠️ headless 必须显式下（Playwright 缺省 true）；与无头参数保持一致才符合预期显示模式
        headless: isHeadless,
        // ⚠️ 双摘除（缺一不可）：
        // - --enable-automation：自动化信息条 + navigator.webdriver 暴露面（CF 指纹信号）
        // - --disable-extensions：Playwright chromiumSwitches() 无条件注入；CDP
        //   Extensions.loadUnpacked 装的扩展在 ExtensionRegistrar::CanAddExtension
        //   被**静默丢弃**（返回 id 但 registry 从未收入 → SW 永不启动）。chromium 通道
        //   不受影响是因为 --disable-extensions-except 会把扩展 ID 加进豁免名单
        ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
        args,
        timeout: 60_000,
        chromiumSandbox: false,
        // 复用启动自带的初始 about:blank 作为工作页：不再另开 newPage()（标签页配额 ≤ 1，
        // 初始页不被闲置占用内存；context.pages()[0] 即它）
        ...(isHeadless ? {} : { reuseExistingPage: true, viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' as const })
    })
    if (channel === 'chrome') {
        // 真实 Chrome 侧载：CDP Extensions.loadUnpacked（browser target 专用；免 flag、
        // 免开发者模式、装的扩展重启即卸载——与每用例独立 profile 启动天然契合）
        // ⚠️ 侧载 burst 期窗口静默：loadUnpacked 返回 → SW 立即启动 → onInstalled/更新
        // 检查弹引导页（docs.scriptcat.org 等）——这一切早于任何运行时补丁可注入的时机。
        // 平台层治理（与扩展内部零耦合，不随管理器版本变化）：侧载前最小化窗口，
        // 页面照样创建/事件照样派发/清扫器照样工作，只是不可见；SW 稳定后恢复窗口。
        if (!isHeadless) {
            console.log('[setup]   windowSilence 开始（minimized）…')
            const silence = await minimizeWindow(context)
            console.log('[setup]   windowSilence minimized 完成…')
            try {
                console.log('[setup]   loadExtensionViaCDP 开始…')
                await loadExtensionViaCDP(context, debugPort, pathToExtension)
                console.log('[setup]   loadExtensionViaCDP 完成')
            } finally {
                await silence?.restore()
            }
        } else {
            console.log('[setup]   loadExtensionViaCDP 开始…')
            await loadExtensionViaCDP(context, debugPort, pathToExtension)
            console.log('[setup]   loadExtensionViaCDP 完成')
        }
    }
    // 噪音页清扫（扩展页 + 管理器外链引导页，事件级自动关闭——行为层免底；
    // burst 期预防由上方窗口静默承担）；全程 tab 事件跟踪（CDP 归因）
    console.log('[setup]   suppressManagerOnboarding 开始…')
    await suppressManagerOnboarding(context)
    console.log('[setup]   suppressManagerOnboarding 完成')
    console.log('[setup]   registerTabTracing 开始…')
    await registerTabTracing(context, debugPort)
    console.log('[setup]   registerTabTracing 完成')
    return context
}

async function waitExtensionId(context: BrowserContext): Promise<string> {
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 20_000 })
    }
    return serviceWorker.url().split('/')[2]
}

/**
 * 真实 Chrome（channel: 'chrome'）侧载扩展：CDP Extensions.loadUnpacked。
 *
 * ⚠️ 为什么不用 --load-extension：branded Chrome 137 起在源码级移除（extension_service.cc
 * 的 GOOGLE_CHROME_BRANDING 分支直接 return），139+ 移除 --disable-extensions-except——
 * flags 静默失效，扩展未安装，SW 永不启动。CDP 路径（2026-04 起）无 flag/无品牌限制、
 * 免开发者模式（INSTALLED_VIA_CDP 直接放行 unpacked 策略），装的扩展重启即卸载。
 * 仅 browser target 可用：经 connectOverCDP 连回本浏览器取 browser 级会话
 * （同 tabs.ts 的原因：launchPersistentContext 拿到的 BrowserContext 无 newBrowserCDPSession）。
 */
async function loadExtensionViaCDP(context: BrowserContext, debugPort: number, extensionDir: string): Promise<void> {
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
    try {
        const session = await browser.newBrowserCDPSession()
        const { id } = (await session.send('Extensions.loadUnpacked', { path: extensionDir })) as { id: string }
        console.log(`[fixtures] CDP 侧载扩展成功: ${id} (${extensionDir})`)
    } finally {
        await browser.close().catch(() => undefined)
    }
}

/**
 * 平台层窗口静默（治理管理器自启噪音页的闪窗）：侧载前把浏览器窗口最小化，
 * SW 稳定（首个扩展页事件 + 清扫器就绪）后恢复。
 *
 * 为什么用这一层（对比被否决的方案）：
 * - 磁盘级注入扩展 SW 文件：硬编码路径/bundle 形态，扩展更新即静默失效，且改写
 *   了被测系统——不符合「测原装扩展」的测试本质；
 * - 运行时 worker.evaluate 补丁：与 SW 自启赛跑必输（loadUnpacked 返回 → onInstalled
 *   立即弹页，早于任何 evaluate 可注入的时机，tab 监控 dump 实证）；
 * - 本方案：只依赖 Chrome 稳定协议 Browser.setWindowBounds，与扩展内部零耦合，
 *   扩展爱怎么更新都不影响。噪音页照样创建、事件照样派发、清扫器照样工作，
 *   只是用户看不见——「多余窗口闪现」从感知上归零，行为层交给双层清扫维持。
 *
 * 返回 { session, restore }；失败不影响主流程（返回 null，恢复步骤自然跳过——
 * 窗口静默只是体验优化，不是正确性依赖）。
 */
async function minimizeWindow(context: BrowserContext): Promise<{ session: import('@playwright/test').CDPSession; restore: () => Promise<void> } | null> {
    try {
        // Browser.getWindowForTarget 需要默认 target：browser 级 newBrowserCDPSession
        // 无 web contents 会报 "No web contents in the target"（实测），必须挂到具体页
        const page = context.pages()[0]
        if (!page) return null
        const session = await context.newCDPSession(page)
        const { windowId } = await session.send('Browser.getWindowForTarget')
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
        console.log('[fixtures] 窗口已最小化（侧载 burst 静默期开始）')
        const restore = async (): Promise<void> => {
            try {
                // 等待信号：扩展 SW 出现（onInstalled 引导 burst 已发完）或短超时免垫底
                await Promise.race([
                    context.waitForEvent('serviceworker', { timeout: 8_000 }).catch(() => undefined),
                    new Promise((r) => setTimeout(r, 8_000))
                ])
                await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
                console.log('[fixtures] 窗口已恢复（侧载 burst 静默期结束）')
            } catch (e) {
                console.log(`[fixtures] 窗口恢复失败（不阻塞）: ${String(e).slice(0, 120)}`)
            }
        }
        return { session, restore }
    } catch (e) {
        console.log(`[fixtures] 窗口最小化失败（不阻塞）: ${String(e).slice(0, 120)}`)
        return null
    }
}

/**
 * 噪音页清扫：管理器首启/启用后会自动弹的页——
 * ①「安装成功 / 权限引导」扩展页（chrome-extension://，非安装页）
 * ② 更新日志/引导外链（各管理器不同，由驱动 noiseUrlPatterns 声明）
 * 都会抢占安装流程的 waitForEvent('page') / 占据有头窗口。双层治理：
 * ① 平台层预防：侧载 burst 期窗口静默（launchExtensionContext，闪窗不可见）；
 * ② 本函数：清扫（现存/后续噪音页事件级自动关闭——行为层兜底）。
 */
export async function suppressManagerOnboarding(context: BrowserContext): Promise<void> {
    const keep = (url: string): boolean =>
        resolveManager().isInstallPageUrl ? resolveManager().isInstallPageUrl!(url) : /install/i.test(url)
    const noisePatterns = resolveManager().noiseUrlPatterns ?? []
    const isNoise = (url: string): boolean =>
        (url.startsWith('chrome-extension://') || noisePatterns.some((p) => url.startsWith(p))) && !keep(url)
    // 清扫：现存 + 事件级
    const closeIfNoise = (page: Page): void => {
        if (isNoise(page.url())) void page.close().catch(() => undefined)
    }
    for (const p of context.pages()) closeIfNoise(p)
    context.on('page', closeIfNoise)
    dumpTabs(context, '噪音页抑制就绪')
}

/**
 * Phase 1：在扩展管理页永久开启 开发者模式 + userScriptsAccess（写入 profile 持久化）
 * 并直写 ScriptCat 引导去重标记，禁掉 SW 启动竞态窗口里的引导页弹窗。
 *
 * ⚠️ 实测（2026-10-02）：SW 在启动后几百 ms 即弹 3 个引导页
 * （docs.scriptcat.org 的 install_comple / open-dev / change），此时补丁尚未注入——
 * 源头拦截来不及。经扩展上下文直写 chrome.storage.local 的
 * `localStorage:firstShowDeveloperMode`（showUserscriptActivationGuide 的去重键，
 * 值 = UA 数字段 btoa；键值格式与 SW 的 er DAO/Z() 写入完全同构）后，
 * SW 起来时读到标记直接 return，跨重载持久不再弹。
 */
async function enableUserScriptsAccess(context: BrowserContext, extensionId: string): Promise<void> {
    const page = await context.newPage()
    await page.goto('chrome://extensions/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => !!(window as any).chrome?.developerPrivate, { timeout: 10_000 })
    /**
     * 读取扩展的 developerPrivate 状态（state + userScripts 是否激活）
     */
    const readStatus = (): Promise<{ state?: string; active?: boolean }> =>
        page.evaluate(async (id) => {
            const dp = (window as any).chrome.developerPrivate
            const list: Array<{ id: string; state?: string; userScriptsAccess?: { isActive?: boolean }; userScripts?: { isActive?: boolean } }> =
                await dp.getExtensionsInfo({ includeDisabled: true })
            const info = list.find((e) => e.id === id)
            return { state: info?.state, active: info?.userScriptsAccess?.isActive ?? info?.userScripts?.isActive }
        }, extensionId)
    // 记录切换前的 SW 对象集合：⚠️ userScriptsAccess 切换会触发扩展重启
    // （SW 替换 + 所有扩展页关闭）。重启未兑现时打开的扩展页会被顺手关掉——
    // 曾致 prepareProfile 的 options.html 直接抛 'Target page ... has been closed'，
    // 这才是「环境性抖动」的真根因（Phase 1 内部竞态，而非站点/SW 问题）
    const swsBefore = new Set(context.serviceWorkers())
    await page.evaluate(async (id) => {
        // ⚠️ Chrome 137+：未开「开发者模式」时侧载扩展一律 DISABLED（卡片提示
        // 「开启开发者模式即可使用此扩展程序」，developerPrivate.state === 'DISABLED'）——
        // 不开则 SW 是死的，安装页秒关、页面被拦截、脚本永远装不上。开发者模式
        // 与 userScriptsAccess 都持久化进基准 profile，Phase 2 拷贝后直接生效
        await (window as any).chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })
        await (window as any).chrome.developerPrivate.updateExtensionConfiguration({
            extensionId: id,
            userScriptsAccess: true
        })
    }, extensionId)
    // ① 轮询 developerPrivate 直至 state=ENABLED 且 userScripts 权限激活
    //（isActive）。未激活 = SW 运行时无 userScripts 权限，脚本不注入
    //（ScriptCat 页面提示「当前未启用允许运行用户脚本」即此因）
    let status = await readStatus()
    const grantDeadline = Date.now() + 15_000
    while (!(status.state === 'ENABLED' && status.active === true) && Date.now() < grantDeadline) {
        await page.waitForTimeout(500)
        status = await readStatus()
    }
    if (!(status.state === 'ENABLED' && status.active === true)) {
        throw new Error(
            `userScripts 权限未激活（${JSON.stringify(status)}）——Phase 1 预配置失败（哨兵未写入，下次运行将自动重建 profile）`
        )
    }
    console.log('[fixtures] userScripts 授权状态: ENABLED+active')
    // ② 等待重启兑现：旧 SW 全部消失且新 SW 就绪。若 6s 内未观察到重启
    //（如重复切换同值不重启的版本），再确认一次激活状态未回退即放行
    const settleDeadline = Date.now() + 6_000
    for (; ;) {
        const sws = context.serviceWorkers()
        const oldGone = [...swsBefore].every((old) => !sws.includes(old))
        const fresh = sws.some((w) => !swsBefore.has(w) && w.url().includes(extensionId))
        if (oldGone && fresh) {
            console.log('[fixtures] 扩展已重启兑现 userScripts 权限（SW 已替换）')
            break
        }
        if (Date.now() > settleDeadline) {
            const recheck = await readStatus()
            if (!(recheck.state === 'ENABLED' && recheck.active === true)) {
                throw new Error(`扩展未重启且激活状态回退（${JSON.stringify(recheck)}）——Phase 1 预配置失败`)
            }
            console.log('[fixtures] 未观察到扩展重启（激活状态保持），继续')
            break
        }
        await page.waitForTimeout(300)
    }
    await page.close()
}

/** 基准 profile 目录（测试共用，E2E_PROFILE_DIR 可覆盖；目录名取产物基座，多项目共存不冲突） */
export function baseProfileDir(): string {
    return process.env.E2E_PROFILE_DIR ?? path.join(os.tmpdir(), `${mataInfo().mata.displayName}-e2e-profile`.toLowerCase())
}

/**
 * 确保基准 profile 就绪（Phase 1 权限预配置）：哨兵标记缺失时启动浏览器执行
 * userScriptsAccess 开启并持久化。测试套件与 debug 会话共用，多处并发调用安全
 * （同进程内靠执行顺序，跨进程靠先清后建的目录语义）。
 */
export async function baseProfileReady(dir: string): Promise<string> {
    // v4：Phase 1 新增真实 Chrome 通道 + 反自动化指纹参数 + 站点 cookie 预热（cf_clearance
    // 随基准 profile 被 Phase 2 拷贝继承）；旧哨兵 profile 换名强制重建。
    // ⚠️ 哨兵按管理器隔离（v4-<managerId>）：各驱动的 prepareProfile 预配置不同
    // （TM 需要 fileAccess=true，ScriptCat 需要 firstShowDeveloperMode 预写），
    // 共用哨兵会让后切换的管理器跳过自己的预配置（实测：ScriptCat 哨兵残留 →
    // TM 的 fileAccess 未写入 → file:// 安装链路 fail，ask.html 永不出现）
    const managerId = resolveManager().id
    const sentinel = path.join(dir, `.user-scripts-enabled-v4-${managerId}`)
    if (fs.existsSync(sentinel)) return dir
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const ctx1 = await launchExtensionContext(dir)
    const extensionId = await waitExtensionId(ctx1)
    await enableUserScriptsAccess(ctx1, extensionId)
    // 管理器自身配置预配置（TM legacy/fileAccess 等）：写入基准 profile，Phase 2 拷贝后生效
    await resolveManager().prepareProfile?.(ctx1, extensionId)
    // 站点 cookie 预热：Phase 1 过一次盾（cf_clearance 持久化进基准 profile），
    // Phase 2 每用例拷贝即继承——同通道同 UA 同指纹，cookie 绑定有效
    await warmSiteCookie(ctx1)
    dumpTabs(ctx1, 'Phase 1 权限预配置完成')
    await ctx1.close()
    fs.writeFileSync(sentinel, new Date().toISOString())
    return dir
}

/**
 * 人在模式（E2E_HUMAN=1）：用例体执行完后暂停，等人类确认测试结果。
 * 确认入口：**浏览器内确认面板**（humanPanel，有头模式默认）——大按钮 + y/f/r
 * 快捷键 + 倒计时兜底，人不用切窗口去终端；取不到浏览器上下文时回落终端 readline。
 * - f：抛错标记用例失败（自动化断言即使通过也覆盖人工判定）；
 * - r：重新执行用例体（最多重跑 2 次，之后跟随最后一次判定）；
 * - 自动化模式（缺省）本钩子零开销。
 *
 * 实现：包装用例回调（而非代理 test 对象——Playwright 的 test 带多层泛型签名，
 * 代理会破坏类型）。用法差异：人在模式下请用 withHuman(title, fn) 包裹用例体。
 */
type HumanTestFn<Args> = (fixtures: Args) => Promise<void> | void

export function withHuman<Args>(title: string, fn: HumanTestFn<Args>): HumanTestFn<Args> {
    if (!isHumanMode()) return fn
    return async (fixtures: Args) => {
        // 人在模式：用例级超时由 spec 的 caseTimeout() 放宽为 E2E_HUMAN_TIMEOUT + 自动化预算，
        // 避免人工检查中途被 Playwright timeout 掐死（掐死后 context 关闭、面板无从弹出）
        let verdict: 'pass' | 'fail' = 'fail'
        let retries = 0
        for (; ;) {
            const t0 = Date.now()
            try {
                await fn(fixtures)
                verdict = 'pass'
            } catch (e) {
                verdict = 'fail'
                console.log(`[human] 自动化断言异常: ${String(e).slice(0, 200)}`)
            }
            const info = { title, durationMs: Date.now() - t0 }
            const autoPassed = verdict === 'pass'
            // 面板上下文：用例 fixtures 里带 BrowserContext 字段即可（SharedSession.context 等）
            const ctx = Object.values(fixtures as Record<string, unknown>).find(
                (v): v is BrowserContext => !!v && typeof v === 'object' && typeof (v as BrowserContext).newPage === 'function'
            )
            let answer: HumanVerdict
            try {
                answer = ctx ? await askVerdictInBrowser(ctx, info, autoPassed) : await askVerdict(info, autoPassed)
            } catch (panelError) {
                console.log(`[human] 确认面板不可用（${String(panelError).slice(0, 120)}），跟随自动化断言结果`)
                answer = autoPassed ? 'pass' : 'fail'
            }
            if (answer === 'retry' && retries < 2) {
                retries++
                console.log(`[human] 重跑用例（第 ${retries}/2 次）…`)
                continue
            }
            if (answer === 'fail') {
                throw new Error(`[human] 人工判定失败（自动化断言 ${autoPassed ? '通过' : '失败'}）`)
            }
            console.log('[human] 人工确认通过 ✓')
            return
        }
    }
}

/**
 * 共享会话是唯一 fixture 体系（整包 1 次启动）：probeManager/smoke/uiBehavior 三文件
 * 共用同一 worker fixture（workers=1 时跨文件不重新 setup）→ 全程只有一次浏览器启动。
 * （曾提供每用例隔离形态 testWithScript，因反复冷启动是 CF 拦截最大诱因而移除；
 * 隔离场景需求由 debug 会话承担。）
 */
export interface SharedSession {
    /** 共享浏览器上下文（人在模式确认面板也弹在这里） */
    context: BrowserContext
    /** 共享测试页：fixture 首载一次，用例全程 SPA 内导航，不再重复加载站点 */
    page: Page
    /** 脚本管理器扩展 ID */
    extensionId: string
}

/** 等待脚本首裁后挑战页重新渲染（挑战页上脚本同样注入，通过后新文档会重新注入）。 */
async function waitChallengeAndSettle(page: Page): Promise<void> {
    if (!(await isChallengePage(page))) return
    console.log('[fixtures] 共享会话首载遇 Cloudflare 挑战，等待通过…')
    if (!(await waitChallengeCleared(page))) {
        throw new Error('Cloudflare 挑战未通过（有头模式可人工点选验证框）')
    }
}

/** 共享会话套件入口（用例侧：testSharedScript + describe.configure({ mode: 'serial' })）。
 *  ⚠️ worker 级 fixture 必须声明在 extend 的第二个泛型段（worker fixtures），与 test 段分开 */
export const testSharedScript = base.extend<{}, { sharedSession: SharedSession; extensionId: string }>({
    extensionId: [
        async ({ sharedSession }, use) => {
            await use(sharedSession.extensionId)
        },
        { scope: 'worker', auto: true }
    ],
    sharedSession: [
        async ({ }, use) => {
            const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
                const t0 = Date.now()
                console.log(`[setup] ▶ ${name} …`)
                try {
                    await fn()
                    console.log(`[setup] ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
                } catch (e) {
                    console.log(`[setup] ✘ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${String(e).slice(0, 160)}`)
                    throw e
                }
            }
            const { mata } = mataInfo()
            let baseDir = ''
            await step('baseProfileReady（哨兵 profile 就绪）', async () => {
                baseDir = await baseProfileReady(baseProfileDir())
            })
            const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${mata.displayName}-e2e-shared-`.toLowerCase()))
            fs.cpSync(baseDir, userDataDir, { recursive: true })
            let context: BrowserContext | undefined
            let extensionId = ''
            let page: Page | undefined
            await step('launchExtensionContext（启动浏览器+侧载）', async () => {
                context = await launchExtensionContext(userDataDir)
            })
            await step('waitExtensionId（等 SW 出现）', async () => {
                extensionId = await waitExtensionId(context!)
                console.log(`[setup]   extensionId=${extensionId}`)
            })
            await step('prepareRuntime', async () => {
                await resolveManager().prepareRuntime?.(context!, extensionId)
            })
            // 脚本只装一次（主脚本；探针仅 mata.e2e.probeEntry 声明了的项目安装）
            await step(`installScript 主脚本`, async () => {
                await resolveManager().installScript(context!, extensionId, resolveUserScript())
            })
            if (artifactNames(mata).probeScript) {
                await step(`installScript 探针`, async () => {
                    await resolveManager().installScript(context!, extensionId, resolveE2EProbeScript())
                })
            }
            // ⚠️ 标签页配额 ≤ 1：复用启动自带的初始页面（about:blank），不另开 newPage
            page = context!.pages()[0] ?? (await context!.newPage())
            // 有目标站点的项目：首次且唯一一次站点加载（挑战兜底）；无站点项目跳过
            if (TARGET_SITE) {
                await step(`goto ${TARGET_SITE}`, async () => {
                    await page!.goto(TARGET_SITE, { waitUntil: 'domcontentloaded' })
                    await waitChallengeAndSettle(page!)
                })
            }
            await use({ context: context!, page: page!, extensionId })
            await context!.close()
            fs.rmSync(userDataDir, { recursive: true, force: true })
        },
        { scope: 'worker', auto: true }
    ]
})

export { chromium }


