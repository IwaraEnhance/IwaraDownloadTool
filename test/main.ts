import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// TypeScript 类型检查
console.log('正在检查 TypeScript 类型...');
try {
    execSync('npx tsc --noEmit --project tsconfig.json', { cwd: root, stdio: 'inherit' });
    console.log('TypeScript 类型检查通过');
} catch {
    console.error('TypeScript 类型检查失败，测试终止');
    process.exit(1);
}

// 全局环境 Mock（静态导入确保最先执行）
import './setup.ts';

// 自动扫描并注册 test/tests/ 下所有 .test.ts 文件
const testsDir = join(__dirname, 'tests');
const testFiles = readdirSync(testsDir).filter(f => f.endsWith('.test.ts')).sort();
for (const file of testFiles) {
    await import(`./tests/${file}`);
}

const { runAllTests } = await import('./framework.ts');

runAllTests().catch(console.error);
