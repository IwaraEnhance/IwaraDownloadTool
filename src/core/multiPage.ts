import { UUID } from './env'
import { originalAddEventListener, originalRemoveEventListener } from './hijack'

export class MultiPage {
    public readonly pageId: string
    public onLastPage?: () => void
    public onPageJoin?: (pageId: string) => void
    public onPageLeave?: (pageId: string) => void
    private readonly channel: BroadcastChannel
    private beforeUnloadHandler: () => void
    constructor() {
        this.pageId = UUID()
        GM_saveTab({ id: this.pageId })
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
                this.onPageJoin?.(message.id)
                break
            case 'leave':
                this.onPageLeave?.(message.id)
                GM_getTabs((tabs) => {
                    if (Object.keys(tabs).length > 1) return
                    this.onLastPage?.()
                })
                break
        }
    }
}
