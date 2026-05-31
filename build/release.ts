/**
 * 发布脚本
 * 职责：提升版本号 → 提交 → 打标签 → 推送
 * 
 * 使用方式:
 *   npm run release           # patch 发布
 *   npm run release -- minor  # minor 发布
 *   npm run release -- major  # major 发布
 */
import {
    run,
    checkCleanWorkingTree,
    getCurrentCommit,
    getLatestTag,
    getCurrentBranch,
} from './git.ts';
import { readFileSync } from 'fs';
import { log, success, error } from './log.ts';

/** 从 package.json 中提取版本号 */
function getPackageVersion(): string {
    const raw = readFileSync('package.json', 'utf-8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (!json.version || typeof json.version !== 'string') {
        throw new Error('package.json 中未找到有效的 version 字段');
    }
    return json.version;
}

function main(): void {
    const level = process.argv[2] || 'patch';
    if (!['patch', 'minor', 'major'].includes(level)) {
        error('release', `无效的版本级别: ${level}，可用选项: patch, minor, major`);
        process.exit(1);
    }

    // 1. 前置检查
    checkCleanWorkingTree();

    // 2. 运行测试
    log('release', '运行测试...');
    run('npm test');

    // 3. 编译构建
    log('release', '执行构建编译...');
    run('npm run build');

    const backupCommit = getCurrentCommit();
    const backupTag = getLatestTag();
    let newTag = '';

    log('release', `当前分支: ${getCurrentBranch()}`);
    log('release', `当前版本标签: ${backupTag || '无'}`);
    log('release', `备份提交: ${backupCommit}`);

    try {
        // 4. 升级版本号
        log('release', `执行 ${level} 版本升级...`);
        run(`npm version ${level} --no-git-tag-version`);

        const version = getPackageVersion();
        newTag = `v${version}`;

        // 5. 提交版本变更
        log('release', '创建版本提交...');
        run('git add package*.json');
        run(`git commit -m "release: ${newTag}"`);

        // 6. 打标签
        log('release', '创建带注释的标签...');
        run(`git tag -a ${newTag} -m "Version ${version}"`);

        // 7. 推送
        log('release', '推送代码及标签...');
        run('git push');
        run(`git push origin ${newTag}`);

        success('release', `成功发布版本 ${newTag}`);
        process.exit(0);
    } catch (err) {
        error('release', `发布失败: ${err}`);
        // 回滚
        try {
            run(`git reset --hard ${backupCommit}`);
            if (newTag) {
                run(`git tag -d ${newTag}`);
            }
        } catch {
            error('release', '回滚失败，请手动处理');
        }
        process.exit(1);
    }
}

main();