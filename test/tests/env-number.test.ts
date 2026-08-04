import '../setup.ts';
import '../../src/core/env.ts';
import { Test, TestGroup } from '../framework.ts';

const numberTestGroup = new TestGroup('Number 静态方法', 'Number 构造函数上的工具方法测试');

// ============ isPositiveInteger ============

numberTestGroup.add(new Test('isPositiveInteger 正整', 'async', function () {
    this.assertTrue(Number.isPositiveInteger(1));
    this.assertTrue(Number.isPositiveInteger(42));
    this.assertTrue(Number.isPositiveInteger(999));
}));

numberTestGroup.add(new Test('isPositiveInteger 非正整', 'async', function () {
    this.assertFalse(Number.isPositiveInteger(0));
    this.assertFalse(Number.isPositiveInteger(-1));
    this.assertFalse(Number.isPositiveInteger(1.5));
    this.assertFalse(Number.isPositiveInteger(NaN));
    this.assertFalse(Number.isPositiveInteger(Infinity));
    this.assertFalse(Number.isPositiveInteger('1' as any));
    this.assertFalse(Number.isPositiveInteger(null));
}));

// ============ isNegativeInteger ============

numberTestGroup.add(new Test('isNegativeInteger 负整', 'async', function () {
    this.assertTrue(Number.isNegativeInteger(-1));
    this.assertTrue(Number.isNegativeInteger(-42));
}));

numberTestGroup.add(new Test('isNegativeInteger 非负整', 'async', function () {
    this.assertFalse(Number.isNegativeInteger(0));
    this.assertFalse(Number.isNegativeInteger(1));
    this.assertFalse(Number.isNegativeInteger(-1.5));
    this.assertFalse(Number.isNegativeInteger(NaN));
    this.assertFalse(Number.isNegativeInteger('-1' as any));
}));

// ============ isPositiveFloat ============

numberTestGroup.add(new Test('isPositiveFloat 正浮点', 'async', function () {
    this.assertTrue(Number.isPositiveFloat(1.5));
    this.assertTrue(Number.isPositiveFloat(0.1));
    this.assertTrue(Number.isPositiveFloat(3.14));
}));

numberTestGroup.add(new Test('isPositiveFloat 非正浮点', 'async', function () {
    this.assertFalse(Number.isPositiveFloat(1));
    this.assertFalse(Number.isPositiveFloat(0));
    this.assertFalse(Number.isPositiveFloat(-0.5));
    this.assertFalse(Number.isPositiveFloat(NaN));
}));

// ============ isNegativeFloat ============

numberTestGroup.add(new Test('isNegativeFloat 负浮点', 'async', function () {
    this.assertTrue(Number.isNegativeFloat(-1.5));
    this.assertTrue(Number.isNegativeFloat(-0.1));
}));

numberTestGroup.add(new Test('isNegativeFloat 非负浮点', 'async', function () {
    this.assertFalse(Number.isNegativeFloat(-1));
    this.assertFalse(Number.isNegativeFloat(0));
    this.assertFalse(Number.isNegativeFloat(1.5));
    this.assertFalse(Number.isNegativeFloat(NaN));
}));

// ============ isConvertibleNumber ============

numberTestGroup.add(new Test('isConvertibleNumber 数字', 'async', function () {
    this.assertTrue(Number.isConvertibleNumber(42));
    this.assertTrue(Number.isConvertibleNumber(0));
    this.assertTrue(Number.isConvertibleNumber(-3.14));
    this.assertTrue(Number.isConvertibleNumber('42'));
    this.assertTrue(Number.isConvertibleNumber('3.14'));
    this.assertTrue(Number.isConvertibleNumber('-0.5'));
}));

numberTestGroup.add(new Test('isConvertibleNumber 非数字', 'async', function () {
    this.assertFalse(Number.isConvertibleNumber(NaN));
    this.assertFalse(Number.isConvertibleNumber(null));
    this.assertFalse(Number.isConvertibleNumber(undefined));
    this.assertFalse(Number.isConvertibleNumber('abc'));
    this.assertFalse(Number.isConvertibleNumber(''));
    this.assertFalse(Number.isConvertibleNumber({}));
}));

numberTestGroup.add(new Test('isConvertibleNumber Infinity 参数', 'async', function () {
    this.assertFalse(Number.isConvertibleNumber(Infinity));
    this.assertTrue(Number.isConvertibleNumber(Infinity, true));
    this.assertFalse(Number.isConvertibleNumber(-Infinity));
    this.assertTrue(Number.isConvertibleNumber(-Infinity, true));
}));

// ============ toPositiveInteger ============

numberTestGroup.add(new Test('toPositiveInteger 合法', 'async', function () {
    this.assertEqual(Number.toPositiveInteger(5), 5);
    this.assertEqual(Number.toPositiveInteger(1), 1);
}));

numberTestGroup.add(new Test('toPositiveInteger 非法抛错', 'async', function () {
    this.assertThrows(() => Number.toPositiveInteger(0));
    this.assertThrows(() => Number.toPositiveInteger(-1));
    this.assertThrows(() => Number.toPositiveInteger(1.5));
}));

// ============ toNegativeInteger ============

numberTestGroup.add(new Test('toNegativeInteger 合法', 'async', function () {
    this.assertEqual(Number.toNegativeInteger(-5), -5);
    this.assertEqual(Number.toNegativeInteger(-1), -1);
}));

numberTestGroup.add(new Test('toNegativeInteger 非法抛错', 'async', function () {
    this.assertThrows(() => Number.toNegativeInteger(0));
    this.assertThrows(() => Number.toNegativeInteger(1));
    this.assertThrows(() => Number.toNegativeInteger(-1.5));
}));

// ============ toPositiveFloat ============

numberTestGroup.add(new Test('toPositiveFloat 合法', 'async', function () {
    this.assertEqual(Number.toPositiveFloat(1.5), 1.5);
    this.assertEqual(Number.toPositiveFloat(0.1), 0.1);
}));

numberTestGroup.add(new Test('toPositiveFloat 非法抛错', 'async', function () {
    this.assertThrows(() => Number.toPositiveFloat(1));
    this.assertThrows(() => Number.toPositiveFloat(0));
    this.assertThrows(() => Number.toPositiveFloat(-0.5));
}));

// ============ toNegativeFloat ============

numberTestGroup.add(new Test('toNegativeFloat 合法', 'async', function () {
    this.assertEqual(Number.toNegativeFloat(-1.5), -1.5);
    this.assertEqual(Number.toNegativeFloat(-0.1), -0.1);
}));

numberTestGroup.add(new Test('toNegativeFloat 非法抛错', 'async', function () {
    this.assertThrows(() => Number.toNegativeFloat(-1));
    this.assertThrows(() => Number.toNegativeFloat(0));
    this.assertThrows(() => Number.toNegativeFloat(1.5));
}));

// ============ 更多边界 ============

numberTestGroup.add(new Test('isConvertibleNumber 字符串边界', 'async', function () {
    this.assertTrue(Number.isConvertibleNumber('0'));
    this.assertTrue(Number.isConvertibleNumber('-0'));
    this.assertTrue(Number.isConvertibleNumber('.5'));
    // JavaScript 的 Number() 支持 0x 和 0b 前缀
    this.assertTrue(Number.isConvertibleNumber('0x1F'));
    this.assertTrue(Number.isConvertibleNumber('0b101'));
}));

numberTestGroup.add(new Test('isConvertibleNumber Infinity 字符串', 'async', function () {
    this.assertFalse(Number.isConvertibleNumber('Infinity'));
    this.assertTrue(Number.isConvertibleNumber('Infinity', true));
}));

numberTestGroup.add(new Test('isPositiveInteger 边界', 'async', function () {
    // MAX_SAFE_INTEGER+1 仍为整数且 >0
    this.assertTrue(Number.isPositiveInteger(Number.MAX_SAFE_INTEGER + 1));
    this.assertFalse(Number.isPositiveInteger(Infinity));
}));

numberTestGroup.add(new Test('isNegativeInteger 边界', 'async', function () {
    this.assertFalse(Number.isNegativeInteger(-Infinity));
}));

export default numberTestGroup;
