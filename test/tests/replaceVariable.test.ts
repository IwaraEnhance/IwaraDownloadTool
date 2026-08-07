import { Test, TestGroup } from '../framework.ts';
import '../../src/core/env.ts';
import dayjs from "dayjs";

Date.prototype.format = function (format) {
    return dayjs(this).format(format)
}

const testGroup = new TestGroup('String.replaceVariable边界情况测试');
let date: Date;

testGroup.beforeEach(() => {
    date = new Date('2023-01-01T12:34:56');
});

// 简单变量替换测试
testGroup.add(new Test('简单变量替换', 'async', function () {
    const template = 'Hello %#name#%, welcome to %#city#%';
    const result = template.replaceVariable({ name: 'John', city: 'New York' });
    this.assertEqual(result, 'Hello John, welcome to New York');
}));

// 日期格式化测试
testGroup.add(new Test('日期格式化', 'async', function () {
    const template = 'Today is %#date:YYYY-MM-DD#%';
    const result = template.replaceVariable({ date });
    this.assertEqual(result, 'Today is 2023-01-01');
}));

// 特殊字符格式化测试
testGroup.add(new Test('日期格式化模板中包含后缀', 'async', function () {
    const template = 'Today is %#date:YYYY-MM-DD#%HH.mm.ss#%';
    const result = template.replaceVariable({ date });
    this.assertEqual(result, 'Today is 2023-01-01HH.mm.ss#%');
}));


// 特殊字符格式化测试
testGroup.add(new Test('特殊字符格式化', 'async', function () {
    const template = 'Today is %#date:YYYY-MM-DD+HH.mm.ss .*+?^${}()|[]#%';
    const result = template.replaceVariable({ date });
    this.assertEqual(result, 'Today is 2023-01-01+12.34.56 .*+?^${}()|[]');
}));

testGroup.add(new Test('路径格式化', 'async', function () {
    const template = '/iwara/%#AUTHOR#%/%#date:YYYY-MM-DD+HH.mm.ss#%_%#ID#%.mp4';
    const result = template.replaceVariable({ date, AUTHOR: 'Test', ID: 'Test123', });
    this.assertEqual(result, '/iwara/Test/2023-01-01+12.34.56_Test123.mp4');
}));


// 递归替换测试
testGroup.add(new Test('递归替换', 'async', function () {
    const template = 'First: %#first#%, Second: %#second#%, Last: %#last#%';
    const result = template.replaceVariable({
        first: '1st',
        second: 'first is %#first#%',
        last: 'second is %#second#%'
    });
    this.assertEqual(result, 'First: 1st, Second: first is 1st, Last: second is first is 1st');
}));

// 日期默认格式化测试
testGroup.add(new Test('日期默认格式化', 'async', function () {
    const template = 'Today is %#date#%';
    const result = template.replaceVariable({ date });
    this.assertEqual(result, 'Today is 2023-01-01');
}));

// 短键优先级测试
testGroup.add(new Test('短键优先级', 'async', function () {
    const template = `User: %#user#%, UserName: %#userName#%\n` +
        `UserName: %#userName#%, User: %#user#%\n` +
        `User: %#user#%, UserName: %#userName#%`;
    const result = template.replaceVariable({ user: 'short', userName: 'longname' });
    const expected = `User: short, UserName: longname\n` +
        `UserName: longname, User: short\n` +
        `User: short, UserName: longname`;
    this.assertEqual(result, expected);
}));

// 循环引用检测测试
testGroup.add(new Test('循环引用检测', 'async', function () {
    const template = 'Circular: %#a#%';
    const result = template.replaceVariable({ a: '%#c#%', b: '%#a#%', c: '%#b#%' });
    // 循环被检测并安全终止（无死循环、无无限展开），保留部分替换结果与未展开的占位符
    // （日志已统一走 originalConsole 绑定引用，不再通过 patch 裸 console.warn 验证）
    this.assertTrue(result.includes('Circular:'), '应包含部分替换结果');
    this.assertTrue(result.includes('%#'), '循环处应保留未展开的占位符（检测到循环并终止）');
}));

export default testGroup;
