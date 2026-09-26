/**
 * 好友请求审批条件注册表（纯数据 + GM 存取 + 无副作用谓词，
 * 纯数据 + GM 存取 + 无副作用谓词，供配置面板（ui）与审批编排（features）共同消费）。
 *
 * 多条件组合模式：`any`（任一满足即批准，OR）/ `all`（全部满足才批准，AND），
 * 由用户在配置中切换，跨页同步存放在 GM 键 GM_KEY_FRIEND_REQUEST_APPROVAL_MODE；
 * 多条件之间按该模式归约；用户在配置中按 id 勾选启用，跨页同步
 * 存放在 GM 键 GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS。
 */
import { GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS, GM_KEY_FRIEND_REQUEST_APPROVAL_MODE, GM_KEY_APPROVE_EVIDENCE_THREAD } from './constants'
import { createLogger } from './log'
import { isNullOrUndefined } from './env'

const log = createLogger('ApprovalConditions')

/** 审批上下文（条件判定的只读输入） */
export interface ApprovalContext {
    /** 请求对方（发起者）的完整用户信息 */
    user: Iwara.User
    /** 原始请求条目（条件扩展可读取 createdAt 等原始字段） */
    entry: Iwara.FriendRequestEntry
    /** 批级评论证据缓存（证据源 → userId → 评论正文集）。
     * 由调用方（runApproveAll）在批开始时抓取并填充；缺失时评论类条件视为不满足。
     * 结构归 core（纯 Map 判定），抓取归 features（网络依赖不进 core 层） */
    commentsByUser?: CommentEvidenceCache
}

/**
 * 审批条件接口（预留扩展点）。
 * 每个条件实现 `test(ctx)`，返回 true 表示"满足该条件，可批准"。
 */
export interface ApprovalCondition {
    /** 条件唯一 ID（持久化与 i18n 键 `approvalCondition_<id>` 均基于它） */
    id: string
    /** 判定：满足返回 true。实现应只读（API/DB），不产生副作用 */
    test: (ctx: ApprovalContext) => Promise<boolean>
}

/** 内置审批条件：无条件批准（默认启用） */
const conditionAlways: ApprovalCondition = {
    id: 'always',
    test: async () => true
}

/** 内置审批条件：对方已关注我（followedBy）——直接读请求条目内嵌的 user 数据，无额外请求 */
const conditionFollowedBy: ApprovalCondition = {
    id: 'followedBy',
    test: async ({ user }) => user.followedBy === true
}

/** 内置审批条件：我也关注了对方（following）——直接读请求条目内嵌的 user 数据 */
const conditionFollowing: ApprovalCondition = {
    id: 'following',
    test: async ({ user }) => user.following === true
}

/** 内置审批条件：对方是 Premium 用户（付费支持者，广告/风险面低）——user.premium 实证字段 */
const conditionPremium: ApprovalCondition = {
    id: 'premium',
    test: async ({ user }) => user.premium === true
}

/** 内置审批条件：对方近期活跃（seenAt 在 30 天内）——僵尸号/废弃号过滤 */
const conditionRecentlyActive: ApprovalCondition = {
    id: 'recentlyActive',
    test: async ({ user }) => {
        if (!user.seenAt) return false
        return Date.now() - new Date(user.seenAt).getTime() <= 30 * 24 * 60 * 60 * 1000
    }
}

/** 内置审批条件：对方是老账号（注册满 30 天）——新注册小号/广告号过滤 */
const conditionEstablished: ApprovalCondition = {
    id: 'established',
    test: async ({ user }) => {
        if (!user.createdAt) return false
        return Date.now() - new Date(user.createdAt).getTime() >= 30 * 24 * 60 * 60 * 1000
    }
}

/** 内置审批条件：对方账号状态正常（非 inactive/banned）——官方枚举实证（见 onboarding）。
 * 注意：封禁账号的好友请求本身罕见（平台侧通常已限制），此条件用于与其他条件组合兜底 */
const conditionActive: ApprovalCondition = {
    id: 'active',
    test: async ({ user }) => user.status === undefined || user.status === 'active'
}

/**
 * 批级评论证据缓存：证据源 key → (userId → 该用户在该源下发表的评论正文集)。
 * 证据源 key 约定：`profile`（本人大厅主页评论）与 `forum:<threadId>`（指定论坛帖）。
 * 结构归 core（纯 Map 判定），抓取归调用方（features，网络依赖不进 core 层）。
 */
export type CommentEvidenceCache = Map<string, Map<string, string[]>>

/** 评论证据类条件的公共判定：对方 userId 在指定证据源下是否有任一评论 */
function hasCommentIn(cache: CommentEvidenceCache | undefined, sourceKey: string, userId: string): boolean {
    return cache !== undefined && (cache.get(sourceKey)?.get(userId)?.length ?? 0) > 0
}

/** 内置审批条件：对方在我的个人主页评论区发表过评论（证据：批开始时抓取一次本人主页全部评论） */
const conditionCommentedOnProfile: ApprovalCondition = {
    id: 'commentedProfile',
    test: async ({ user, commentsByUser }) => hasCommentIn(commentsByUser, 'profile', user.id)
}

/** 内置审批条件：对方在指定论坛帖子下发表过评论（帖子 ID 由 GM 键配置，批开始时抓取一次） */
const conditionCommentedOnForumThread: ApprovalCondition = {
    id: 'commentedForumThread',
    test: async ({ user, commentsByUser }) => {
        const threadId = GM_getValue<string | undefined>(GM_KEY_APPROVE_EVIDENCE_THREAD, undefined)
        if (isNullOrUndefined(threadId) || threadId.isEmpty()) return false
        return hasCommentIn(commentsByUser, `forum:${threadId}`, user.id)
    }
}

/** 内置审批条件注册表：新增条件在此追加即可（配置按 id 引用，i18n 键 approvalCondition_<id>) */
export const BUILTIN_APPROVAL_CONDITIONS: ApprovalCondition[] = [
    conditionAlways,
    conditionFollowedBy,
    conditionFollowing,
    conditionPremium,
    conditionRecentlyActive,
    conditionEstablished,
    conditionActive,
    conditionCommentedOnProfile,
    conditionCommentedOnForumThread
]

/** 根据 id 查找内置条件定义（未注册的 id 返回 undefined，调用方静默跳过保证向后兼容） */
export function getApprovalCondition(id: string): ApprovalCondition | undefined {
    return BUILTIN_APPROVAL_CONDITIONS.find((c) => c.id === id)
}

/** 读取已启用的审批条件 id 列表（未配置时默认 always = 无条件批准） */
export function getEnabledApprovalConditionIds(): string[] {
    const stored = GM_getValue<string[] | undefined>(GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS, undefined)
    if (!Array.isArray(stored) || stored.length === 0) return ['always']
    return stored
}

/** 保存已启用的审批条件 id 列表（配置面板调用） */
export function setEnabledApprovalConditionIds(ids: string[]): void {
    GM_setValue(GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS, ids)
}

/** 审批条件组合模式：any = 任一满足即批准（OR，缺省，向后兼容）；all = 全部满足才批准（AND） */
export type ApprovalMode = 'any' | 'all'

/** 读取条件组合模式（未配置或缺值回退 any，与历史 OR 语义一致） */
export function getApprovalMode(): ApprovalMode {
    const stored = GM_getValue<string | undefined>(GM_KEY_FRIEND_REQUEST_APPROVAL_MODE, undefined)
    return stored === 'all' ? 'all' : 'any'
}

/** 保存条件组合模式（配置面板调用） */
export function setApprovalMode(mode: ApprovalMode): void {
    GM_setValue(GM_KEY_FRIEND_REQUEST_APPROVAL_MODE, mode)
}

/** 依次执行条件列表并按模式归约：any = 任一满足即 true（短路）；all = 全部满足才 true（任一不满足即短路）。
 * 未注册 id 跳过并记日志；条件判定异常视为不满足并记日志。短路径保证网络条件在可判定时尽早停止 */
export async function checkApprovalConditions(ids: string[], ctx: ApprovalContext, mode: ApprovalMode = 'any'): Promise<boolean> {
    for (const id of ids) {
        const condition = getApprovalCondition(id)
        if (!condition) {
            log.warn(`未注册的审批条件: ${id}，跳过`)
            continue
        }
        let result = false
        try {
            result = await condition.test(ctx)
        } catch (error) {
            log.warn(`审批条件 ${id} 判定异常:`, error)
        }
        if (mode === 'any' && result) return true
        if (mode === 'all' && !result) return false
    }
    // any：无一满足；all：全部满足（或无可判定条件——空集/全未注册在 all 下视为满足）
    return mode === 'all'
}
