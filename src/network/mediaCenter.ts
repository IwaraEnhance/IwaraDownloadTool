/**
 * MediaCenter 纯 HTTP API 客户端（错误以值类型返回）。
 *
 * 原 network/mediaCenter.ts 同时承载「批量同步编排」与「HTTP 调用」两层职责，
 * 且反向依赖 download 层（downloadPath/aria2TrackManager），是 network→download
 * 逆向边的根源。现拆分：
 * - 本模块：纯 API 客户端（无 toast、无编排，错误以返回值/错误对象表达）；
 * - features/mediaSync.ts：syncCachedToMediaCenter + pushToMediaCenter 编排（依赖本模块）。
 */
import { config } from '../core/config'
import { unlimitedFetch } from '../core/extension'
import { isNullOrUndefined } from '../core/env'

/** MediaCenter 配置是否就绪（API 地址与密钥均非空） */
export function isMediaCenterConfigured(): boolean {
    return !config.mediaCenterApi.isEmpty() && !config.mediaCenterApiKey.isEmpty()
}

/** 归一化 API 基址（去尾部斜杠） */
export function mediaCenterApiBase(): string {
    return config.mediaCenterApi.replace(/\/+$/, '')
}

/** MediaCenter 请求头（Bearer 鉴权） */
export function mediaCenterAuthHeaders(): Record<string, string> {
    return {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${config.mediaCenterApiKey}`
    }
}

/** MediaCenter 视频列表条目（列表端点返回的字段子集） */
export interface MediaCenterListItem {
    id: string
    fileHash?: string
    title?: string
}

/** 拉取 MediaCenter 全部视频列表（limit=0 表示全量，按 createdAt 降序）。
 * 失败抛错（含状态码与响应文本摘要），由调用方决定提示方式。 */
export async function fetchMediaList(): Promise<MediaCenterListItem[]> {
    const response = await unlimitedFetch(`${mediaCenterApiBase()}/api/media?limit=0&sortBy=createdAt&sortOrder=desc`, {
        headers: mediaCenterAuthHeaders()
    })
    if (!response.ok) {
        throw new Error(`拉取 MediaCenter 列表失败: ${response.status} ${await response.text()}`)
    }
    const result = (await response.json()) as { items?: MediaCenterListItem[] }
    return isNullOrUndefined(result.items) ? [] : result.items
}

/** 校验 MediaCenter 记录是否存在（GET /api/media/:id），返回是否 2xx */
export async function mediaCenterRecordExists(mediaCenterId: string): Promise<boolean> {
    const checkRes = await unlimitedFetch(`${mediaCenterApiBase()}/api/media/${mediaCenterId}`, {
        method: 'GET',
        headers: mediaCenterAuthHeaders()
    })
    return checkRes.ok
}

/** createMedia 请求结果 */
export type CreateMediaResult =
    | { ok: true; id: string }
    | { ok: false; conflict?: { existingId?: string }; status?: number; error?: string }

/** 创建媒体记录（POST /api/media，用视频 ID 作 fileHash 去重）。409 冲突时带出 existingId。 */
export async function createMedia(body: { filePath: string; fileHash: string }): Promise<CreateMediaResult> {
    const createRes = await unlimitedFetch(`${mediaCenterApiBase()}/api/media`, {
        method: 'POST',
        headers: mediaCenterAuthHeaders(),
        body: JSON.stringify(body)
    })
    if (createRes.status === 409) {
        const conflict = (await createRes.json()) as { error: string; existingId?: string; existingTitle?: string }
        return { ok: false, conflict: { existingId: conflict.existingId }, error: conflict.error }
    }
    if (!createRes.ok) {
        return { ok: false, status: createRes.status, error: await createRes.text() }
    }
    const createResult = (await createRes.json()) as { error?: string; id?: string }
    if (createResult.error) return { ok: false, error: createResult.error }
    if (!createResult.id || createResult.id.isEmpty()) return { ok: false, error: 'no id returned' }
    return { ok: true, id: createResult.id }
}

/** updateMedia 结果 */
export type UpdateMediaResult = { ok: true } | { ok: false; status?: number; error?: string }

/** 更新媒体元数据（PUT /api/media/:id）。404 时明确标记（调用方删除本地映射）。 */
export async function updateMedia(mediaCenterId: string, body: Record<string, unknown>): Promise<UpdateMediaResult> {
    const updateRes = await unlimitedFetch(`${mediaCenterApiBase()}/api/media/${mediaCenterId}`, {
        method: 'PUT',
        headers: mediaCenterAuthHeaders(),
        body: JSON.stringify(body)
    })
    if (!updateRes.ok) {
        return { ok: false, status: updateRes.status, error: await updateRes.text() }
    }
    const updateResult = (await updateRes.json()) as { error?: string; media?: Record<string, unknown> }
    if (updateResult.error) return { ok: false, error: updateResult.error }
    if (!updateResult.media) return { ok: false, error: 'no media returned' }
    return { ok: true }
}
