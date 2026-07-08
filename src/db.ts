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
    caches: {
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
        this.dbPromise = openDB<IwaraDownloadToolDB>('IwaraDownloadTool', 20, {
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

                // 检查并创建 caches 表（如果不存在）
                if (!db.objectStoreNames.contains('caches')) {
                    const cachesStore = db.createObjectStore('caches', { keyPath: 'ID' });
                    cachesStore.createIndex('ID', 'ID', { unique: true });
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

    // caches 表操作
    public async caches() {
        const db = await this.getDB();
        return db.transaction('caches', 'readwrite').objectStore('caches');
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

    // 便捷方法：获取 caches 表中的数据
    public async getCaches() {
        const store = await this.caches();
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
     * @yields VideoInfo[] 每批次的记录数组
     */
    public async *iterateVideosBatched(batchSize: number = 500, predicate?: (video: VideoInfo) => boolean): AsyncGenerator<VideoInfo[], void, void> {
        let lastKey: any = undefined;
        let hasMore = true;

        while (hasMore) {
            const db = await this.getDB();
            const tx = db.transaction('videos', 'readonly');
            const store = tx.store;

            let cursor: any;
            if (lastKey !== undefined) {
                cursor = await store.openCursor(IDBKeyRange.lowerBound(lastKey, true));
            } else {
                cursor = await store.openCursor();
            }

            const batch: VideoInfo[] = [];
            while (cursor && batch.length < batchSize) {
                const video = cursor.value as VideoInfo;
                if (!predicate || predicate(video)) {
                    batch.push(video);
                }
                lastKey = cursor.key;
                cursor = await cursor.continue();
            }

            hasMore = cursor !== null;
            // 事务在此 yield 后安全自动提交
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
