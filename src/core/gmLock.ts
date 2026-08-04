/**
 * GMLock —— 基于 GM 存储的跨页面租约锁（最后写入者胜出 + 动作前复核）
 *
 * 优雅之处：GM 存储没有“比较并交换”，但本锁并不需要它。调用方约定在每次执行
 * 关键动作前都用 renew()/isHeld() 基于存储重新复核持有权，因此：
 * - 无需监听器、无需写入后的消解等待、无需任何本地持有状态；
 * - 即使两个页面同时“抢占成功”，也只有最后写入者能通过后续的存储复核并执行
 *   动作，其余页面自然让位，保证任一时刻只有一个页面真正执行。
 *
 * - 防重复接管：抢占时若锁被他人持有且租约未过期则拒绝；只有持有者能 renew()
 *   续期，非持有者无法覆盖他人租约。
 * - 防未接管：租约（expires）超时后任何页面都能重新抢占；持有者周期性 renew()
 *   心跳续期，页面关闭/崩溃后租约自然过期，其他页面可接管。
 *
 * 依赖的 GM API：GM_getValue / GM_setValue / GM_listValues / GM_deleteValue。
 */

/** 锁值结构：存储在 GM 存储中 */
export interface GMLockValue {
    /** 持有者唯一标识（页面实例级，如 UUID） */
    owner: string;
    /** 租约到期时间戳（毫秒） */
    expires: number;
}

export class GMLock {
    /** GM 存储键前缀，便于 GM_listValues 遍历与清理 */
    private static readonly PREFIX = 'GMLock:';

    private readonly owner: string;

    /**
     * @param owner 持有者唯一标识（同一页面实例内应保持一致，如 UUID）
     */
    constructor(owner: string) {
        this.owner = owner;
    }

    private static key(name: string): string {
        return GMLock.PREFIX + name;
    }

    /**
     * 尝试获取锁（条件写入，最后写入者胜出）
     * @param name 锁名（跨页面共享的唯一标识，如 `aria2TrackManager`）
     * @param ttl  租约时长（毫秒）
     * @returns 抢占写入是否成功（注意：即使返回 true，执行关键动作前仍应调用
     *          isHeld()/renew() 基于存储复核，以消解并发竞争）
     */
    acquire(name: string, ttl: number): boolean {
        const key = GMLock.key(name);
        const now = Date.now();
        const current = GM_getValue<GMLockValue | undefined>(key);
        // 已被其他页面持有且租约未过期 → 抢占失败
        if (current && current.owner !== this.owner && current.expires > now) return false;
        // 空闲 / 租约过期 / 本页续期 → 写入抢占
        GM_setValue(key, { owner: this.owner, expires: now + ttl });
        return true;
    }

    /**
     * 心跳续期：仅当仍持有（存储校验）时延长租约，非持有者无法覆盖他人租约
     * @returns 是否仍持有（false 表示已失去，调用方应立即停止动作并让位）
     */
    renew(name: string, ttl: number): boolean {
        const key = GMLock.key(name);
        const current = GM_getValue<GMLockValue | undefined>(key);
        if (current?.owner !== this.owner) return false;
        GM_setValue(key, { owner: this.owner, expires: Date.now() + ttl });
        return true;
    }

    /** 是否仍持有该锁（基于存储校验，供执行关键动作前复核） */
    isHeld(name: string): boolean {
        const value = GM_getValue<GMLockValue | undefined>(GMLock.key(name));
        return !!value && value.owner === this.owner && value.expires > Date.now();
    }

    /** 释放锁（仅当仍由本页持有，避免误删他人锁） */
    release(name: string): void {
        const key = GMLock.key(name);
        if (GM_getValue<GMLockValue | undefined>(key)?.owner === this.owner) {
            GM_deleteValue(key);
        }
    }

    /** 清理所有已过期的锁（利用 GM_listValues 遍历全部 GM 键） */
    static pruneExpired(): void {
        const now = Date.now();
        for (const key of GM_listValues()) {
            if (!key.startsWith(GMLock.PREFIX)) continue;
            const value = GM_getValue<GMLockValue | undefined>(key);
            if (!value || value.expires <= now) GM_deleteValue(key);
        }
    }
}

