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

export default pathTestGroup;
