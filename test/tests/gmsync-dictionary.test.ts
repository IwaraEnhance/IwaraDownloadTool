import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { GMSyncDictionary } from '../../src/core/gmSyncDictionary.ts';

const gmsyncTestGroup = new TestGroup('GMSyncDictionary', 'GM 存储同步字典本地操作测试');

gmsyncTestGroup.add(new Test('构造读取初始值', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-construct', [['a', 'va'], ['b', 'vb']], (v): v is string => typeof v === 'string');
    this.assertEqual(d.get('a'), 'va');
    this.assertEqual(d.size, 2);
}));

gmsyncTestGroup.add(new Test('set 触发 onSet 并可读回', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-set', [], (v): v is string => typeof v === 'string');
    let called: [string, string] | undefined;
    d.onSet = (key, value) => { called = [key, value] };
    d.set('x', 'vx');
    this.assertEqual(d.get('x'), 'vx');
    this.assertEqual(JSON.stringify(called), JSON.stringify(['x', 'vx']));
}));

gmsyncTestGroup.add(new Test('delete 触发 onDel', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-del', [['a', 'va']], (v): v is string => typeof v === 'string');
    let called: string | undefined;
    d.onDel = (key) => { called = key };
    this.assertEqual(d.delete('a'), true);
    this.assertEqual(d.has('a'), false);
    this.assertEqual(called, 'a');
}));

gmsyncTestGroup.add(new Test('delete 不存在的键不触发 onDel', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-delmiss', [], (v): v is string => typeof v === 'string');
    let called = false;
    d.onDel = () => { called = true };
    this.assertEqual(d.delete('nope'), false);
    this.assertEqual(called, false);
}));

gmsyncTestGroup.add(new Test('clear 触发 onSync 并清空', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-clear', [['a', 'va']], (v): v is string => typeof v === 'string');
    let called = false;
    d.onSync = () => { called = true };
    d.clear();
    this.assertEqual(d.size, 0);
    this.assertEqual(called, true);
}));

gmsyncTestGroup.add(new Test('validator 过滤非法初始值', 'async', function () {
    const d = new GMSyncDictionary<number>('gmsync-t-valid', [['a', 1], ['b', 'bad']] as any, (v): v is number => typeof v === 'number');
    this.assertEqual(d.has('a'), true);
    this.assertEqual(d.has('b'), false);
    this.assertEqual(d.size, 1);
}));

gmsyncTestGroup.add(new Test('GM 值变化监听器：注册/触发/移除', 'async', function () {
    GM_deleteValue('gm-listen-t1');
    const calls: any[] = [];
    const id = GM_addValueChangeListener('gm-listen-t1', (name, oldValue, newValue, remote) => { calls.push({ name, oldValue, newValue, remote }); });
    GM_setValue('gm-listen-t1', 'v1'); // 本地修改：remote=false，oldValue=undefined
    this.assertEqual(calls.length, 1);
    this.assertEqual(calls[0].name, 'gm-listen-t1');
    this.assertEqual(calls[0].oldValue, undefined);
    this.assertEqual(calls[0].newValue, 'v1');
    this.assertEqual(calls[0].remote, false);
    GM_setValue('gm-listen-t1', 'v2'); // 本地修改：oldValue=v1
    this.assertEqual(calls.length, 2);
    this.assertEqual(calls[1].oldValue, 'v1');
    this.assertEqual(calls[1].newValue, 'v2');
    (globalThis as any).__GM_simulateRemoteChange('gm-listen-t1', 'v3'); // 远程修改：remote=true
    this.assertEqual(calls.length, 3);
    this.assertEqual(calls[2].oldValue, 'v2');
    this.assertEqual(calls[2].newValue, 'v3');
    this.assertEqual(calls[2].remote, true);
    GM_removeValueChangeListener(id);
    GM_setValue('gm-listen-t1', 'v4'); // 已移除，不再触发
    this.assertEqual(calls.length, 3);
    GM_deleteValue('gm-listen-t1');
}));

gmsyncTestGroup.add(new Test('远程变化触发跨页同步', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-remote', [], (v): v is string => typeof v === 'string');
    let onSetKey: string | undefined;
    let onSetValue: string | undefined;
    d.onSet = (key, value) => { onSetKey = key; onSetValue = value; };
    (globalThis as any).__GM_simulateRemoteChange('gmsync-t-remote', [['r1', 'vr1']]);
    this.assertEqual(d.get('r1'), 'vr1');
    this.assertEqual(onSetKey, 'r1');
    this.assertEqual(onSetValue, 'vr1');
    // 远程清空（newValue 为 null）触发 onSync
    let synced = false;
    d.onSync = () => { synced = true; };
    (globalThis as any).__GM_simulateRemoteChange('gmsync-t-remote', null);
    this.assertEqual(d.size, 0);
    this.assertEqual(synced, true);
    GM_deleteValue('gmsync-t-remote');
}));

gmsyncTestGroup.add(new Test('本地 set 不触发远程处理（无自循环）', 'async', function () {
    const d = new GMSyncDictionary<string>('gmsync-t-local', [], (v): v is string => typeof v === 'string');
    let onSetCount = 0;
    d.onSet = () => { onSetCount++; };
    d.set('a', 'v1');
    d.set('b', 'v2');
    this.assertEqual(onSetCount, 2); // 本地 set 直接触发 onSet，且监听器回调（remote=false）不会再次处理
    this.assertEqual(d.size, 2);
    GM_deleteValue('gmsync-t-local');
}));
