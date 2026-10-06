/**
 * 批量选择注册表（跨页同步 + 复选框 DOM 登记，任意批量操作的基础模块）。
 *
 * **设计语义（用户确认）**：本模块是「批量操作（各类）」的基础模块——跨页同步的
 * 选择集合（ID → VideoInfo）+ 页面复选框 DOM 登记表。下载只是它的第一个注册消费者；
 * 批量点赞/批量关注等未来能力经 features/selection 的 BatchAction 注册表接入。
 *
 * 原 main.ts 的 selectList/pageSelectButtons/getSelectButton/updateButtonState 迁移至此：
 * 状态唯一归属地，变更经 core/events 广播（selection:changed），消费方各自订阅自刷新。
 */
import { GMSyncDictionary } from '../core/gmSyncDictionary'
import { Dictionary } from '../core/dictionary'
import { GM_KEY_SELECT_LIST } from '../core/constants'
import { emit } from '../core/events'

/** 跨页同步的选择集合：videoId → 视频信息（VideoInfo 为批量动作的公共超集 payload） */
export const selectList = new GMSyncDictionary<VideoInfo>(GM_KEY_SELECT_LIST)

/** 页面复选框登记表：videoId → 复选框元素（ui 层注入时登记，卸载时注销） */
export const pageSelectButtons = new Dictionary<HTMLInputElement>()

/** 兼容旧名的导出别名（GMSyncDictionary 实例，迁移期使用；新代码请用 selection 语义理解） */
export const selection = selectList

/** 从 DOM 兜底查找选择按钮（登记表未命中时，如 React 重渲染后登记丢失） */
export function getSelectButton(id: string): HTMLInputElement | undefined {
    return pageSelectButtons.has(id) ? pageSelectButtons.get(id) : (unsafeWindow.document.querySelector(`input.selectButton[videoid="${id}"]`) as HTMLInputElement | undefined)
}

/** 把单个复选框的选中态同步为 selectList 的当前状态（原 main.ts updateButtonState） */
export function updateButtonState(videoID: string): void {
    const selectButton = getSelectButton(videoID)
    if (selectButton) selectButton.checked = selectList.has(videoID)
}

/** 接线：GMSyncDictionary 三个回调 → 广播 selection:changed 事件（原 main.ts 的 3 组回调链事件化） */
selectList.onSet = (key) => emit('selection:changed', { size: selectList.size, videoId: key })
selectList.onDel = (key) => emit('selection:changed', { size: selectList.size, videoId: key })
selectList.onSync = () => emit('selection:changed', { size: selectList.size })
