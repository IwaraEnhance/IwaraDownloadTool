import { readdirSync, writeFileSync, watch } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Plugin } from 'esbuild'
import { log, success, error } from './log.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const i18nDir = join(root, 'src', 'i18n')
const outputPath = join(root, 'src', 'i18n.ts')

/** 从文件名推导语言键：zh_cn.json → zh，en.json → en */
function fileKey(filename: string): string {
    return filename.replace('.json', '').split('_')[0]
}

/** 生成 src/i18n.ts */
export function generateI18n(): boolean {
    try {
        const files = readdirSync(i18nDir)
            .filter((f) => f.endsWith('.json'))
            .sort()
        const lines = ['/* 自动生成 */', ...files.map((f) => `import ${f.replace('.json', '')} from './i18n/${f}';`), 'export const i18nList = {', ...files.map((f) => `    ${fileKey(f)}: ${f.replace('.json', '')},`), '} satisfies Record<string, I18N>;', 'export type Language = keyof typeof i18nList;']
        writeFileSync(outputPath, lines.join('\n'), 'utf-8')
        success('i18n', '翻译文件已生成')
        return true
    } catch {
        error('i18n', '翻译文件生成失败')
        return false
    }
}

/** esbuild 插件：构建时自动生成 */
export const i18nPlugin: Plugin = {
    name: 'generate-i18n',
    setup(build) {
        build.onStart(() => {
            generateI18n()
        })
    }
}

/** 开发模式：监听 src/i18n/ 中文件新建或删除时重新生成 */
if (process.argv.includes('--watch')) {
    log('i18n', '监听中...')
    generateI18n()
    watch(i18nDir, { recursive: true }, (event, filename) => {
        if (event === 'rename' && filename?.endsWith('.json')) {
            log('i18n', `${filename} 已 ${event}，重新生成`)
            generateI18n()
        }
    })
}
