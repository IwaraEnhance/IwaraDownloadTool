import { UUID } from './env'
import { originalAddEventListener, originalRemoveEventListener } from './hijack'

/**
 * 跨页存在性通知（BroadcastChannel 单一通路）。
 *
 * 原实现用 GM_saveTab/GM_getTabs 统计管理器侧标签页，但这两个 API 仅
 * Tampermonkey/ScriptCat 提供，Violentmonkey 不支持。改为在频道内维护
 * pageId 集合：join 加入、leave 移除，集合只剩自身时触发 onLastPage。
 */
export class MultiPage {
    public readonly pageId: string
    public onLastPage?: () => void
    public onPageJoin?: (pageId: string) => void
    public onPageLeave?: (pageId: string) => void
    private readonly channel: BroadcastChannel
    /** 已发现的页面实例（含自身），最后页面判定依据 */
    private readonly pages = new Set<string>()
    private beforeUnloadHandler: () => void
    constructor() {
        this.pageId = UUID()
        this.pages.add(this.pageId)
        this.channel = new BroadcastChannel('page-status-channel')
        this.channel.onmessage = (event: MessageEvent<PageEvent>) => this.handleMessage(event.data)
        this.channel.postMessage({ type: 'join', id: this.pageId })
        this.beforeUnloadHandler = () => {
            this.channel.postMessage({ type: 'leave', id: this.pageId })
            originalRemoveEventListener.call(unsafeWindow.document, 'beforeunload', this.beforeUnloadHandler)
        }
        originalAddEventListener.call(unsafeWindow.document, 'beforeunload', this.beforeUnloadHandler)
    }
    public suicide() {
        this.channel.postMessage({ type: 'suicide', id: this.pageId })
    }
    private handleMessage(message: PageEvent) {
        switch (message.type) {
            case 'suicide':
                if (this.pageId !== message.id) unsafeWindow.close()
                break
            case 'join':
                this.pages.add(message.id)
                this.onPageJoin?.(message.id)
                break
            case 'leave':
                this.pages.delete(message.id)
                this.onPageLeave?.(message.id)
                if (this.pages.size <= 1) this.onLastPage?.()
                break
        }
    }
}
