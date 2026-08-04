import '../setup.ts';
import '../../src/core/env.ts';
import { Test, TestGroup } from '../framework.ts';

const arrayTestGroup = new TestGroup('Array 原型方法', 'Array.prototype 工具方法测试');

// ============ any ============

arrayTestGroup.add(new Test('any 空数组', 'async', function () {
    this.assertFalse([].any());
}));

arrayTestGroup.add(new Test('any 全空值', 'async', function () {
    this.assertFalse([null, undefined].any());
}));

arrayTestGroup.add(new Test('any 有非空值', 'async', function () {
    this.assertTrue([null, 'hello', undefined].any());
    this.assertTrue([0].any());
    this.assertTrue([false].any());
    this.assertTrue([''].any());
}));

// ============ unique ============

arrayTestGroup.add(new Test('unique 基本去重', 'async', function () {
    const result = [1, 2, 2, 3, 1, 4].unique();
    this.assertEqual(result.length, 4);
    this.assertTrue(result.includes(1));
    this.assertTrue(result.includes(2));
    this.assertTrue(result.includes(3));
    this.assertTrue(result.includes(4));
}));

arrayTestGroup.add(new Test('unique 字符串去重', 'async', function () {
    const result = ['a', 'b', 'a', 'c', 'b'].unique();
    this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b', 'c']));
}));

arrayTestGroup.add(new Test('unique 属性去重', 'async', function () {
    const arr = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 1, name: 'Alice2' },
    ];
    const result = arr.unique('id');
    this.assertEqual(result.length, 2);
    this.assertEqual(result[0].id, 1);
    this.assertEqual(result[1].id, 2);
}));

// ============ union ============

arrayTestGroup.add(new Test('union 基本并集', 'async', function () {
    const result = [1, 2, 3].union([3, 4, 5]);
    this.assertEqual(result.length, 5);
    this.assertTrue(result.includes(1));
    this.assertTrue(result.includes(2));
    this.assertTrue(result.includes(3));
    this.assertTrue(result.includes(4));
    this.assertTrue(result.includes(5));
}));

arrayTestGroup.add(new Test('union 属性并集', 'async', function () {
    const a = [{ id: 1 }, { id: 2 }];
    const b = [{ id: 2 }, { id: 3 }];
    const result = a.union(b, 'id');
    this.assertEqual(result.length, 3);
}));

arrayTestGroup.add(new Test('union 空数组', 'async', function () {
    const result = [1, 2].union([]);
    this.assertEqual(JSON.stringify(result), JSON.stringify([1, 2]));
}));

// ============ intersect ============

arrayTestGroup.add(new Test('intersect 基本交集', 'async', function () {
    const result = [1, 2, 3].intersect([2, 3, 4]);
    this.assertEqual(result.length, 2);
    this.assertTrue(result.includes(2));
    this.assertTrue(result.includes(3));
}));

arrayTestGroup.add(new Test('intersect 无交集', 'async', function () {
    const result = [1, 2].intersect([3, 4]);
    this.assertEqual(result.length, 0);
}));

arrayTestGroup.add(new Test('intersect 属性交集', 'async', function () {
    const a = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    const b = [{ id: 2, name: 'B2' }, { id: 3, name: 'C' }];
    const result = a.intersect(b, 'id');
    this.assertEqual(result.length, 1);
    this.assertEqual(result[0].id, 2);
}));

// ============ difference ============

arrayTestGroup.add(new Test('difference 基本差集', 'async', function () {
    const result = [1, 2, 3, 4].difference([2, 4]);
    this.assertEqual(result.length, 2);
    this.assertTrue(result.includes(1));
    this.assertTrue(result.includes(3));
}));

arrayTestGroup.add(new Test('difference 无差异', 'async', function () {
    const result = [1, 2].difference([1, 2]);
    this.assertEqual(result.length, 0);
}));

// ============ complement ============

arrayTestGroup.add(new Test('complement 基本补集', 'async', function () {
    const result = [1, 2, 3].complement([2, 3, 4]);
    this.assertEqual(result.length, 2);
    this.assertTrue(result.includes(1));
    this.assertTrue(result.includes(4));
}));

arrayTestGroup.add(new Test('complement 相同数组', 'async', function () {
    const result = [1, 2].complement([1, 2]);
    this.assertEqual(result.length, 0);
}));

arrayTestGroup.add(new Test('complement 属性补集', 'async', function () {
    const a = [{ id: 1 }, { id: 2 }];
    const b = [{ id: 2 }, { id: 3 }];
    const result = a.complement(b, 'id');
    this.assertEqual(result.length, 2); // {id:1} 和 {id:3}
}));

// ============ 更多边界 ============

arrayTestGroup.add(new Test('unique NaN 值', 'async', function () {
    const result = [NaN, NaN, 1, 2, 1].unique();
    // Set 认为 NaN === NaN，所以只保留一个 NaN
    this.assertEqual(result.length, 3); // NaN, 1, 2
}));

arrayTestGroup.add(new Test('unique 属性含 NaN', 'async', function () {
    const arr = [{ id: NaN }, { id: NaN }, { id: 1 }];
    const result = arr.unique('id');
    // 属性去重对 NaN 做了 Symbol 处理
    this.assertEqual(result.length, 2);
}));

arrayTestGroup.add(new Test('unique 混合类型', 'async', function () {
    const result = [1, '1', 1, '1', true, 'true'].unique();
    this.assertEqual(result.length, 4); // 1, '1', true, 'true'
    this.assertEqual(result[0], 1);
    this.assertEqual(result[1], '1');
}));

arrayTestGroup.add(new Test('union 两个空数组', 'async', function () {
    const result = [].union([]);
    this.assertEqual(result.length, 0);
}));

arrayTestGroup.add(new Test('intersect 一个空数组', 'async', function () {
    const result = [1, 2].intersect([]);
    this.assertEqual(result.length, 0);
    const result2 = ([] as number[]).intersect([1, 2]);
    this.assertEqual(result2.length, 0);
}));

arrayTestGroup.add(new Test('difference 全部相同', 'async', function () {
    const result = [1, 2, 3].difference([1, 2, 3]);
    this.assertEqual(result.length, 0);
}));

arrayTestGroup.add(new Test('complement 完全不同的数组', 'async', function () {
    const result = [1, 2].complement([3, 4]);
    this.assertEqual(result.length, 4);
    this.assertEqual(JSON.stringify(result.sort()), JSON.stringify([1, 2, 3, 4]));
}));

export default arrayTestGroup;
