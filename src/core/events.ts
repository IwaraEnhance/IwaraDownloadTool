/**
 * 类型化事件总线（通知，不是命令）。
 *
 * 设计原则：
 * - **通知**（fire-and-forget、多订阅者、无返回值）走本总线；
 * - **动作**（有返回值、需确认结果）走构造期注入接口（MenuActions）或批量动作注册表（BatchAction）。
 *
 * 事件即"广播"：发送方不需要知道接收方是谁，接收方订阅自己关心的领域事件。
 * 替代 main.ts 中硬编码的三条回调链（selectList.onSet/onDel/onSync → updateButtonState/updateSelected），
 * 使 selection 的消费方（水印/复选框/菜单）彼此解耦。
 */

/** 全部领域事件类型表（新增事件在此声明，保持类型安全） */
export interface BusEvents {
    /** 页面切换（SPA 跳转 + 冷加载补发），payload 为解析后的页面类型与路径 */
    'page:change': { type: PageType; path: string }
    /** 选择列表变化（本页 set/delete/clear 或跨页同步）；videoId 仅在单键变更时有值 */
    'selection:changed': { size: number; videoId?: string }
    /** 登录令牌变化（localStorage token 变更/移除/清空） */
    'auth:token-changed': void
}

type PageType = string & {}

type EventName = keyof BusEvents
/** Unsubscribe 函数：调用后取消订阅 */
export type Unsubscribe = () => void

const listeners = new Map<EventName, Set<(payload: never) => void>>()

function listenersOf(name: EventName): Set<(payload: never) => void> {
    let set = listeners.get(name)
    if (!set) {
        set = new Set()
        listeners.set(name, set)
    }
    return set
}

/** 订阅事件；返回取消订阅函数（幂等安全） */
export function on<K extends EventName>(name: K, cb: (payload: BusEvents[K]) => void): Unsubscribe {
    const set = listenersOf(name)
    set.add(cb as (payload: never) => void)
    return () => set.delete(cb as (payload: never) => void)
}

/** 取消订阅（与 on 返回的 Unsubscribe 等价，用于具名清理） */
export function off<K extends EventName>(name: K, cb: (payload: BusEvents[K]) => void): void {
    listeners.get(name)?.delete(cb as (payload: never) => void)
}

/** 发布事件：同步通知所有订阅者；单个订阅者异常不影响其他订阅者（隔离） */
export function emit<K extends EventName>(name: K, payload: BusEvents[K]): void {
    const set = listeners.get(name)
    if (!set || set.size === 0) return
    // 拷贝一份，允许回调内安全地取消订阅（含自身）
    for (const cb of [...set]) {
        try {
            ; (cb as (p: BusEvents[K]) => void)(payload)
        } catch (error) {
            // 事件总线不吞业务，但也不让单个订阅者炸掉其他订阅者
            originalConsoleError(`[Events] subscriber error on '${String(name)}':`, error)
        }
    }
}

/** 测试支持：清空全部订阅（仅测试环境使用） */
export function clearBus(): void {
    listeners.clear()
}

function originalConsoleError(...args: unknown[]): void {
    // 避免依赖 core/log（log 依赖 hijack 的 originalConsole，此处保持 events 零依赖）
    // eslint-disable-next-line no-console
    console.error(...args)
}
