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
import esbuild from 'esbuild';
import { promises, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import inlineCSS from './inlineCSS.ts';
import minifyModules from './minifyModules.ts';
import { i18nPlugin } from './generate-i18n.ts';
import { log, success, error } from './log.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const distPath = join(root, 'dist');
const sourcePath = join(root, 'src');
const packagePath = join(root, 'package.json');
const tsconfigPath = join(root, 'tsconfig.json');
const mataTemplatePath = join(sourcePath, 'mata', 'userjs.mata');

function ensureDir(path: string) {
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function UUID(): string {
    return randomUUID().replaceAll('-', '');
}

/** 发布渠道：dev 本地验证 / preview 预览版 / latest 正式版（与 CI 工作流及 GitHub Release 渠道一一对应） */
const CHANNELS = ['dev', 'preview', 'latest'] as const;
type Channel = (typeof CHANNELS)[number];

/** 解析渠道参数：`npm run build [channel]`，缺省为 dev */
function parseChannel(raw: string | undefined): Channel {
    const channel = (raw ?? 'dev') as Channel;
    if (!CHANNELS.includes(channel)) {
        error('build', `无效的发布渠道: ${channel}，可用选项: ${CHANNELS.join(', ')}`);
        process.exit(1);
    }
    return channel;
}

/** 计算产物版本号：dev 渠道附加 -dev.<uuid> 保证每次构建可区分，preview/latest 使用 package.json 版本 */
function resolveVersion(packageVersion: string, channel: Channel): string {
    return channel === 'dev' ? `${packageVersion}-dev.${UUID()}` : packageVersion;
}

/** 输出 dist 产物清单与大小 */
function logArtifacts(): void {
    for (const file of readdirSync(distPath).sort()) {
        const stat = statSync(join(distPath, file));
        log('build', `产物: ${file} (${formatSize(stat.size)})`);
    }
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

/** 未压缩产物后处理：统一换行、去除注释与空行（保留 metadata 中的 @ 行） */
function cleanUnminifiedOutput(text: string): string {
    return text
        .replace(/\r\n?|\n/g, '\r\n')
        .replace(/ \/\* .*? \*\//g, '')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\/\/ (?![@=]).*$/gm, '')
        .replace(/\r\n?|\n/g, '\r\n')
        .replace(/^\s*$/gm, '');
}

interface MetadataDict {
    [key: string]: string | (string | null)[] | null;
}

function parseMetadata(content: string): MetadataDict {
    const startTag = '// ==UserScript==';
    const endTag = '// ==/UserScript==';

    const startIndex = content.indexOf(startTag);
    if (startIndex === -1) throw new Error("No metadata block found");

    const bodyStart = startIndex + startTag.length;
    const endIndex = content.indexOf(endTag, bodyStart);
    if (endIndex === -1) throw new Error("Unclosed metadata block");

    const block = content.slice(bodyStart, endIndex);

    const lines = block
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('// @'))
        .map(l => l.replace('// @', '').trim());

    if (lines.length === 0) throw new Error("No metadata entries found");

    const results: MetadataDict = {};

    for (const line of lines) {
        const spaceIdx = line.indexOf(' ');
        const key = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
        const value = spaceIdx === -1 ? null : line.slice(spaceIdx + 1).trim();

        if (!key) continue;

        if (results[key] !== undefined) {
            const existing = results[key];
            if (Array.isArray(existing)) {
                existing.push(value);
            } else {
                results[key] = [existing, value];
            }
        } else {
            results[key] = value;
        }
    }

    return results;
}

function serializeMetadata(metadata: MetadataDict): string {
    const keys = Object.keys(metadata);
    const maxLen = keys.reduce((a, b) => a.length > b.length ? a : b, '').length;
    const pad = maxLen + 1;

    const lines: string[] = ['// ==UserScript=='];

    for (const [key, value] of Object.entries(metadata)) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
            if (v === null) {
                lines.push(`// @${key}`);
            } else {
                lines.push(`// @${key.padEnd(pad, ' ')}${v}`);
            }
        }
    }

    lines.push('// ==/UserScript==');
    return lines.join('\r\n');
}

function replaceTemplateVars(text: string, vars: Record<string, string>): string {
    return text.replace(/%#(\w+)#%/g, (_, key) => vars[key] ?? _);
}

function typeCheck(): void {
    log('build', '正在检查 TypeScript 类型...');
    try {
        execSync('npx tsc --noEmit --project tsconfig.json', {
            cwd: root,
            stdio: 'inherit',
        });
        success('build', 'TypeScript 类型检查通过');
    } catch {
        error('build', 'TypeScript 类型检查失败，构建终止');
        process.exit(1);
    }
}

async function main() {

    // 类型检查
    typeCheck();

    // 清空输出
    await promises.rm(distPath, {
        recursive: true,
        force: true
    });

    ensureDir(distPath);

    // 读取配置
    const packageInfo = JSON.parse(readFileSync(packagePath, 'utf8'));
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
    const displayName = packageInfo.displayName;

    // 解析 metadata 模板
    const mataTemplate = parseMetadata(readFileSync(mataTemplatePath, 'utf8'));

    // 渠道与版本：updateURL/downloadURL 中的 %#release_tag#% 即发布渠道
    const channel = parseChannel(process.argv[2]);
    const version = resolveVersion(packageInfo.version, channel);
    mataTemplate.version = version;
    log('build', `渠道: ${channel}，版本: ${version}`);

    // 替换 URL 占位符
    const vars: Record<string, string> = {
        release_tag: channel,
        display_name: displayName,
        version: version,
    };
    if (typeof mataTemplate.updateURL === 'string') {
        mataTemplate.updateURL = replaceTemplateVars(mataTemplate.updateURL, vars);
    }
    if (typeof mataTemplate.downloadURL === 'string') {
        mataTemplate.downloadURL = replaceTemplateVars(mataTemplate.downloadURL, vars);
    }

    // 序列化 metadata 并替换模板变量
    let matadata = serializeMetadata(mataTemplate);
    matadata = replaceTemplateVars(matadata, vars);

    // 写入 .mata.js 文件（供 Tampermonkey 检查更新用）
    const mataTempPath = join(distPath, `${displayName}.mata.js`);
    writeFileSync(mataTempPath, matadata);

    // 编译入口
    const mainPath = join(sourcePath, 'main.ts');
    const distCompressPath = join(distPath, `${displayName}.min.user.js`);
    const distUncompressPath = join(distPath, `${displayName}.user.js`);

    const sharedOptions: esbuild.BuildOptions = {
        format: 'iife',
        entryPoints: [mainPath],
        bundle: true,
        banner: { js: matadata },
        loader: { '.json': 'json' },
        platform: 'browser',
        target: ['es2022', 'chrome110', 'edge110', 'firefox110', 'safari16.4'],
        charset: 'utf8',
        ignoreAnnotations: true,
        legalComments: 'none',
        tsconfigRaw: tsconfig,
    };

    await esbuild.build({
        ...sharedOptions,
        keepNames: true,
        allowOverwrite: true,
        outfile: distCompressPath,
        minify: true,
        plugins: [i18nPlugin, inlineCSS],
    });

    const result = await esbuild.build({
        ...sharedOptions,
        write: false,
        treeShaking: false,
        minify: false,
        sourcemap: false,
        plugins: [i18nPlugin, minifyModules, inlineCSS],
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
        await promises.writeFile(distUncompressPath, cleanUnminifiedOutput(result.outputFiles[0].text));
    } else {
        error('build', `构建失败：${result.errors}`);
        process.exit(1);
    }

    logArtifacts();
    success('build', '构建完成');
}

main().catch((err) => {
    error('build', `构建失败: ${err}`);
    process.exit(1);
});