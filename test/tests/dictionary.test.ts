import '../setup.ts'
import { Test, TestGroup } from '../framework.ts'
import { Dictionary } from '../../src/core/dictionary.ts'

const dictTestGroup = new TestGroup('Dictionary 类', '扩展 Map 的工具方法测试')

dictTestGroup.add(
    new Test('空字典转换', 'async', function () {
        const d = new Dictionary<string>()
        this.assertEqual(d.toArray().length, 0)
        this.assertEqual(d.keysArray().length, 0)
        this.assertEqual(d.valuesArray().length, 0)
    })
)

dictTestGroup.add(
    new Test('带初始数据的字典', 'async', function () {
        const d = new Dictionary<string>([
            ['key1', 'value1'],
            ['key2', 'value2']
        ])
        this.assertEqual(d.size, 2)
        this.assertEqual(d.get('key1'), 'value1')
        this.assertEqual(d.get('key2'), 'value2')
    })
)

dictTestGroup.add(
    new Test('toArray 方法', 'async', function () {
        const d = new Dictionary<number>([
            ['a', 1],
            ['b', 2]
        ])
        const arr = d.toArray()
        this.assertEqual(arr.length, 2)
        this.assertEqual(arr[0][0], 'a')
        this.assertEqual(arr[0][1], 1)
        this.assertEqual(arr[1][0], 'b')
        this.assertEqual(arr[1][1], 2)
    })
)

dictTestGroup.add(
    new Test('keysArray 方法', 'async', function () {
        const d = new Dictionary<string>([
            ['x', '10'],
            ['y', '20']
        ])
        const keys = d.keysArray()
        this.assertEqual(keys.length, 2)
        this.assertTrue(keys.includes('x'))
        this.assertTrue(keys.includes('y'))
    })
)

dictTestGroup.add(
    new Test('valuesArray 方法', 'async', function () {
        const d = new Dictionary<string>([
            ['a', 'foo'],
            ['b', 'bar']
        ])
        const values = d.valuesArray()
        this.assertEqual(values.length, 2)
        this.assertTrue(values.includes('foo'))
        this.assertTrue(values.includes('bar'))
    })
)

dictTestGroup.add(
    new Test('继承 Map 方法', 'async', function () {
        const d = new Dictionary<number>()
        d.set('one', 1)
        d.set('two', 2)
        this.assertEqual(d.size, 2)
        this.assertTrue(d.has('one'))
        this.assertEqual(d.get('two'), 2)
        d.delete('one')
        this.assertEqual(d.size, 1)
        d.clear()
        this.assertEqual(d.size, 0)
    })
)

export default dictTestGroup
