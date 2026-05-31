import '../setup.ts';
import '../../src/env.ts';
import { Test, TestGroup } from '../framework.ts';
import dayjs from 'dayjs';

// 实现与 src/extension.ts 保持一致，均使用 dayjs
Date.prototype.format = function (format?: string) {
    return dayjs(this).format(format)
}
Date.prototype.add = function ({ years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0, ms = 0 } = {}) {
    return dayjs(this)
        .add(years, 'year').add(months, 'month').add(days, 'day')
        .add(hours, 'hour').add(minutes, 'minute').add(seconds, 'second')
        .add(ms, 'millisecond')
        .toDate();
};
Date.prototype.sub = function ({ years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0, ms = 0 } = {}) {
    return dayjs(this)
        .subtract(years, 'year').subtract(months, 'month').subtract(days, 'day')
        .subtract(hours, 'hour').subtract(minutes, 'minute').subtract(seconds, 'second')
        .subtract(ms, 'millisecond')
        .toDate();
};

const dateTestGroup = new TestGroup('Date 原型方法', 'Date.prototype 工具方法测试');

// ============ add ============

dateTestGroup.add(new Test('add 增加天数', 'async', function () {
    const d = new Date('2023-01-01T00:00:00');
    const result = d.add({ days: 5 });
    this.assertEqual(result.getDate(), 6);
    // 原日期不应改变
    this.assertEqual(d.getDate(), 1);
}));

dateTestGroup.add(new Test('add 增加月份', 'async', function () {
    const d = new Date('2023-01-15T00:00:00');
    const result = d.add({ months: 2 });
    this.assertEqual(result.getMonth(), 2); // 3月
    this.assertEqual(result.getDate(), 15);
}));

dateTestGroup.add(new Test('add 增加年份', 'async', function () {
    const d = new Date('2023-01-01T00:00:00');
    const result = d.add({ years: 1 });
    this.assertEqual(result.getFullYear(), 2024);
}));

dateTestGroup.add(new Test('add 增加小时', 'async', function () {
    const d = new Date('2023-01-01T10:00:00');
    const result = d.add({ hours: 3 });
    this.assertEqual(result.getHours(), 13);
}));

dateTestGroup.add(new Test('add 增加分钟', 'async', function () {
    const d = new Date('2023-01-01T10:30:00');
    const result = d.add({ minutes: 45 });
    this.assertEqual(result.getMinutes(), 15);
    this.assertEqual(result.getHours(), 11);
}));

dateTestGroup.add(new Test('add 复合增加（月末钳位）', 'async', function () {
    const d = new Date('2023-01-31T00:00:00');
    const result = d.add({ months: 1, days: 1 });
    // dayjs: Jan 31 + 1 month = Feb 28（钳位到月末），+ 1 day = Mar 1
    this.assertEqual(result.getMonth(), 2); // 3月 (0-indexed)
    this.assertEqual(result.getDate(), 1);
}));

dateTestGroup.add(new Test('add 无参数不变', 'async', function () {
    const d = new Date('2023-06-15T12:30:45');
    const result = d.add({});
    this.assertEqual(result.getTime(), d.getTime());
}));

// ============ sub ============

dateTestGroup.add(new Test('sub 减少天数', 'async', function () {
    const d = new Date('2023-01-10T00:00:00');
    const result = d.sub({ days: 5 });
    this.assertEqual(result.getDate(), 5);
}));

dateTestGroup.add(new Test('sub 减少月份', 'async', function () {
    const d = new Date('2023-03-15T00:00:00');
    const result = d.sub({ months: 2 });
    this.assertEqual(result.getMonth(), 0); // 1月
}));

dateTestGroup.add(new Test('sub 减少年份', 'async', function () {
    const d = new Date('2023-01-01T00:00:00');
    const result = d.sub({ years: 1 });
    this.assertEqual(result.getFullYear(), 2022);
}));

dateTestGroup.add(new Test('sub 减少导致月份回退', 'async', function () {
    const d = new Date('2023-03-01T00:00:00');
    const result = d.sub({ days: 1 });
    this.assertEqual(result.getMonth(), 1); // 2月
    this.assertEqual(result.getDate(), 28);
}));

dateTestGroup.add(new Test('sub 复合减少（顺序执行）', 'async', function () {
    const d = new Date('2023-03-01T00:00:00');
    const result = d.sub({ months: 1, days: 1 });
    // setMonth(1) => Feb 1; setDate(0) => Jan 31
    this.assertEqual(result.getMonth(), 0); // 1月 (0-indexed)
    this.assertEqual(result.getDate(), 31);
}));

dateTestGroup.add(new Test('sub 无参数不变', 'async', function () {
    const d = new Date('2023-06-15T12:30:45');
    const result = d.sub({});
    this.assertEqual(result.getTime(), d.getTime());
}));
// ============ format ============

dateTestGroup.add(new Test('format 默认格式', 'async', function () {
    const d = new Date('2023-01-01T12:34:56');
    const result = d.format('YYYY-MM-DD');
    this.assertEqual(result, '2023-01-01');
}));

dateTestGroup.add(new Test('format 带时间的格式', 'async', function () {
    const d = new Date('2023-01-01T12:34:56');
    const result = d.format('YYYY-MM-DD HH:mm:ss');
    this.assertEqual(result, '2023-01-01 12:34:56');
}));

dateTestGroup.add(new Test('format 无参数返回 ISO 字符串', 'async', function () {
    const d = new Date('2023-01-01T00:00:00');
    const result = d.format();
    // dayjs format() 无参数返回带时区偏移的 ISO 字符串
    this.assertTrue(result.includes('2023-01-01T00:00:00'));
}));

dateTestGroup.add(new Test('format 中文格式', 'async', function () {
    const d = new Date('2023-01-01T12:34:56');
    const result = d.format('YYYY年MM月DD日');
    this.assertEqual(result, '2023年01月01日');
}));

// ============ 更多 Date 边界 ============

dateTestGroup.add(new Test('add 只传一个参数', 'async', function () {
    const d = new Date('2023-01-01T00:00:00');
    const result = d.add({ months: 1 });
    this.assertEqual(result.getMonth(), 1);
    this.assertEqual(result.getDate(), 1);
}));

dateTestGroup.add(new Test('add 参数含 undefined', 'async', function () {
    const d = new Date('2023-06-15T00:00:00');
    const result = d.add({ years: undefined as any, days: 5, months: undefined as any });
    this.assertEqual(result.getDate(), 20);
    this.assertEqual(result.getMonth(), 5); // 月份不应变化
}));

dateTestGroup.add(new Test('add 闰年 2月29日', 'async', function () {
    const d = new Date('2024-02-29T00:00:00');
    const result = d.add({ years: 1 });
    // dayjs 钳位到月末: 2025年非闰年 → 2月28日
    this.assertEqual(result.getFullYear(), 2025);
    this.assertEqual(result.getMonth(), 1); // 2月
    this.assertEqual(result.getDate(), 28);
}));

dateTestGroup.add(new Test('sub 闰年 2月29日', 'async', function () {
    const d = new Date('2024-02-29T00:00:00');
    const result = d.sub({ years: 1 });
    // dayjs 钳位到月末: 2023年非闰年 → 2月28日
    this.assertEqual(result.getFullYear(), 2023);
    this.assertEqual(result.getMonth(), 1); // 2月
    this.assertEqual(result.getDate(), 28);
}));

dateTestGroup.add(new Test('add 跨年', 'async', function () {
    const d = new Date('2023-12-15T00:00:00');
    const result = d.add({ months: 1 });
    this.assertEqual(result.getFullYear(), 2024);
    this.assertEqual(result.getMonth(), 0); // 1月
}));

dateTestGroup.add(new Test('sub 跨年', 'async', function () {
    const d = new Date('2023-01-15T00:00:00');
    const result = d.sub({ months: 1 });
    this.assertEqual(result.getFullYear(), 2022);
    this.assertEqual(result.getMonth(), 11); // 12月
}));

dateTestGroup.add(new Test('add sub 互逆运算', 'async', function () {
    const d = new Date('2023-06-15T12:30:00');
    const added = d.add({ days: 7, hours: 3 });
    const back = added.sub({ days: 7, hours: 3 });
    this.assertEqual(back.getTime(), d.getTime());
}));

dateTestGroup.add(new Test('format 小时分钟秒', 'async', function () {
    const d = new Date('2023-01-01T09:05:07');
    this.assertEqual(d.format('HH:mm:ss'), '09:05:07');
}));

dateTestGroup.add(new Test('format 十二小时制', 'async', function () {
    const d = new Date('2023-01-01T15:30:00');
    this.assertEqual(d.format('hh:mm A'), '03:30 PM');
}));

export default dateTestGroup;
