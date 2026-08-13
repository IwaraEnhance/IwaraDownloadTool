/**
 * 发布脚本（重构版）
 *
 * 职责划分:
 * - 本地（本脚本）: 在 dev 分支上 同步远程 → 提升版本号 → 验证构建 → 提交 → 推送 dev
 * - CI（.github/workflows）: tag 与 GitHub Release 资产
 *     - dev 推送    → Preview.yml 构建 preview 渠道 → 发布/移动 preview release
 *     - master 合并 → Release.yml 构建 latest 渠道 → 创建 vX.Y.Z 存档 + latest release
 *                    ⚠ 之后会把远程 dev 删除并重建到 master（远程分支变化）
 *
 * 本地不再打 tag: vX.Y.Z / preview / latest 均由 CI gh release create 创建或移动，
 * 避免本地 tag 被 CI --cleanup-tag 删除重建的冲突（见 git 历史 v3.3.119/latest 均指向 master 合并提交）。
 *
 * 推送前会与 origin/dev 同步: CI 重建远程 dev 后本地会落后/分叉，
 * 脚本会先尝试自动合并可合并的远程更改（快进/干净合并，在测试与构建之前），
 * 冲突才中止并恢复原状，避免 bump 提交创建后才撞上 non-fast-forward 推送失败。
 *
 * 完整性守卫: 发布过程中（测试/构建/bump 期间）禁止手动提交或暂存——
 * HEAD 变化或出现发布文件之外的暂存内容都会中止发布，杜绝绕过发布流程的发布。
 *
 * 使用方式:
 *   npm run release                          # patch 发布
 *   npm run release -- minor                 # minor 发布
 *   npm run release -- major                 # major 发布
 *   npm run release -- minor --dry-run       # 演练: 只打印步骤不执行
 *   npm run release -- patch --no-test       # 跳过测试
 *   npm run release -- patch --no-build      # 跳过构建验证
 *   npm run release -- patch --channel latest  # 构建验证用 latest 渠道（默认 dev，防意外更新）
 */
import { readFileSync } from 'fs';
import {
    run,
    exec,
    getCurrentCommit,
    getCurrentBranch,
    hasUncommittedChanges,
} from './git.ts';
import { log, success, error, warn } from './log.ts';

const TAG = 'release' as const;

/**
 * 本地验证构建渠道:
 * - dev（默认）: updateURL 指向不存在的 releases/download/dev/，安装本地产物后
 *   不会被自动更新到 preview 渠道版本——dev 渠道存在的意义即「防意外更新」
 * - preview / latest: 供需要验证特定渠道产物时显式指定
 */
const CHANNELS = ['dev', 'preview', 'latest'] as const;
type Channel = (typeof CHANNELS)[number];

interface ReleaseOptions {
    level: 'patch' | 'minor' | 'major';
    dryRun: boolean;
    runTests: boolean;
    runBuild: boolean;
    channel: Channel;
}

/** 解析命令行参数: 位置参数为版本级别，--flag 为开关 */
function parseArgs(argv: string[]): ReleaseOptions {
    const options: ReleaseOptions = {
        level: 'patch',
        dryRun: false,
        runTests: true,
        runBuild: true,
        channel: 'dev',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (['patch', 'minor', 'major'].includes(arg)) {
            options.level = arg as ReleaseOptions['level'];
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--no-test') {
            options.runTests = false;
        } else if (arg === '--no-build') {
            options.runBuild = false;
        } else if (arg === '--channel') {
            const value = argv[++i];
            if (value && CHANNELS.includes(value as Channel)) {
                options.channel = value as Channel;
            } else {
                error(TAG, `无效的渠道: ${value}，可用选项: ${CHANNELS.join(', ')}`);
                process.exit(1);
            }
        } else if (arg.startsWith('--channel=')) {
            const value = arg.slice('--channel='.length);
            if (CHANNELS.includes(value as Channel)) {
                options.channel = value as Channel;
            } else {
                error(TAG, `无效的渠道: ${value}，可用选项: ${CHANNELS.join(', ')}`);
                process.exit(1);
            }
        } else {
            error(TAG, `未知参数: ${arg}`);
            process.exit(1);
        }
    }
    return options;
}

/** 从 package.json 中提取版本号 */
function getPackageVersion(): string {
    const raw = readFileSync('package.json', 'utf-8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (!json.version || typeof json.version !== 'string') {
        throw new Error('package.json 中未找到有效的 version 字段');
    }
    return json.version;
}

/** 语义化版本递增（package.json 版本恒为 X.Y.Z，无预发布段） */
function bumpVersion(version: string, level: ReleaseOptions['level']): string {
    const [major, minor, patch] = version.split('.').map(Number);
    switch (level) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

/** 发布提交只允许包含这些文件（package.json/package-lock.json 由 npm version 修改，src/i18n.ts 由构建生成） */
const RELEASE_FILES = ['package.json', 'package-lock.json', 'src/i18n.ts'];

/**
 * 发布完整性守卫：确保发布过程中没有绕过发布流程的手动提交或暂存
 * - HEAD 必须仍是发布基线（否则说明有人在发布过程中手动 commit）
 * - 暂存区必须只含发布文件（否则说明有人手动 git add，会混入发布提交）
 */
function verifyReleaseIntegrity(baseCommit: string): void {
    const head = exec('git rev-parse HEAD');
    if (head !== baseCommit) {
        throw new Error(`检测到发布过程中的手动提交（HEAD 已从基线 ${baseCommit} 变为 ${head}），发布中止`);
    }
    const staged = exec('git diff --cached --name-only').split('\n').filter(Boolean);
    const unexpected = staged.filter((file) => !RELEASE_FILES.includes(file));
    if (unexpected.length > 0) {
        throw new Error(`检测到不在发布范围内的暂存文件: ${unexpected.join(', ')}，发布中止`);
    }
}

/**
 * 与远程 origin/dev 同步: 尝试合并可合并的远程更改
 * Release 工作流发布后会把远程 dev 删除并重建到 master（分支变化），
 * 此时本地 dev 会落后或分叉。落后时先尝试自动合并（快进/干净合并直接继续），
 * 冲突才中止并恢复原状——确保后续测试与构建基于合并后的最新代码。
 */
function syncWithRemote(dryRun: boolean): void {
    run('git fetch origin', { tag: TAG, dryRun });
    let remoteHead: string;
    try {
        remoteHead = exec('git rev-parse origin/dev');
    } catch {
        error(TAG, '远程不存在 dev 分支（可能刚被 CI 删除且尚未重建），请稍后重试，或先手动推送 dev');
        process.exit(1);
    }
    const localHead = exec('git rev-parse HEAD');
    if (localHead === remoteHead) {
        log(TAG, '本地 dev 与远程 origin/dev 同步');
        return;
    }
    const ahead = Number(exec('git rev-list --count origin/dev..HEAD'));
    const behind = Number(exec('git rev-list --count HEAD..origin/dev'));
    if (behind === 0) {
        if (ahead > 0) {
            log(TAG, `本地 dev 领先远程 ${ahead} 个提交（未推送的本地工作），无需合并`);
        }
        return;
    }

    // 本地落后（或分叉）：尝试合并远程更改
    log(TAG, `远程 origin/dev 领先本地 ${behind} 个提交${ahead > 0 ? `（本地亦有 ${ahead} 个独立提交）` : ''}，尝试合并...`);
    try {
        // 纯落后用快进合并；分叉用普通合并（可自动合并则产生合并提交）
        run(`git merge origin/dev${ahead === 0 ? ' --ff-only' : ''}`, { tag: TAG, dryRun });
        log(TAG, ahead === 0 ? '已快进合并远程更改' : '已自动合并远程更改');
    } catch {
        error(TAG, '合并远程更改时发生冲突，无法自动合并');
        if (!dryRun) {
            try {
                run('git merge --abort', { tag: TAG, silent: true });
                success(TAG, '已终止合并，工作区恢复原状');
            } catch {
                error(TAG, '终止合并失败，请手动处理');
            }
        }
        error(TAG, '请手动执行 git pull 处理冲突后重新发布');
        process.exit(1);
    }
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));

    // ── 1. 前置检查 ──
    const branch = getCurrentBranch();
    if (branch !== 'dev') {
        error(TAG, `发布仅允许在 dev 分支执行，当前分支: ${branch}。正式版由 master 合并后的 CI 发布。`);
        process.exit(1);
    }
    if (hasUncommittedChanges()) {
        error(TAG, '检测到未提交的更改，请先提交或暂存后再执行。');
        process.exit(1);
    }
    // 与远程同步：先尝试合并可合并的远程更改（在测试/编译前，保证基于最新代码）
    syncWithRemote(options.dryRun);
    const backupCommit = getCurrentCommit();
    const oldVersion = getPackageVersion();
    const newVersion = bumpVersion(oldVersion, options.level);
    log(TAG, `分支: ${branch}，版本升级: ${oldVersion} → ${newVersion}${options.dryRun ? '（演练模式，不实际执行）' : ''}`);

    // ── 2. 运行测试（验证 bump 前代码质量） ──
    if (options.runTests) {
        log(TAG, '运行测试...');
        run('npm test', { tag: TAG, dryRun: options.dryRun });
    }

    // ── 3-5. bump 版本 → 构建验证 → 提交（失败可安全回滚） ──
    try {
        log(TAG, `执行 ${options.level} 版本升级...`);
        run(`npm version ${options.level} --no-git-tag-version`, { tag: TAG, dryRun: options.dryRun });

        // 先 bump 后构建，保证产物使用新版本号
        if (options.runBuild) {
            log(TAG, `构建验证（渠道: ${options.channel}）...`);
            run(`npm run build ${options.channel}`, { tag: TAG, dryRun: options.dryRun });
        }

        // 完整性守卫：发布过程中禁止手动提交/暂存（防止出现绕过发布流程的发布）
        if (!options.dryRun) {
            log(TAG, '校验发布完整性（无手动提交/暂存）...');
            verifyReleaseIntegrity(backupCommit);
        }

        log(TAG, '创建版本提交...');
        run('git add package.json package-lock.json src/i18n.ts', { tag: TAG, dryRun: options.dryRun });
        if (!options.dryRun) {
            verifyReleaseIntegrity(backupCommit);
        }
        run(`git commit -m "release: v${newVersion}"`, { tag: TAG, dryRun: options.dryRun });
    } catch (err) {
        error(TAG, `发布失败: ${err}`);
        if (!options.dryRun) {
            // 仅当 HEAD 仍在发布基线时才能安全撤销发布流程的本地更改；
            // 若有人手动提交（HEAD 已变），绝不自动回滚，避免误删其提交
            const head = exec('git rev-parse HEAD');
            if (head === backupCommit) {
                log(TAG, `撤销发布流程的本地更改（基线 ${backupCommit}）...`);
                try {
                    run('git reset', { tag: TAG, silent: true });
                    // 逐文件还原，避免某个文件不存在导致整体还原失败
                    for (const file of RELEASE_FILES) {
                        try {
                            run(`git restore ${file}`, { tag: TAG, silent: true });
                        } catch {
                            // 文件未被跟踪或无改动，无需还原
                        }
                    }
                    success(TAG, '已撤销本地更改（其他文件的手动编辑予以保留）');
                } catch {
                    error(TAG, '撤销失败，请手动处理');
                }
            } else {
                warn(TAG, 'HEAD 已偏离发布基线，检测到发布过程中的手动提交，跳过自动回滚，请手动检查');
            }
        }
        process.exit(1);
    }

    // ── 6. 推送 dev（触发 Preview 工作流；推送后失败不回滚，避免本地/远程分叉） ──
    log(TAG, `推送 ${branch} 分支（触发 Preview 工作流）...`);
    try {
        run(`git push origin ${branch}`, { tag: TAG, dryRun: options.dryRun });
    } catch (err) {
        error(TAG, `推送失败: ${err}`);
        warn(TAG, '本地提交已创建但未推送，常见原因: 远程 dev 已被 CI 重建（落后/分叉）');
        warn(TAG, '解决: git fetch origin && git rebase origin/dev 后手动执行 git push origin dev');
        process.exit(1);
    }

    success(TAG, `已发布 v${newVersion}（版本提交已推送到 ${branch}）`);
    log(TAG, 'CI Preview 工作流将构建并发布 preview 渠道预览版');
    log(TAG, '后续步骤: 合并 dev → master 后，Release 工作流将构建并发布 latest 渠道正式版（vX.Y.Z 存档 + latest）');
}

main();