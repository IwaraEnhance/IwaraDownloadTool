import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { Version } from '../../src/class.ts';
import { VersionState } from '../../src/enum.ts';

const versionTestGroup = new TestGroup('Version 类', '语义化版本号解析与比较测试');

// ============ 版本解析 ============

versionTestGroup.add(new Test('解析完整版本号', 'async', function () {
    const v = new Version('1.2.3');
    this.assertEqual(v.major, 1);
    this.assertEqual(v.minor, 2);
    this.assertEqual(v.patch, 3);
    this.assertEqual(v.preRelease.length, 0);
    this.assertEqual(v.buildMetadata, '');
}));

versionTestGroup.add(new Test('解析带预发布版本', 'async', function () {
    const v = new Version('1.0.0-alpha');
    this.assertEqual(v.major, 1);
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['alpha']));
}));

versionTestGroup.add(new Test('解析带预发布和元数据', 'async', function () {
    const v = new Version('1.0.0-beta.2+sha.1234');
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['beta', '2']));
    this.assertEqual(v.buildMetadata, 'sha.1234');
}));

versionTestGroup.add(new Test('解析只有主版本号', 'async', function () {
    const v = new Version('1');
    this.assertEqual(v.major, 1);
    this.assertEqual(v.minor, 0);
    this.assertEqual(v.patch, 0);
}));

versionTestGroup.add(new Test('解析主次版本号', 'async', function () {
    const v = new Version('2.1');
    this.assertEqual(v.major, 2);
    this.assertEqual(v.minor, 1);
    this.assertEqual(v.patch, 0);
}));

versionTestGroup.add(new Test('解析多段预发布', 'async', function () {
    const v = new Version('2.0.0-rc.1.2.3');
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['rc', '1', '2', '3']));
}));

versionTestGroup.add(new Test('解析仅元数据', 'async', function () {
    const v = new Version('1.0.0+build2023');
    this.assertEqual(v.preRelease.length, 0);
    this.assertEqual(v.buildMetadata, 'build2023');
}));

versionTestGroup.add(new Test('空字符串抛错', 'async', function () {
    this.assertThrows(() => new Version(''));
}));

versionTestGroup.add(new Test('无效版本号抛错', 'async', function () {
    this.assertThrows(() => new Version('abc'));
    this.assertThrows(() => new Version('1.2.abc'));
}));

// ============ 版本比较 ============

versionTestGroup.add(new Test('相等版本', 'async', function () {
    const a = new Version('1.0.0');
    const b = new Version('1.0.0');
    this.assertEqual(a.compare(b), VersionState.Equal);
}));

versionTestGroup.add(new Test('主版本号更高', 'async', function () {
    const a = new Version('2.0.0');
    const b = new Version('1.0.0');
    this.assertEqual(a.compare(b), VersionState.High);
    this.assertEqual(b.compare(a), VersionState.Low);
}));

versionTestGroup.add(new Test('次版本号更高', 'async', function () {
    const a = new Version('1.1.0');
    const b = new Version('1.0.0');
    this.assertEqual(a.compare(b), VersionState.High);
}));

versionTestGroup.add(new Test('补丁版本号更高', 'async', function () {
    const a = new Version('1.0.2');
    const b = new Version('1.0.1');
    this.assertEqual(a.compare(b), VersionState.High);
}));

versionTestGroup.add(new Test('预发布版本低于正式版', 'async', function () {
    const a = new Version('1.0.0-alpha');
    const b = new Version('1.0.0');
    // SemVer: 有预发布 < 无预发布
    this.assertEqual(a.compare(b), VersionState.Low);
    this.assertEqual(b.compare(a), VersionState.High);
}));

versionTestGroup.add(new Test('预发布版本号比较 (数字)', 'async', function () {
    const a = new Version('1.0.0-beta.2');
    const b = new Version('1.0.0-beta.10');
    this.assertEqual(a.compare(b), VersionState.Low);
}));

versionTestGroup.add(new Test('预发布版本号比较 (字符串)', 'async', function () {
    const a = new Version('1.0.0-alpha');
    const b = new Version('1.0.0-beta');
    this.assertEqual(a.compare(b), VersionState.Low);
}));

versionTestGroup.add(new Test('预发布版本号混合比较', 'async', function () {
    const a = new Version('1.0.0-1');
    const b = new Version('1.0.0-alpha');
    // SemVer: 数字标识符 < 字母标识符
    this.assertEqual(a.compare(b), VersionState.Low);
}));

versionTestGroup.add(new Test('预发布不同长度', 'async', function () {
    const a = new Version('1.0.0-alpha');
    const b = new Version('1.0.0-alpha.1');
    this.assertEqual(a.compare(b), VersionState.Low);
}));

// ============ toString ============

versionTestGroup.add(new Test('toString 基本版本', 'async', function () {
    const v = new Version('1.2.3');
    this.assertEqual(v.toString(), '1.2.3');
}));

versionTestGroup.add(new Test('toString 带预发布', 'async', function () {
    const v = new Version('1.0.0-rc.1');
    this.assertEqual(v.toString(), '1.0.0-rc.1');
}));

versionTestGroup.add(new Test('toString 带构建元数据', 'async', function () {
    const v = new Version('1.0.0+sha.1234');
    this.assertEqual(v.toString(), '1.0.0+sha.1234');
}));

// ============ 更多边界 ============

versionTestGroup.add(new Test('大版本号', 'async', function () {
    const v = new Version('999.888.777');
    this.assertEqual(v.major, 999);
    this.assertEqual(v.minor, 888);
    this.assertEqual(v.patch, 777);
}));

versionTestGroup.add(new Test('零版本号', 'async', function () {
    const v = new Version('0.0.0');
    this.assertEqual(v.major, 0);
    this.assertEqual(v.minor, 0);
    this.assertEqual(v.patch, 0);
}));

versionTestGroup.add(new Test('预发布全是数字', 'async', function () {
    const v = new Version('1.0.0-123');
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['123']));
}));

versionTestGroup.add(new Test('预发布混合数字字母', 'async', function () {
    const v = new Version('2.0.0-rc1.beta2');
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['rc1', 'beta2']));
}));

versionTestGroup.add(new Test('预发布空段被保留', 'async', function () {
    const v = new Version('1.0.0-alpha..1');
    this.assertEqual(JSON.stringify(v.preRelease), JSON.stringify(['alpha', '', '1']));
}));

versionTestGroup.add(new Test('仅主版本号比较相等', 'async', function () {
    this.assertEqual(new Version('1').compare(new Version('1.0.0')), VersionState.Equal);
}));

versionTestGroup.add(new Test('更长预发布比较', 'async', function () {
    const a = new Version('1.0.0-aaa');
    const b = new Version('1.0.0-aaab');
    this.assertEqual(a.compare(b), VersionState.Low);
}));

export default versionTestGroup;
