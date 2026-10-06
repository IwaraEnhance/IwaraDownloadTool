/**
 * e2e 侧的 mata.json 存取（与 build/mata.ts 同一契约的读取面）。
 *
 * 框架需要的项目事实只有两类，全部读 mata.json：
 * - e2e 交接点：产物基座（displayName）、探针入口（有 = 项目提供 GM 探针）、目标站点；
 * - userscript 元数据头（name/version/grant 等，供探针产物核对）。
 * 项目未声明 targetSite 且无法从 include/match 推导时，站点类基建按"无站点项目"降级。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
// Mata 类型由 src/types/mata.d.ts 的 declare namespace 全局提供（项目 .d.ts 惯例，无需 import）

/** 仓库根（本文件位于 e2e/helpers/ 下） */
export const projectRoot = path.resolve(import.meta.dirname, '../..')

/** 主产物与探针产物的 dist 相对路径（由 displayName 派生，与 build/mata.ts 同规则） */
export function artifactNames(mata: Mata.Root): { userScript: string; probeScript: string | undefined } {
    return {
        userScript: `${mata.displayName}.user.js`,
        probeScript: mata.e2e?.probeEntry ? `${mata.displayName}.e2e-test.user.js` : undefined
    }
}

/** 从 include/match 推导目标站点（泛词干模式无法还原域名时返回 undefined） */
function deriveTargetSite(mata: Mata.Root): string | undefined {
    for (const pattern of [...(mata.match ?? []), ...(mata.include ?? [])]) {
        const host = pattern.split('://')[1]?.split('/')[0]
        if (!host || host === '*') continue
        // 具体域名（*.example.com / example.com）：去通配后无星号残留，可还原完整域名
        const domain = host.replaceAll('*', '').replace(/^\.+/, '')
        if (domain && !domain.includes('*')) return `https://www.${domain}/`
        break // 首条是泛词干模式（*iwara*）即放弃推导，需显式 targetSite
    }
    return undefined
}

let cached: { mata: Mata.Root; targetSite: string | undefined } | undefined

/**
 * 目标站点（E2E_SITE_URL 可覆盖；项目未声明 targetSite 且 include/match 无法
 * 推导 = 空串）。单文件模块级常量会在 CLI 环境读取前求值，故用惰性 getter。
 */
export function getTargetSite(): string {
    return process.env.E2E_SITE_URL ?? mataInfo().targetSite ?? ''
}

/** 读 mata.json（同进程记忆化）；结构问题抛人类可读错误 */
export function mataInfo(): { mata: Mata.Root; e2e: Mata.E2E; targetSite: string | undefined } {
    if (cached) return { mata: cached.mata, e2e: cached.mata.e2e ?? {}, targetSite: cached.targetSite }
    const mataPath = path.join(projectRoot, 'src', 'mata', 'mata.json')
    if (!existsSync(mataPath)) {
        throw new Error(`未找到 ${mataPath}——e2e 框架以 mata.json 为项目权威信息源，请先迁移`)
    }
    const mata = JSON.parse(readFileSync(mataPath, 'utf8')) as Mata.Root
    if (!mata.displayName) throw new Error('mata.json 缺 displayName（构建产物名基座）')
    const targetSite = mata.e2e?.targetSite ?? deriveTargetSite(mata)
    cached = { mata, targetSite }
    return { mata, e2e: mata.e2e ?? {}, targetSite }
}
