import '../setup.ts'
import { Test, TestGroup } from '../framework.ts'
import { checkApprovalConditions, getApprovalMode, setApprovalMode, type ApprovalCondition } from '../../src/core/approvalConditions.ts'
import { GM_KEY_FRIEND_REQUEST_APPROVAL_MODE } from '../../src/core/constants.ts'

const approvalModeTestGroup = new TestGroup('ApprovalMode', '好友请求审批条件组合模式（any/all）契约测试')

/** 构造可控行为的假条件（测试期注册进内置注册表，结束恢复） */
function makeCondition(id: string, result: boolean | Error, onCall?: () => void): ApprovalCondition {
    return {
        id,
        test: async () => {
            onCall?.()
            if (result instanceof Error) throw result
            return result
        }
    }
}

let spyCalled = 0

/** 将假条件替换进内置注册表（测试结束恢复） */
async function withConditions(conditions: ApprovalCondition[], fn: () => Promise<void>): Promise<void> {
    const mod = await import('../../src/core/approvalConditions.ts')
    const original = [...mod.BUILTIN_APPROVAL_CONDITIONS]
    mod.BUILTIN_APPROVAL_CONDITIONS.length = 0
    mod.BUILTIN_APPROVAL_CONDITIONS.push(...conditions)
    try {
        await fn()
    } finally {
        mod.BUILTIN_APPROVAL_CONDITIONS.length = 0
        mod.BUILTIN_APPROVAL_CONDITIONS.push(...original)
    }
}

approvalModeTestGroup.add(
    new Test('any 模式：任一满足即批准（短路，不再执行后续条件）', 'async', function () {
        return withConditions(
            [makeCondition('c1', false), makeCondition('c2', true), makeCondition('c3', true, () => spyCalled++)],
            async () => {
                spyCalled = 0
                const result = await checkApprovalConditions(['c1', 'c2', 'c3'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'any')
                this.assertEqual(result, true)
                this.assertEqual(spyCalled, 0, 'c2 已满足，c3 不应被评估')
            }
        )
    })
)

approvalModeTestGroup.add(
    new Test('all 模式：任一不满足即拒绝（短路，不再执行后续条件）', 'async', function () {
        return withConditions(
            [makeCondition('c1', true), makeCondition('c2', false), makeCondition('c3', true, () => spyCalled++)],
            async () => {
                spyCalled = 0
                const result = await checkApprovalConditions(['c1', 'c2', 'c3'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'all')
                this.assertEqual(result, false)
                this.assertEqual(spyCalled, 0, 'c2 已不满足，c3 不应被评估')
            }
        )
    })
)

approvalModeTestGroup.add(
    new Test('all 模式：全部满足才批准', 'async', function () {
        return withConditions([makeCondition('c1', true), makeCondition('c2', true)], async () => {
            const result = await checkApprovalConditions(['c1', 'c2'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'all')
            this.assertEqual(result, true)
        })
    })
)

approvalModeTestGroup.add(
    new Test('any 模式：全部不满足则拒绝', 'async', function () {
        return withConditions([makeCondition('c1', false), makeCondition('c2', false)], async () => {
            const result = await checkApprovalConditions(['c1', 'c2'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'any')
            this.assertEqual(result, false)
        })
    })
)

approvalModeTestGroup.add(
    new Test('any 模式：条件判定异常视为不满足，继续评估后续条件', 'async', function () {
        return withConditions([makeCondition('c1', new Error('boom')), makeCondition('c2', true)], async () => {
            const result = await checkApprovalConditions(['c1', 'c2'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'any')
            this.assertEqual(result, true)
        })
    })
)

approvalModeTestGroup.add(
    new Test('all 模式：条件判定异常视为不满足，立即拒绝', 'async', function () {
        return withConditions([makeCondition('c1', true), makeCondition('c2', new Error('boom')), makeCondition('c3', true)], async () => {
            const result = await checkApprovalConditions(['c1', 'c2', 'c3'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'all')
            this.assertEqual(result, false)
        })
    })
)

approvalModeTestGroup.add(
    new Test('未注册 id 跳过不阻塞判定（any 模式后续条件仍可批准）', 'async', function () {
        return withConditions([makeCondition('c1', true)], async () => {
            const result = await checkApprovalConditions(['ghost', 'c1'], { user: {} as Iwara.User, entry: {} as Iwara.FriendRequestEntry }, 'any')
            this.assertEqual(result, true)
        })
    })
)

approvalModeTestGroup.add(
    new Test('模式存取：缺省回退 any（与历史 OR 语义一致）', 'async', function () {
        GM_deleteValue(GM_KEY_FRIEND_REQUEST_APPROVAL_MODE)
        this.assertEqual(getApprovalMode(), 'any')
        setApprovalMode('all')
        this.assertEqual(getApprovalMode(), 'all')
        // 垃圾值回退 any
        GM_setValue(GM_KEY_FRIEND_REQUEST_APPROVAL_MODE, 'garbage')
        this.assertEqual(getApprovalMode(), 'any')
        setApprovalMode('any')
        this.assertEqual(getApprovalMode(), 'any')
    })
)
