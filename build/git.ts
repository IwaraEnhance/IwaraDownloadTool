import { execSync } from 'child_process';

/** 执行命令，仅在失败时输出结果到终端 */
export function run(cmd: string): void {
    try {
        execSync(cmd, { stdio: 'pipe' });
    } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString();
        const stdout = (error as { stdout?: Buffer }).stdout?.toString();
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        console.error(`\n命令执行失败: ${cmd}`);
        throw error;
    }
}

/** 执行命令并返回去首尾空白的字符串结果 */
export function exec(cmd: string): string {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
}

/** 获取当前短提交哈希 */
export function getCurrentCommit(): string {
    return exec('git rev-parse --short HEAD');
}

/** 获取最新的标签名 */
export function getLatestTag(): string {
    try {
        return exec('git describe --tags --abbrev=0');
    } catch {
        return '';
    }
}

/** 获取当前分支名 */
export function getCurrentBranch(): string {
    return exec('git rev-parse --abbrev-ref HEAD');
}

/** 检查工作区是否干净（无未提交的更改） */
export function checkCleanWorkingTree(): void {
    const status = exec('git status --porcelain');
    if (status) {
        console.error('检测到未提交的更改，请先提交或暂存后再执行。');
        process.exit(1);
    }
    console.log('工作区干净');
}