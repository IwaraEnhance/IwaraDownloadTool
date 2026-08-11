import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { Path } from '../../src/core/class.ts';

const pathTestGroup = new TestGroup('Path 类', '路径解析与规范化测试');

// ============ Windows 路径 ============

pathTestGroup.add(new Test('Windows 简单路径', 'async', function () {
    const p = new Path('C:\\Users\\test\\file.txt');
    this.assertEqual(p.type, 'Windows');
    this.assertEqual(p.fullPath, 'C:\\Users\\test\\file.txt');
    this.assertEqual(p.directory, 'C:\\Users\\test');
    this.assertEqual(p.fullName, 'file.txt');
    this.assertEqual(p.baseName, 'file');
    this.assertEqual(p.extension, 'txt');
}));

pathTestGroup.add(new Test('Windows 根目录路径', 'async', function () {
    const p = new Path('C:\\file.txt');
    this.assertEqual(p.directory, 'C:');
    this.assertEqual(p.fullName, 'file.txt');
}));

pathTestGroup.add(new Test('Windows 无扩展名文件', 'async', function () {
    const p = new Path('D:\\folder\\README');
    this.assertEqual(p.extension, '');
    this.assertEqual(p.baseName, 'README');
    this.assertEqual(p.fullName, 'README');
}));

pathTestGroup.add(new Test('Windows 多级目录', 'async', function () {
    const p = new Path('C:\\a\\b\\c\\d\\e\\file.txt');
    this.assertEqual(p.directory, 'C:\\a\\b\\c\\d\\e');
    this.assertEqual(p.fullName, 'file.txt');
}));

pathTestGroup.add(new Test('Windows 混合分隔符 (正斜杠)', 'async', function () {
    const p = new Path('C:/Users/test/file.txt');
    this.assertEqual(p.type, 'Windows');
    // 应统一为反斜杠
    this.assertEqual(p.fullPath, 'C:\\Users\\test\\file.txt');
}));

pathTestGroup.add(new Test('Windows 末尾斜杠处理', 'async', function () {
    const p = new Path('C:\\Users\\test\\');
    // 末尾斜杠应被去除，文件名为空
    this.assertEqual(p.fullPath, 'C:\\Users\\test');
}));

pathTestGroup.add(new Test('Windows 重复分隔符合并', 'async', function () {
    const p = new Path('C:\\Users\\\\test\\\\\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\Users\\test\\file.txt');
}));

pathTestGroup.add(new Test('Windows 点导航 (.)', 'async', function () {
    const p = new Path('C:\\Users\\.\\test\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\Users\\test\\file.txt');
}));

pathTestGroup.add(new Test('Windows 点导航 (..) 返回上层', 'async', function () {
    const p = new Path('C:\\Users\\test\\..\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\Users\\file.txt');
}));

pathTestGroup.add(new Test('Windows 点导航多层返回', 'async', function () {
    const p = new Path('C:\\Users\\a\\b\\..\\..\\file.txt');
    // b/.. 回到 a, a/.. 回到 Users, 最终: C:\Users\file.txt
    this.assertEqual(p.fullPath, 'C:\\Users\\file.txt');
}));

pathTestGroup.add(new Test('Windows 绝对路径越界抛错', 'async', function () {
    this.assertThrows(() => new Path('C:\\Users\\..\\..\\..\\file.txt'));
}));

pathTestGroup.add(new Test('Windows 路径含非法字符', 'async', function () {
    this.assertThrows(() => new Path('C:\\Users\\test\\file<>.txt'));
    this.assertThrows(() => new Path('C:\\Users\\test\\file|.txt'));
    this.assertThrows(() => new Path('C:\\Users\\test\\file?.txt'));
    this.assertThrows(() => new Path('C:\\Users\\test\\file*.txt'));
}));

pathTestGroup.add(new Test('Windows 路径含变量名中的非法字符', 'async', function () {
    // 变量名中的格式化参数部分含非法字符应抛错
    this.assertThrows(() => new Path('C:\\%#name:for<mat#%\\file.txt'));
}));

pathTestGroup.add(new Test('Windows 路径变量名合法', 'async', function () {
    const p = new Path('C:\\%#AUTHOR#%\\%#TITLE#%[%#ID#%].mp4');
    this.assertEqual(p.directory, 'C:\\%#AUTHOR#%');
    this.assertEqual(p.fullName, '%#TITLE#%[%#ID#%].mp4');
    this.assertEqual(p.baseName, '%#TITLE#%[%#ID#%]');
    this.assertEqual(p.extension, 'mp4');
}));

// ============ Unix 路径 ============

pathTestGroup.add(new Test('Unix 简单路径', 'async', function () {
    const p = new Path('/home/user/file.txt');
    this.assertEqual(p.type, 'Unix');
    this.assertEqual(p.fullPath, '/home/user/file.txt');
    this.assertEqual(p.directory, '/home/user');
    this.assertEqual(p.fullName, 'file.txt');
}));

pathTestGroup.add(new Test('Unix 根目录', 'async', function () {
    const p = new Path('/');
    this.assertEqual(p.fullPath, '/');
    this.assertEqual(p.directory, '/');
    this.assertEqual(p.fullName, '');
}));

pathTestGroup.add(new Test('Unix 无扩展名', 'async', function () {
    const p = new Path('/usr/bin/bash');
    this.assertEqual(p.extension, '');
    this.assertEqual(p.baseName, 'bash');
}));

pathTestGroup.add(new Test('Unix 点文件', 'async', function () {
    const p = new Path('/home/user/.gitconfig');
    // lastDot index 为 0，`lastDot <= 0` 导致 extension 为空
    this.assertEqual(p.baseName, '.gitconfig');
    this.assertEqual(p.extension, '');
}));

pathTestGroup.add(new Test('Unix 末尾斜杠', 'async', function () {
    const p = new Path('/home/user/');
    this.assertEqual(p.fullPath, '/home/user');
}));

pathTestGroup.add(new Test('Unix 重复斜杠合并', 'async', function () {
    const p = new Path('/home//user///file.txt');
    this.assertEqual(p.fullPath, '/home/user/file.txt');
}));

pathTestGroup.add(new Test('Unix 反斜杠统一为正斜杠', 'async', function () {
    const p = new Path('/home\\user\\file.txt');
    this.assertEqual(p.fullPath, '/home/user/file.txt');
}));

pathTestGroup.add(new Test('Unix 点导航 (.)', 'async', function () {
    const p = new Path('/home/./user/./file.txt');
    this.assertEqual(p.fullPath, '/home/user/file.txt');
}));

pathTestGroup.add(new Test('Unix 点导航 (..)', 'async', function () {
    const p = new Path('/home/user/../other/file.txt');
    this.assertEqual(p.fullPath, '/home/other/file.txt');
}));

pathTestGroup.add(new Test('Unix 绝对路径越界抛错', 'async', function () {
    this.assertThrows(() => new Path('/home/../../file.txt'));
}));

pathTestGroup.add(new Test('Unix 含空字符抛错', 'async', function () {
    this.assertThrows(() => new Path('/home/user\0file.txt'));
}));

// ============ 相对路径 ============

pathTestGroup.add(new Test('相对路径简单', 'async', function () {
    const p = new Path('folder/file.txt');
    this.assertEqual(p.type, 'Relative');
    this.assertEqual(p.fullPath, 'folder/file.txt');
}));

pathTestGroup.add(new Test('相对路径当前目录前缀', 'async', function () {
    const p = new Path('./folder/file.txt');
    this.assertEqual(p.fullPath, 'folder/file.txt');
}));

pathTestGroup.add(new Test('相对路径返回上层', 'async', function () {
    const p = new Path('../folder/file.txt');
    this.assertEqual(p.fullPath, '../folder/file.txt');
}));

pathTestGroup.add(new Test('相对路径多层返回', 'async', function () {
    const p = new Path('a/b/c/../../../file.txt');
    this.assertEqual(p.fullPath, 'file.txt');
}));

pathTestGroup.add(new Test('相对路径保留多余..', 'async', function () {
    const p = new Path('a/../../file.txt');
    this.assertEqual(p.fullPath, '../file.txt');
}));

pathTestGroup.add(new Test('相对路径含非法字符', 'async', function () {
    this.assertThrows(() => new Path('folder/file<>.txt'));
    this.assertThrows(() => new Path('folder/file|.txt'));
}));

pathTestGroup.add(new Test('相对路径含空字符抛错', 'async', function () {
    this.assertThrows(() => new Path('folder/file\0.txt'));
}));

// ============ 边界情况 ============

pathTestGroup.add(new Test('空路径抛错', 'async', function () {
    this.assertThrows(() => new Path(''));
}));

pathTestGroup.add(new Test('UNC 路径抛错', 'async', function () {
    this.assertThrows(() => new Path('\\\\server\\share\\file.txt'));
}));

pathTestGroup.add(new Test('只有文件名 (相对)', 'async', function () {
    const p = new Path('file.txt');
    this.assertEqual(p.type, 'Relative');
    this.assertEqual(p.directory, '');
    this.assertEqual(p.fullName, 'file.txt');
}));

pathTestGroup.add(new Test('多级扩展名', 'async', function () {
    const p = new Path('C:\\archive.tar.gz');
    this.assertEqual(p.baseName, 'archive.tar');
    this.assertEqual(p.extension, 'gz');
}));

pathTestGroup.add(new Test('以点开头的文件名', 'async', function () {
    const p = new Path('/home/user/.hidden');
    this.assertEqual(p.baseName, '.hidden');
    this.assertEqual(p.extension, '');
}));

pathTestGroup.add(new Test('validate=false 跳过校验', 'async', function () {
    // 即使路径含非法字符，validate=false 也应通过
    const p = new Path('C:\\test\\file<>.txt', false);
    this.assertEqual(p.fullPath, 'C:\\test\\file<>.txt');
}));


// ============ 更多边界情况 ============

pathTestGroup.add(new Test('Windows 仅驱动器盘符抛错', 'async', function () {
    // C: 被识别为 Relative 路径，冒号被视为非法字符
    this.assertThrows(() => new Path('C:'));
}));

pathTestGroup.add(new Test('Windows 仅驱动器加反斜杠', 'async', function () {
    const p = new Path('C:\\');
    this.assertEqual(p.type, 'Windows');
    this.assertEqual(p.fullPath, 'C:\\');
    this.assertEqual(p.directory, 'C:\\');
    this.assertEqual(p.fullName, '');
}));

pathTestGroup.add(new Test('Windows 仅驱动器加正斜杠', 'async', function () {
    const p = new Path('C:/');
    this.assertEqual(p.type, 'Windows');
    this.assertEqual(p.fullPath, 'C:\\');
}));

pathTestGroup.add(new Test('Windows 文件名尾部带点', 'async', function () {
    const p = new Path('C:\\test\\file.');
    // 末尾点被视为分隔符，baseName 为点前部分
    this.assertEqual(p.baseName, 'file');
    this.assertEqual(p.extension, '');
}));

pathTestGroup.add(new Test('Windows 路径含空格', 'async', function () {
    const p = new Path('C:\\Program Files\\My App\\data file.txt');
    this.assertEqual(p.directory, 'C:\\Program Files\\My App');
    this.assertEqual(p.fullName, 'data file.txt');
}));

pathTestGroup.add(new Test('Windows 路径含 Unicode 字符', 'async', function () {
    const p = new Path('C:\\用户\\文档\\文件.txt');
    this.assertEqual(p.fullName, '文件.txt');
    this.assertEqual(p.baseName, '文件');
    this.assertEqual(p.extension, 'txt');
}));

pathTestGroup.add(new Test('Windows 路径含中文空格', 'async', function () {
    const p = new Path('C:\\测试 路径\\文件名.txt');
    this.assertEqual(p.fullName, '文件名.txt');
}));

pathTestGroup.add(new Test('Unix 路径含中文', 'async', function () {
    const p = new Path('/home/用户/文件.txt');
    this.assertEqual(p.fullName, '文件.txt');
}));

pathTestGroup.add(new Test('Unix 文件名尾部带点', 'async', function () {
    const p = new Path('/home/user/file.');
    // 末尾点被视为分隔符，baseName 为点前部分
    this.assertEqual(p.baseName, 'file');
    this.assertEqual(p.extension, '');
}));

pathTestGroup.add(new Test('相对路径仅 ..', 'async', function () {
    const p = new Path('..');
    this.assertEqual(p.type, 'Relative');
    this.assertEqual(p.fullPath, '..');
}));

pathTestGroup.add(new Test('相对路径仅 .', 'async', function () {
    const p = new Path('.');
    this.assertEqual(p.fullPath, '');
}));

pathTestGroup.add(new Test('相对路径 纯点导航后为空', 'async', function () {
    const p = new Path('./.');
    this.assertEqual(p.fullPath, '');
}));

pathTestGroup.add(new Test('相对路径 多 .. 保留', 'async', function () {
    const p = new Path('../../../file.txt');
    this.assertEqual(p.fullPath, '../../../file.txt');
}));

pathTestGroup.add(new Test('相对路径 混合 . 和 ..', 'async', function () {
    const p = new Path('./a/../b/./c');
    this.assertEqual(p.fullPath, 'b/c');
}));

pathTestGroup.add(new Test('相对路径 以点开头的文件名', 'async', function () {
    const p = new Path('./.hidden');
    this.assertEqual(p.fullName, '.hidden');
    this.assertEqual(p.directory, '');
}));

pathTestGroup.add(new Test('Windows 多级扩展名 2', 'async', function () {
    const p = new Path('C:\\backup\\app.1.2.3.tar.bz2');
    this.assertEqual(p.baseName, 'app.1.2.3.tar');
    this.assertEqual(p.extension, 'bz2');
}));

pathTestGroup.add(new Test('Windows 长路径', 'async', function () {
    const longDir = 'A'.repeat(100);
    const p = new Path(`C:\\${longDir}\\file.txt`);
    this.assertEqual(p.directory, `C:\\${longDir}`);
    this.assertEqual(p.fullName, 'file.txt');
    this.assertTrue(p.fullPath.length > 110);
}));

pathTestGroup.add(new Test('Windows 变量含正则特殊字符', 'async', function () {
    // 变量名中的 . * + 等特殊字符应被正确转义
    const p = new Path('C:\\%#file.name#%\\%#data+set#%.txt');
    this.assertEqual(p.directory, 'C:\\%#file.name#%');
    this.assertEqual(p.fullName, '%#data+set#%.txt');
}));

pathTestGroup.add(new Test('Unix 仅根目录斜杠', 'async', function () {
    const p = new Path('//');
    this.assertEqual(p.fullPath, '/');
}));

pathTestGroup.add(new Test('Unix 重复根目录斜杠', 'async', function () {
    const p = new Path('///');
    this.assertEqual(p.fullPath, '/');
}));

pathTestGroup.add(new Test('Unix 含空格路径', 'async', function () {
    const p = new Path('/home/user/My Documents/file.txt');
    this.assertEqual(p.fullName, 'file.txt');
}));

pathTestGroup.add(new Test('相对路径 空段被忽略', 'async', function () {
    const p = new Path('a//b///c');
    this.assertEqual(p.fullPath, 'a/b/c');
}));

pathTestGroup.add(new Test('相对路径 以 .. 开头且包含子目录', 'async', function () {
    const p = new Path('../../a/b');
    this.assertEqual(p.fullPath, '../../a/b');
}));

// ============ AST 与变量 ============

pathTestGroup.add(new Test('AST 结构（含变量节点）', 'async', function () {
    const p = new Path('C:\\%#AUTHOR#%\\%#TITLE#%[%#ID#%].mp4');
    this.assertEqual(p.ast.type, 'Windows');
    this.assertEqual(p.ast.root, 'C:');
    this.assertEqual(p.ast.segments.length, 2);
    // 段1：纯变量
    const seg1 = p.ast.segments[0];
    this.assertEqual(seg1.kind, 'name');
    this.assertEqual(seg1.parts.length, 1);
    const part1 = seg1.parts[0];
    this.assertEqual(part1.kind, 'variable');
    if (part1.kind === 'variable') {
        this.assertEqual(part1.name, 'AUTHOR');
        this.assertEqual(part1.format, null);
    }
    // 段2：变量 + 字面混合
    const parts = p.ast.segments[1].parts;
    this.assertEqual(parts.length, 4);
    const title = parts[0];
    const bracket = parts[1];
    const id = parts[2];
    const suffix = parts[3];
    this.assertEqual(title.kind, 'variable');
    if (title.kind === 'variable') this.assertEqual(title.name, 'TITLE');
    this.assertEqual(bracket.kind, 'literal');
    if (bracket.kind === 'literal') this.assertEqual(bracket.value, '[');
    this.assertEqual(id.kind, 'variable');
    if (id.kind === 'variable') this.assertEqual(id.name, 'ID');
    this.assertEqual(suffix.kind, 'literal');
    if (suffix.kind === 'literal') this.assertEqual(suffix.value, '].mp4');
}));

pathTestGroup.add(new Test('AST 变量格式参数', 'async', function () {
    const p = new Path('C:\\%#NowTime:YYYY-MM-DD#%\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') {
        this.assertEqual(part.name, 'NowTime');
        this.assertEqual(part.format, 'YYYY-MM-DD');
    }
}));

pathTestGroup.add(new Test('AST 点导航段语义', 'async', function () {
    const p = new Path('a/./b/../c');
    // ast 为规范化前的原始语法树：a / . / b / .. / c
    this.assertEqual(p.ast.segments.length, 5);
    const seg0 = p.ast.segments[0];
    const seg2 = p.ast.segments[2];
    const seg4 = p.ast.segments[4];
    this.assertEqual(seg0.kind, 'name');
    const part0 = seg0.parts[0];
    if (part0.kind === 'literal') this.assertEqual(part0.value, 'a');
    this.assertEqual(p.ast.segments[1].kind, 'dot');
    this.assertEqual(seg2.kind, 'name');
    const part2 = seg2.parts[0];
    if (part2.kind === 'literal') this.assertEqual(part2.value, 'b');
    this.assertEqual(p.ast.segments[3].kind, 'dotdot');
    this.assertEqual(seg4.kind, 'name');
    const part4 = seg4.parts[0];
    if (part4.kind === 'literal') this.assertEqual(part4.value, 'c');
    // 规范化结果反映在 fullPath
    this.assertEqual(p.fullPath, 'a/c');
}));

pathTestGroup.add(new Test('resolve 变量替换', 'async', function () {
    const p = new Path('C:\\%#AUTHOR#%\\%#TITLE#%[%#ID#%].mp4');
    const resolved = p.resolve({ AUTHOR: 'dawn', TITLE: '测试视频', ID: 'abc123' });
    this.assertEqual(resolved, 'C:\\dawn\\测试视频[abc123].mp4');
}));

pathTestGroup.add(new Test('resolve 未提供变量保持原样', 'async', function () {
    const p = new Path('C:\\%#AUTHOR#%\\file.txt');
    this.assertEqual(p.resolve({}), 'C:\\%#AUTHOR#%\\file.txt');
}));

pathTestGroup.add(new Test('resolve 变量格式参数', 'async', function () {
    const p = new Path('C:\\%#NowTime:YYYY#%\\file.txt');
    // 无 format 方法的普通值：忽略格式参数，直接 stringify
    this.assertEqual(p.resolve({ NowTime: '2026' }), 'C:\\2026\\file.txt');
}));

pathTestGroup.add(new Test('resolve 值含 format 方法', 'async', function () {
    const p = new Path('C:\\%#QUALITY:upper#%\\file.txt');
    // 值含 format 方法且提供了格式参数 → 调用 value.format(format)
    const value = { format: (f: string) => `fmt(${f})` };
    this.assertEqual(p.resolve({ QUALITY: value }), 'C:\\fmt(upper)\\file.txt');
}));

pathTestGroup.add(new Test('resolve 嵌套占位符', 'async', function () {
    const p = new Path('%#AUTHOR#%');
    // AUTHOR 的值本身含 %#ID#% 占位符，应继续循环解析
    this.assertEqual(p.resolve({ AUTHOR: '%#ID#%', ID: 'abc' }), 'abc');
}));

// ============ 变量与占位符分隔符边缘情况 ============

pathTestGroup.add(new Test('变量：纯变量段', 'async', function () {
    const p = new Path('%#A#%');
    this.assertEqual(p.type, 'Relative');
    this.assertEqual(p.fullPath, '%#A#%');
    this.assertEqual(p.ast.segments.length, 1);
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') {
        this.assertEqual(part.name, 'A');
        this.assertEqual(part.format, null);
    }
}));

pathTestGroup.add(new Test('变量：相邻变量无字面间隔', 'async', function () {
    const p = new Path('C:\\%#A#%%#B#%');
    this.assertEqual(p.ast.segments[0].parts.length, 2);
    const a = p.ast.segments[0].parts[0];
    const b = p.ast.segments[0].parts[1];
    this.assertEqual(a.kind, 'variable');
    this.assertEqual(b.kind, 'variable');
    if (a.kind === 'variable') this.assertEqual(a.name, 'A');
    if (b.kind === 'variable') this.assertEqual(b.name, 'B');
}));

pathTestGroup.add(new Test('变量：格式参数按首个冒号切分', 'async', function () {
    // 词法层面：%#A:B:C#% 中 name=A、format=B:C（首个冒号切分，其余冒号归入格式）
    const p = new Path('C:\\%#A:B:C#%\\file.txt', false);
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') {
        this.assertEqual(part.name, 'A');
        this.assertEqual(part.format, 'B:C');
    }
    // 校验层面：格式参数含非法字符（冒号）→ 抛错
    this.assertThrows(() => new Path('C:\\%#A:B:C#%\\file.txt'));
}));

pathTestGroup.add(new Test('变量：空格式参数', 'async', function () {
    const p = new Path('C:\\%#A:#%\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') {
        this.assertEqual(part.name, 'A');
        this.assertEqual(part.format, '');
    }
    // 渲染保持原样
    this.assertEqual(p.fullPath, 'C:\\%#A:#%\\file.txt');
}));

pathTestGroup.add(new Test('变量：空变量名合法', 'async', function () {
    // %##% 变量名为空，作为不透明节点不抛错
    const p = new Path('C:\\%##%\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\%##%\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') this.assertEqual(part.name, '');
}));

pathTestGroup.add(new Test('变量：未闭合占位符视为字面文本', 'async', function () {
    // 只有前缀 %#、无后缀 #% → 整段作为字面量
    const p = new Path('C:\\100%#done\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\100%#done\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'literal');
    if (part.kind === 'literal') this.assertEqual(part.value, '100%#done');
}));

pathTestGroup.add(new Test('变量：只有后缀 #% 视为字面文本', 'async', function () {
    const p = new Path('C:\\done#%\\file.txt');
    this.assertEqual(p.fullPath, 'C:\\done#%\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'literal');
    if (part.kind === 'literal') this.assertEqual(part.value, 'done#%');
}));

pathTestGroup.add(new Test('变量：名称可含单个 #（分隔符成对匹配）', 'async', function () {
    const p = new Path('C:\\%#a#b#%\\file.txt');
    const part = p.ast.segments[0].parts[0];
    this.assertEqual(part.kind, 'variable');
    if (part.kind === 'variable') this.assertEqual(part.name, 'a#b');
}));

pathTestGroup.add(new Test('变量：不能跨路径分隔符', 'async', function () {
    // %#A\B#% 中的 \ 是路径分隔符，变量被切断为两个字面段
    const p = new Path('C:\\%#A\\B#%\\file.txt');
    this.assertEqual(p.ast.segments.length, 3);
    const s0 = p.ast.segments[0].parts[0];
    const s1 = p.ast.segments[1].parts[0];
    this.assertEqual(s0.kind, 'literal');
    this.assertEqual(s1.kind, 'literal');
    if (s0.kind === 'literal') this.assertEqual(s0.value, '%#A');
    if (s1.kind === 'literal') this.assertEqual(s1.value, 'B#%');
}));

pathTestGroup.add(new Test('变量：各路径类型均支持', 'async', function () {
    const win = new Path('C:\\%#A#%\\x');
    this.assertEqual(win.type, 'Windows');
    this.assertEqual(win.fullPath, 'C:\\%#A#%\\x');
    const unix = new Path('/%#A#%/x');
    this.assertEqual(unix.type, 'Unix');
    this.assertEqual(unix.fullPath, '/%#A#%/x');
    const rel = new Path('%#A#%/x');
    this.assertEqual(rel.type, 'Relative');
    this.assertEqual(rel.fullPath, '%#A#%/x');
}));

pathTestGroup.add(new Test('resolve：变量值为空字符串不折叠分隔符', 'async', function () {
    // 变量段解析为空后保留两侧分隔符，产生空段（C:\ + \file.txt）
    const p = new Path('C:\\%#A#%\\file.txt');
    this.assertEqual(p.resolve({ A: '' }), 'C:\\\\file.txt');
}));

pathTestGroup.add(new Test('resolve：字面 % 与 # 不受影响', 'async', function () {
    // 未闭合的占位符不是变量，不会被替换
    const p = new Path('C:\\100%#done\\#tag.txt');
    this.assertEqual(p.fullPath, 'C:\\100%#done\\#tag.txt');
    this.assertEqual(p.resolve({ done: 'x' }), 'C:\\100%#done\\#tag.txt');
}));

export default pathTestGroup;
