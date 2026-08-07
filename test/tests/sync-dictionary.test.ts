import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { SyncDictionary } from '../../src/core/class.ts';
import { delay } from '../../src/core/env.ts';

const syncTestGroup = new TestGroup('SyncDictionary', 'BroadcastChannel 跨实例同步测试');

syncTestGroup.add(new Test('set 同步到同通道另一实例', 'async', async function () {
    const a = new SyncDictionary<string>('sync-t1', []);
    const b = new SyncDictionary<string>('sync-t1', []);
    let received: string | undefined;
    b.onSet = (key, value) => { received = value };
    a.set('k', 'v1');
    await delay(50);
    this.assertEqual(b.get('k'), 'v1');
    this.assertEqual(received, 'v1');
    a.close();
    b.close();
}));

syncTestGroup.add(new Test('delete 同步到另一实例', 'async', async function () {
    const a = new SyncDictionary<string>('sync-t2', [['k', 'v']]);
    const b = new SyncDictionary<string>('sync-t2', []);
    await delay(50); // 等初始 state 握手同步
    a.delete('k');
    await delay(50);
    this.assertEqual(b.has('k'), false);
    a.close();
    b.close();
}));

syncTestGroup.add(new Test('不同通道互不影响', 'async', async function () {
    const a = new SyncDictionary<string>('sync-t3a', []);
    const b = new SyncDictionary<string>('sync-t3b', []);
    a.set('k', 'v1');
    await delay(50);
    this.assertEqual(b.has('k'), false);
    a.close();
    b.close();
}));
