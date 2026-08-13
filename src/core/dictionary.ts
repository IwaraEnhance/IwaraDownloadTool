/**
 * 字典类
 * 扩展原生Map，提供更方便的转换方法
 * @template T 值类型
 */
export class Dictionary<T> extends Map<string, T> {
    constructor(data: Array<[string, T]> = []) {
        // 不用 super(data) 填充：Map 构造器内部通过 this.set() 添加元素，
        // 若子类 override 了 set（如 SyncDictionary），会在子类自身字段
        // （如 channel）初始化前被调用而崩溃。改用 super.set() 直接填充。
        super()
        for (const [key, value] of data) {
            super.set(key, value)
        }
    }
    public toArray(): Array<[string, T]> {
        return Array.from(this)
    }
    public keysArray(): Array<string> {
        return Array.from(this.keys())
    }
    public valuesArray(): Array<T> {
        return Array.from(this.values())
    }
}
