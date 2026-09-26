/**
 * 长作业进度域
 *
 * ProgressTracker：常驻进度报告的领域封装——底层是 core/notify 的 progress()
 * 句柄型报告（文本/进度条更新与收起都是报告通道的一等能力，DOM 全归 sink 侧
 * 的 Toast 组件；本模块不含任何节点构造）。
 *
 * BatchTaskRunner：收敛 GMLock 编排样板（抢锁/心跳/失去锁退出/冲突与等待提示），
 * 调用方只写 iterate 业务体（jitter、重试策略等参数差异留在调用方）。
 */
import { progress, report, type ReportHandle } from '../core/notify'
import { GMLock, GMLockTTL } from '../core/gmLock'
import { UUID } from '../core/env'

// ── 进度域 ──

/** 进度句柄：文本/确定性进度条更新与收起（未 start 时各方法自动 start） */
export interface ProgressTracker {
    /** 显示常驻进度（重复调用幂等） */
    start(): void
    /** 更新进度文本 */
    update(text: string): void
    /** 设置确定性进度条（0~1，任务完成占比；未提供 total 的作业不调用） */
    reportRatio(ratio: number): void
    /** 收起进度 */
    close(): void
}

/**
 * 创建进度域：内部维持一个常驻 progress 报告，update/reportRatio 原地刷新，close 收起。
 * 若 sink 未实现 progress()（理论上 main 注入的适配器已实现），退化为 info + onDismiss。
 */
/**
 * 创建进度域：懒建——首个带内容的 update/reportRatio 才创建常驻报告，
 * 避免 runBatchTask 预建的空文本 toast（原版进度 toast 也是首个 ctl.progress 才出现）。
 */
export function createProgressTracker(initialText: string): ProgressTracker {
    let handle: ReportHandle | undefined
    const ensure = (text?: string, ratio?: number): ReportHandle => {
        if (handle !== undefined) {
            if (text !== undefined) handle.update({ body: text })
            if (ratio !== undefined) handle.update({ progressRatio: ratio })
            return handle
        }
        const first: import('../core/notify').ReportOptions = { body: text ?? initialText, duration: -1, close: false }
        if (ratio !== undefined) first.progressRatio = ratio
        handle = progress(first)
        return handle
    }
    return {
        start: () => void ensure(),
        // 懒建：空文本的 update 视为占位，不创建常驻报告
        update: (text) => {
            if (text.isEmpty()) return
            ensure(text)
        },
        reportRatio: (ratio) => ensure(undefined, ratio),
        close: () => {
            handle?.dismiss()
            handle = undefined
        }
    }
}


// ── 批量作业模板 ──

/** 批量作业控制句柄（iterate 内使用） */
export interface BatchControl {
    /** 心跳由锁内部维护；iterate 循环顶部复核，false = 失去锁应立即让位 */
    isHeld(): boolean
    /** 更新进度文本（常驻 tracker） */
    progress(text: string): void
    /** 设置确定性进度条（done/total；仅迭代总数已知的批量作业使用） */
    progressRatio(done: number, total: number): void
    /** 收起进度 */
    progressEnd(): void
}

export interface BatchTaskOptions<T> {
    /** 跨页互斥锁名 */
    lockName: string
    /** 锁租约场景（GMLockTTL 场景枚举沿用） */
    ttl: GMLockTTL
    /** 冲突策略：'exit' → taskInProgress 提示后退出；'wait' → 常驻 waitingForLock 提示并挂起直到锁可用 */
    onConflict: 'exit' | 'wait'
    /** 业务体；返回 undefined 表示因冲突/失锁中途退出（正常返回值语义由调用方定义） */
    iterate: (ctl: BatchControl) => Promise<T | undefined>
}

/**
 * 批量作业模板方法：锁获取/心跳/失去锁提示退出/冲突与等待提示全部内聚；
 * - analyze（wait）：acquire 失败 → 常驻 %#waitingForLock#% → acquireWaitWithHeartbeat → 收起
 * - syncPages（exit）：acquire 失败 → %#taskInProgress#%（3s）→ 退出
 * - iterate 循环顶部 ctl.isHeld() 失锁时调用方 taskConflict() 后退出（runner 兜底收起进度与释放锁）
 * - 全部退出路径（正常/异常/失锁）保证 close + release
 */
export async function runBatchTask<T>(options: BatchTaskOptions<T>): Promise<T | undefined> {
    const lock = new GMLock(UUID())
    const tracker = createProgressTracker('')

    let acquired = lock.acquireWithHeartbeat(options.lockName, options.ttl)
    if (!acquired) {
        if (options.onConflict === 'exit') {
            report('warn', { body: '%#taskInProgress#%', duration: 3000, close: true })
            return undefined
        }
        // 常驻 waitingForLock 提示，挂起等锁，结束后收起
        const waiting = createProgressTracker('%#waitingForLock#%')
        waiting.start()
        try {
            acquired = await lock.acquireWaitWithHeartbeat(options.lockName, options.ttl)
        } finally {
            waiting.close()
        }
        if (!acquired) return undefined
    }

    try {
        return await options.iterate({
            isHeld: () => lock.isHeld(options.lockName),
            progress: (text) => tracker.update(text),
            progressRatio: (done, total) => tracker.reportRatio(total > 0 ? done / total : 0),
            progressEnd: () => tracker.close()
        })
    } finally {
        tracker.close()
        lock.release(options.lockName)
    }
}

/** 失去锁时的冲突提示（taskInProgress 3s toast） */
export function taskConflict(): void {
    report('warn', { body: '%#taskInProgress#%', duration: 3000, close: true })
}
