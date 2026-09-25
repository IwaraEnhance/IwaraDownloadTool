import { isNullOrUndefined } from './env'
import { createLogger } from './log'

const log = createLogger('InjectionWatcher')

/**
 * 页面注入规则：定义"什么时机、注入什么"。
 * 特性模块只需描述规则（页面判定 / 就绪判定 / DOM 标记 / 注入动作），
 * 监听与调度（渲染跟随、清除补种、防抖冷却）由本模块统一处理。
 */
export interface InjectionRule {
    /** 规则唯一 ID（日志与排查用，重复注册静默忽略） */
    id: string
    /** 是否激活（如读取配置开关；每次调度时重新求值，支持运行时切换） */
    enabled?: () => boolean
    /** 目标页面判定（调度线程内高频调用，必须幂等且只读） */
    isTargetPage: () => boolean
    /** 页面内容就绪判定：满足后才允许注入（如官方 React 列表已渲染）；缺省视为就绪 */
    isReady?: () => boolean
    /** 注入物根节点的 DOM 标记 selector（存在即视为已注入，也是补种依据） */
    markerSelector: string
    /** 注入动作（实现应自带防重复，允许异步） */
    inject: () => Promise<void> | void
    /** 补种防抖冷却（毫秒），默认 500；避开 React 渲染风暴期防止注入/清除循环 */
    cooldown?: number
}

/** 已注册规则表 */
const rules: InjectionRule[] = []
/** 各规则上次注入时间（补种冷却依据） */
const lastInjectAt = new Map<string, number>()
/** 常驻观察器单例：首个规则注册时启动，从头跟随站点 React 托管树 */
let observer: MutationObserver | undefined

/**
 * 注册注入规则并确保调度器已启动（模块加载即调用，重复注册同 id 静默忽略）。
 * 注册后会立即调度一次，覆盖"注册时页面已就绪"的场景（无需等待下一次 DOM 变更）。
 */
export function registerInjectionRule(rule: InjectionRule): void {
    if (rules.some((r) => r.id === rule.id)) return
    rules.push(rule)
    startObserver()
    queueMicrotask(dispatch)
}

/** 启动常驻观察器（单例；观察 document 的整棵子树） */
function startObserver(): void {
    if (!isNullOrUndefined(observer)) return
    observer = new MutationObserver(dispatch)
    // 观察对象必须是 document 而非 document.body：规则注册发生在模块加载阶段（document-start），
    // 此时 body 尚未由解析器创建（observe(null) 会抛错炸掉脚本）；监听 document 节点可覆盖 body 本身被插入的时刻
    observer.observe(unsafeWindow.document, { childList: true, subtree: true })
    log.debug('注入调度器已启动')
}

/**
 * 调度：遍历规则，对"已激活 + 在目标页 + 未注入 + 已就绪 + 过冷却期"的规则执行注入。
 * MutationObserver 回调本身按变更批次合并触发，无需额外防抖；单条规则异常不影响其他规则。
 */
function dispatch(): void {
    for (const rule of rules) {
        try {
            if (rule.enabled && !rule.enabled()) continue
            if (!rule.isTargetPage()) continue
            if (!isNullOrUndefined(unsafeWindow.document.querySelector(rule.markerSelector))) continue
            if (rule.isReady && !rule.isReady()) continue
            const cooldown = rule.cooldown ?? 500
            if (Date.now() - (lastInjectAt.get(rule.id) ?? 0) < cooldown) continue
            lastInjectAt.set(rule.id, Date.now())
            Promise.resolve(rule.inject()).catch((error) => log.warn(`规则 ${rule.id} 注入失败:`, error))
        } catch (error) {
            log.warn(`规则 ${rule.id} 调度异常:`, error)
        }
    }
}
