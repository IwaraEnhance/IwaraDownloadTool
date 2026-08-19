import type { IDBPDatabase } from 'idb'
import type { IwaraDownloadToolDB } from './db'

/**
 * 数据库 schema 当前版本号（与 idb openDB 的 version 参数保持一致，单一来源）。
 *
 * schema 版本历史（git 历史）：
 * - Dexie 时代（迁移到 idb 之前）：声明 `db.version(2)`，但 Dexie 打开 IndexedDB 时会把版本
 *   ×10（见 dexie-open.ts: `nativeVerToOpen = Math.round(db.verno * 10)`，升级时再 `oldVer / 10`），
 *   因此浏览器里实际的原生数据库版本是 **20**（2×10）。3~7 仅存在于被注释掉的旧 VideoDatabase 代码中，从未生效
 * - v20（迁移到 idb）：沿用 Dexie 时代已有的原生版本 20（= Dexie 自动"加 0"的结果），数据无缝保留，stores 同 v2
 * - v22（加入 MediaCenter）：新增 idmap，删除 caches（v<21）、pairs（v<22）
 *   注：v21 为过渡版本（pairs 表曾短暂存在于中间构建），pairs 删除逻辑为兜底
 */
/** 数据库名称（openDB / deleteDB 共用，单一来源） */
export const DB_NAME = 'IwaraDownloadTool'

export const DB_VERSION = 22

/**
 * IndexedDB schema 迁移：idb 检测到数据库版本变化时调用（openDB 的 upgrade 回调）。
 * 采用「幂等创建 + 按 oldVersion 定向清理」策略：
 * - 各表/索引不存在时创建（可从任意旧版本直接升级）
 * - 按 oldVersion 删除已废弃的缓存表（caches / pairs，删后数据自动重建）
 * @param db         版本变化事务内的目标数据库
 * @param oldVersion 升级前的旧版本号
 */
export function upgradeDatabase(db: IDBPDatabase<IwaraDownloadToolDB>, oldVersion: number): void {
    // 检查并创建 follows 表（如果不存在）
    if (!db.objectStoreNames.contains('follows')) {
        const followsStore = db.createObjectStore('follows', { keyPath: 'id' })
        followsStore.createIndex('id', 'id', { unique: true })
        followsStore.createIndex('username', 'username', { unique: true })
        followsStore.createIndex('name', 'name')
        followsStore.createIndex('friend', 'friend')
        followsStore.createIndex('following', 'following')
        followsStore.createIndex('followedBy', 'followedBy')
    }

    // 检查并创建 friends 表（如果不存在）
    if (!db.objectStoreNames.contains('friends')) {
        const friendsStore = db.createObjectStore('friends', { keyPath: 'id' })
        friendsStore.createIndex('id', 'id', { unique: true })
        friendsStore.createIndex('username', 'username', { unique: true })
        friendsStore.createIndex('name', 'name')
        friendsStore.createIndex('friend', 'friend')
        friendsStore.createIndex('following', 'following')
        friendsStore.createIndex('followedBy', 'followedBy')
    }

    // 检查并创建 videos 表（如果不存在）
    if (!db.objectStoreNames.contains('videos')) {
        const videosStore = db.createObjectStore('videos', { keyPath: 'ID' })
        videosStore.createIndex('ID', 'ID', { unique: true })
        videosStore.createIndex('UploadTime', 'UploadTime')
        videosStore.createIndex('Private', 'Private')
        videosStore.createIndex('Unlisted', 'Unlisted')
        videosStore.createIndex('Type', 'Type')
    }

    // 检查并创建 idmap 表（如果不存在）
    if (!db.objectStoreNames.contains('idmap')) {
        const idmapStore = db.createObjectStore('idmap', { keyPath: 'ID' })
        idmapStore.createIndex('ID', 'ID', { unique: true })
    }

    // 删除旧版 caches 表（v20 → v21），缓存数据会重新生成
    if (oldVersion < 21 && db.objectStoreNames.contains('caches' as any)) {
        db.deleteObjectStore('caches' as any)
    }
    // 删除旧版 pairs 表（v21 → v22），缓存数据会重新生成
    if (oldVersion < 22 && db.objectStoreNames.contains('pairs' as any)) {
        db.deleteObjectStore('pairs' as any)
    }
}
