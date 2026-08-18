import '../setup.ts'
import { Test, TestGroup } from '../framework.ts'
import { Config } from '../../src/core/config.ts'

const configTestGroup = new TestGroup('Config 类', '配置默认值与行为测试')

configTestGroup.add(
    new Test('默认值', 'async', function () {
        Config.destroyInstance()
        const c = new Config() as any
        this.assertEqual(c.downloadPriority, 'Source')
        this.assertEqual(c.autoInjectCheckbox, true)
        this.assertEqual(c.checkPriority, true)
        this.assertEqual(c.downloadType, 3) // Others
        this.assertEqual(c.downloadPath, '/Iwara/%#AUTHOR#%/%#TITLE#%[%#ID#%].mp4')
        this.assertEqual(c.aria2Path, 'http://127.0.0.1:6800/jsonrpc')
        this.assertEqual(c.priority['Source'], 100)
        this.assertEqual(c.priority['preview'], 1)
        this.assertEqual(c.language, 'zh')
        // 路径规范化开关与长度默认值
        this.assertEqual(c.pathNormalize, true)
        this.assertEqual(c.pathReplaceEmojis, true)
        this.assertEqual(c.pathFoldMarks, true)
        this.assertEqual(c.pathSanitize, true)
        this.assertEqual(c.pathTruncate, true)
        this.assertEqual(c.pathTitleMaxLength, 72)
        this.assertEqual(c.pathAliasMaxLength, 64)
    })
)

configTestGroup.add(
    new Test('getInstance 单例', 'async', function () {
        Config.destroyInstance()
        const a = Config.getInstance()
        const b = Config.getInstance()
        this.assertEqual(a === b, true)
        Config.destroyInstance()
    })
)

configTestGroup.add(
    new Test('destroyInstance 后重新创建', 'async', function () {
        Config.destroyInstance()
        const a = Config.getInstance()
        Config.destroyInstance()
        const b = Config.getInstance()
        this.assertEqual(a === b, false)
        Config.destroyInstance()
    })
)

configTestGroup.add(
    new Test('initInstance 合并配置并覆盖默认值', 'async', function () {
        Config.destroyInstance()
        Config.initInstance({ downloadPriority: '1080p', downloadType: 2 } as any)
        const c = Config.getInstance()
        this.assertEqual(c.downloadPriority, '1080p')
        this.assertEqual(c.downloadType, 2)
        this.assertEqual(c.autoInjectCheckbox, true) // 未覆盖属性仍用默认值
        Config.destroyInstance()
        GM_deleteValue('downloadPriority')
        GM_deleteValue('downloadType')
    })
)

configTestGroup.add(
    new Test('设置属性触发 configChange 回调', 'async', function () {
        Config.destroyInstance()
        const c = new Config() as any
        const changed: string[] = []
        c.configChange = (name: string) => {
            changed.push(name)
        }
        c.downloadPriority = '540'
        c.enableWidescreen = true
        this.assertEqual(JSON.stringify(changed), JSON.stringify(['downloadPriority', 'enableWidescreen']))
        GM_deleteValue('downloadPriority')
        GM_deleteValue('enableWidescreen')
    })
)

configTestGroup.add(
    new Test('远程修改触发 configChange', 'async', function () {
        Config.destroyInstance()
        const c = new Config() as any
        const changed: string[] = []
        c.configChange = (name: string) => {
            changed.push(name)
        }
        ;(globalThis as any).__GM_simulateRemoteChange('downloadPriority', '720p')
        this.assertTrue(changed.includes('downloadPriority'))
        this.assertEqual(c.downloadPriority, '720p')
        Config.destroyInstance()
        GM_deleteValue('downloadPriority')
    })
)
