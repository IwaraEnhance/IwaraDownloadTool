import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { config } from '../../src/core/config.ts';
import { checkIsHaveDownloadLink } from '../../src/download/linkCheck.ts';

const linkCheckTestGroup = new TestGroup('checkIsHaveDownloadLink', '评论下载链接检测测试');

linkCheckTestGroup.add(new Test('未启用检查时始终 false', 'async', function () {
    GM_deleteValue('checkDownloadLink');
    this.assertEqual(checkIsHaveDownloadLink('https://mega.nz/folder/abc'), false);
}));

linkCheckTestGroup.add(new Test('空/空值评论返回 false', 'async', function () {
    GM_setValue('checkDownloadLink', true);
    this.assertEqual(checkIsHaveDownloadLink(''), false);
    this.assertEqual(checkIsHaveDownloadLink(undefined as any), false);
    this.assertEqual(checkIsHaveDownloadLink(null as any), false);
}));

linkCheckTestGroup.add(new Test('检测已知网盘特征', 'async', function () {
    GM_setValue('checkDownloadLink', true);
    this.assertEqual(checkIsHaveDownloadLink('download: https://mega.nz/folder/xxx'), true);
    this.assertEqual(checkIsHaveDownloadLink('链接: https://pan.baidu.com/s/123'), true);
    this.assertEqual(checkIsHaveDownloadLink('Get it on mediafire.com now'), true);
    this.assertEqual(checkIsHaveDownloadLink('OneDrive: 1drv.ms share'), true);
}));

linkCheckTestGroup.add(new Test('大小写不敏感', 'async', function () {
    GM_setValue('checkDownloadLink', true);
    this.assertEqual(checkIsHaveDownloadLink('MEGA.NZ 网盘'), true);
}));

linkCheckTestGroup.add(new Test('普通评论返回 false', 'async', function () {
    GM_setValue('checkDownloadLink', true);
    this.assertEqual(checkIsHaveDownloadLink('just a normal comment, thanks for upload'), false);
    GM_deleteValue('checkDownloadLink');
}));
