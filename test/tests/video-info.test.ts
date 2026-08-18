import '../setup.ts'
import { Test, TestGroup } from '../framework.ts'
import { isVideoInfo, isInitVideoInfo, isFullVideoInfo, isPartialVideoInfo, isCacheVideoInfo, isFailVideoInfo, assertVideoInfoType } from '../../src/core/env.ts'

const videoInfoGroup = new TestGroup('VideoInfo 类型守卫', 'isVideoInfo 系列类型保护函数测试')

// ============ isInitVideoInfo ============

videoInfoGroup.add(
    new Test('isInitVideoInfo 有效对象', 'async', function () {
        const info = { Type: 'init' as const, ID: 'abc123' }
        this.assertTrue(isInitVideoInfo(info))
        this.assertTrue(isVideoInfo(info))
    })
)

videoInfoGroup.add(
    new Test('isInitVideoInfo 空 ID', 'async', function () {
        this.assertFalse(isInitVideoInfo({ Type: 'init' as const, ID: '' }))
        this.assertFalse(isInitVideoInfo({ Type: 'init' as const, ID: null as any }))
    })
)

videoInfoGroup.add(
    new Test('isInitVideoInfo 类型不匹配', 'async', function () {
        this.assertFalse(isInitVideoInfo({ Type: 'full', ID: 'abc' } as any))
        this.assertFalse(isInitVideoInfo({ Type: 'invalid' as any, ID: 'abc' }))
    })
)

videoInfoGroup.add(
    new Test('isInitVideoInfo null/undefined', 'async', function () {
        this.assertFalse(isInitVideoInfo(null as any))
        this.assertFalse(isInitVideoInfo(undefined as any))
    })
)

// ============ isFullVideoInfo ============

const makeFullVideoInfo = (overrides: any = {}) => ({
    Type: 'full',
    ID: 'video123',
    UploadTime: 1700000000,
    Title: 'Test Video',
    FileName: 'test_video.mp4',
    Size: 1024576,
    Tags: ['tag1', 'tag2'],
    Liked: true,
    Following: false,
    Friend: false,
    Author: 'TestAuthor',
    AuthorID: 'author123',
    Private: false,
    Unlisted: false,
    DownloadQuality: 'Source',
    External: false,
    DownloadUrl: 'https://example.com/video.mp4',
    RAW: {},
    ...overrides
})

videoInfoGroup.add(
    new Test('isFullVideoInfo 完整有效对象', 'async', function () {
        this.assertTrue(isFullVideoInfo(makeFullVideoInfo()))
        this.assertTrue(isVideoInfo(makeFullVideoInfo()))
    })
)

videoInfoGroup.add(
    new Test('isFullVideoInfo 类型不匹配', 'async', function () {
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Type: 'partial' })))
    })
)

videoInfoGroup.add(
    new Test('isFullVideoInfo 缺少必需字段', 'async', function () {
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Title: '' })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ FileName: '' })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Title: undefined })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Size: undefined })))
    })
)

videoInfoGroup.add(
    new Test('isFullVideoInfo 字段类型校验', 'async', function () {
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ UploadTime: 'string' as any })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Tags: 'not-array' as any })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ Liked: 'yes' as any })))
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ RAW: undefined })))
    })
)

videoInfoGroup.add(
    new Test('isFullVideoInfo 空 ID', 'async', function () {
        this.assertFalse(isFullVideoInfo(makeFullVideoInfo({ ID: '' })))
    })
)

// ============ isPartialVideoInfo ============

const makePartialVideoInfo = (overrides: any = {}) => ({
    Type: 'partial',
    ID: 'video456',
    UploadTime: 1700000000,
    Title: 'Partial Video',
    Tags: ['tag-a'],
    Liked: false,
    Author: 'PartialAuthor',
    AuthorID: 'author456',
    Private: true,
    Unlisted: false,
    External: false,
    RAW: {},
    ...overrides
})

videoInfoGroup.add(
    new Test('isPartialVideoInfo 有效对象', 'async', function () {
        this.assertTrue(isPartialVideoInfo(makePartialVideoInfo()))
        this.assertTrue(isVideoInfo(makePartialVideoInfo()))
    })
)

videoInfoGroup.add(
    new Test('isPartialVideoInfo 缺少可选字段仍有效', 'async', function () {
        // PartialVideoInfo 不要求 FileName/Size/DownloadUrl 等
        this.assertTrue(isPartialVideoInfo(makePartialVideoInfo()))
    })
)

videoInfoGroup.add(
    new Test('isPartialVideoInfo 类型不匹配', 'async', function () {
        this.assertFalse(isPartialVideoInfo(makePartialVideoInfo({ Type: 'full' })))
    })
)

videoInfoGroup.add(
    new Test('isPartialVideoInfo 必需字段校验', 'async', function () {
        this.assertFalse(isPartialVideoInfo(makePartialVideoInfo({ Title: '' })))
        this.assertFalse(isPartialVideoInfo(makePartialVideoInfo({ Author: '' })))
        this.assertFalse(isPartialVideoInfo(makePartialVideoInfo({ ID: '' })))
    })
)

// ============ isCacheVideoInfo ============

const makeCacheVideoInfo = (overrides: any = {}) => ({
    Type: 'cache',
    ID: 'cache789',
    RAW: {},
    ...overrides
})

videoInfoGroup.add(
    new Test('isCacheVideoInfo 有效对象', 'async', function () {
        this.assertTrue(isCacheVideoInfo(makeCacheVideoInfo()))
        this.assertTrue(isVideoInfo(makeCacheVideoInfo()))
    })
)

videoInfoGroup.add(
    new Test('isCacheVideoInfo 缺少 RAW', 'async', function () {
        this.assertFalse(isCacheVideoInfo(makeCacheVideoInfo({ RAW: undefined })))
    })
)

videoInfoGroup.add(
    new Test('isCacheVideoInfo 类型不匹配', 'async', function () {
        this.assertFalse(isCacheVideoInfo(makeCacheVideoInfo({ Type: 'init' })))
    })
)

// ============ isFailVideoInfo ============

const makeFailVideoInfo = (overrides: any = {}) => ({
    Type: 'fail',
    ID: 'fail000',
    ...overrides
})

videoInfoGroup.add(
    new Test('isFailVideoInfo 有效对象', 'async', function () {
        this.assertTrue(isFailVideoInfo(makeFailVideoInfo()))
        this.assertTrue(isVideoInfo(makeFailVideoInfo()))
    })
)

videoInfoGroup.add(
    new Test('isFailVideoInfo 空 ID', 'async', function () {
        this.assertFalse(isFailVideoInfo(makeFailVideoInfo({ ID: '' })))
    })
)

videoInfoGroup.add(
    new Test('isFailVideoInfo 类型不匹配', 'async', function () {
        this.assertFalse(isFailVideoInfo(makeFailVideoInfo({ Type: 'full' })))
    })
)

// ============ isVideoInfo (综合) ============

videoInfoGroup.add(
    new Test('isVideoInfo 识别所有有效类型', 'async', function () {
        this.assertTrue(isVideoInfo(makeFullVideoInfo()))
        this.assertTrue(isVideoInfo(makePartialVideoInfo()))
        this.assertTrue(isVideoInfo(makeCacheVideoInfo()))
        this.assertTrue(isVideoInfo(makeFailVideoInfo()))
        this.assertTrue(isVideoInfo({ Type: 'init', ID: 'init001' }))
    })
)

videoInfoGroup.add(
    new Test('isVideoInfo 拒绝无效对象', 'async', function () {
        this.assertFalse(isVideoInfo(null))
        this.assertFalse(isVideoInfo(undefined))
        this.assertFalse(isVideoInfo('string'))
        this.assertFalse(isVideoInfo(42))
        this.assertFalse(isVideoInfo({ Type: 'unknown' as any, ID: 'test' }))
        this.assertFalse(isVideoInfo({}))
    })
)

// ============ assertVideoInfoType ============

videoInfoGroup.add(
    new Test('assertVideoInfoType 返回正确类型', 'async', function () {
        const init = assertVideoInfoType({ Type: 'init' as const, ID: 'i1' })
        this.assertEqual(init.Type, 'init')

        const full = assertVideoInfoType(makeFullVideoInfo()) as FullVideoInfo
        this.assertEqual(full.Type, 'full')
        this.assertEqual(full.Title, 'Test Video')

        const fail = assertVideoInfoType({ Type: 'fail' as const, ID: 'f1' })
        this.assertEqual(fail.Type, 'fail')
    })
)

videoInfoGroup.add(
    new Test('assertVideoInfoType 未知类型抛错', 'async', function () {
        this.assertThrows(() => assertVideoInfoType({ Type: 'invalid' as any, ID: 'x' }))
        this.assertThrows(() => assertVideoInfoType({ Type: '' as any, ID: 'x' }))
    })
)

export default videoInfoGroup
