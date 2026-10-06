import { Test, TestGroup } from '../framework.ts'
import { GMLock, GMLockTTL, type GMLockValue } from '../../src/core/gmLock.ts'

/**
 * GMLock 单元测试（Node + test/setup.ts 的 GM 存储 mock，含 remote 事件语义）。
 * 真实跨页传播语义由 e2e gmBehavior.spec 锚定（同 GMSyncDictionary 的分工口径）；
 * 本文件覆盖纯逻辑：互斥/续期/过期接管/释放 owner 保护/清理回收/acquireWait 超时。
 */

const gmLockTestGroup = new TestGroup('GMLock', 'GM 存储租约锁：互斥/续期/接管/清理/等待')

/** 清空 mock GM 存储中的全部锁键（隔离用例间状态） */
function cleanLocks(): void {
    GM_listValues()
        .filter((k) => k.startsWith('GMLock:'))
        .forEach((k) => GM_deleteValue(k))
}

/** 直接构造存储值（模拟他人页面的写入） */
function setForeignLock(name: string, owner: string, ttl: number): void {
    GM_setValue(`GMLock:${name}`, { owner, expires: Date.now() + ttl } satisfies GMLockValue)
}

const A = 'page-A'
const B = 'page-B'

gmLockTestGroup.add(
    new Test('acquire：空闲即可抢占', 'async', function () {
        cleanLocks()
        const lock = new GMLock(A)
        this.assertTrue(lock.acquire('t1', GMLockTTL.ShortTask))
        this.assertTrue(lock.isHeld('t1'))
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquire：他人租约未过期时拒绝，本页已持有时可续写', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t2', 5_000))
        // 他人未过期 → 拒绝
        this.assertEqual(b.acquire('t2', 5_000), false)
        // 持有者重复 acquire（续写）→ 成功
        this.assertTrue(a.acquire('t2', 5_000))
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquire：他人租约过期后可接管', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t3', 1))
        // 租约（1ms）已被 GM_setValue 同步写入；等待到期后 B 可接管
        await new Promise((r) => setTimeout(r, 20))
        this.assertEqual(a.isHeld('t3'), false)
        this.assertTrue(b.acquire('t3', 5_000))
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('renew：仅持有者可续期，非持有者/无锁时返回 false', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t4', 5_000))
        this.assertEqual(b.renew('t4', 5_000), false)
        // 非持有者的 renew 不得破坏原租约
        this.assertTrue(a.isHeld('t4'))
        this.assertTrue(a.renew('t4', 5_000))
        // 锁不存在时 renew 失败
        this.assertEqual(b.renew('ghost', 5_000), false)
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('release：仅当本页持有时才删除（误删保护）', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t5', 5_000))
        // 非持有者 release 不应删除他人锁
        b.release('t5')
        this.assertTrue(a.isHeld('t5'))
        // 持有者 release 删除
        a.release('t5')
        this.assertEqual(a.isHeld('t5'), false)
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWithHeartbeat：成功后自动续期，release 停止心跳', 'async', async function () {
        cleanLocks()
        const lock = new GMLock(A)
        this.assertTrue(lock.acquireWithHeartbeat('t6', 100, 20))
        // 心跳至少跑两轮（20ms 间隔），租约不应过期
        await new Promise((r) => setTimeout(r, 60))
        this.assertTrue(lock.isHeld('t6'), '心跳应在租约期内续期')
        lock.release('t6')
        this.assertEqual(lock.isHeld('t6'), false)
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWithHeartbeat：失去锁时心跳停止并回调 onLost', 'async', async function () {
        cleanLocks()
        const lost: string[] = []
        const lock = new GMLock(A)
        // 短 TTL + 高频心跳，B 抢走后 A 的心跳应停且有 onLost
        this.assertTrue(lock.acquireWithHeartbeat('t7', 200, 15, (name) => lost.push(name)))
        const b = new GMLock(B)
        // 模拟 A 失联超期：直接把租约改成已过期再让 B 抢占
        GM_setValue('GMLock:t7', { owner: A, expires: Date.now() - 1 })
        this.assertTrue(b.acquire('t7', 60_000))
        // A 下一次心跳 tick 发现失锁 → onLost 且不再续期
        await new Promise((r) => setTimeout(r, 80))
        this.assertTrue(lost.includes('t7'), 'onLost 应被回调')
        this.assertEqual(GM_getValue<GMLockValue>('GMLock:t7').owner, B)
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWait：锁空闲时立即抢占', 'async', async function () {
        cleanLocks()
        const lock = new GMLock(A)
        const start = Date.now()
        const ok = await lock.acquireWait('t8', 5_000, 1_000)
        this.assertTrue(ok)
        this.assertTrue(Date.now() - start < 100, '空闲锁应立即返回')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWait：持有者释放后（本地 GM 事件）立即唤醒接管', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t9', 60_000))
        const waiting = b.acquireWait('t9', 5_000, 5_000)
        // 稍后持有者释放 → B 的监听器应提前唤醒（无需等满 60s 租约）
        setTimeout(() => a.release('t9'), 30)
        const start = Date.now()
        const ok = await waiting
        this.assertTrue(ok)
        this.assertTrue(Date.now() - start < 5_000, '释放事件应提前唤醒等待方')
        this.assertTrue(b.isHeld('t9'))
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWait：等待超时返回 false', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t10', 60_000))
        const start = Date.now()
        const ok = await b.acquireWait('t10', 5_000, 50)
        this.assertEqual(ok, false)
        this.assertTrue(Date.now() - start >= 40, '应等待到超时才返回')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWaitWithHeartbeat：接管成功后心跳生效', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t11', 1))
        await new Promise((r) => setTimeout(r, 10))
        // B 接管过期租约并启动心跳（TTL 100ms，心跳 20ms）
        this.assertTrue(await b.acquireWaitWithHeartbeat('t11', 100, 20, undefined, 1_000))
        await new Promise((r) => setTimeout(r, 60))
        this.assertTrue(b.isHeld('t11'), '接管后心跳应维持租约')
        b.release('t11')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('pruneExpired：过期的锁被清理，未过期与结构异常行为符合预期', 'async', function () {
        cleanLocks()
        const active = { owner: A, expires: Date.now() + 60_000 }
        const expired = { owner: A, expires: Date.now() - 1 }
        GM_setValue('GMLock:keep', active)
        GM_setValue('GMLock:drop', expired)
        GMLock.pruneExpired()
        this.assertTrue(GM_listValues().includes('GMLock:keep'), '未过期锁不得被清理')
        this.assertEqual(GM_listValues().includes('GMLock:drop'), false, '过期锁应被清理')
        // 结构异常（owner/expires 缺失或类型不符）也应被回收，避免永久滞留
        GM_setValue('GMLock:broken', { owner: 123, expires: 'NaN' } as unknown as GMLockValue)
        GMLock.pruneExpired()
        this.assertEqual(GM_listValues().includes('GMLock:broken'), false, '结构异常的锁值应被回收')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('pruneExpired：取-删间隙内被 renew 的活跃锁不被误删（双检语义）', 'async', function () {
        cleanLocks()
        const expiredAtFirstRead = { owner: A, expires: Date.now() - 1 }
        GM_setValue('GMLock:t12', expiredAtFirstRead)
        // 模拟「prune 第一次读到过期快照、删除前重读时持有者已 renew」的交错：
        // 劫持 GM_getValue，首次（遍历读取）返回过期快照，其后（删除前重读）返回活跃租约；
        // 同时劫持 GM_deleteValue 记录删除意图——双检语义的可见效果是「不删除被续约的锁」
        const originalGet = GM_getValue
        const originalDelete = GM_deleteValue
        let readCount = 0
        let deleteAttempted = false
        const renewed = { owner: A, expires: Date.now() + 60_000 }
            ; (globalThis as any).GM_getValue = (key: string, defaultValue?: any) => {
                if (key === 'GMLock:t12') {
                    readCount++
                    return readCount === 1 ? expiredAtFirstRead : renewed
                }
                return originalGet(key, defaultValue)
            }
            ; (globalThis as any).GM_deleteValue = (key: string) => {
                if (key === 'GMLock:t12') deleteAttempted = true
                return originalDelete(key)
            }
        try {
            GMLock.pruneExpired()
        } finally {
            ; (globalThis as any).GM_getValue = originalGet
                ; (globalThis as any).GM_deleteValue = originalDelete
        }
        this.assertEqual(readCount, 2, 'pruneExpired 应恰好读取两次（首读 + 删除前重读）')
        this.assertEqual(deleteAttempted, false, '重读快照与首读不一致（已被 renew 覆盖）时不得删除')
        this.assertTrue(GM_listValues().includes('GMLock:t12'), '被 renew 的活跃租约不得被误删')
        cleanLocks()
    })
)

// ── Web Locks 双后端 ──

/** 安装假 LockManager 并重新定位 unsafeWindow.navigator（返回恢复函数）。
 * 模拟浏览器进程内仲裁语义：同名锁至多一个持有者，ifAvailable 下被持有则以 null 调用回调。
 * 释放语义：callback 返回的 Promise（WebLock 的挂起持有）settle 后立即从 held 表移除——
 * 与真实浏览器一致（回调返回 = 释放），释放后的 peek/request 应能重新获锁 */
function installFakeLockManager(): () => void {
    const held = new Map<string, () => void>()
    const locks = {
        request: async (_name: string, options: any, callback: (lock: unknown) => unknown): Promise<unknown> => {
            const name = _name
            if (options?.ifAvailable && held.has(name)) {
                // 被持有：以 null 调用（规范行为），回调返回值即请求结果
                return await callback(null)
            }
            let resolveHeld!: () => void
            const untilReleased = new Promise<void>((r) => { resolveHeld = r })
            held.set(name, resolveHeld)
            // callback 的挂起 Promise（持有期）settle（= release 被调用）后立即删除持有记录
            const result = await callback({ name, mode: 'exclusive' })
            const afterRelease = (result as unknown as Promise<void> | undefined)
            if (afterRelease && typeof (afterRelease as any).then === 'function') {
                await afterRelease
            }
            held.delete(name)
            void untilReleased
            return result
        },
        query: async () => ({ held: [...held.keys()].map((name) => ({ name, mode: 'exclusive' })), pending: [] })
    }
    const uw = (unsafeWindow as any)
    // ⚠️ test/setup.ts 的 unsafeWindow 可能没有 navigator 属性：补一个空对象再挂 locks，
    // 并记住原值——否则（a）本用例对 nav.locks 的 defineProperty 落在临时对象上，
    // restore 后后续用例读 navigator.locks 报 undefined；（b）恢复时无法还原原缺失态
    const hadNavigator = 'navigator' in uw
    const originalNavigator = uw.navigator
    if (!hadNavigator) uw.navigator = {}
    const nav = uw.navigator
    const descriptor = Object.getOwnPropertyDescriptor(nav, 'locks')
    Object.defineProperty(nav, 'locks', { value: locks, configurable: true })
    return () => {
        if (descriptor) Object.defineProperty(nav, 'locks', descriptor)
        else delete nav.locks
        if (!hadNavigator) delete uw.navigator
    }
}

const webLockTestGroup = new TestGroup('GMLock双后端', 'Web Locks 可用时的浏览器原生互斥与不可用时的降级')

webLockTestGroup.add(
    new Test('isWebLockSupported：无 locks 时 false（Node mock 环境默认降级 GM 后端）', 'async', function () {
        return import('../../src/core/webLock.ts').then((mod) => {
            this.assertEqual(mod.isWebLockSupported(), false, 'test/setup.ts 的 unsafeWindow.navigator 无 locks')
        })
    })
)

webLockTestGroup.add(
    new Test('web 后端：假 LockManager 下 acquireReady 预取 granted → 同步 acquire true、isHeld true', 'async', async function () {
        const restore = installFakeLockManager()
        try {
            // 重新取 webLock/GMLock 模块（isWebLockSupported 在 backend 定格时按需求值）
            const { GMLock } = await import('../../src/core/gmLock.ts')
            const lock = new GMLock('page-W1')
            await lock.acquireReady('webT1')
            this.assertTrue(lock.acquire('webT1', 5_000), '窗口 granted → 同步 acquire 返回 true')
            this.assertTrue(lock.isHeld('webT1'), 'web 后端 isHeld 基于窗口 + 心跳存活')
            this.assertTrue(lock.renew('webT1', 5_000), 'web 后端 renew 为存活探测（窗口 granted + 心跳在）')
            lock.release('webT1')
            this.assertEqual(lock.isHeld('webT1'), false, 'release 后窗口清除 → isHeld false')
        } finally {
            restore()
        }
    })
)

webLockTestGroup.add(
    new Test('web 后端互斥：他人已持锁时 acquireReady denied → 同步 acquire false', 'async', async function () {
        const restore = installFakeLockManager()
        try {
            const { GMLock } = await import('../../src/core/gmLock.ts')
            const a = new GMLock('page-WA')
            const b = new GMLock('page-WB')
            await a.acquireReady('webT2')
            this.assertTrue(a.acquire('webT2', 5_000))
            // b 预取时锁已被 a 持有（假管理器 ifAvailable 语义）→ denied
            await b.acquireReady('webT2')
            this.assertEqual(b.acquire('webT2', 5_000), false, '浏览器仲裁下单持有者，b 不得成功')
            a.release('webT2')
            b.release('webT2')
        } finally {
            restore()
        }
    })
)

// ── 边缘情况补充 ──

webLockTestGroup.add(
    new Test('release 幂等：重复 release 不抛错且状态稳定；非持有页 release 无副作用', 'async', async function () {
        const restore = installFakeLockManager()
        try {
            const { GMLock } = await import('../../src/core/gmLock.ts')
            const a = new GMLock('page-WR')
            const b = new GMLock('page-WR2')
            await a.acquireReady('webR1')
            this.assertTrue(a.acquire('webR1', 5_000))
            // 非持有者 release：无 held 标志，不得影响 a 的持有
            b.release('webR1')
            this.assertTrue(a.isHeld('webR1'), '非持有者 release 不得影响持有者')
            // 幂等：持有者连续 release 两次，第二次为 no-op 不抛错
            a.release('webR1')
            a.release('webR1')
            this.assertEqual(a.isHeld('webR1'), false)
            this.assertEqual(b.isHeld('webR1'), false)
        } finally {
            restore()
        }
    })
)

webLockTestGroup.add(
    new Test('web 后端 LOCKS.request 抛异常：视为未获得并安全降级（不传播异常）', 'async', async function () {
        const restore = installFakeLockManager()
        try {
            // 让 request 直接抛（模拟沙箱限制/AbortError）；nav.locks 由假管理器保证存在
            const nav = (unsafeWindow as any).navigator
            const orig = nav.locks.request
            nav.locks.request = async () => {
                throw new DOMException('aborted', 'AbortError')
            }
            try {
                const { GMLock } = await import('../../src/core/gmLock.ts')
                const lock = new GMLock('page-WX')
                // acquireReady 内 peekAsync 吃掉异常 → denied 窗口 → 同步 acquire
                // 安全降级 GM 租约语义（仲裁异常只是「本轮裁决不可用」，不是「锁被他人
                // 持有」——他人未过期的租约在场才拒绝，存储空闲可正常抢占）
                await lock.acquireReady('webX1')
                this.assertTrue(lock.acquire('webX1', 5_000), '仲裁异常下存储空闲 → 降级 GM 抢占成功（返回值不落空）')
                this.assertTrue(lock.isHeld('webX1'), '降级抢占后 isHeld 基于存储租约')
                // 他人租约真实在场 → 拒绝（互斥语义不受仲裁异常影响）
                GM_setValue('GMLock:webX1', { owner: '其他页', expires: Date.now() + 5_000 })
                const other = new GMLock('page-WX2')
                this.assertEqual(other.acquire('webX1', 5_000), false, '他人未过期租约在场 → 拒绝')
                lock.release('webX1')
                other.release('webX1')
            } finally {
                nav.locks.request = orig
            }
        } finally {
            restore()
        }
    })
)

webLockTestGroup.add(
    new Test('acquireAsync 全路径（web 后端）：预取→持有→复核一步到位', 'async', async function () {
        const restore = installFakeLockManager()
        try {
            const { GMLock } = await import('../../src/core/gmLock.ts')
            const a = new GMLock('page-WA2')
            const b = new GMLock('page-WB2')
            // 空闲：全路径成功（预取窗口即失即取，真实持有 + isHeld 复核）
            this.assertTrue(await a.acquireAsync('webA1', 5_000), 'acquireAsync 空闲锁应成功')
            this.assertTrue(a.isHeld('webA1'), '全路径成功后 isHeld 应为 true')
            // 他人（A 真实持有挂起中）：B 的全路径应在预取即 denied，acquire false
            this.assertEqual(await b.acquireAsync('webA1', 5_000), false, '他人持有时全路径应失败（浏览器仲裁）')
            // A 释放后 B 可重试成功
            a.release('webA1')
            await new Promise((r) => setTimeout(r, 10))
            this.assertTrue(await b.acquireAsync('webA1', 5_000), 'A 释放后 B 重试应成功')
            b.release('webA1')
        } finally {
            restore()
        }
    })
)

gmLockTestGroup.add(
    new Test('GM 后端 acquire 重复续写刷新租约：他人过期前不可插入', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        const start = Date.now()
        this.assertTrue(a.acquire('t13', 200))
        // A 持续续写两次，租约始终被推到未来 200ms
        a.acquire('t13', 200)
        a.acquire('t13', 200)
        // 200ms 内 B 任何时刻 acquire 都应被拒绝（租约被 A 的续写保持有效）
        this.assertEqual(b.acquire('t13', 5_000), false, 'A 持续续写下 B 不得插入')
        this.assertTrue(Date.now() - start < 200, '断言应在租约期内完成')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('GM 后端 owner 值混淆：owner 字符串相等的不同实例视为同持有者共享锁', 'async', function () {
        cleanLocks()
        // 同 owner 字符串的两个实例 = 同一持有者语义（如同页多锁句柄共享）
        const a1 = new GMLock('page-same')
        const a2 = new GMLock('page-same')
        this.assertTrue(a1.acquire('t14', 5_000))
        // a2 视角：owner 相同 → 可续写/续期/release（文档语义：owner 是持有者标识非实例标识）
        this.assertTrue(a2.isHeld('t14'), '同 owner 字符串的实例共享持有态')
        this.assertTrue(a2.renew('t14', 5_000), '同 owner 实例可互相续期')
        a2.release('t14')
        this.assertEqual(a1.isHeld('t14'), false, '任一同 owner 实例 release 即释放共享锁')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('GM 后端 TTL 边界：ttl=0 视为立即过期不可持有；负值同退化为过期', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        // ttl=0：expires=now → isHeld 判定 expires > now 为 false（不持有）；可被任何人立即接管
        this.assertTrue(a.acquire('t15', 0))
        this.assertEqual(a.isHeld('t15'), false, 'ttl=0 的租约立即过期')
        this.assertTrue(b.acquire('t15', 5_000), '他人可立即接管 ttl=0 的锁')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('GM 后端 acquireWait 的 deadline 边界：timeout=0 未持锁时立即返回 false', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t16', 60_000))
        const start = Date.now()
        const ok = await b.acquireWait('t16', 5_000, 0)
        this.assertEqual(ok, false, 'timeout=0 应立即失败（不等待）')
        this.assertTrue(Date.now() - start < 50, 'timeout=0 不得产生明显等待')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('acquireWaitWithHeartbeat 超时路径：等待失败时不启动心跳、不持有', 'async', async function () {
        cleanLocks()
        const a = new GMLock(A)
        const b = new GMLock(B)
        this.assertTrue(a.acquire('t17', 60_000))
        const ok = await b.acquireWaitWithHeartbeat('t17', 5_000, 20, undefined, 60)
        this.assertEqual(ok, false, '等待超时应返回 false')
        this.assertEqual(b.isHeld('t17'), false, '超时路径不得持有')
        // 清理 A 长租约
        a.release('t17')
        cleanLocks()
    })
)

gmLockTestGroup.add(
    new Test('pruneExpired：活跃持有中的锁不被清理且 prune 后持有态不受影响', 'async', function () {
        cleanLocks()
        const a = new GMLock(A)
        this.assertTrue(a.acquire('t18', 60_000))
        GMLock.pruneExpired()
        this.assertTrue(a.isHeld('t18'), 'pruneExpired 不得影响活跃租约')
        cleanLocks()
    })
)

webLockTestGroup.add(
    new Test('web 后端与 GM 后端隔离：locks 不可用后同锁名完全走 GM 租约语义', 'async', function () {
        cleanLocks()
        // Node 环境（无 locks）：web 后端探测为 false，锁名定格 GM 后端；
        // acquire/isHeld/renew/release 全部应为纯 GM 租约行为（webAcquireState 不参与）
        const lock = new GMLock(A)
        const other = new GMLock(B)
        this.assertTrue(lock.acquire('t19', 5_000))
        this.assertTrue(lock.isHeld('t19'))
        // 他人租约在场 → 拒绝（GM 后端语义，而非 web 的 held 标志语义）
        this.assertEqual(other.acquire('t19', 5_000), false)
        // 直接写 GM 租约模拟他人页面（web 后端不可能这样被干扰——这正是降级语义的边界）
        GM_setValue('GMLock:t19', { owner: B, expires: Date.now() + 5_000 })
        this.assertEqual(lock.isHeld('t19'), false, '租约被他人覆盖后原持有者应失锁')
        cleanLocks()
    })
)
