import "./env";
import { prune, UUID } from "./env";
import { Dictionary } from "./dictionary";

export class SyncDictionary<T> extends Dictionary<T> {
    /** 当通过 set 或接收消息设置时触发 */
    public onSet?: (key: string, value: T) => void;
    /** 当删除时触发 */
    public onDel?: (key: string) => void;
    /** 完成初次或增量同步后触发 */
    public onSync?: () => void;

    public timestamp: number;
    public lifetime: number;
    private id: string;
    private channel: BroadcastChannel;

    /**
     * @param channelName 通信通道，同一名称标签页间同步
     * @param initial 初始纯值列表，会附加当前时戳
     */
    constructor(channelName: string, initial: Array<[string, T]> = []) {
        const hasInitial = prune(initial).any();
        super(hasInitial ? initial : undefined);
        this.timestamp = hasInitial ? Date.now() : 0;
        this.lifetime = hasInitial ? performance.now() : 0;
        this.id = UUID();
        this.channel = new BroadcastChannel(channelName);
        this.channel.onmessage = ({ data: msg }: { data: Message<T> }) => this.handleMessage(msg);
        this.channel.postMessage({ type: 'sync', id: this.id, timestamp: this.timestamp, lifetime: this.lifetime });
    }
    private setTimestamp(timestamp?: number) {
        this.timestamp = timestamp ?? Date.now();
        this.lifetime = performance.now();
    }
    /**
     * 重写：设置值并广播，同时记录时间戳
     */
    public override set(key: string, value: T): this {
        this.setTimestamp()
        super.set(key, value);
        this.channel.postMessage({ type: 'set', key, value, timestamp: this.timestamp, lifetime: this.lifetime, id: this.id });
        this.onSet?.(key, value);
        return this;
    }
    /**
     * 重写：删除并广播，同时记录时间戳
     */
    public override delete(key: string): boolean {
        this.setTimestamp()
        const existed = super.delete(key);
        if (existed) {
            this.onDel?.(key);
            this.channel.postMessage({ type: 'delete', key, timestamp: this.timestamp, lifetime: this.lifetime, id: this.id });
        }
        return existed;
    }
    /**
     * 重写：清空并广播，同时记录时间戳
     */
    public override clear(): void {
        this.setTimestamp()
        super.clear();
        this.channel.postMessage({ timestamp: this.timestamp, lifetime: this.lifetime, id: this.id, type: 'state', state: super.toArray() });
        this.onSync?.();
    }
    /**
     * 处理同步消息
     */
    private handleMessage(msg: Message<T>) {
        if (msg.id === this.id) return;
        if (msg.type === 'sync') {
            this.channel.postMessage({ timestamp: this.timestamp, lifetime: this.lifetime, id: this.id, type: 'state', state: super.toArray() });
            return;
        }
        if (msg.timestamp === this.timestamp && msg.lifetime === this.lifetime) return;
        if (msg.timestamp < this.timestamp || msg.lifetime < this.lifetime) return;
        switch (msg.type) {
            case 'state': {
                super.clear();
                for (let index = 0; index < msg.state.length; index++) {
                    const [key, value] = msg.state[index];
                    super.set(key, value);
                }
                this.setTimestamp(msg.timestamp);
                this.onSync?.();
                break;
            }
            case 'set': {
                const { key, value } = msg;
                super.set(key, value);
                this.setTimestamp(msg.timestamp);
                this.onSet?.(key, value);
                break;
            }
            case 'delete': {
                const { key } = msg;
                if (super.delete(key)) {
                    this.setTimestamp(msg.timestamp);
                    this.onDel?.(key);
                }
                break;
            }
        }
    }

    /**
     * 关闭底层 BroadcastChannel，释放跨页通信资源。
     * 幂等：多次调用安全；关闭后实例不应再使用。
     * 浏览器中页面卸载会自动清理，但 Node 测试环境必须显式关闭，
     * 否则未关闭的 BroadcastChannel 会保持事件循环活跃导致进程无法退出。
     */
    public close(): void {
        this.channel.close();
    }
}
