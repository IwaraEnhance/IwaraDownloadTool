import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { getXVersion } from '../../src/network/xVersion.ts';

const xVersionTestGroup = new TestGroup('getXVersion', 'Iwara X-Version 请求签名测试');

xVersionTestGroup.add(new Test('输出 40 位小写 hex', 'async', async function () {
    const v = await getXVersion('https://api.iwara.tv/video/abc');
    this.assertEqual(v.length, 40);
    this.assertTrue(/^[0-9a-f]{40}$/.test(v));
}));

xVersionTestGroup.add(new Test('相同输入结果稳定', 'async', async function () {
    const v1 = await getXVersion('https://api.iwara.tv/video/abc?expires=12345');
    const v2 = await getXVersion('https://api.iwara.tv/video/abc?expires=12345');
    this.assertEqual(v1, v2);
}));

xVersionTestGroup.add(new Test('不同 expires 产生不同签名', 'async', async function () {
    const v1 = await getXVersion('https://api.iwara.tv/video/abc?expires=1');
    const v2 = await getXVersion('https://api.iwara.tv/video/abc?expires=2');
    this.assertNotEqual(v1, v2);
}));

xVersionTestGroup.add(new Test('已知预期值（回归保护）', 'async', async function () {
    this.assertEqual(await getXVersion('https://api.iwara.tv/video/abc'), 'd1a2b7f5a5c8d69ada943059fee61c12eba89b2d');
    this.assertEqual(await getXVersion('https://api.iwara.tv/video/abc?expires=12345'), 'f70b669136028bcb126d7f74c1691879d6113ff7');
    this.assertEqual(await getXVersion('https://api.iwara.tv/playlist/xyz?expires=999'), '555289c79636aaeaa4f551f8b7c939c3365a53d8');
}));
