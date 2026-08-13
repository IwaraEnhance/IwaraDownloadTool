import { execSync } from 'child_process';
import type { Tag } from './log.ts';

export interface RunOptions {
    /** 日志标签（dry-run 打印命令时使用），默认 'git' */
    tag?: Tag;
    /** 失败时不打印命令输出 */
    silent?: boolean;
    /** 演练模式：只打印命令不执行 */
    dryRun?: boolean;
}

/**
 * 执行有副作用的命令
 * 失败时打印 stdout/stderr 后抛出；dry-run 模式只打印不执行
 */
export function run(cmd: string, options: RunOptions = {}): void {
    const { tag = 'git', silent = false, dryRun = false } = options;
    if (dryRun) {
        console.log(`  [${tag}] → ${cmd}`);
        return;
    }
    try {
        execSync(cmd, { stdio: 'pipe' });
    } catch (err) {
        if (!silent) {
            const stdout = (err as { stdout?: Buffer }).stdout?.toString();
            const stderr = (err as { stderr?: Buffer }).stderr?.toString();
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
        }
        throw err;
    }
}

/** 执行只读命令并返回去首尾空白的字符串结果 */
export function exec(cmd: string): string {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
}

/** 获取当前短提交哈希 */
export function getCurrentCommit(): string {
    return exec('git rev-parse --short HEAD');
}

/** 获取当前分支名 */
export function getCurrentBranch(): string {
    return exec('git rev-parse --abbrev-ref HEAD');
}

/** 工作区是否有未提交的更改（含未跟踪文件） */
export function hasUncommittedChanges(): boolean {
    return exec('git status --porcelain').length > 0;
}