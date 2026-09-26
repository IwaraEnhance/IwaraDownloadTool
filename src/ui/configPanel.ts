/**
 * 配置面板（configEdit + CONFIG_FIELDS schema；保存前环境校验经构造参数注入）。
 * schema 机制原样保留：渲染（pageChange）、回写（configChange）、显隐联动（dependsOn）均由表驱动。
 * save 按钮的环境校验经构造期注入（ui 不 import network）。
 */
import { Config, config } from '../core/config'
import { DownloadType } from '../core/enum'
import { renderNode } from '../core/extension'
import { originalNodeAppendChild } from '../core/hijack'
import { GM_KEY_IS_DEBUG, GM_KEY_IS_FIRST_RUN } from '../core/constants'
import { i18nList, type Language } from '../i18n'
import { BUILTIN_APPROVAL_CONDITIONS, getEnabledApprovalConditionIds, setEnabledApprovalConditionIds, getApprovalMode, setApprovalMode, type ApprovalMode } from '../core/approvalConditions'

/** 配置编辑 schema：声明每个配置项的渲染方式、分组、显隐条件与特殊行为。
 * 新增配置项只需在此数组加一行；渲染（pageChange）、回写（configChange）、
 * 显隐联动（dependsOn）均由本表驱动。 */
interface ConfigField {
    name: string
    type: 'switch' | 'text' | 'password' | 'number' | 'conditions' | 'approvalMode'
    /** 该字段出现在哪些标签页 */
    tabs: string[]
    /** 页内分组（同组渲染为一个 fieldset，缺省则直接平铺） */
    group?: string
    visible?: (target: Config) => boolean
    dependsOn?: string
    help?: { text: string; href: string }
    get?: (name: string, defaultValue?: any) => any
    onSet?: (target: Config, e: Event) => void
    defaultValue?: any
    rerender?: boolean
}

/** 标签页序：核心行为（常规/下载）→ 下载器配置（Aria2/iwaradl/MediaCenter 按 downloadType 显隐）→ 社交功能（好友请求）→ 高级（实验性/调试）固定最后 */
const TABS: { id: string; visible: (target: Config) => boolean }[] = [
    { id: 'general', visible: () => true },
    { id: 'download', visible: () => true },
    { id: 'aria2', visible: (target) => target.downloadType === DownloadType.Aria2 },
    { id: 'iwaradl', visible: (target) => target.downloadType === DownloadType.Iwaradl },
    { id: 'mediaCenter', visible: (target) => target.downloadType === DownloadType.Aria2 && target.experimentalFeatures },
    // 好友请求管理（一键审批 + 审批模式 + 审批条件 + 证据帖）独立页
    { id: 'friends', visible: () => true },
    // 高级页（实验性 / 调试）固定在最后
    { id: 'advanced', visible: () => true }
]

const CONFIG_FIELDS: ConfigField[] = [
    // 常规页：下载行为
    { name: 'checkPriority', type: 'switch', tabs: ['general'], group: 'download', rerender: true },
    { name: 'checkDownloadLink', type: 'switch', tabs: ['general'], group: 'download' },
    { name: 'autoDownloadMetadata', type: 'switch', tabs: ['general'], group: 'download' },
    { name: 'autoCopySaveFileName', type: 'switch', tabs: ['general'], group: 'download' },
    // 常规页：选择与关注
    { name: 'autoInjectCheckbox', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'autoFollow', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'autoLike', type: 'switch', tabs: ['general'], group: 'selection' },
    { name: 'filterLikedVideos', type: 'switch', tabs: ['general'], group: 'selection' },
    // 常规页：可见性
    {
        name: 'addUnlistedAndPrivate',
        type: 'switch',
        tabs: ['general'],
        group: 'visibility',
        onSet: (target, e) => {
            const checked = (e.target as HTMLInputElement).checked
            target.addUnlistedAndPrivate = checked
            if (checked) target.filterUnlistedAndPrivate = false
        }
    },
    {
        name: 'filterUnlistedAndPrivate',
        type: 'switch',
        tabs: ['general'],
        group: 'visibility',
        onSet: (target, e) => {
            const checked = (e.target as HTMLInputElement).checked
            target.filterUnlistedAndPrivate = checked
            if (checked) target.addUnlistedAndPrivate = false
        }
    },
    // 常规页：界面
    { name: 'autoCollapseMenu', type: 'switch', tabs: ['general'], group: 'interface' },
    { name: 'enableWidescreen', type: 'switch', tabs: ['general'], group: 'interface' },
    { name: 'enableBeautify', type: 'switch', tabs: ['general'], group: 'interface' },
    // 好友请求管理页（一键审批 + 审批模式 + 审批条件 + 证据帖）
    { name: 'friendRequestApprove', type: 'switch', tabs: ['friends'], group: 'friendRequest', rerender: true },
    { name: 'friendRequestApproveMode', type: 'approvalMode', tabs: ['friends'], group: 'friendRequest', dependsOn: 'friendRequestApprove' },
    { name: 'friendRequestApproveConditions', type: 'conditions', tabs: ['friends'], group: 'friendRequest', dependsOn: 'friendRequestApprove' },
    // 评论证据帖 ID（commentedForumThread 条件的证据源）；forumThread 的 URL 末段或纯 ID 皆可
    { name: 'friendApproveEvidenceThreadId', type: 'text', tabs: ['friends'], group: 'friendRequest', dependsOn: 'friendRequestApprove' },
    // 高级页（脚本自身行为与调试）
    { name: 'promoteScriptAuthor', type: 'switch', tabs: ['advanced'] },
    { name: 'experimentalFeatures', type: 'switch', tabs: ['advanced'], rerender: true },
    { name: 'enableUnsafeMode', type: 'switch', tabs: ['advanced'] },
    {
        name: 'isDebug',
        type: 'switch',
        tabs: ['advanced'],
        defaultValue: false,
        get: (name, defaultValue) => GM_getValue(name, defaultValue),
        onSet: (target, e) => {
            GM_setValue(GM_KEY_IS_DEBUG, (e.target as HTMLInputElement).checked)
            unsafeWindow.location.reload()
        }
    },
    // 下载页（下载画质在前，下载位置在后）
    { name: 'downloadPriority', type: 'text', tabs: ['download'], group: 'download', visible: (target) => target.checkPriority },
    { name: 'downloadPath', type: 'text', tabs: ['download'], group: 'download', help: { text: '%#variable#%', href: 'https://github.com/IwaraEnhance/IwaraDownloadTool/wiki/路径可用变量' } },
    { name: 'pathNormalize', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathReplaceEmojis', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathFoldMarks', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathSanitize', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathTruncate', type: 'switch', tabs: ['download'], group: 'pathNormalize' },
    { name: 'pathTitleMaxLength', type: 'number', tabs: ['download'], group: 'pathNormalize', dependsOn: 'pathTruncate' },
    { name: 'pathAliasMaxLength', type: 'number', tabs: ['download'], group: 'pathNormalize', dependsOn: 'pathTruncate' },
    // Aria2 页（标签页本身已按 downloadType 显隐）
    { name: 'aria2Path', type: 'text', tabs: ['aria2'], group: 'aria2' },
    { name: 'aria2Token', type: 'password', tabs: ['aria2'], group: 'aria2' },
    // 代理（Aria2 / iwaradl 页共用）
    { name: 'downloadProxy', type: 'text', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    { name: 'downloadProxyUsername', type: 'text', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    { name: 'downloadProxyPassword', type: 'password', tabs: ['aria2', 'iwaradl'], group: 'proxy' },
    // MediaCenter 页（标签页已含 downloadType + experimentalFeatures 条件）
    { name: 'mediaCenterApi', type: 'text', tabs: ['mediaCenter'], group: 'mediaCenter', help: { text: '%#mediaCenterInfo#%', href: 'https://github.com/dawn-lc/MediaCenter' } },
    { name: 'mediaCenterApiKey', type: 'password', tabs: ['mediaCenter'], group: 'mediaCenter' },
    // iwaradl 页
    { name: 'iwaradlPath', type: 'text', tabs: ['iwaradl'], group: 'iwaradl', help: { text: '%#iwaradlLink#%', href: 'https://github.com/Izumiko/iwaradl' } },
    { name: 'iwaradlToken', type: 'password', tabs: ['iwaradl'], group: 'iwaradl' }
]

export class configEdit {
    target: Config
    interface: HTMLDivElement
    tabButtons: HTMLDivElement
    tabPanels: HTMLDivElement
    activeTab = 'general'
    /** 保存前环境校验（main 组装期注入，ui 不 import network） */
    private verifyBeforeSave?: () => Promise<boolean>
    constructor(config: Config, verifyBeforeSave?: () => Promise<boolean>) {
        this.verifyBeforeSave = verifyBeforeSave
        this.target = config
        this.target.configChange = (item: string) => {
            this.configChange.call(this, item)
        }
        this.tabButtons = renderNode({
            nodeType: 'div',
            className: 'tabs'
        })
        this.tabPanels = renderNode({
            nodeType: 'div',
            className: 'tabPanels',
            childs: TABS.map((tab) => ({
                nodeType: 'div',
                className: 'tabPanel',
                attributes: {
                    'data-tab': tab.id
                }
            }))
        })

        let save = renderNode({
            nodeType: 'button',
            childs: '%#save#%',
            attributes: {
                title: i18nList[config.language].save
            },
            events: {
                click: async () => {
                    save.disabled = !save.disabled
                    if (this.verifyBeforeSave ? await this.verifyBeforeSave() : true) {
                        unsafeWindow.location.reload()
                    }
                    save.disabled = !save.disabled
                }
            }
        })
        let reset = renderNode({
            nodeType: 'button',
            childs: '%#reset#%',
            attributes: {
                title: i18nList[config.language].reset
            },
            events: {
                click: () => {
                    GM_setValue(GM_KEY_IS_FIRST_RUN, true)
                    unsafeWindow.location.reload()
                }
            }
        })
        this.interface = renderNode({
            nodeType: 'div',
            attributes: {
                id: 'pluginConfig'
            },
            childs: [
                {
                    nodeType: 'div',
                    className: 'main',
                    childs: [
                        {
                            nodeType: 'h2',
                            childs: '%#appName#%'
                        },
                        this.tabButtons,
                        this.tabPanels
                    ]
                },
                {
                    nodeType: 'p',
                    className: 'buttonList',
                    childs: [reset, save]
                }
            ]
        })
    }
    /** 按 schema 渲染单个配置项（switch 用开关，其余用输入框，带 help/dependsOn；conditions 用审批条件多选；approvalMode 用模式单选） */
    private renderField(field: ConfigField): Element {
        if (field.type === 'switch') {
            return this.switchButton(field.name, field.get, field.onSet ? (name, e) => field.onSet!(this.target, e) : undefined, field.defaultValue)
        }
        if (field.type === 'conditions') {
            return this.approvalConditionsField(field.name, field.dependsOn)
        }
        if (field.type === 'approvalMode') {
            return this.approvalModeField(field.name, field.dependsOn)
        }
        const help = field.help
            ? renderNode({
                nodeType: 'a',
                childs: field.help.text,
                className: 'rainbow-text',
                attributes: { style: 'float: inline-end;', href: field.help.href }
            })
            : undefined
        return this.inputComponent(field.name, field.type, help, undefined, undefined, field.dependsOn)
    }
    private switchButton(name: string, get?: (name: string, defaultValue?: any) => any, set?: (name: string, e: Event) => void, defaultValue?: boolean) {
        return renderNode({
            nodeType: 'p',
            className: 'inputRadioLine',
            childs: [
                {
                    nodeType: 'label',
                    childs: `%#${name}#%`,
                    attributes: {
                        for: name
                    }
                },
                {
                    nodeType: 'input',
                    className: 'switch',
                    attributes: {
                        type: 'checkbox',
                        name: name,
                        checked: get !== undefined ? get(name, defaultValue) : (this.target[name] ?? defaultValue ?? false)
                    },
                    events: {
                        change: (e: Event) => {
                            if (set !== undefined) {
                                set(name, e)
                                return
                            } else {
                                this.target[name] = (e.target as HTMLInputElement).checked
                            }
                        }
                    }
                }
            ]
        })
    }
    private inputComponent(name: string, type?: InputType, help?: HTMLElement, get?: (name: string) => void, set?: (name: string, e: Event) => void, dependsOn?: string) {
        return renderNode({
            nodeType: 'label',
            className: 'fieldLine',
            // dependsOn：声明本输入框由哪个开关控制显隐（关闭开关时隐藏，开启时显示）
            attributes: dependsOn ? { 'data-depends-on': dependsOn } : undefined,
            childs: [
                {
                    nodeType: 'span',
                    childs: [`%#${name}#%`, help]
                },
                {
                    nodeType: 'input',
                    attributes: {
                        name: name,
                        type: type ?? 'text',
                        value: get !== undefined ? get(name) : this.target[name]
                    },
                    events: {
                        change: (e: Event) => {
                            if (set !== undefined) {
                                set(name, e)
                                return
                            } else {
                                const input = e.target as HTMLInputElement
                                this.target[name] = input.type === 'number' ? Number(input.value) : input.value
                            }
                        }
                    }
                }
            ]
        })
    }
    /** 好友请求审批条件多选框：勾选项写入 GM 存储（跨页同步），多条件 OR 语义（任一满足即批准）。
     * 全不选时回退为 always（无条件批准），与后端 getEnabledApprovalConditionIds 的缺省一致 */
    private approvalConditionsField(name: string, dependsOn?: string) {
        const enabled = getEnabledApprovalConditionIds()
        return renderNode({
            nodeType: 'div',
            // ⚠️ renderNode 的字符串 className 不允许含空格（classList.add 抛 DOMException），多类名必须用数组
            className: ['fieldLine', 'conditionsField'],
            attributes: dependsOn ? { 'data-depends-on': dependsOn } : undefined,
            childs: [
                {
                    nodeType: 'span',
                    childs: `%#${name}#%`
                },
                {
                    nodeType: 'div',
                    className: 'conditionsList',
                    childs: BUILTIN_APPROVAL_CONDITIONS.map((condition) =>
                        renderNode({
                            nodeType: 'label',
                            className: 'conditionsItem',
                            childs: [
                                {
                                    nodeType: 'input',
                                    attributes: {
                                        type: 'checkbox',
                                        name: name,
                                        value: condition.id,
                                        checked: enabled.includes(condition.id)
                                    },
                                    events: {
                                        change: () => {
                                            // 从当前 DOM 勾选态重算启用列表（单一事实来源是 DOM）
                                            const checked = Array.from(this.interface.querySelectorAll<HTMLInputElement>(`.conditionsList input[name=${name}]:checked`)).map((i) => i.value)
                                            setEnabledApprovalConditionIds(checked.length > 0 ? checked : ['always'])
                                        }
                                    }
                                },
                                `%#approvalCondition_${condition.id}#%`
                            ]
                        })
                    )
                }
            ]
        })
    }
    /** 好友请求审批条件组合模式单选：any（任一满足即批准）/ all（全部满足才批准）。
     * 值写入 GM 存储跨页同步，与后端 getApprovalMode 缺省 any 一致 */
    private approvalModeField(name: string, dependsOn?: string) {
        const current = getApprovalMode()
        const modes: ApprovalMode[] = ['any', 'all']
        return renderNode({
            nodeType: 'div',
            className: ['fieldLine', 'conditionsField'],
            attributes: dependsOn ? { 'data-depends-on': dependsOn } : undefined,
            childs: [
                {
                    nodeType: 'span',
                    childs: `%#${name}#%`
                },
                {
                    nodeType: 'div',
                    className: 'conditionsList',
                    childs: modes.map((mode) =>
                        renderNode({
                            nodeType: 'label',
                            className: 'conditionsItem',
                            childs: [
                                {
                                    nodeType: 'input',
                                    attributes: {
                                        type: 'radio',
                                        name: name,
                                        value: mode,
                                        checked: current === mode
                                    },
                                    events: {
                                        change: (e: Event) => {
                                            const value = (e.target as HTMLInputElement).value
                                            if (value === 'all') setApprovalMode('all')
                                            else setApprovalMode('any')
                                        }
                                    }
                                },
                                `%#approvalMode_${mode}#%`
                            ]
                        })
                    )
                }
            ]
        })
    }
    private downloadTypeSelect() {
        return renderNode({
            nodeType: 'fieldset',
            className: 'downloadType',
            childs: [
                {
                    nodeType: 'div',
                    className: 'fieldTitle',
                    childs: '%#downloadType#%'
                },
                ...Object.keys(DownloadType)
                    .filter((i: any) => isNaN(Number(i)))
                    .map((type: string, index: number) =>
                        renderNode({
                            nodeType: 'label',
                            childs: [
                                {
                                    nodeType: 'input',
                                    attributes: {
                                        type: 'radio',
                                        name: 'downloadType',
                                        value: index,
                                        checked: index === Number(this.target.downloadType)
                                    },
                                    events: {
                                        change: (e) => {
                                            this.target.downloadType = Number((e.target as HTMLInputElement).value)
                                        }
                                    }
                                },
                                type
                            ]
                        })
                    )
            ]
        })
    }
    /** 根据依赖开关的当前状态，控制带 data-depends-on 的输入框显隐（关闭开关则隐藏其依赖输入框） */
    private updateVisibility() {
        this.interface.querySelectorAll<HTMLElement>('[data-depends-on]').forEach((element) => {
            const dependsOn = element.dataset.dependsOn
            if (dependsOn) element.style.display = this.target[dependsOn] ? '' : 'none'
        })
    }
    private configChange(item: string) {
        if (item === 'downloadType') {
            // 下载方式：同步 radio 选中态，重建标签页（不自动跳转，停留在当前页）
            this.interface.querySelectorAll<HTMLInputElement>('[name=downloadType]').forEach((radio) => {
                radio.checked = Number(radio.value) === Number(this.target.downloadType)
            })
            this.renderAllTabs()
            return
        }
        // 影响布局的字段（其 visible 条件变化）→ 重建标签页
        if (CONFIG_FIELDS.find((field) => field.name === item)?.rerender) {
            this.renderAllTabs()
            return
        }
        // conditions / approvalMode 类型（值存 GM 存储而非 Config，且多 input 共享 name）跳过单值同步
        const gmFieldType = CONFIG_FIELDS.find((field) => field.name === item)?.type
        if (gmFieldType === 'conditions' || gmFieldType === 'approvalMode') return
        // 普通字段：同步 DOM 值（覆盖互斥联动、跨页远程同步等非事件路径）
        const element = this.interface.querySelector<HTMLInputElement>(`[name=${item}]`)
        if (element) {
            if (element.type === 'checkbox') element.checked = this.target[item]
            else element.value = this.target[item]
        }
        // 刷新依赖显隐（开关切换即时控制其依赖输入框的显示/隐藏）
        this.updateVisibility()
    }
    /** 切换标签页：仅切换显示与激活态，不重建内容（避免丢失输入焦点） */
    private tabChange(tab: string) {
        this.activeTab = tab
        this.tabButtons.querySelectorAll<HTMLButtonElement>('button.tab').forEach((button) => {
            button.classList.toggle('active', button.dataset.tab === tab)
        })
        this.tabPanels.querySelectorAll<HTMLElement>('.tabPanel').forEach((panel) => {
            panel.style.display = panel.dataset.tab === tab ? '' : 'none'
        })
        this.scrollActiveTabIntoView(true)
        this.updateVisibility()
    }
    /** 激活标签滚入可视区：横向溢出时将其尽量横移到标签栏视觉中心（点击意图强化，
     * 比贴边的最小可见更自然，类似移动端 tab bar）。clamp 到可滚范围；不溢出则不动。
     * 只调 scrollLeft，不用 scrollIntoView——后者可能连带滚动纵向祖先容器 */
    private scrollActiveTabIntoView(smooth = false) {
        const button = this.tabButtons.querySelector<HTMLButtonElement>(`button.tab.active`)
        if (!button) return
        const max = this.tabButtons.scrollWidth - this.tabButtons.clientWidth
        if (max <= 0) return
        const target = button.offsetLeft + button.offsetWidth / 2 - this.tabButtons.clientWidth / 2
        const left = Math.max(0, Math.min(max, target))
        if (smooth) this.tabButtons.scrollTo({ left, behavior: 'smooth' })
        else this.tabButtons.scrollLeft = left
    }
    /** 重建标签栏与所有可见页内容（下载方式 / rerender 变化时调用） */
    private renderAllTabs() {
        // 当前激活页若已不再可见（如切换下载方式后下载器页消失），回退到常规页，避免所有面板都隐藏
        if (!TABS.find((tab) => tab.id === this.activeTab && tab.visible(this.target))) {
            this.activeTab = 'general'
        }
        // 标签栏：按条件显隐 + 激活态
        while (this.tabButtons.hasChildNodes()) {
            this.tabButtons.removeChild(this.tabButtons.firstChild!)
        }
        for (const tab of TABS) {
            if (!tab.visible(this.target)) continue
            originalNodeAppendChild.call(
                this.tabButtons,
                renderNode({
                    nodeType: 'button',
                    className: this.activeTab === tab.id ? ['tab', 'active'] : 'tab',
                    attributes: {
                        'data-tab': tab.id,
                        type: 'button'
                    },
                    childs: `%#${tab.id}Tab#%`,
                    events: {
                        click: () => {
                            this.tabChange(tab.id)
                        }
                    }
                })
            )
        }
        // 各页内容：按 tab 过滤 schema，再按 group 渲染为 fieldset（无 group 则平铺）
        for (const tab of TABS) {
            const panel = this.tabPanels.querySelector(`.tabPanel[data-tab=${tab.id}]`) as HTMLElement
            while (panel.hasChildNodes()) {
                panel.removeChild(panel.firstChild!)
            }
            if (!tab.visible(this.target)) {
                panel.style.display = 'none'
                continue
            }
            if (tab.id === 'general') {
                originalNodeAppendChild.call(
                    panel,
                    renderNode({
                        nodeType: 'label',
                        className: 'languageLine',
                        childs: [
                            '%#language#% ',
                            {
                                nodeType: 'input',
                                className: 'inputRadioLine',
                                attributes: {
                                    name: 'language',
                                    type: 'text',
                                    value: this.target.language
                                },
                                events: {
                                    change: (event: Event) => {
                                        this.target.language = (event.target as HTMLInputElement).value as Language
                                    }
                                }
                            }
                        ]
                    })
                )
                originalNodeAppendChild.call(panel, this.downloadTypeSelect())
            }
            const groups = new Map<string, ConfigField[]>()
            for (const field of CONFIG_FIELDS) {
                if (!field.tabs.includes(tab.id)) continue
                if (field.visible && !field.visible(this.target)) continue
                const key = field.group ?? '__flat__'
                const list = groups.get(key) ?? []
                list.push(field)
                groups.set(key, list)
            }
            for (const [group, fields] of groups) {
                if (group === '__flat__') {
                    fields.forEach((field) => originalNodeAppendChild.call(panel, this.renderField(field)))
                } else {
                    originalNodeAppendChild.call(
                        panel,
                        renderNode({
                            nodeType: 'fieldset',
                            childs: [
                                {
                                    nodeType: 'div',
                                    className: 'fieldTitle',
                                    childs: `%#${group}Group#%`
                                },
                                ...fields.map((field) => this.renderField(field))
                            ]
                        })
                    )
                }
            }
            panel.style.display = this.activeTab === tab.id ? '' : 'none'
        }
        // 动态渲染完成后应用初始显隐（依据当前开关状态）与激活标签可视性
        this.scrollActiveTabIntoView()
        this.updateVisibility()
    }
    public inject() {
        if (!unsafeWindow.document.querySelector('#pluginConfig')) {
            originalNodeAppendChild.call(unsafeWindow.document.body, this.interface)
            this.renderAllTabs()
        }
    }
}
