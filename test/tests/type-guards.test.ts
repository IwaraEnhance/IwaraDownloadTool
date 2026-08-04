import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import {
    isNull, isUndefined, isNullOrUndefined,
    isObject, isString, isNumber, isArray,
    isNotEmpty, hasFunction,
    isConvertibleToNumber,
} from '../../src/core/env.ts';

const guardTestGroup = new TestGroup('类型守卫函数', '类型判断工具函数测试');

// ============ isNull / isUndefined / isNullOrUndefined ============

guardTestGroup.add(new Test('isNull 识别 null', 'async', function () {
    this.assertTrue(isNull(null));
    this.assertFalse(isNull(undefined));
    this.assertFalse(isNull(0));
    this.assertFalse(isNull(''));
}));

guardTestGroup.add(new Test('isUndefined 识别 undefined', 'async', function () {
    this.assertTrue(isUndefined(undefined));
    this.assertFalse(isUndefined(null));
    this.assertFalse(isUndefined(0));
}));

guardTestGroup.add(new Test('isNullOrUndefined 识别 null 和 undefined', 'async', function () {
    this.assertTrue(isNullOrUndefined(null));
    this.assertTrue(isNullOrUndefined(undefined));
    this.assertFalse(isNullOrUndefined(0));
    this.assertFalse(isNullOrUndefined(''));
    this.assertFalse(isNullOrUndefined(false));
}));

// ============ isObject ============

guardTestGroup.add(new Test('isObject 识别对象', 'async', function () {
    this.assertTrue(isObject({}));
    this.assertTrue(isObject({ a: 1 }));
    this.assertFalse(isObject(null));
    this.assertFalse(isObject(undefined));
    this.assertFalse(isObject([]));
    this.assertFalse(isObject('string'));
    this.assertFalse(isObject(42));
}));

// ============ isString ============

guardTestGroup.add(new Test('isString 识别字符串', 'async', function () {
    this.assertTrue(isString(''));
    this.assertTrue(isString('hello'));
    this.assertFalse(isString(null));
    this.assertFalse(isString(undefined));
    this.assertFalse(isString(42));
    this.assertFalse(isString({}));
}));

// ============ isNumber ============

guardTestGroup.add(new Test('isNumber 识别数字', 'async', function () {
    this.assertTrue(isNumber(0));
    this.assertTrue(isNumber(42));
    this.assertTrue(isNumber(NaN));
    this.assertTrue(isNumber(Infinity));
    this.assertFalse(isNumber(null));
    this.assertFalse(isNumber('42'));
}));

// ============ isArray ============

guardTestGroup.add(new Test('isArray 识别数组', 'async', function () {
    this.assertTrue(isArray([]));
    this.assertTrue(isArray([1, 2, 3]));
    this.assertFalse(isArray({}));
    this.assertFalse(isArray(null));
    this.assertFalse(isArray('[]'));
}));

// ============ isNotEmpty ============

guardTestGroup.add(new Test('isNotEmpty 空值判断', 'async', function () {
    this.assertFalse(isNotEmpty(null));
    this.assertFalse(isNotEmpty(undefined));
    this.assertFalse(isNotEmpty(''));
    this.assertFalse(isNotEmpty([]));
    this.assertFalse(isNotEmpty([null, undefined]));
    this.assertTrue(isNotEmpty('hello'));
    this.assertTrue(isNotEmpty(42));
    this.assertTrue(isNotEmpty(0));
    this.assertTrue(isNotEmpty(false));
    this.assertTrue(isNotEmpty([1, 2]));
    this.assertTrue(isNotEmpty({ a: 1 }));
}));

guardTestGroup.add(new Test('isNotEmpty 嵌套数组', 'async', function () {
    this.assertFalse(isNotEmpty([null, undefined, []]));
    this.assertTrue(isNotEmpty([null, 'hello']));
}));

guardTestGroup.add(new Test('isNotEmpty 对象属性判断', 'async', function () {
    this.assertFalse(isNotEmpty({ a: null, b: undefined }));
    this.assertTrue(isNotEmpty({ a: 1 }));
}));

// ============ hasFunction ============

guardTestGroup.add(new Test('hasFunction 检查对象方法', 'async', function () {
    this.assertTrue(hasFunction({ format: () => '' }, 'format'));
    this.assertFalse(hasFunction({ name: 'test' }, 'format'));
    this.assertFalse(hasFunction(null, 'toString'));
    this.assertFalse(hasFunction(undefined, 'toString'));
    this.assertFalse(hasFunction(42, 'toString'));
}));

// ============ isConvertibleToNumber ============

guardTestGroup.add(new Test('isConvertibleToNumber 可转换数字', 'async', function () {
    this.assertTrue(isConvertibleToNumber(42));
    this.assertTrue(isConvertibleToNumber(0));
    this.assertTrue(isConvertibleToNumber(-3.14));
    this.assertFalse(isConvertibleToNumber(NaN));
    this.assertFalse(isConvertibleToNumber(null));
    this.assertFalse(isConvertibleToNumber(undefined));
    this.assertFalse(isConvertibleToNumber('abc'));
}));

guardTestGroup.add(new Test('isConvertibleToNumber Infinity 参数', 'async', function () {
    this.assertFalse(isConvertibleToNumber(Infinity));
    this.assertTrue(isConvertibleToNumber(Infinity, true));
    this.assertFalse(isConvertibleToNumber(-Infinity));
    this.assertTrue(isConvertibleToNumber(-Infinity, true));
}));

export default guardTestGroup;
