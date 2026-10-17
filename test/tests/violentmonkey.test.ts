import { Test, TestGroup } from '../framework.ts'
import { Path } from '../../src/core/path.ts'
import { getGMDownloadName } from '../../src/download/downloadPath.ts'

const vmTestGroup = new TestGroup('Violentmonkey 兼容', 'GM_download 文件名适配')

const gmInfo = GM_info as unknown as { scriptHandler: string; downloadMode?: 'native' | 'browser' }
const original = { scriptHandler: gmInfo.scriptHandler, downloadMode: gmInfo.downloadMode }

/** 在指定管理器/下载模式下执行断言，结束后还原 GM_info（isViolentmonkey 每次调用现读） */
function withManager(scriptHandler: string, downloadMode: 'native' | 'browser' | undefined, fn: () => void): void {
    gmInfo.scriptHandler = scriptHandler
    gmInfo.downloadMode = downloadMode
    try {
        fn()
    } finally {
        gmInfo.scriptHandler = original.scriptHandler
        gmInfo.downloadMode = original.downloadMode
    }
}

vmTestGroup.add(
    new Test('Tampermonkey 保持绝对路径/子目录不变', 'async', function () {
        const path = new Path('/Iwara/Author/Title[abc].mp4')
        withManager('Tampermonkey', undefined, () => {
            this.assertEqual(getGMDownloadName(path), '/Iwara/Author/Title[abc].mp4')
        })
    })
)

vmTestGroup.add(
    new Test('ScriptCat 保持绝对路径/子目录不变', 'async', function () {
        const path = new Path('/Iwara/Author/Title[abc].mp4')
        withManager('ScriptCat', undefined, () => {
            this.assertEqual(getGMDownloadName(path), '/Iwara/Author/Title[abc].mp4')
        })
    })
)

vmTestGroup.add(
    new Test('Violentmonkey browser 模式：去根前缀、保留相对子目录', 'async', function () {
        const path = new Path('/Iwara/Author/Title[abc].mp4')
        withManager('Violentmonkey', 'browser', () => {
            this.assertEqual(getGMDownloadName(path), 'Iwara/Author/Title[abc].mp4')
        })
    })
)

vmTestGroup.add(
    new Test('Violentmonkey browser 模式：Windows 绝对路径转 Downloads 相对路径', 'async', function () {
        const path = new Path('D:\\Videos\\Iwara\\Title[abc].mp4')
        withManager('Violentmonkey', 'browser', () => {
            this.assertEqual(getGMDownloadName(path), 'Videos\\Iwara\\Title[abc].mp4')
        })
    })
)

vmTestGroup.add(
    new Test('Violentmonkey native 模式：退化为纯文件名', 'async', function () {
        const path = new Path('/Iwara/Author/Title[abc].mp4')
        withManager('Violentmonkey', 'native', () => {
            this.assertEqual(getGMDownloadName(path), 'Title[abc].mp4')
        })
    })
)

vmTestGroup.add(
    new Test('Violentmonkey 旧版（无 downloadMode）：按 native 处理', 'async', function () {
        const path = new Path('/Iwara/Author/Title[abc].mp4')
        withManager('Violentmonkey', undefined, () => {
            this.assertEqual(getGMDownloadName(path), 'Title[abc].mp4')
        })
    })
)
