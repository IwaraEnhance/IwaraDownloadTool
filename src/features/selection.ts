/**
 * 批量选择编排（Space 键勾选 + BatchAction 批量动作注册表）。
 *
 * selection 是「批量操作（各类）」的基础模块（状态在 context/selection），
 * 本模块拥有它的 UI 编排：Space 键勾选、批量动作注册表、页面复选框注入的调度。
 *
 * 批量动作经注册表解耦：ui/menu 只渲染 getBatchActions()，
 * 业务方（download-flow 等）registerBatchAction 注册——菜单不再与任何具体业务编译期绑定。
 */
import { PageType } from '../core/enum'
import { selectList } from '../context/selection'
import { isNullOrUndefined } from '../core/env'
import { findElement } from '../core/extension'
import { originalAddEventListener } from '../core/hijack'

/** 批量动作定义：一个"对选中集合执行的操作"（下载/批量点赞/批量关注…） */
export interface BatchAction {
    /** 唯一 ID（同时用作 i18n 键与菜单按钮标识） */
    id: string
    /** i18n 键（缺省同 id；`%#id#%` 占位符机制渲染） */
    labelKey?: string
    /** 显隐条件（返回 false 的页面类型不渲染按钮；缺省=所有有选择框的页面） */
    visible?: (ctx: { pageType: PageType }) => boolean
    /**
     * 执行：直接读取 selectList 活引用（context/selection 导入），不做快照交付。
     * 根源守则：任务表与选中列表必须同源（活引用），任何「快照隔离」交付都会切断
     * 去重/完成删除的写透链 → 选中残留。需要隔离时动作内部自建副本并自行负责同步。 */
    run: () => void | Promise<void>
}

/** 注册表（插入序保持；同名重复注册覆盖） */
const batchActions = new Map<string, BatchAction>()

/** 注册批量动作（业务方在模块顶层或 init 时调用；重复 id 覆盖并可发现冲突） */
export function registerBatchAction(action: BatchAction): void {
    if (batchActions.has(action.id)) console.warn(`[Selection] BatchAction id conflict: ${action.id} (overwritten)`)
    batchActions.set(action.id, action)
}

/** 读取全部已注册动作（菜单按此渲染，只读） */
export function getBatchActions(): BatchAction[] {
    return [...batchActions.values()]
}

/** 全选/全不选本页复选框（原 menu.selectAll） */
export function selectAll(checked: boolean): void {
    unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
        const button = element as HTMLInputElement
        button.checked !== checked && button.click()
    })
}

/** 反选本页复选框（原 menu.toggleSelect） */
export function toggleSelect(): void {
    unsafeWindow.document.querySelectorAll('.selectButton').forEach((element) => {
        ; (element as HTMLInputElement).click()
    })
}

/** 数据驱动取消全选：逐个 delete 触发 GMSyncDictionary 事件链（onDel → 按钮态同步 + 跨页广播） */
export function deselectAll(): void {
    for (const id of selectList.keys()) {
        selectList.delete(id)
    }
}

/** 悬停目标跟踪 + Space 键勾选当前悬停的视频卡片（原 main.ts 的 mouseTarget/keydown 逻辑） */
let mouseTarget: Element | null = null

/** 安装悬停跟踪与 Space 快捷键（main 组装时调用一次） */
export function installSelectionShortcuts(): void {
    originalAddEventListener('mouseover', (event: Event) => {
        mouseTarget = (event as MouseEvent).target instanceof Element ? ((event as MouseEvent).target as Element) : null
    })
    originalAddEventListener('keydown', (event: Event) => {
        const keyboardEvent = event as KeyboardEvent
        if (keyboardEvent.code === 'Space' && !isNullOrUndefined(mouseTarget)) {
            let element = findElement(mouseTarget, '.videoTeaser')
            let button = element && (element.matches('.selectButton') ? element : element.querySelector('.selectButton'))
            button && (button as HTMLInputElement).click()
            button && keyboardEvent.preventDefault()
        }
    })
}
