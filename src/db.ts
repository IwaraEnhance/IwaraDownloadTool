import "./env";
import { isNullOrUndefined } from "./env"
import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';

// 数据库模式定义
interface IwaraDownloadToolDB extends DBSchema {
    follows: {
        key: string;
        value: Iwara.User;
        indexes: {
            'id': string;
            'username': string;
            'name': string;
            'friend': string;
            'following': string;
            'followedBy': string;
        };
    };
    friends: {
        key: string;
        value: Iwara.User;
        indexes: {
            'id': string;
            'username': string;
            'name': string;
            'friend': string;
            'following': string;
            'followedBy': string;
        };
    };
    videos: {
        key: string;
        value: VideoInfo;
        indexes: {
            'ID': string;
            'UploadTime': string;
            'Private': string;
            'Unlisted': string;
            'Type': string;
        };
    };
    idmap: {
        key: string;
        value: { ID: string, href: string };
        indexes: {
            'ID': string;
        };
    };
}

export class Database {
    private static instance: Database;
    private dbPromise: Promise<IDBPDatabase<IwaraDownloadToolDB>>;

    private constructor() {
        this.dbPromise = openDB<IwaraDownloadToolDB>('IwaraDownloadTool', 22, {
            upgrade(db, oldVersion, newVersion, transaction) {
                if (!db.objectStoreNames.contains('follows')) {
                    const followsStore = db.createObjectStore('follows', { keyPath: 'id' });
                    followsStore.createIndex('id', 'id', { unique: true });
                    followsStore.createIndex('username', 'username', { unique: true });
                    followsStore.createIndex('name', 'name');
                    followsStore.createIndex('friend', 'friend');
                    followsStore.createIndex('following', 'following');
                    followsStore.createIndex('followedBy', 'followedBy');
                }

                // 检查并创建 friends 表（如果不存在）
                if (!db.objectStoreNames.contains('friends')) {
                    const friendsStore = db.createObjectStore('friends', { keyPath: 'id' });
                    friendsStore.createIndex('id', 'id', { unique: true });
                    friendsStore.createIndex('username', 'username', { unique: true });
                    friendsStore.createIndex('name', 'name');
                    friendsStore.createIndex('friend', 'friend');
                    friendsStore.createIndex('following', 'following');
                    friendsStore.createIndex('followedBy', 'followedBy');
                }

                // 检查并创建 videos 表（如果不存在）
                if (!db.objectStoreNames.contains('videos')) {
                    const videosStore = db.createObjectStore('videos', { keyPath: 'ID' });
                    videosStore.createIndex('ID', 'ID', { unique: true });
                    videosStore.createIndex('UploadTime', 'UploadTime');
                    videosStore.createIndex('Private', 'Private');
                    videosStore.createIndex('Unlisted', 'Unlisted');
                    videosStore.createIndex('Type', 'Type');
                }

                // 检查并创建 idmap 表（如果不存在）
                if (!db.objectStoreNames.contains('idmap')) {
                    const idmapStore = db.createObjectStore('idmap', { keyPath: 'ID' });
                    idmapStore.createIndex('ID', 'ID', { unique: true });
                }

                // 删除旧版 caches 表（v20 → v21），缓存数据会重新生成
                if (oldVersion < 21 && db.objectStoreNames.contains('caches' as any)) {
                    db.deleteObjectStore('caches' as any);
                }
                // 删除旧版 pairs 表（v21 → v22），缓存数据会重新生成
                if (oldVersion < 22 && db.objectStoreNames.contains('pairs' as any)) {
                    db.deleteObjectStore('pairs' as any);
                }
            }
        });
    }

    // 获取数据库实例
    private async getDB(): Promise<IDBPDatabase<IwaraDownloadToolDB>> {
        return this.dbPromise;
    }

    // follows 表操作
    public async follows() {
        const db = await this.getDB();
        return db.transaction('follows', 'readwrite').objectStore('follows');
    }

    // friends 表操作
    public async friends() {
        const db = await this.getDB();
        return db.transaction('friends', 'readwrite').objectStore('friends');
    }

    // videos 表操作
    public async videos() {
        const db = await this.getDB();
        return db.transaction('videos', 'readwrite').objectStore('videos');
    }

    // idmap 表操作
    public async idmap() {
        const db = await this.getDB();
        return db.transaction('idmap', 'readwrite').objectStore('idmap');
    }

    // 便捷方法：获取 follows 表中的数据
    public async getFollows() {
        const store = await this.follows();
        return store.getAll();
    }

    // 便捷方法：获取 friends 表中的数据
    public async getFriends() {
        const store = await this.friends();
        return store.getAll();
    }

    // 便捷方法：获取 videos 表中的数据
    public async getVideos() {
        const store = await this.videos();
        return store.getAll();
    }

    // 便捷方法：获取 idmap 表中的数据
    public async getIdmap() {
        const store = await this.idmap();
        return store.getAll();
    }

    // 根据用户名获取 follow 信息
    public async getFollowByUsername(username: string): Promise<Iwara.User | undefined> {
        const db = await this.getDB();
        const tx = db.transaction('follows', 'readonly');
        const index = tx.store.index('username');
        return index.get(username);
    }

    // 根据用户ID获取 follow 信息
    public async getFollowById(id: string): Promise<Iwara.User | undefined> {
        const db = await this.getDB();
        return db.get('follows', id);
    }

    // 根据 ID 获取视频信息
    public async getVideoById(id: string): Promise<VideoInfo | undefined> {
        const db = await this.getDB();
        return db.get('videos', id);
    }

    // 批量获取视频信息
    public async getVideosByIds(ids: string[]): Promise<VideoInfo[]> {
        const db = await this.getDB();
        const tx = db.transaction('videos', 'readonly');
        const store = tx.store;

        const results: VideoInfo[] = [];
        for (const id of ids) {
            const video = await store.get(id);
            if (video) {
                results.push(video);
            }
        }
        return results;
    }

    /**
     * 统计 videos 表中符合条件的记录数（单事务游标，无 yield，线程安全）
     */
    public async countVideos(predicate?: (video: VideoInfo) => boolean): Promise<number> {
        const db = await this.getDB();
        const tx = db.transaction('videos', 'readonly');
        const store = tx.store;
        let cursor = await store.openCursor();
        let count = 0;
        while (cursor) {
            if (!predicate || predicate(cursor.value as VideoInfo)) count++;
            cursor = await cursor.continue();
        }
        return count;
    }

    /**
     * 按批次迭代 videos 表，每批次使用独立事务，防止事务因 yield 自动提交
     * @param batchSize 每批次记录数，默认 500
     * @param predicate 可选过滤回调
     * @param sortBy 可选排序字段——使用数据库中已存在的索引名，如 'UploadTime'；未指定时按主键 ID 排序
     * @yields VideoInfo[] 每批次的记录数组
     *
     * @example
     * // 按 UploadTime 升序遍历
     * for await (const batch of db.iterateVideosBatched(200, undefined, 'UploadTime')) { ... }
     *
     * @example
     * // 按 UploadTime 降序遍历（利用游标方向）
     * for await (const batch of db.iterateVideosBatched(200, undefined, 'UploadTime', 'prev')) { ... }
     */
    public async *iterateVideosBatched(
        batchSize: number = 500,
        predicate?: (video: VideoInfo) => boolean,
        sortBy?: 'UploadTime' | 'ID',
        direction: IDBCursorDirection = 'next',
    ): AsyncGenerator<VideoInfo[], void, void> {
        // 用于分页游标：同时记住 indexKey 和 primaryKey，以处理索引值重复的情况
        let lastIndexKey: any = undefined;
        let lastPrimaryKey: any = undefined;
        let hasMore = true;

        while (hasMore) {
            const db = await this.getDB();
            const tx = db.transaction('videos', 'readonly');
            const store = tx.store;
            const source = sortBy ? store.index(sortBy) : store;

            let cursor: any;

            if (lastIndexKey !== undefined) {
                if (direction === 'prev') {
                    // 降序：用 upperBound 包含当前 key，然后跳过已处理过的记录
                    const range = IDBKeyRange.upperBound(lastIndexKey, false);
                    cursor = await source.openCursor(range, direction);
                    // 跳过所有已处理过的记录（索引键相同且主键 >= 上一批最后一条的主键）
                    while (cursor && cursor.key === lastIndexKey && cursor.primaryKey >= lastPrimaryKey) {
                        cursor = await cursor.continue();
                    }
                } else {
                    // 升序：用 lowerBound 包含当前 key，然后跳过已处理过的记录
                    const range = IDBKeyRange.lowerBound(lastIndexKey, false);
                    cursor = await source.openCursor(range, direction);
                    // 跳过所有已处理过的记录（索引键相同且主键 <= 上一批最后一条的主键）
                    while (cursor && cursor.key === lastIndexKey && cursor.primaryKey <= lastPrimaryKey) {
                        cursor = await cursor.continue();
                    }
                }
            } else {
                cursor = await source.openCursor(null, direction);
            }

            const batch: VideoInfo[] = [];
            while (cursor && batch.length < batchSize) {
                const video = cursor.value as VideoInfo;
                if (!predicate || predicate(video)) {
                    batch.push(video);
                }
                lastIndexKey = cursor.key;
                lastPrimaryKey = cursor.primaryKey;
                cursor = await cursor.continue();
            }

            hasMore = cursor !== null;
            // 事务在此 yield 后安全自动提交
            yield batch;
        }
    }

    /**
     * 按批次仅迭代 videos 表的主键（视频 ID），不读取完整值。
     * 使用 openKeyCursor 避免 structured clone 反序列化开销，比 iterateVideosBatched 快 10-100 倍。
     * @param batchSize 每批次主键数量，默认 5000
     * @yields string[] 每批次的视频 ID 数组
     */
    public async *iterateVideoKeysBatched(
        batchSize: number = 5000,
    ): AsyncGenerator<string[], void, void> {
        let lastKey: any = undefined;
        let hasMore = true;

        while (hasMore) {
            const db = await this.getDB();
            const tx = db.transaction('videos', 'readonly');
            const store = tx.store;

            let cursor: any;
            if (lastKey !== undefined) {
                // 从上一批的最后一个主键之后开始（exclusive 边界）
                const range = IDBKeyRange.lowerBound(lastKey, true);
                cursor = await store.openKeyCursor(range, 'next');
            } else {
                cursor = await store.openKeyCursor(null, 'next');
            }

            const batch: string[] = [];
            while (cursor && batch.length < batchSize) {
                batch.push(cursor.primaryKey as string);
                lastKey = cursor.primaryKey;
                cursor = await cursor.continue();
            }

            hasMore = cursor !== null;
            yield batch;
        }
    }

    // 添加或更新视频信息
    public async putVideo(video: VideoInfo): Promise<void> {
        const db = await this.getDB();
        await db.put('videos', video);
    }

    // 批量添加或更新视频信息
    public async bulkPutVideos(videos: VideoInfo[]): Promise<void> {
        const db = await this.getDB();
        const tx = db.transaction('videos', 'readwrite');
        const store = tx.store;

        for (const video of videos) {
            await store.put(video);
        }
        await tx.done;
    }

    // 添加或更新 follow 信息
    public async putFollow(user: Iwara.User): Promise<void> {
        const db = await this.getDB();
        await db.put('follows', user);
    }

    // 添加或更新 friend 信息
    public async putFriend(user: Iwara.User): Promise<void> {
        const db = await this.getDB();
        await db.put('friends', user);
    }

    // 删除 follow 信息
    public async deleteFollow(id: string): Promise<void> {
        const db = await this.getDB();
        await db.delete('follows', id);
    }

    // 删除 friend 信息
    public async deleteFriend(id: string): Promise<void> {
        const db = await this.getDB();
        await db.delete('friends', id);
    }

    // 获取过滤后的视频
    async getFilteredVideos(startTime: number, endTime: number): Promise<VideoInfo[]> {
        if (isNullOrUndefined(startTime) || isNullOrUndefined(endTime)) return [];

        const db = await this.getDB();
        const tx = db.transaction('videos', 'readonly');
        const store = tx.store;
        const index = store.index('UploadTime');

        const allVideos: VideoInfo[] = [];

        // 使用游标遍历 UploadTime 在范围内的视频
        let cursor = await index.openCursor(IDBKeyRange.bound(startTime, endTime, true, true));
        while (cursor) {
            const video = cursor.value;

            // 应用过滤条件
            if ((video.Type === 'partial' || video.Type === 'full') &&
                (video.Private || video.Unlisted) &&
                !isNullOrUndefined(video.RAW)) {
                allVideos.push(video);
            }

            cursor = await cursor.continue();
        }

        return allVideos;
    }

    // ── MediaCenterID 与 IwaraID 映射表 ──

    /**
     * 获取 MediaCenterID 与 IwaraID 映射
     */
    public async getMediaCenterIdMap(videoId: string): Promise<string | undefined> {
        const db = await this.getDB();
        const entry = await db.get('idmap', videoId);
        return entry?.href;
    }

    /**
     * 设置 MediaCenterID 与 IwaraID 映射
     */
    public async putMediaCenterIdMap(videoId: string, mediaCenterId: string): Promise<void> {
        const db = await this.getDB();
        await db.put('idmap', { ID: videoId, href: mediaCenterId });
    }

    /**
     * 批量设置 MediaCenterID 与 IwaraID 映射
     */
    public async bulkPutMediaCenterIdMaps(entries: Array<{ videoId: string; mediaCenterId: string }>): Promise<void> {
        const db = await this.getDB();
        const tx = db.transaction('idmap', 'readwrite');
        const store = tx.store;
        for (const { videoId, mediaCenterId } of entries) {
            await store.put({ ID: videoId, href: mediaCenterId });
        }
        await tx.done;
    }

    /**
     * 获取所有 MediaCenterID 与 IwaraID 映射
     */
    public async getAllMediaCenterIdMaps(): Promise<Map<string, string>> {
        const db = await this.getDB();
        const all = await db.getAll('idmap');
        const map = new Map<string, string>();
        for (const entry of all) {
            map.set(entry.ID, entry.href);
        }
        return map;
    }

    /**
     * 删除指定视频的 MediaCenterID 与 IwaraID 映射
     */
    public async deleteMediaCenterIdMap(videoId: string): Promise<void> {
        const db = await this.getDB();
        await db.delete('idmap', videoId);
    }

    /**
     * 清除所有 MediaCenterID 与 IwaraID 映射
     */
    public async clearAllMediaCenterIdMaps(): Promise<void> {
        const db = await this.getDB();
        const tx = db.transaction('idmap', 'readwrite');
        const store = tx.store;
        let cursor = await store.openCursor();
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }
        await tx.done;
    }

    // 单例模式
    public static getInstance(): Database {
        if (isNullOrUndefined(Database.instance)) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    public static destroyInstance() {
        Database.instance = undefined as any;
    }

    // 删除整个数据库（用于测试或重置）
    public async delete(): Promise<void> {
        const db = await this.getDB();
        db.close();
        await deleteDB('IwaraDownloadTool');
    }
}

export const db = Database.getInstance();
