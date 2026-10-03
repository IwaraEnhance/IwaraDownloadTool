/**
 * 构建脚本
 * 职责：类型检查 → 解析元数据模板 → esbuild 编译出压缩/未压缩产物 + .mata.js
 *
 * 使用方式:
 *   npm run build             # dev 渠道（默认: 版本号附加 -dev.<uuid>）
 *   npm run build preview     # preview 渠道（预览版，Preview.yml 发布）
 *   npm run build latest      # latest 渠道（正式版，Release.yml 发布）
 *
 * 渠道决定产物中的 @version 与 @updateURL/@downloadURL 指向:
 *   dev     → .../releases/download/dev/...（该 release 不存在，更新检查失败 →
 *             安装本地产物后不会被自动更新到 preview/latest 渠道，即防意外更新）
 *   preview → .../releases/download/preview/...
 *   latest  → .../releases/download/latest/...
 */
import esbuild from 'esbuild'
import { promises, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import inlineCSS from './inlineCSS.ts'
import minifyModules from './minifyModules.ts'
import { i18nPlugin } from './generate-i18n.ts'
import { log, success, error } from './log.ts'
import { loadMata, serializeUserscriptHeader, replaceTemplateVars } from './mata.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = join(__dirname, '..')

const distPath = join(root, 'dist')
const sourcePath = join(root, 'src')
const tsconfigPath = join(root, 'tsconfig.json')

function ensureDir(path: string) {
    if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function UUID(): string {
    return randomUUID().replaceAll('-', '')
}

/** 发布渠道：dev 本地验证 / preview 预览版 / latest 正式版（与 CI 工作流及 GitHub Release 渠道一一对应） */
const CHANNELS = ['dev', 'preview', 'latest'] as const
type Channel = (typeof CHANNELS)[number]

/** 解析渠道参数：`npm run build [channel]`，缺省为 dev */
function parseChannel(raw: string | undefined): Channel {
    const channel = (raw ?? 'dev') as Channel
    if (!CHANNELS.includes(channel)) {
        error('build', `无效的发布渠道: ${channel}，可用选项: ${CHANNELS.join(', ')}`)
        process.exit(1)
    }
    return channel
}

/** 计算产物版本号：dev 渠道附加 -dev.<uuid> 保证每次构建可区分，preview/latest 使用 package.json 版本 */
function resolveVersion(packageVersion: string, channel: Channel): string {
    return channel === 'dev' ? `${packageVersion}-dev.${UUID()}` : packageVersion
}

/** 输出 dist 产物清单与大小 */
function logArtifacts(): void {
    for (const file of readdirSync(distPath).sort()) {
        const stat = statSync(join(distPath, file))
        log('build', `产物: ${file} (${formatSize(stat.size)})`)
    }
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
}

/** 未压缩产物后处理：统一换行、去除注释与空行（保留 metadata 中的 @ 行） */
function cleanUnminifiedOutput(text: string): string {
    return text
        .replace(/\r\n?|\n/g, '\r\n')
        .replace(/ \/\* .*? \*\//g, '')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\/\/ (?![@=]).*$/gm, '')
        .replace(/\r\n?|\n/g, '\r\n')
        .replace(/^\s*$/gm, '')
}

function typeCheck(): void {
    log('build', '正在检查 TypeScript 类型...')
    try {
        execSync('npx tsc --noEmit --project tsconfig.json', {
            cwd: root,
            stdio: 'inherit'
        })
        success('build', 'TypeScript 类型检查通过')
    } catch {
        error('build', 'TypeScript 类型检查失败，构建终止')
        process.exit(1)
    }
}

async function main() {
    // 类型检查
    typeCheck()

    // 清空输出
    await promises.rm(distPath, {
        recursive: true,
        force: true
    })

    ensureDir(distPath)

    // 读取配置
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
    // 项目权威信息源（mata.json：产物名/版本/元数据/e2e 交接点，替代 package.json+userjs.mata 双源）
    const mata = loadMata()
    const e2eConfig = mata.e2e ?? {}

    // 渠道与版本：dev 附加 -dev.<uuid>（防意外更新），preview/latest 用 mata.json 版本
    const channel = parseChannel(process.argv[2])
    const version = resolveVersion(mata.version, channel)
    log('build', `渠道: ${channel}，版本: ${version}`)

    // 产物名基座（mata.displayName 单一来源；产物名与 URL 文件名段均由它派生）
    const baseName = mata.displayName

    // 模板变量（%#release_tag#% / %#display_name#% 等）
    const vars: Record<string, string> = {
        release_tag: channel,
        display_name: baseName,
        version: version
    }

    // 序列化 userscript 头（updateURL/downloadURL 等含模板占位符在此一并替换）
    const header = replaceTemplateVars(serializeUserscriptHeader(mata, version), vars)

    // 写入 .mata.js 文件（供 Tampermonkey 检查更新用）
    const mataTempPath = join(distPath, `${baseName}.mata.js`)
    writeFileSync(mataTempPath, header)

    // 编译入口（构建入口 = mata.e2e.entry，缺省 src/main.ts）
    const mainPath = join(root, e2eConfig.entry ?? 'src/main.ts')
    const distCompressPath = join(distPath, `${baseName}.min.user.js`)
    const distUncompressPath = join(distPath, `${baseName}.user.js`)

    const sharedOptions: esbuild.BuildOptions = {
        format: 'iife',
        entryPoints: [mainPath],
        bundle: true,
        banner: { js: header },
        loader: { '.json': 'json' },
        platform: 'browser',
        target: ['es2022', 'chrome110', 'edge110', 'firefox110', 'safari16.4'],
        charset: 'utf8',
        ignoreAnnotations: true,
        legalComments: 'none',
        tsconfigRaw: tsconfig
    }

    await esbuild.build({
        ...sharedOptions,
        keepNames: true,
        allowOverwrite: true,
        outfile: distCompressPath,
        minify: true,
        plugins: [i18nPlugin, inlineCSS]
    })

    const result = await esbuild.build({
        ...sharedOptions,
        write: false,
        treeShaking: false,
        minify: false,
        sourcemap: false,
        plugins: [i18nPlugin, minifyModules, inlineCSS]
    })

    if (result.outputFiles && result.outputFiles.length > 0) {
        await promises.writeFile(distUncompressPath, cleanUnminifiedOutput(result.outputFiles[0].text))
    } else {
        error('build', `构建失败：${result.errors}`)
        process.exit(1)
    }
    // e2e 探针脚本（仅 dev 渠道 + mata.e2e.probeEntry 声明探针的项目才构建）：
    // ⚠️ 刻意不带 @noframes —— GM 存储按脚本分域（跨脚本彼此不可见），「标签 ≤ 1」
    // 约束下真 remote 事件的唯一通路 = 同一脚本在同页顶 frame + 子 frame 的两个实例。
    // 宿主 = e2e 起的本地服务页面（127.0.0.1，零风控暴露、无外网依赖，CI 无头可跑）。
    // 渠道门在源头：preview/latest 是发布产出，dist 天然无探针，CI 无需任何过滤；
    // dev 是本地/CI 测试验证渠道，探针只在此存在。
    if (channel === 'dev' && e2eConfig.probeEntry) {
        // 探针 grant 从主脚本 mata.grant 派生（防手工枚举漏项）：GM 存储族 +
        // ⚠️ unsafeWindow（探针把操作口对象挂 unsafeWindow 供主世界 evaluate 直调，
        // 漏此权限 = 探针沙箱内 unsafeWindow 为 undefined，e2e 全线 not ready）
        const GM_STORAGE_GRANTS = new Set([
            'GM_getValue',
            'GM_setValue',
            'GM_deleteValue',
            'GM_listValues',
            'GM_addValueChangeListener',
            'GM_removeValueChangeListener',
            'unsafeWindow'
        ])
        const probeGrants = [...new Set([...(mata.grant ?? []), 'GM_info'])].filter((g) => GM_STORAGE_GRANTS.has(g) || g === 'GM_info')
        if (!probeGrants.includes('unsafeWindow')) {
            error('build', `探针 grant 缺 unsafeWindow（主脚本 mata.grant 未声明），无法暴露操作口——请在 mata.json grant 中补 "unsafeWindow"`)
            process.exit(1)
        }
        const e2eHeader = serializeUserscriptHeader(
            {
                ...mata,
                name: { default: `${baseName} E2E Probe` },
                description: { default: 'e2e-only probe: real-GM bridge for cross-context storage tests' },
                noframes: undefined,
                // e2e-only 本地产物：剥离主脚本的发布更新链路（updateURL/downloadURL
                // 指向主产物，探针若携带会在 latest 渠道验证构建时被管理器误跟更新）
                updateURL: undefined,
                downloadURL: undefined,
                grant: probeGrants,
                include: ['http://127.0.0.1/*', 'https://127.0.0.1/*'],
                match: ['http://127.0.0.1/*', 'http://127.0.0.1/*/*'],
                'run-at': 'document-start'
            },
            version
        )
        await esbuild.build({
            ...sharedOptions,
            entryPoints: [join(root, e2eConfig.probeEntry)],
            allowOverwrite: true,
            outfile: join(distPath, `${baseName}.e2e-test.user.js`),
            banner: { js: replaceTemplateVars(e2eHeader, vars) },
            minify: false,
            treeShaking: false,
            sourcemap: false,
            plugins: []
        })
    }
    logArtifacts()
    success('build', '构建完成')
}

main().catch((err) => {
    error('build', `构建失败: ${err}`)
    process.exit(1)
})
