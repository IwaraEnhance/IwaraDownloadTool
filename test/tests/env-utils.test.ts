import '../setup.ts'
import { Test, TestGroup } from '../framework.ts'
import { stringify, prune, UUID, delay, throttle, debounce } from '../../src/core/env.ts'

const utilsTestGroup = new TestGroup('工具函数', 'stringify / prune / UUID / delay 测试')

// ============ stringify ============

utilsTestGroup.add(
    new Test('stringify undefined', 'async', function () {
        this.assertEqual(stringify(undefined), 'undefined')
    })
)

utilsTestGroup.add(
    new Test('stringify null', 'async', function () {
        this.assertEqual(stringify(null), 'null')
    })
)

utilsTestGroup.add(
    new Test('stringify boolean', 'async', function () {
        this.assertEqual(stringify(true), 'true')
        this.assertEqual(stringify(false), 'false')
    })
)

utilsTestGroup.add(
    new Test('stringify number', 'async', function () {
        this.assertEqual(stringify(42), '42')
        this.assertEqual(stringify(3.14), '3.14')
        this.assertEqual(stringify(NaN), 'NaN')
        this.assertEqual(stringify(Infinity), 'Infinity')
    })
)

utilsTestGroup.add(
    new Test('stringify string', 'async', function () {
        this.assertEqual(stringify('hello'), 'hello')
        this.assertEqual(stringify(''), '')
    })
)

utilsTestGroup.add(
    new Test('stringify symbol', 'async', function () {
        const sym = Symbol('test')
        this.assertEqual(stringify(sym), sym.toString())
    })
)

utilsTestGroup.add(
    new Test('stringify function', 'async', function () {
        const fn = () => 42
        this.assertEqual(stringify(fn), fn.toString())
    })
)

utilsTestGroup.add(
    new Test('stringify Error', 'async', function () {
        const err = new Error('test error')
        this.assertEqual(stringify(err), err.toString())
    })
)

utilsTestGroup.add(
    new Test('stringify Date', 'async', function () {
        const date = new Date('2023-01-01T00:00:00.000Z')
        this.assertEqual(stringify(date), '2023-01-01T00:00:00.000Z')
    })
)

utilsTestGroup.add(
    new Test('stringify object', 'async', function () {
        const obj = { a: 1, b: 'hello', c: true }
        const result = stringify(obj)
        this.assertTrue(result.includes('"a": 1'))
        this.assertTrue(result.includes('"b": "hello"'))
        this.assertTrue(result.includes('"c": true'))
    })
)

utilsTestGroup.add(
    new Test('stringify array', 'async', function () {
        const arr = [1, 'two', false]
        const result = stringify(arr)
        this.assertTrue(result.includes('1'))
        this.assertTrue(result.includes('"two"'))
    })
)

// ============ prune ============

utilsTestGroup.add(
    new Test('prune 移除 null 值', 'async', function () {
        const result = prune({ a: 1, b: null, c: undefined, d: 'hello' })
        this.assertEqual(result.a, 1)
        this.assertEqual(result.d, 'hello')
        this.assertUndefined((result as Record<string, unknown>).b)
        this.assertUndefined((result as Record<string, unknown>).c)
    })
)

utilsTestGroup.add(
    new Test('prune 递归清理嵌套对象', 'async', function () {
        const result = prune({
            a: 1,
            b: { x: null, y: 'keep', z: undefined },
            c: [null, 'keep', undefined]
        })
        this.assertEqual(result.a, 1)
        this.assertEqual(result.b?.y, 'keep')
        this.assertUndefined((result.b as Record<string, unknown>)?.x)
        this.assertEqual((result.c as any[]).length, 1)
        this.assertEqual((result.c as any[])[0], 'keep')
    })
)

utilsTestGroup.add(
    new Test('prune 空对象', 'async', function () {
        const result = prune({})
        this.assertEqual(JSON.stringify(result), '{}')
    })
)

utilsTestGroup.add(
    new Test('prune 保留数字 0', 'async', function () {
        const result = prune({ a: 0, b: false, c: '' })
        this.assertEqual(result.a, 0)
        this.assertEqual(result.b, false)
        // 空字符串 isNotEmpty 为 false，会被 prune 移除
        this.assertUndefined(result.c)
    })
)

// ============ UUID ============

utilsTestGroup.add(
    new Test('UUID 生成非空字符串', 'async', function () {
        const uuid = UUID()
        this.assertTrue(typeof uuid === 'string')
        this.assertTrue(uuid.length > 0)
    })
)

utilsTestGroup.add(
    new Test('UUID 格式 (32位十六进制)', 'async', function () {
        const uuid = UUID()
        // UUID 应为 32 位十六进制字符（crypto.randomUUID 去掉横线）
        this.assertTrue(/^[0-9a-f]{32}$/i.test(uuid))
    })
)

utilsTestGroup.add(
    new Test('UUID 唯一性', 'async', function () {
        const uuid1 = UUID()
        const uuid2 = UUID()
        this.assertNotEqual(uuid1, uuid2)
    })
)

// ============ delay ============

utilsTestGroup.add(
    new Test('delay 等待指定时间', 'async', async function () {
        const start = Date.now()
        await delay(10)
        const elapsed = Date.now() - start
        this.assertTrue(elapsed >= 5, `delay(10) 应至少等待 5ms，实际: ${elapsed}ms`)
    })
)

// ============ throttle ============

utilsTestGroup.add(
    new Test('throttle leading=true 首次立即执行', 'async', async function () {
        let callCount = 0
        const fn = throttle(() => {
            callCount++
        }, 50)
        fn()
        this.assertEqual(callCount, 1, '首次调用应立即执行')
    })
)

utilsTestGroup.add(
    new Test('throttle 连续调用限频', 'async', async function () {
        let callCount = 0
        const fn = throttle(() => {
            callCount++
        }, 50)
        fn() // 立即执行 (leading)
        fn() // 被限流，安排 trailing
        this.assertEqual(callCount, 1, '第二次调用不应立即执行')
        await delay(60) // 等待 trailing 执行
        this.assertEqual(callCount, 2, 'trailing 调用应执行')
    })
)

utilsTestGroup.add(
    new Test('throttle cancel 取消 trailing', 'async', async function () {
        let callCount = 0
        const fn = throttle(() => {
            callCount++
        }, 50)
        fn() // 立即执行
        fn() // 安排 trailing
        fn.cancel() // 取消 trailing
        await delay(60)
        this.assertEqual(callCount, 1, '取消后 trailing 不应执行')
    })
)

utilsTestGroup.add(
    new Test('throttle leading=false 首次不执行', 'async', async function () {
        let callCount = 0
        const fn = throttle(
            () => {
                callCount++
            },
            30,
            { leading: false, trailing: true }
        )
        fn()
        this.assertEqual(callCount, 0, 'leading=false 首次不应执行')
        await delay(40)
        this.assertEqual(callCount, 1, 'trailing 应执行')
    })
)

utilsTestGroup.add(
    new Test('throttle 传参正确', 'async', async function () {
        let result = ''
        const fn = throttle((s: string) => {
            result = s
        }, 30)
        fn('hello')
        this.assertEqual(result, 'hello', '参数应正确传递')
    })
)

// ============ debounce ============

utilsTestGroup.add(
    new Test('debounce 延迟执行', 'async', async function () {
        let callCount = 0
        const fn = debounce(() => {
            callCount++
        }, 30)
        fn()
        this.assertEqual(callCount, 0, 'debounce 不应立即执行')
        await delay(40)
        this.assertEqual(callCount, 1, '延迟后应执行一次')
    })
)

utilsTestGroup.add(
    new Test('debounce 连续调用只执行最后一次', 'async', async function () {
        let result = ''
        const fn = debounce((s: string) => {
            result = s
        }, 30)
        fn('A')
        fn('B')
        fn('C')
        this.assertEqual(result, '', '中间调用不应执行')
        await delay(40)
        this.assertEqual(result, 'C', '只应执行最后一次')
    })
)

utilsTestGroup.add(
    new Test('debounce cancel 取消执行', 'async', async function () {
        let callCount = 0
        const fn = debounce(() => {
            callCount++
        }, 30)
        fn()
        fn.cancel()
        await delay(40)
        this.assertEqual(callCount, 0, '取消后不应执行')
    })
)

utilsTestGroup.add(
    new Test('debounce immediate=true 首次立即执行', 'async', async function () {
        let callCount = 0
        const fn = debounce(
            () => {
                callCount++
            },
            50,
            { immediate: true }
        )
        fn()
        this.assertEqual(callCount, 1, 'immediate=true 首次应执行')
        fn()
        this.assertEqual(callCount, 1, '第二次不应立即执行')
        await delay(60)
        this.assertEqual(callCount, 1, 'immediate=true trailing 不应执行')
    })
)

utilsTestGroup.add(
    new Test('debounce immediate 连续调用', 'async', async function () {
        let callCount = 0
        const fn = debounce(
            () => {
                callCount++
            },
            50,
            { immediate: true }
        )
        fn() // 立即执行
        fn() // 被防抖
        fn() // 被防抖
        await delay(60)
        fn() // 新的立即执行
        this.assertEqual(callCount, 2, 'immediate 模式只在首次且无 pending 时执行')
    })
)

export default utilsTestGroup
