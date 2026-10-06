/**
 * mata.json 序列化/反序列化（项目权威信息源的存取层，零外部工具依赖）。
 *
 * mata.json 是用户脚本项目的唯一权威信息源（含构建内部键与 e2e 测试信息），
 * 本模块是其与 userscript 头（`// @Key value`）之间的双向桥梁：
 * - loadMata：读 + 校验（构建期/测试期共用）；
 * - serializeUserscriptHeader：可序列化键 → userscript 元数据块；
 * - resolveInjectionSites：从 include/match 解析「站点可注入」事实 ——
 *   通配模式归一为主页 URL（e2e 目标站点由此而来，项目换站即文件换行）。
 */
import { readFileSync } from 'fs'
import { join } from 'path'

/** userscript 头的裸键（mata.json 中布尔 true → 输出 `// @noframes` 不带值） */
const BARE_KEYS = new Set(['noframes'])

/** 仓库根（本模块位于 build/ 下） */
export const projectRoot = join(import.meta.dirname, '..')

/** mata.json 路径（相对仓库根） */
export const MATA_PATH = join(projectRoot, 'src', 'mata', 'mata.json')

/** 读取并校验 mata.json（任何结构问题都在此抛人类可读错误） */
export function loadMata(mataPath = MATA_PATH): Mata.Root {
    let raw: unknown
    try {
        raw = JSON.parse(readFileSync(mataPath, 'utf8'))
    } catch (e) {
        throw new Error(`mata.json 不可读（${mataPath}）: ${String(e).slice(0, 120)}`)
    }
    const mata = raw as Mata.Root
    const problems: string[] = []
    if (!mata.displayName || typeof mata.displayName !== 'string') problems.push('displayName（构建产物名基座）缺失')
    if (!mata.version || !/^\d+\.\d+\.\d+$/.test(mata.version)) problems.push('version（X.Y.Z）缺失或格式非法')
    if (!mata.name?.default) problems.push('name.default（脚本名）缺失')
    if (problems.length) throw new Error(`mata.json 结构不合法:\n  - ${problems.join('\n  - ')}`)
    return mata
}

/** 模板变量替换：%#key#% → vars[key]（未命中的占位符原样保留，便于上游发现） */
export function replaceTemplateVars(text: string, vars: Record<string, string>): string {
    return text.replace(/%#(\w+)#%/g, (_, key) => vars[key] ?? _)
}

/**
 * 可序列化键 → userscript 元数据块（`// ==UserScript== ... // ==/UserScript==`）。
 * 内部键（displayName/version/e2e）不出现在产物头；
 * name/description 为 LocalizedText：default → @key，其余 → @key:<locale>。
 * 键值列对齐（按最长键 padEnd），保持手写模板的可读版式。
 */
export function serializeUserscriptHeader(mata: Mata.Root, version?: string): string {
    // 两遍式：先收集全部 [键, 值行]，得到键长上界后再统一对齐输出
    const entries: Array<{ key: string; value: string | boolean | null }> = []
    const collect = (key: string, value: string | string[] | boolean | null | undefined): void => {
        if (value === undefined || value === null || value === false) return
        if (BARE_KEYS.has(key) && value === true) {
            entries.push({ key, value: null }) // 裸键：无值行
            return
        }
        for (const v of Array.isArray(value) ? value : [value]) {
            entries.push({ key, value: v })
        }
    }
    // 本地化键展开：name/description 同构（default 主键 + locale 后缀键）
    collect('name', mata.name.default)
    collect('description', mata.description.default)
    for (const [locale, text] of Object.entries(mata.name)) {
        if (locale !== 'default') collect(`name:${locale}`, text)
    }
    for (const [locale, text] of Object.entries(mata.description)) {
        if (locale !== 'default') collect(`description:${locale}`, text)
    }
    for (const key of ['icon', 'namespace', 'author', 'license', 'copyright', 'supportURL', 'homepageURL', 'updateURL', 'downloadURL']) {
        collect(key, mata[key as keyof Mata.Root] as string | undefined)
    }
    for (const key of ['connect', 'include', 'match', 'require', 'resource', 'grant']) {
        collect(key, mata[key as keyof Mata.Root] as string[] | undefined)
    }
    collect('run-at', mata['run-at'])
    collect('noframes', mata.noframes === true ? true : undefined)
    if (version) collect('version', version)

    // 值列对齐：最长键 + 1 空格（无值行只输出键，不参与值列）
    const pad = entries.reduce((max, e) => Math.max(max, e.key.length), 0) + 1
    const lines = entries.map((e) => (e.value === null ? `// @${e.key}` : `// @${e.key.padEnd(pad, ' ')}${e.value}`))
    return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\r\n')
}

/**
 * 从 include/match 解析「站点可注入」事实 → e2e 目标站点首页。
 * 支持具体域名模式（协议加分域通配到域名再接路径段）与泛词干模式（任意协议
 * 加任意子域加词干通配再接路径段，如 *iwara* 词干），归一为词干列表（首条优先）。
 * 未声明任何站点 = 项目不面向特定站点，返回空表（框架跳过站点导航类基建）。
 */
export function resolveInjectionSites(mata: Mata.Root): string[] {
    const hosts: string[] = []
    for (const pattern of [...(mata.match ?? []), ...(mata.include ?? [])]) {
        // *://*.example.com/* | https://example.com/* | *://*iwara*/* → 取 host 段
        const host = pattern.split('://')[1]?.split('/')[0]
        if (!host || host === '*') continue
        // 去子域通配与首尾星号：*.example.com / *iwara* → iwara 类词干保留（域后缀形态）
        const stem = host.replaceAll('*', '')
        if (stem && !hosts.includes(stem)) hosts.push(stem)
    }
    return hosts
}

/** e2e 目标站点：include/match 首个站点词干的 www 形（无站点声明 = undefined） */
export function resolveTargetSite(mata: Mata.Root): string | undefined {
    const first = resolveInjectionSites(mata)[0]
    return first ? `https://www.${first}/` : undefined
}
