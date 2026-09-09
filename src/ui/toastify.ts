import { Dictionary } from '../core/dictionary'
import { debounce, isNullOrUndefined, UUID } from '../core/env'
export type Gravity = 'top' | 'bottom'
export type Position = 'left' | 'center' | 'right'
export type CloseReason = 'timeout' | 'close-button' | 'other'
export const activeToasts = new Dictionary<Toast>()
const toastTimeouts = new Map<Toast, number>()
const toastContainers = new Map<string, HTMLElement>()
const offscreenContainer = document.createElement('div')
offscreenContainer.classList.add('offscreen-container')
const camelToKebab = (str: string): string => str.replace(/([A-Z])/g, '-$1').toLowerCase()
// 自动显示进度条的最小持续时长(ms)：短提示转瞬即逝，进度条无意义；常驻提示(-1)不自动消失也不显示
const MIN_PROGRESS_DURATION = 3000
const getContainer = (gravity: Gravity, position: Position): HTMLElement => {
    const containerId = `toast-container-${gravity}-${position}`
    let container = toastContainers.get(containerId)
    if (isNullOrUndefined(container)) {
        container = document.createElement('div')
        container.id = containerId
        container.classList.add('toast-container', `toast-${gravity}`, `toast-${position}`)
        document.body.appendChild(container)
        toastContainers.set(containerId, container)
    }
    return container
}
const addTimeout = (toast: Toast, callback: () => void): void => {
    if (isNullOrUndefined(toast.options.duration)) return
    delTimeout(toast)
    const duration = toast.options.duration
    const timeoutId = window.setTimeout(() => {
        callback()
        delTimeout(toast)
    }, duration)
    toastTimeouts.set(toast, timeoutId)

    if (!toast.showProgress) return
    if (isNullOrUndefined(toast.progress)) return
    // 进度条由纯 CSS animation 驱动（替代 20ms setInterval 写 CSS 变量）
    // duration 变化或重新计时（mouseleave 恢复）时：移除动画 + 强制 reflow 后恢复，从头播放
    const progress = toast.progress
    progress.style.setProperty('--toast-duration', `${duration}ms`)
    progress.style.animation = 'none'
    void progress.offsetWidth
    progress.style.animation = ''
    progress.style.animationPlayState = 'running'
}
const delTimeout = (toast: Toast): void => {
    const timeoutId = toastTimeouts.get(toast)
    if (!isNullOrUndefined(timeoutId)) {
        clearTimeout(timeoutId)
        toastTimeouts.delete(toast)
    }
    if (!toast.showProgress) return
    // 暂停进度条动画（mouseover 暂停 / hide 时停止，不再需要 interval）
    if (!isNullOrUndefined(toast.progress)) {
        toast.progress.style.animationPlayState = 'paused'
    }
}
/** 交互式提示按钮：渲染在 toast 内容下方的一行按钮（与整个 toast 的 onClick 互斥） */
export interface ToastButton {
    /** 按钮文本（支持 %#i18nKey#% 占位符，newToast 会替换） */
    text: string
    /** 按钮附加类名（用于样式定制） */
    className?: string
    /** 点击回调：参数为所属 toast 实例，可调用 hide() 收起 */
    onClick: (toast: Toast) => void
}
export interface ToastOptions {
    id?: string
    root?: Element
    text?: string
    node?: Node
    duration?: number
    close?: boolean
    gravity?: Gravity
    position?: Position
    className?: string | string[]
    stopOnFocus?: boolean
    showProgress?: boolean
    /** 动画速度倍率（>1 变慢、<1 变快），通过 --toast-rate 缩放该 toast 的淡入淡出时长 */
    rate?: number
    onClose?: (this: Toast, e: CustomEvent<{ reason: CloseReason }>) => void
    onClick?: (this: Toast, e: MouseEvent) => void
    /** 交互式按钮行（与 onClick 互斥：提供后整个 toast 的 onClick 不生效，点击主体无行为） */
    buttons?: ToastButton[]
    style?: Partial<CSSStyleDeclaration>
    oldestFirst?: boolean
}
interface Options {
    id: string
    gravity: Gravity
    position: Position
    stopOnFocus: boolean
    oldestFirst: boolean
    showProgress: boolean
    rate: number
    text?: string
    node?: Node
    duration?: number
    close?: boolean
    className?: string | string[]
    onClose?: (this: Toast, e: CustomEvent<{ reason: CloseReason }>) => void
    onClick?: (this: Toast, e: MouseEvent) => void
    buttons?: ToastButton[]
    style?: Partial<CSSStyleDeclaration>
}
/**
 * Toast
 * @example
 * new Toast({ text: 'Hello World' }).show()
 */
export class Toast {
    private static readonly defaults: Omit<Options, 'id'> = {
        gravity: 'top',
        position: 'left',
        stopOnFocus: true,
        oldestFirst: true,
        showProgress: false,
        rate: 1
    }
    public id: string
    public options: Options
    public root: Element
    public element: HTMLElement
    public gravity: Gravity
    public position: Position
    public oldestFirst: boolean
    public stopOnFocus: boolean
    public showProgress: boolean
    public content?: HTMLDivElement
    public progress?: HTMLDivElement
    private mouseOverHandler?: () => void
    private mouseLeaveHandler?: () => void
    private closeButtonHandler?: () => void
    private animationEndHandler?: (e: TransitionEvent) => void
    private clickHandler?: (e: MouseEvent) => void
    private closeButton?: HTMLSpanElement
    private hidden = false
    /**
     * Create a Toastify instance
     * @param options User configuration options
     */
    constructor(options: ToastOptions) {
        // id 缺省时每次生成新 UUID（避免所有无 id 的 toast 共享 defaults 中的同一个 id）
        this.id = options.id ?? UUID()
        this.options = {
            ...Toast.defaults,
            ...options,
            id: this.id
        }
        // ── 参数互斥 ──
        // text 与 node 互斥：同时给出时 node 优先，text 忽略
        if (this.options.text && this.options.node) delete this.options.text
        // buttons 与 onClick 互斥：提供交互按钮时，整个 toast 的 onClick 不生效（点击主体无行为）
        if (this.options.buttons && this.options.buttons.length > 0) delete this.options.onClick
        this.root = getContainer(this.options.gravity, this.options.position)
        this.gravity = this.options.gravity
        this.position = this.options.position
        this.stopOnFocus = this.options.stopOnFocus
        this.oldestFirst = this.options.oldestFirst
        // showProgress 未显式指定时，仅在「会自动隐藏且持续时间足够长」的 toast 上显示进度条
        // 显式传 true/false 可覆盖此自动判定
        this.showProgress = options.showProgress ?? (!isNullOrUndefined(this.options.duration) && this.options.duration > 0 && this.options.duration >= MIN_PROGRESS_DURATION)
        this.element = document.createElement('div')
        // rate: 动画速度倍率（>1 变慢、<1 变快），通过 --toast-rate 缩放该 toast 的过渡时长
        if (this.options.rate !== 1) {
            this.element.style.setProperty('--toast-rate', String(this.options.rate))
        }
        this.applyBaseStyles().addCloseButton().createContent().ensureCloseMethod().bindEvents()
        activeToasts.set(this.id, this)
    }
    private applyBaseStyles(): this {
        this.element.classList.add('toast')
        if (this.options.className) {
            const classes = Array.isArray(this.options.className) ? this.options.className : [this.options.className]
            classes.forEach((cls) => this.element.classList.add(cls))
        }
        return this
    }
    private createContent(): this {
        this.content = document.createElement('div')
        this.content.classList.add('toast-content')
        if (this.options.text) {
            this.content.textContent = this.options.text
        }
        if (this.options.node) {
            this.content.appendChild(this.options.node)
        }
        if (this.options.style) {
            this.applyStyles(this.content, this.options.style)
        }
        if (this.showProgress) {
            this.progress = document.createElement('div')
            this.progress.classList.add('toast-progress')
            this.content.appendChild(this.progress)
        }
        if (this.options.buttons && this.options.buttons.length > 0) {
            // 交互式按钮行：渲染在内容末尾，点击按钮阻断冒泡（不触发整个 toast 的 onClick，运行时互斥保证）
            const buttonsRow = document.createElement('div')
            buttonsRow.classList.add('toast-buttons')
            for (const btn of this.options.buttons) {
                const button = document.createElement('button')
                button.textContent = btn.text
                if (btn.className) button.className = btn.className
                button.addEventListener('click', (e) => {
                    e.stopPropagation()
                    btn.onClick(this)
                })
                buttonsRow.appendChild(button)
            }
            this.content.appendChild(buttonsRow)
        }
        this.element.appendChild(this.content)
        return this
    }
    private addCloseButton(): this {
        if (this.options.close) {
            this.closeButton = document.createElement('span')
            this.closeButton.className = 'toast-close'
            this.closeButton.textContent = '🗙'
            this.closeButtonHandler = () => this.hide('close-button')
            this.closeButton.addEventListener('click', this.closeButtonHandler)
            this.element.appendChild(this.closeButton)
        }
        return this
    }
    public setToastRect(): this {
        // fix max-height cannot be automatically animated
        if (!this.element.classList.contains('show')) offscreenContainer.appendChild(this.element)
        this.element.style.removeProperty('--toast-height')
        this.element.style.removeProperty('--toast-width')
        this.element.style.setProperty('max-height', 'none', 'important')
        this.element.style.setProperty('max-width', `${this.root.getBoundingClientRect().width}px`, 'important')
        const { height, width } = this.element.getBoundingClientRect()
        this.element.style.setProperty('--toast-height', `${height}px`)
        this.element.style.setProperty('--toast-width', `${width}px`)
        this.element.style.removeProperty('max-height')
        this.element.style.removeProperty('max-width')
        if (!this.element.classList.contains('show')) offscreenContainer.removeChild(this.element)
        return this
    }
    private ensureCloseMethod(): this {
        // 有交互按钮时不自动补「点击主体隐藏」——按钮已承载交互，点击主体应无行为
        if (isNullOrUndefined(this.options.duration) && isNullOrUndefined(this.options.close) && isNullOrUndefined(this.options.onClick) && isNullOrUndefined(this.options.buttons)) {
            this.options.onClick = () => this.hide('other')
        }
        return this
    }
    private bindEvents(): this {
        if (this.stopOnFocus && !isNullOrUndefined(this.options.duration) && this.options.duration > 0) {
            this.mouseOverHandler = () => delTimeout(this)
            this.mouseLeaveHandler = () => addTimeout(this, () => this.hide('timeout'))
            this.element.addEventListener('mouseover', this.mouseOverHandler)
            this.element.addEventListener('mouseleave', this.mouseLeaveHandler)
        }
        if (!isNullOrUndefined(this.options.onClick)) {
            this.clickHandler = this.options.onClick.bind(this)
            this.element.addEventListener('click', this.clickHandler)
            // 有点击行为的 toast 才显示手型光标（CSS: .toast.clickable .toast-content）
            this.element.classList.add('clickable')
        }
        return this
    }
    private applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        for (const key in styles) {
            const value = styles[key]
            const property = camelToKebab(key)
            if (isNullOrUndefined(value)) {
                element.style.removeProperty(property)
                continue
            }
            const important = value.includes('!important')
            const cleanValue = value.replace(/\s*!important\s*/, '').trim()
            element.style.setProperty(property, cleanValue, important ? 'important' : '')
        }
    }
    private toggleAnimationState(animation: boolean): this {
        if (!this.element.classList.replace(animation ? 'hide' : 'show', animation ? 'show' : 'hide')) {
            this.element.classList.add(animation ? 'show' : 'hide')
        }
        return this
    }
    private insertToastElement(): this {
        if (this.oldestFirst) {
            this.root.insertBefore(this.element, this.root.firstChild)
        } else {
            this.root.appendChild(this.element)
        }
        return this
    }
    private setupAutoHide(): this {
        if (!isNullOrUndefined(this.options.duration) && this.options.duration > 0) {
            addTimeout(this, () => this.hide('timeout'))
        }
        return this
    }
    /**
     * Display the Toast notification
     * @returns this Instance for method chaining
     */
    public show(): this {
        this.setToastRect().insertToastElement()
        // 强制 reflow：让初始状态（opacity:0 / max-height:0）先被浏览器记录，再切换 .show 类，
        // transition 才能从初始值开始淡入（否则同帧插入+加类会直接跳到目标态，看不到淡入）
        void this.element.offsetWidth
        this.toggleAnimationState(true).setupAutoHide()
        return this
    }
    /**
     * @deprecated This function is deprecated. Use the show() instead.
     */
    public showToast() {
        return this.show()
    }
    private removeEventListeners(): this {
        if (this.mouseOverHandler) {
            this.element.removeEventListener('mouseover', this.mouseOverHandler)
        }
        if (this.mouseLeaveHandler) {
            this.element.removeEventListener('mouseleave', this.mouseLeaveHandler)
        }
        if (this.clickHandler) {
            this.element.removeEventListener('click', this.clickHandler)
        }
        if (this.options.close && this.closeButton && this.closeButtonHandler) {
            this.closeButton.removeEventListener('click', this.closeButtonHandler)
        }
        return this
    }
    /**
     * Hide the current Toast with optional close reason
     * @param reason The reason for closing (default: 'other')
     * Triggers a CSS exit animation and removes the element after the animation completes
     */
    public hide(reason: CloseReason = 'other'): void {
        // 幂等：重复 hide（如关闭按钮 click 冒泡 + onClick 同时触发）只执行一次，避免 onClose 重复调用
        if (this.hidden || !this.element) return
        this.hidden = true
        delTimeout(this)
        activeToasts.delete(this.id)
        let closed = false
        const finalize = () => {
            if (closed) return
            closed = true
            this.element.remove()
            this.options.onClose?.call(
                this,
                new CustomEvent('toast-close', {
                    detail: { reason }
                })
            )
        }
        // 淡出由 transition 驱动（max-height 收束到 0 时结束），监听 transitionend 后移除元素
        this.animationEndHandler = (e: TransitionEvent) => {
            if (e.propertyName !== 'max-height') return
            this.element.removeEventListener('transitionend', this.animationEndHandler!)
            finalize()
        }
        this.element.addEventListener('transitionend', this.animationEndHandler)
        // 兜底：transitionend 丢失（后台标签页/无高度变化/事件被抑制）时强制移除，避免元素残留
        // 时长读取计算样式的过渡时长（多值取最长）+ 300ms 余量，自适应不同淡出速度（如 toast-slow）
        const durations = getComputedStyle(this.element).transitionDuration
        const maxMs =
            durations
                .split(',')
                .map((s) => parseFloat(s))
                .filter(Number.isFinite)
                .reduce((max, sec) => Math.max(max, sec), 0) * 1000
        window.setTimeout(finalize, Math.max(maxMs, 300) + 300)
        this.removeEventListeners().toggleAnimationState(false)
    }
    /**
     * @deprecated This function is deprecated. Use the hide() instead.
     */
    public hideToast(): void {
        this.hide('other')
    }
}
function createToast(options: ToastOptions): Toast {
    return new Toast(options)
}
declare global {
    function Toast(options: ToastOptions): Toast
    /**
     * @deprecated This function is deprecated. Use the Toast() instead.
     */
    function Toastify(options: ToastOptions): Toast
}
globalThis.Toast = createToast
globalThis.Toastify = createToast
    ; (document.body ?? document.documentElement).appendChild(offscreenContainer)
window.addEventListener(
    'resize',
    debounce(() => {
        for (const [_, toast] of activeToasts) {
            toast.setToastRect()
        }
    }, 100)
)
