import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { GMLock } from '../../src/core/gmLock.ts';

const gmLockTestGroup = new TestGroup('GMLock', '基于 GM 存储的跨页租约锁测试');

gmLockTestGroup.add(new Test('acquire 成功且 isHeld', 'async', function () {
    const lock = new GMLock('owner-A');
    this.assertEqual(lock.acquire('gm-test-lock', 10000), true);
    this.assertEqual(lock.isHeld('gm-test-lock'), true);
    lock.release('gm-test-lock');
}));

gmLockTestGroup.add(new Test('他人持有时 acquire 失败', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock', 10000);
    this.assertEqual(b.acquire('gm-test-lock', 10000), false);
    this.assertEqual(b.isHeld('gm-test-lock'), false);
    a.release('gm-test-lock');
}));

gmLockTestGroup.add(new Test('非持有者 renew 失败', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock', 10000);
    this.assertEqual(b.renew('gm-test-lock', 10000), false);
    this.assertEqual(a.renew('gm-test-lock', 10000), true);
    a.release('gm-test-lock');
}));

gmLockTestGroup.add(new Test('租约过期后可被他人抢占', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock', -1000); // 过期
    this.assertEqual(a.isHeld('gm-test-lock'), false);
    this.assertEqual(b.acquire('gm-test-lock', 10000), true);
    b.release('gm-test-lock');
}));

gmLockTestGroup.add(new Test('release 仅持有者可释放', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock', 10000);
    b.release('gm-test-lock'); // 非持有者释放无效
    this.assertEqual(a.isHeld('gm-test-lock'), true);
    a.release('gm-test-lock');
    this.assertEqual(a.isHeld('gm-test-lock'), false);
}));

gmLockTestGroup.add(new Test('pruneExpired 只清理过期锁', 'async', function () {
    const a = new GMLock('owner-A');
    a.acquire('gm-expired', -1000);
    a.acquire('gm-active', 10000);
    GMLock.pruneExpired();
    const x = new GMLock('owner-X');
    this.assertEqual(x.acquire('gm-expired', 10000), true); // 过期锁已被清理，可抢占
    x.release('gm-expired');
    this.assertEqual(a.isHeld('gm-active'), true); // 活跃锁保留
    a.release('gm-active');
}));

gmLockTestGroup.add(new Test('acquireWait 在他人释放后立即接管', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock-wait', 10000);

    const pending = b.acquireWait('gm-test-lock-wait', 10000);
    // 模拟另一页面释放锁（remote 事件，newValue=undefined 表示删除）
    (globalThis as any).__GM_simulateRemoteChange('GMLock:gm-test-lock-wait', undefined);
    this.assertTrue(await pending, '远程释放后应立即接管');
    this.assertTrue(b.isHeld('gm-test-lock-wait'));
    b.release('gm-test-lock-wait');
}));

gmLockTestGroup.add(new Test('acquireWait 在租约到期后接管', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock-wait2', 100); // 短租约，无 release 事件

    this.assertTrue(await b.acquireWait('gm-test-lock-wait2', 10000), '租约到期后应立即接管');
    b.release('gm-test-lock-wait2');
}));

gmLockTestGroup.add(new Test('acquireWait 超时返回 false', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-test-lock-wait3', 10000);

    this.assertFalse(await b.acquireWait('gm-test-lock-wait3', 10000, 100), '超时后应返回 false');
    a.release('gm-test-lock-wait3');
}));

// ── 极限工况 ──

gmLockTestGroup.add(new Test('极限: 远程覆盖写入后本地复核让位(最后写入者胜出)', 'async', function () {
    const a = new GMLock('owner-A');
    a.acquire('gm-lww', 10000);
    this.assertTrue(a.isHeld('gm-lww'));
    // 模拟另一页面同时抢占并覆盖写入(真实场景: 双方都读到空闲, 后写者胜出)
    (globalThis as any).__GM_simulateRemoteChange('GMLock:gm-lww', { owner: 'owner-B', expires: Date.now() + 10000 });
    // 本地动作前复核: 发现被覆盖, 立即让位
    this.assertFalse(a.isHeld('gm-lww'), '被覆盖后 isHeld 应失败');
    this.assertFalse(a.renew('gm-lww', 10000), '被覆盖后 renew 应失败');
    const b = new GMLock('owner-B');
    this.assertTrue(b.isHeld('gm-lww'), '覆盖者复核通过');
    b.release('gm-lww');
}));

gmLockTestGroup.add(new Test('极限: TTL=0 立即过期', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-ttl0', 0);
    this.assertFalse(a.isHeld('gm-ttl0'), 'TTL=0 后应视为未持有');
    this.assertTrue(b.acquire('gm-ttl0', 10000), '他人应立即可抢占');
    b.release('gm-ttl0');
}));

gmLockTestGroup.add(new Test('极限: 本页 acquire 等效续期并延长租约', 'async', async function () {
    const a = new GMLock('owner-A');
    a.acquire('gm-reacquire', 5000);
    const expiresBefore = (globalThis as any).GM_getValue('GMLock:gm-reacquire').expires as number;
    await new Promise(r => setTimeout(r, 20));
    this.assertTrue(a.acquire('gm-reacquire', 5000), '本页重复 acquire 应成功(续期)');
    const expiresAfter = (globalThis as any).GM_getValue('GMLock:gm-reacquire').expires as number;
    this.assertTrue(expiresAfter > expiresBefore, '续期后租约应延长');
    a.release('gm-reacquire');
}));

gmLockTestGroup.add(new Test('极限: 非持有者 renew 失败且不改变原租约', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-renew-invariant', 5000);
    const before = (globalThis as any).GM_getValue('GMLock:gm-renew-invariant') as { owner: string; expires: number };
    this.assertFalse(b.renew('gm-renew-invariant', 99999), '非持有者 renew 应失败');
    const after = (globalThis as any).GM_getValue('GMLock:gm-renew-invariant') as { owner: string; expires: number };
    this.assertEqual(after.owner, before.owner, '原持有者不变');
    this.assertEqual(after.expires, before.expires, '原租约不变');
    a.release('gm-renew-invariant');
}));

gmLockTestGroup.add(new Test('极限: 重复 release 幂等且不伤及新持有者', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-idempotent-release', 5000);
    a.release('gm-idempotent-release');
    a.release('gm-idempotent-release'); // 重复释放无操作、不抛错
    this.assertFalse(a.isHeld('gm-idempotent-release'));
    b.acquire('gm-idempotent-release', 5000);
    a.release('gm-idempotent-release'); // 旧持有者释放不影响新持有者
    this.assertTrue(b.isHeld('gm-idempotent-release'), '新持有者不受旧持有者 release 影响');
    b.release('gm-idempotent-release');
}));

gmLockTestGroup.add(new Test('极限: 不同锁名互不干扰', 'async', function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-lock-x', 10000);
    this.assertTrue(b.acquire('gm-lock-y', 10000), '不同锁名应独立获取');
    this.assertTrue(a.isHeld('gm-lock-x') && b.isHeld('gm-lock-y'), '两把锁同时持有');
    this.assertFalse(b.acquire('gm-lock-x', 10000), '同名锁仍互斥');
    a.release('gm-lock-x');
    b.release('gm-lock-y');
}));

gmLockTestGroup.add(new Test('极限: acquireWait 多等待者接力, 唯一接管且逐个唤醒', 'async', async function () {
    const lockName = 'gm-wait-relay';
    const holder = new GMLock('owner-holder');
    holder.acquire(lockName, 10000);

    const waiters = [new GMLock('w1'), new GMLock('w2'), new GMLock('w3'), new GMLock('w4'), new GMLock('w5')];
    const pendings = waiters.map(w => w.acquireWait(lockName, 10000));
    const resolved = new Array(waiters.length).fill(false);

    for (let round = 0; round < waiters.length; round++) {
        // 模拟当前持有者释放(跨页 remote 事件)
        (globalThis as any).__GM_simulateRemoteChange(`GMLock:${lockName}`, undefined);
        // 每轮恰好一个未接管过的等待者接管(已接管的 promise 已 resolve, 必须排除)
        const winnerIdx = await Promise.race(
            pendings.map((p, i) => p.then(() => i)).filter((_, i) => !resolved[i])
        );
        this.assertFalse(resolved[winnerIdx], `第 ${round} 轮接管的等待者不应已接管过`);
        resolved[winnerIdx] = true;
        this.assertTrue(waiters[winnerIdx].isHeld(lockName), `第 ${round} 轮接管者应持有锁`);
        // 其余等待者应仍在排队(短时间内不得接管)
        for (let i = 0; i < waiters.length; i++) {
            if (resolved[i]) continue;
            const state = await Promise.race([
                pendings[i].then(() => 'resolved' as const),
                new Promise<string>(r => setTimeout(() => r('pending'), 80))
            ]);
            this.assertEqual(state, 'pending', `第 ${round} 轮后第 ${i} 个等待者不应同时接管`);
        }
    }
    // 清理: 全部 release(幂等)
    for (const w of waiters) w.release(lockName);
}));

gmLockTestGroup.add(new Test('极限: 持有者持续续期时等待者不误抢, 停止后到期接管', 'async', async function () {
    const lockName = 'gm-wait-renew';
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire(lockName, 200);

    const pending = b.acquireWait(lockName, 10000);
    // 持有者连续续期 3 次(键值变化会唤醒等待者, 但租约未过期不应抢占)
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 60));
        this.assertTrue(a.renew(lockName, 300), `第 ${i} 次续期应成功`);
        this.assertTrue(a.isHeld(lockName));
        const state = await Promise.race([
            pending.then(() => 'resolved' as const),
            new Promise<string>(r => setTimeout(() => r('pending'), 50))
        ]);
        this.assertEqual(state, 'pending', '持有者续期期间等待者不应接管');
    }
    // 停止续期, 租约到期后应立即接管
    this.assertTrue(await pending, '停止续期后等待者应在租约到期时接管');
    b.release(lockName);
}));

gmLockTestGroup.add(new Test('极限: acquireWait timeout=0 立即失败', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-wait-timeout0', 10000);
    const start = Date.now();
    this.assertFalse(await b.acquireWait('gm-wait-timeout0', 10000, 0), 'timeout=0 应立即返回 false');
    this.assertTrue(Date.now() - start < 50, 'timeout=0 不应有实际等待');
    a.release('gm-wait-timeout0');
}));

gmLockTestGroup.add(new Test('极限: 本页已持有时 acquireWait 立即返回', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-wait-held', 10000);

    const pending = b.acquireWait('gm-wait-held', 10000);
    (globalThis as any).__GM_simulateRemoteChange('GMLock:gm-wait-held', undefined);
    this.assertTrue(await pending, '接管成功');
    this.assertTrue(b.isHeld('gm-wait-held'));

    const start = Date.now();
    this.assertTrue(await b.acquireWait('gm-wait-held', 10000), '本页已持有, 再等待应立即成功');
    this.assertTrue(Date.now() - start < 50, '本页已持有时不应挂起');
    b.release('gm-wait-held');
}));

// ── 内部心跳 ──

gmLockTestGroup.add(new Test('acquireWithHeartbeat 内部心跳自动续期', 'async', async function () {
    const a = new GMLock('owner-A');
    a.acquireWithHeartbeat('gm-hb-renew', 100, 20);
    await new Promise(r => setTimeout(r, 150)); // 约 7 个心跳周期, 无心跳时租约早已过期
    this.assertTrue(a.isHeld('gm-hb-renew'), '内部心跳应持续续期保持持有');
    a.release('gm-hb-renew');
}));

gmLockTestGroup.add(new Test('失去锁后心跳停止并触发 onLost', 'async', async function () {
    const a = new GMLock('owner-A');
    let lost = false;
    a.acquireWithHeartbeat('gm-hb-lost', 100, 20, () => { lost = true; });
    // 模拟被另一页面覆盖(最后写入者胜出)
    (globalThis as any).__GM_simulateRemoteChange('GMLock:gm-hb-lost', { owner: 'owner-B', expires: Date.now() + 10000 });
    await new Promise(r => setTimeout(r, 60)); // 一个心跳周期内应发现失去锁
    this.assertTrue(lost, '失去锁后应触发 onLost');
    this.assertFalse(a.isHeld('gm-hb-lost'), '失去锁后不应再持有');
    const value = (globalThis as any).GM_getValue('GMLock:gm-hb-lost') as { owner: string };
    this.assertEqual(value.owner, 'owner-B', '心跳停止后不应覆盖新持有者');
    (globalThis as any).GM_deleteValue('GMLock:gm-hb-lost');
}));

gmLockTestGroup.add(new Test('release 后心跳停止, 锁不被复活', 'async', async function () {
    const a = new GMLock('owner-A');
    a.acquireWithHeartbeat('gm-hb-release', 100, 20);
    await new Promise(r => setTimeout(r, 40));
    a.release('gm-hb-release');
    await new Promise(r => setTimeout(r, 80)); // 心跳若未停止会在此复活锁
    const b = new GMLock('owner-B');
    this.assertTrue(b.acquire('gm-hb-release', 10000), 'release 后锁应保持空闲');
    b.release('gm-hb-release');
}));

gmLockTestGroup.add(new Test('acquireWaitWithHeartbeat 接管后自动续期', 'async', async function () {
    const a = new GMLock('owner-A');
    const b = new GMLock('owner-B');
    a.acquire('gm-hb-wait', 10000);
    const pending = b.acquireWaitWithHeartbeat('gm-hb-wait', 100, 20);
    (globalThis as any).__GM_simulateRemoteChange('GMLock:gm-hb-wait', undefined);
    this.assertTrue(await pending, '接管成功');
    await new Promise(r => setTimeout(r, 150));
    this.assertTrue(b.isHeld('gm-hb-wait'), '接管后内部心跳应持续续期');
    b.release('gm-hb-wait');
}));
