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
