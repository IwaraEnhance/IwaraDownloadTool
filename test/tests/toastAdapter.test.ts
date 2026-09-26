import { Test, TestGroup } from '../framework.ts'
import '../setup.ts'
import { buildToastParamsFromReport } from '../../src/core/notify.ts'

const testGroup = new TestGroup('report→toast 参数合并契约', '锁死 buildToastParamsFromReport 的「未传字段不产生自有键」语义（toast 三连回归的根源护栏）')

testGroup.add(
    new Test('契约1: 未传 duration 不产生自有键（曾致 undefined 覆盖底座 Info 默认 2000 → toast 永不消失）', 'async', function () {
        const params = buildToastParamsFromReport({ body: 'ok' })
        this.assertFalse('duration' in params, '未传 duration 不得产生自有键')
    })
)

testGroup.add(
    new Test('契约2: 显式 duration 原样透传', 'async', function () {
        const params = buildToastParamsFromReport({ body: 'x', duration: -1 }) as any
        this.assertEqual(params.duration, -1)
    })
)

testGroup.add(
    new Test('契约3: close 未传不产生自有键；显式 true/false 均透传', 'async', function () {
        const none = buildToastParamsFromReport({ body: 'x' })
        this.assertFalse('close' in none, '未传 close 不得产生自有键')
        const explicit = buildToastParamsFromReport({ body: 'x', close: true }) as any
        this.assertEqual(explicit.close, true)
        const off = buildToastParamsFromReport({ body: 'x', close: false }) as any
        this.assertEqual(off.close, false, 'close:false 也必须透传（常驻报告阻止底座补交互）')
    })
)

testGroup.add(
    new Test('契约4: 不默认合成 onClick（曾致常驻进度条可被误点消失+进度冻结）', 'async', function () {
        const params = buildToastParamsFromReport({ body: 'x', duration: -1, close: false })
        this.assertFalse('onClick' in params, '适配层不得合成默认 onClick')
    })
)

testGroup.add(
    new Test('契约5: string body → text；Node body → node', 'async', function () {
        const s = buildToastParamsFromReport({ body: '文本载荷' }) as any
        this.assertEqual(s.text, '文本载荷')
        const fakeNode = { textContent: 'N' } as unknown as Node
        const n = buildToastParamsFromReport({ body: fakeNode }) as any
        this.assertEqual(n.node, fakeNode)
        this.assertTrue(n.text === undefined, 'Node 载荷不得带 text 值')
    })
)

export default testGroup
