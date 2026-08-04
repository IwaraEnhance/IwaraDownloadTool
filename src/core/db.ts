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

/** 可导出为 JSON 文件的数据库表名 */
export type ExportableTable = 'videos' | 'follows' | 'friends' | 'idmap';

/** 文件下载方式 */
export type DownloadMode = 'gm' | 'browser' | 'auto';

/** 分批导出 JSON 文件的配置项 */
export interface ExportToJsonOptions {
    /** 每批记录数，默认 500 */
    batchSize?: number;
    /** 文件名前缀，默认使用表名（如 videos_001.json） */
    prefix?: string;
    /** JSON 是否格式化（缩进 2 空格），默认 true */
    pretty?: boolean;
    /** 每下载完成一个文件的进度回调 */
    onProgress?: (done: number, totalBatches: number) => void;
    /**
     * 文件下载方式：
     * - 'gm'：使用 GM_download（Chrome 上推荐）
     * - 'browser'：使用 <a download> 触发浏览器原生下载
     * - 'auto'：自动选择——Firefox 使用 browser（GM_download 的 blob URL 在 Firefox 上不可靠），
     *           其他浏览器优先 GM_download，失败/超时自动回退 browser（默认）
     */
    downloadMode?: DownloadMode;
    /** GM_download 超时时间（毫秒），默认 30000。blob 本地下载应瞬时完成，超时即视为不可用 */
    gmTimeout?: number;
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

    /**
     * 通用分批迭代指定表的所有记录（按主键升序，每批独立事务，防止 yield 自动提交）
     * @param table 表名（'videos' | 'follows' | 'friends' | 'idmap'）
     * @param batchSize 每批记录数，默认 500
     * @yields T[] 每批记录数组
     *
     * @example
     * for await (const batch of db.iterateTableBatched('videos', 500)) {
     *     console.log(`本批 ${batch.length} 条`);
     * }
     */
    public async *iterateTableBatched<T = unknown>(
        table: ExportableTable,
        batchSize: number = 500,
    ): AsyncGenerator<T[], void, void> {
        let lastKey: any = undefined;
        let hasMore = true;

        while (hasMore) {
            const db = await this.getDB();
            const tx = db.transaction(table, 'readonly');
            const store = tx.store;

            let cursor: any;
            if (lastKey !== undefined) {
                // 从上一批最后一条主键之后开始（exclusive 边界）
                const range = IDBKeyRange.lowerBound(lastKey, true);
                cursor = await store.openCursor(range, 'next');
            } else {
                cursor = await store.openCursor(null, 'next');
            }

            const batch: T[] = [];
            while (cursor && batch.length < batchSize) {
                batch.push(cursor.value as T);
                lastKey = cursor.primaryKey;
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

    // ── 分批导出 JSON 文件 ──

    /**
     * 通过浏览器将文本内容下载为本地文件
     * - 'gm'：使用 GM_download（用户脚本环境，可保存到默认下载目录）
     * - 'browser'：使用 <a download> 触发浏览器原生下载
     * - 'auto'：Firefox 使用 browser（GM_download 的 blob URL 在 Firefox 上不受支持），
     *           其他浏览器优先 GM_download，失败/超时自动回退 browser
     */
    private async downloadTextFile(
        filename: string,
        content: string,
        mimeType: string,
        mode: DownloadMode = 'auto',
        gmTimeout: number = 30 * 1000,
    ): Promise<void> {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        // 浏览器原生下载（支持 blob URL，Firefox 可用）
        const triggerBrowserDownload = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // 延迟释放，确保浏览器已读取 blob 内容
            setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
        };

        const isFirefox = () => /Firefox/i.test(navigator.userAgent);
        const useGm = (mode === 'gm' || (mode === 'auto' && !isFirefox())) && typeof GM_download === 'function';

        if (useGm) {
            try {
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    // 兜底超时：GM_download 可能因权限未授权/下载队列阻塞而始终不回调，避免 Promise 无限 pending
                    const timer = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        reject(new Error(`下载 ${filename} 超时（GM_download 未响应）`));
                    }, gmTimeout);

                    GM_download({
                        url,
                        name: filename,
                        saveAs: false,
                        onload: () => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); resolve(); },
                        onerror: (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(`下载 ${filename} 失败: ${err.error}${err.details ? ` - ${err.details}` : ''}`)); },
                        ontimeout: () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(`下载 ${filename} 超时`)); },
                    });
                });
                return;
            } catch (error) {
                // GM_download 失败/超时：auto 模式下回退为浏览器原生下载（此时 blob URL 尚未释放，可直接复用）
                if (mode === 'auto') {
                    console.warn(`[db] GM_download 不可用，回退浏览器原生下载: ${(error as Error).message}`);
                    triggerBrowserDownload();
                    return;
                }
                URL.revokeObjectURL(url);
                throw error;
            }
        }

        triggerBrowserDownload();
    }

    /**
     * 分批导出指定表的数据为多个 JSON 文件（浏览器下载方式）
     *
     * 每批记录序列化为一个独立 JSON 数组文件，避免一次性序列化全库导致内存占用过大。
     * 文件命名为 `${prefix}_001.json`、`${prefix}_002.json` ……
     *
     * @param table 要导出的表名
     * @param options 导出配置
     * @returns 实际生成的 JSON 文件数量
     *
     * @example
     * // 将 videos 表按每批 500 条导出为 videos_001.json、videos_002.json …
     * const count = await db.exportToJsonFiles('videos', {
     *     batchSize: 500,
     *     onProgress: (done, total) => console.log(`进度 ${done}/${total}`),
     * });
     */
    public async exportToJsonFiles(
        table: ExportableTable,
        options: ExportToJsonOptions = {},
    ): Promise<number> {
        const { batchSize = 500, prefix = table, pretty = true, onProgress, downloadMode = 'auto', gmTimeout } = options;

        const db = await this.getDB();
        const total = await db.count(table);
        const totalBatches = Math.ceil(total / batchSize);

        let fileCount = 0;
        for await (const batch of this.iterateTableBatched(table, batchSize)) {
            fileCount++;
            const content = JSON.stringify(batch, null, pretty ? 2 : undefined);
            const filename = `${prefix}_${String(fileCount).padStart(3, '0')}.json`;
            await this.downloadTextFile(filename, content, 'application/json;charset=utf-8', downloadMode, gmTimeout);
            onProgress?.(fileCount, totalBatches);
        }
        return fileCount;
    }

    /**
     * 分批导出数据库中全部表（videos、follows、friends、idmap）为 JSON 文件
     * @param options 导出配置
     * @returns 每张表实际生成的 JSON 文件数量
     *
     * @example
     * const result = await db.exportAllToJsonFiles({ batchSize: 1000 });
     * console.log(result); // { videos: 3, follows: 1, friends: 1, idmap: 1 }
     */
    public async exportAllToJsonFiles(
        options: ExportToJsonOptions = {},
    ): Promise<Record<ExportableTable, number>> {
        const tables: ExportableTable[] = ['videos', 'follows', 'friends', 'idmap'];
        const result = {} as Record<ExportableTable, number>;
        for (const table of tables) {
            result[table] = await this.exportToJsonFiles(table, options);
        }
        return result;
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
