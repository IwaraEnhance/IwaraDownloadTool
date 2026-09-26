import { Test, TestGroup } from '../framework.ts'
import '../setup.ts'
import { registerBatchAction, getBatchActions } from '../../src/features/selection.ts'
import { selectList } from '../../src/context/selection.ts'
import { on } from '../../src/core/events.ts'

const testGroup = new TestGroup('批量动作注册表契约', '锁死 BatchAction 注册/读取/写透广播三项语义（快照写透断裂回归的根源护栏）')

testGroup.add(
    new Test('契约1: registerBatchAction 注册后 getBatchActions 可读，且重复 id 覆盖保持唯一', 'async', function () {
        const calls: string[] = []
        registerBatchAction({ id: '__contract_a__', run: () => calls.push('a1') })
        registerBatchAction({ id: '__contract_a__', run: () => calls.push('a2') })
        const found = getBatchActions().filter((a) => a.id === '__contract_a__')
        this.assertEqual(found.length, 1, '重复 id 必须覆盖而非追加')
        found[0].run()
        this.assertEqual(calls.join(','), 'a2', '覆盖后旧实现不再可达')
    })
)

testGroup.add(
    new Test('契约2: run 契约为零参（活引用语义；快照交付参数会导致写透断裂→选中残留）', 'async', function () {
        // 源码契约：BatchAction.run() 无参数——动作内部直接读 selectList 活引用。
        // 这里验证官方消费者（downloadSelected）之外的注册形态在注册表层的可见性。
        registerBatchAction({ id: '__contract_zero__', run: () => undefined })
        const found = getBatchActions().find((a) => a.id === '__contract_zero__')
        this.assertNotNull(found)
        this.assertEqual(found!.run.length, 0, 'run 必须为零参函数（接口面去引诱）')
    })
)

testGroup.add(
    new Test('契约3: selectList 写透广播链——set/delete 各触发一次 selection:changed（取消选中的机制基础）', 'async', function () {
        let events = 0
        const off = on('selection:changed', () => events++)
        const testId = '__contract_probe__'
        selectList.set(testId, { Type: 'init', ID: testId })
        selectList.delete(testId)
        off()
        this.assertTrue(events >= 2, 'set+delete 应各触发一次 selection:changed')
        this.assertFalse(selectList.has(testId), '探针项应已删除')
    })
)

export default testGroup
