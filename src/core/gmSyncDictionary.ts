import './env'
import { isNullOrUndefined, isVideoInfo } from './env'
import { Dictionary } from './dictionary'

export class GMSyncDictionary<T> extends Dictionary<T> {
    /** 当通过 set 或接收消息设置时触发 */
    public onSet?: (key: string, value: T) => void
    /** 当删除时触发 */
    public onDel?: (key: string) => void
    /** 完成初次或增量同步后触发 */
    public onSync?: () => void

    private name: string
    private listenerId: number | null = null
    private static readonly BATCH_THRESHOLD = 10

    /**
     * 构造函数
     * @param name 存储在GM_setValue中的键名
     * @param initial 初始值列表
     * @param validator 值校验器（默认校验 VideoInfo，可传入自定义校验以存储其他类型）
     */
    constructor(name: string, initial: Array<[string, T]> = [], validator: (value: unknown) => boolean = isVideoInfo) {
        let stored = initial.any() ? initial : GM_getValue(name, initial)
        try {
            super(stored.filter(([_, value]) => validator(value)))
        } catch (error) {
            super()
        }
        this.name = name
        this.saveToStorage()
        this.setupValueChangeListener()
    }

    /**
     * 设置GM值变化监听器
     */
    private setupValueChangeListener(): void {
        // 移除现有的监听器（如果有）
        if (this.listenerId !== null) {
            GM_removeValueChangeListener(this.listenerId)
        }
        this.listenerId = GM_addValueChangeListener(this.name, (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => {
            // 只有远程变化才需要处理（其他标签页的修改）
            if (key === this.name && remote) {
                this.handleRemoteChange(newValue as [string, T][])
            }
        })
    }

    /**
     * 处理远程变化
     * @param newValue 新的值
     */
    private handleRemoteChange(newValue: [string, T][]): void {
        if (isNullOrUndefined(newValue)) {
            // 如果新值为空，清空字典
            super.clear()
            this.onSync?.()
            return
        }
        const currentKeys = new Set(this.keys())
        const addedOrUpdated: Array<[string, T]> = []
        const deleted: string[] = []
        for (const [key, value] of newValue) {
            if (!currentKeys.has(key)) {
                addedOrUpdated.push([key, value])
            } else {
                const currentValue = this.get(key)
                if (currentValue !== value) {
                    addedOrUpdated.push([key, value])
                }
                currentKeys.delete(key)
            }
        }
        for (const key of currentKeys) {
            deleted.push(key)
        }
        const totalChanges = addedOrUpdated.length + deleted.length
        if (totalChanges > GMSyncDictionary.BATCH_THRESHOLD) {
            super.clear()
            for (const [key, value] of newValue) {
                super.set(key, value)
            }
            this.onSync?.()
        } else {
            for (const [key, value] of addedOrUpdated) {
                super.set(key, value)
                this.onSet?.(key, value)
            }
            for (const key of deleted) {
                super.delete(key)
                this.onDel?.(key)
            }
        }
    }

    /**
     * 保存当前字典到GM存储
     */
    private saveToStorage(): void {
        GM_setValue(this.name, this.toArray())
    }

    /**
     * 重写set方法：设置值并保存到GM存储
     */
    public override set(key: string, value: T): this {
        super.set(key, value)
        this.saveToStorage()
        this.onSet?.(key, value)
        return this
    }

    /**
     * 重写delete方法：删除值并保存到GM存储
     */
    public override delete(key: string): boolean {
        const result = super.delete(key)
        if (result) {
            this.saveToStorage()
            this.onDel?.(key)
        }
        return result
    }

    /**
     * 重写clear方法：清空字典并保存到GM存储
     */
    public override clear(): void {
        super.clear()
        this.saveToStorage()
        this.onSync?.()
    }

    /**
     * 获取值（从父类继承）
     */
    public override get(key: string): T | undefined {
        return super.get(key)
    }

    /**
     * 检查键是否存在（从父类继承）
     */
    public override has(key: string): boolean {
        return super.has(key)
    }

    /**
     * 获取字典大小（从父类继承）
     */
    public override get size(): number {
        return super.size
    }

    /**
     * 销毁监听器
     */
    public destroy(): void {
        if (this.listenerId !== null) {
            GM_removeValueChangeListener(this.listenerId)
            this.listenerId = null
        }
    }
}
