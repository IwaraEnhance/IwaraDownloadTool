/**
 * 平台钩子层
 *
 * installPlatformHooks()：幂等安装 7 组 monkey-patch，把平台事件
 * 转为总线事件/订阅回调；main 只调用安装，不再持有劫持实现。
 *
 * 订阅接口（onNodeAdded/onNodeRemoved/onHistoryChange/onTokenChange）：main 在组装期
 * 注册业务回调（selection 注入、pageChange 流水线、auth 刷新），实现
 * 订阅接口（onNodeAdded/onNodeRemoved/onHistoryChange/onTokenChange）：main 在组装期
 */
import { emit } from './events'
import { getPageType } from './browserEnv'
import { LS_KEY_TOKEN } from './constants'
import {
    originalAddEventListener,
    originalNodeAppendChild,
    originalNodeRemoveChild,
    originalElementRemove,
    originalHistoryPushState,
    originalHistoryReplaceState,
    originalStorageSetItem,
    originalStorageRemoveItem,
    originalStorageClear
} from './hijack'

export type Unsubscribe = () => void

/** 已安装标志（幂等） */
let installed = false

/** 各钩子的订阅回调表（install 前注册的回调在 install 后生效） */
const nodeAddedCbs: Array<(n: Node) => void> = []
const nodeRemovedCbs: Array<(n: Node) => void> = []
const historyChangeCbs: Array<() => void> = []
const tokenChangeCbs: Array<() => void> = []

/** 订阅辅助：push + 返回退订句柄 */
function subscribe<T>(list: T[], cb: T): Unsubscribe {
    list.push(cb)
    return () => {
        const idx = list.indexOf(cb)
        if (idx >= 0) list.splice(idx, 1)
    }
}

/**
 * 安装平台钩子（幂等；幂等语义：重复调用直接返回，已挂的回调保持有效）
 * hijackAddEventListener 本身不产生事件，仅还原站点的 addEventListener 突变——保持原行为
 */
export function installPlatformHooks(options: { watchNodeAppend: boolean } = { watchNodeAppend: true }): void {
    if (installed) return
    installed = true

    // addEventListener 防站点覆写（原 hijackAddEventListener）
    unsafeWindow.EventTarget.prototype.addEventListener = function (type, listener, options) {
        originalAddEventListener.call(this, type, listener, options)
    }

    if (options.watchNodeAppend) {
        Node.prototype.appendChild = function <T extends Node>(node: T): T {
            if (node instanceof HTMLElement && node.classList.contains('videoTeaser')) {
                nodeAddedCbs.forEach((cb) => cb(node))
            }
            return originalNodeAppendChild.call(this, node) as T
        }
    }
    Node.prototype.removeChild = function <T extends Node>(child: T): T {
        nodeRemovedCbs.forEach((cb) => cb(child))
        return originalNodeRemoveChild.apply(this, [child]) as T
    }
    Element.prototype.remove = function () {
        nodeRemovedCbs.forEach((cb) => cb(this))
        return originalElementRemove.apply(this)
    }
    unsafeWindow.history.pushState = function (...args) {
        originalHistoryPushState.apply(this, args)
        emit('page:change', { type: getPageType(), path: unsafeWindow.location.pathname })
        historyChangeCbs.forEach((cb) => cb())
    }
    unsafeWindow.history.replaceState = function (...args) {
        originalHistoryReplaceState.apply(this, args)
        emit('page:change', { type: getPageType(), path: unsafeWindow.location.pathname })
        historyChangeCbs.forEach((cb) => cb())
    }
    unsafeWindow.Storage.prototype.setItem = function (key, value) {
        originalStorageSetItem.call(this, key, value)
        if (key === LS_KEY_TOKEN) {
            emit('auth:token-changed', undefined)
            tokenChangeCbs.forEach((cb) => cb())
        }
    }
    unsafeWindow.Storage.prototype.removeItem = function (key) {
        originalStorageRemoveItem.call(this, key)
        if (key === LS_KEY_TOKEN) {
            emit('auth:token-changed', undefined)
            tokenChangeCbs.forEach((cb) => cb())
        }
    }
    unsafeWindow.Storage.prototype.clear = function () {
        originalStorageClear.call(this)
        emit('auth:token-changed', undefined)
        tokenChangeCbs.forEach((cb) => cb())
    }
}

/** 订阅节点插入（.videoTeaser 卡片 → selection 注入勾选框） */
export function onNodeAdded(cb: (n: Node) => void): Unsubscribe {
    return subscribe(nodeAddedCbs, cb)
}

/** 订阅节点移除（卡片卸载 → 清理复选框登记） */
export function onNodeRemoved(cb: (n: Node) => void): Unsubscribe {
    return subscribe(nodeRemovedCbs, cb)
}

/** 订阅历史栈变化（pushState/replaceState → pageChange 流水线） */
export function onHistoryChange(cb: () => void): Unsubscribe {
    return subscribe(historyChangeCbs, cb)
}

/** 订阅登录令牌变化（LS_KEY_TOKEN 写删 → 菜单刷新） */
export function onTokenChange(cb: () => void): Unsubscribe {
    return subscribe(tokenChangeCbs, cb)
}
