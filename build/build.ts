import esbuild from 'esbuild';
import { promises, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import inlineCSS from './inlineCSS.ts';
import minifyModules from './minifyModules.ts';

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
    let result = text;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`%#${key}#%`, 'g'), value);
    }
    return result;
}

function typeCheck(): void {
    console.log('正在检查 TypeScript 类型...');
    try {
        execSync('npx tsc --noEmit --project tsconfig.json', {
            cwd: root,
            stdio: 'inherit',
        });
        console.log('TypeScript 类型检查通过');
    } catch {
        console.error('TypeScript 类型检查失败，构建终止');
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

    // 设置版本
    const releaseTag = process.argv[2] ?? 'dev';
    const version = `${packageInfo.version}${releaseTag === 'dev' ? '-dev.' + UUID() : ''}`;
    mataTemplate.version = version;
    console.log(`版本: ${version}`);

    // 替换 URL 占位符
    const vars: Record<string, string> = {
        release_tag: releaseTag,
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
        target: ['es2022', 'chrome92', 'edge92', 'firefox90', 'safari15.4'],
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
        plugins: [inlineCSS],
    });

    const result = await esbuild.build({
        ...sharedOptions,
        write: false,
        treeShaking: false,
        minify: false,
        sourcemap: false,
        plugins: [minifyModules, inlineCSS],
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
        let out = result.outputFiles[0].text
            .replace(/\r\n?|\n/g, '\r\n')
            .replace(/ \/\* .*? \*\//g, '')
            .replace(/\/\*\*[\s\S]*?\*\//g, '')
            .replace(/\/\/ (?![@=]).*$/gm, '')
            .replace(/\r\n?|\n/g, '\r\n')
            .replace(/^\s*$/gm, '');
        await promises.writeFile(distUncompressPath, out);
    } else {
        console.error(`构建失败：${result.errors}`);
        process.exit(1);
    }

    console.log('构建完成');
}

main().catch((err) => {
    console.error('构建失败:', err);
    process.exit(1);
});