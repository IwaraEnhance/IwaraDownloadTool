import '../core/env'
import { delay, isNullOrUndefined } from '../core/env'
import { PageType, ToastType } from '../core/enum'
import { newToast, toastNode } from '../ui/notify'
import { createLogger } from '../core/log'
import { GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS } from '../core/constants'
import { getPageTypeFromPath } from '../core/pageType'
import { renderNode, unlimitedFetch } from '../core/extension'
import { originalNodeAppendChild } from '../core/hijack'
import { getAuth, verifyLogin } from '../network/auth'
import { addFriend } from '../network/interactions'
import { apiEndpoint } from '../context/site'
import { i18nList } from '../i18n'
import { config } from '../core/config'
import { registerInjectionRule } from '../core/injectionWatcher'
import { resolvePlaceholders } from '../core/i18nRuntime'
import { getLocalUser } from '../network/users'
import { fetchAllComments } from '../network/comments'
import { type CommentEvidenceCache } from '../core/approvalConditions'
import { GM_KEY_APPROVE_EVIDENCE_THREAD } from '../core/constants'
import '../css/friendRequests.css'

const log = createLogger('FriendRequests')

/** 审批条件上下文：传给每个条件的判定函数 */
export interface ApprovalContext {
    /** 请求对方（发起者）的完整用户信息 */
    user: Iwara.User
    /** 原始请求条目（条件扩展可读取 createdAt 等原始字段） */
    entry: Iwara.FriendRequestEntry
}

/**
 * 好友请求审批条件注册表已下沉 core/approvalConditions.ts（纯数据 + GM 存取 +
 * 无副作用谓词，供 ui 配置面板与 features 审批编排共同消费）。此处 re-export
 * 保持既有导入路径兼容（ApprovalContext 本文件保留本地定义避免冲突）。
 */
export { BUILTIN_APPROVAL_CONDITIONS, getEnabledApprovalConditionIds, setEnabledApprovalConditionIds, getApprovalCondition, checkApprovalConditions, getApprovalMode, setApprovalMode } from '../core/approvalConditions'
export type { ApprovalCondition, ApprovalMode } from '../core/approvalConditions'
import { getEnabledApprovalConditionIds, checkApprovalConditions, getApprovalMode } from '../core/approvalConditions'

/**
 * 好友请求 API（分页拉取 / 批准 / 拒绝）已下沉 network/interactions.ts（纯 HTTP 客户端，
 * 同型 #8 收敛）：fetchAllFriendRequests re-export 兼容；批准/拒绝直呼 addFriend/removeFriend。
 */
export { fetchAllFriendRequests } from '../network/interactions'
import { fetchAllFriendRequests } from '../network/interactions'

// ── 页面注入：一键审批按钮 + 审批进度条 ──

/** 进度面板元素（懒创建单例） */
let panel: HTMLDivElement | undefined
let panelBar: HTMLDivElement | undefined
let panelText: HTMLSpanElement | undefined
/** 运行标志：防重入（按钮点击期间禁用） */
let running = false

/** 更新进度面板（首次调用自动创建并挂到 body）。text 含 %#i18nKey#% 占位符，
 * 更新时先经 i18nRuntime 的 resolver 替换再写 textContent（不重建节点）。 */
function updatePanel(done: number, total: number, text: string) {
    if (isNullOrUndefined(panel) || isNullOrUndefined(panelBar) || isNullOrUndefined(panelText)) {
        panelBar = renderNode({ nodeType: 'div', className: 'friendsApproveBar' }) as HTMLDivElement
        panel = renderNode({
            nodeType: 'div',
            className: 'friendsApprove',
            childs: [
                { nodeType: 'span', className: 'friendsApproveText', childs: resolvePlaceholders(text) },
                { nodeType: 'div', className: 'friendsApproveTrack', childs: panelBar }
            ],
            attributes: { id: 'pluginFriendsApprovePanel' }
        }) as HTMLDivElement
        panelText = panel.querySelector('.friendsApproveText') as HTMLSpanElement
        panel.style.display = 'none'
        originalNodeAppendChild.call(unsafeWindow.document.body, panel)
    } else {
        // 更新：占位符替换后直写（免节点重建；构造期同样已替换——两条路径语义一致）
        panelText!.textContent = resolvePlaceholders(text)
    }
    panel!.style.display = ''
    panelBar!.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'
}

/** 隐藏进度面板 */
function hidePanel() {
    if (!isNullOrUndefined(panel)) panel.style.display = 'none'
}

/**
 * 批开始时按需抓取评论证据（一键审批的评论类条件）：
 * - 启用 commentedProfile → 抓本人 profile 评论（sourceKey='profile'）；
 * - 启用 commentedForumThread 且配置了证据帖 ID → 抓该论坛帖评论（sourceKey='forum:<id>'）。
 * 两个证据源相互独立，同时启用时并行抓取，仅启用其一时只抓其一。
 * 抓取失败降级为空证据（对应条件不满足），不中断审批流程。
 */
async function gatherCommentEvidence(conditionIds: string[], me: Iwara.User): Promise<CommentEvidenceCache> {
    const cache: CommentEvidenceCache = new Map()
    const load = async (sourceKey: string, type: string, id: string) => {
        try {
            const comments = await fetchAllComments(type, id)
            const byUser = new Map<string, string[]>()
            for (const c of comments) {
                if (isNullOrUndefined(c.user?.id)) continue
                const list = byUser.get(c.user.id) ?? []
                list.push(c.body ?? '')
                byUser.set(c.user.id, list)
            }
            cache.set(sourceKey, byUser)
        } catch (error) {
            log.warn(`评论证据抓取失败 (${sourceKey}):`, error)
        }
    }
    const threadId = GM_getValue<string | undefined>(GM_KEY_APPROVE_EVIDENCE_THREAD, undefined)
    await Promise.all([
        ...(conditionIds.includes('commentedProfile') ? [load('profile', 'profile', me.id)] : []),
        ...(conditionIds.includes('commentedForumThread') && !isNullOrUndefined(threadId) && !threadId.isEmpty()
            ? [load(`forum:${threadId}`, 'forumThread', threadId)]
            : [])
    ])
    return cache
}

/** 判断启用的审批条件中是否有评论证据类（有才值得在批开始时抓取） */
function hasCommentEvidenceSources(enabledIds: string[]): boolean {
    return enabledIds.includes('commentedProfile') || enabledIds.includes('commentedForumThread')
}

/**
 * 一键批准流程：拉取全部收到的请求 → 逐条按启用条件判定（OR）→ 满足者逐个 POST 批准 → 进度条反馈。
 * 每个批准之间 delay 节流，避免请求风暴。running 防重入。
 */
export async function runApproveAll(): Promise<void> {
    if (running) return
    running = true
    try {
        // 一键批准是长作业入口：refresh 语义（verifyLogin + 实时拉取，见 network/users）
        const me = await getLocalUser({ refresh: true })
        if (isNullOrUndefined(me)) {
            updatePanel(0, 1, '%#notLoggedIn#%')
            return
        }
        updatePanel(0, 1, '%#friendApproveFetching#%')
        const entries = await fetchAllFriendRequests(me.id)
        if (entries.length === 0) {
            updatePanel(1, 1, '%#friendApproveNone#%')
            await delay(2500)
            hidePanel()
            return
        }
        const conditionIds = getEnabledApprovalConditionIds()
        // 条件组合模式（any=任一满足 / all=全部满足）：批开始读一次，整批语义一致
        const mode = getApprovalMode()
        // 评论类证据条件启用时：批开始抓取一次（各证据源按启用条件独立并行拉取；谓词只读不反网络）
        const commentEvidence = hasCommentEvidenceSources(conditionIds)
            ? await gatherCommentEvidence(conditionIds, me)
            : undefined
        // 阶段一：条件判定（评论证据随 ctx 下发）
        const qualified: Iwara.FriendRequestEntry[] = []
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            updatePanel(i, entries.length, `%#friendApproveChecking#% ${i + 1}/${entries.length}`)
            const peer = entry.user.id === me.id ? entry.target : entry.user
            if (await checkApprovalConditions(conditionIds, { user: peer, entry, commentsByUser: commentEvidence }, mode)) qualified.push(entry)
        }
        // 阶段二：逐个批准（POST /friends 经 network/interactions 客户端；失败计数不中断）
        let approved = 0
        for (let i = 0; i < qualified.length; i++) {
            updatePanel(i, qualified.length, `%#friendApproveRunning#% ${i + 1}/${qualified.length}`)
            if (await addFriend(qualified[i].user.id)) {
                approved++
            } else {
                log.warn(`批准好友请求失败 ${qualified[i].user.id}`)
            }
            await delay(500)
        }
        updatePanel(qualified.length, qualified.length, `%#friendApproveDone#% ${approved}/${qualified.length}`)
        log.info(`一键批准完成: ${approved}/${qualified.length} (共 ${entries.length} 条请求)`)
        // 官方列表无局部刷新机制，是否整页刷新交给用户决定（不自动 reload）
        newToast(ToastType.Info, {
            duration: -1,
            node: toastNode(`%#friendApproveDone#% ${approved}/${qualified.length} (%#friendApproveReloadHint#%)`),
            buttons: [{ text: '%#friendApproveReload#%', onClick: (t) => { t.hide(); unsafeWindow.location.reload() } }, { text: '%#ok#%', onClick: (t) => t.hide() }]
        }).show()
        await delay(3000)
        hidePanel()
    } catch (error) {
        log.error('一键批准异常:', error)
        updatePanel(0, 1, `%#friendApproveError#%`)
        newToast(ToastType.Error, {
            node: toastNode(`%#friendApproveError#%`),
            buttons: [{ text: '%#ok#%', onClick: (t) => t.hide() }]
        }).show()
    } finally {
        running = false
    }
}

/** 是否好友请求页 */
export function isFriendRequestsPage(): boolean {
    return getPageTypeFromPath(unsafeWindow.location.hash.trimHead('#').trimHead('!').split('?')[0] || unsafeWindow.location.pathname) === PageType.Friends && unsafeWindow.location.pathname.replace(/\/+$/, '').endsWith('/requests')
}

/**
 * 在好友请求页注入"一键审批"按钮。重复调用安全（已有注入则跳过）。
 * 按钮挂在官方页头之后；触发由两部分完成：main.ts pageChange（SPA 跳转 + 冷加载）与
 * injectionWatcher 的常驻调度（列表渲染就绪后注入、被 React 清除后补种），本函数不做延时轮询。
 */
export async function injectFriendApproveButton(): Promise<void> {
    if (!isFriendRequestsPage()) return
    if (!isNullOrUndefined(unsafeWindow.document.querySelector('#pluginFriendsApprove'))) return
    if (!(await verifyLogin())) return
    // 官方请求列表（React 异步加载）尚未渲染时立即返回，由 injectionWatcher 监听到就绪后再注入
    if (isNullOrUndefined(unsafeWindow.document.querySelector('.friendRequest, .friend'))) return
    const button = renderNode({
        nodeType: 'button',
        className: 'friendsApproveButton',
        attributes: { id: 'pluginFriendsApprove', type: 'button' },
        childs: '%#friendApproveAll#%',
        events: {
            click: async (event: Event) => {
                event.preventDefault()
                event.stopPropagation()
                const target = event.target as HTMLButtonElement
                target.disabled = true
                await runApproveAll()
                // 是否重载由 runApproveAll 完成后的 toast 提供（用户自行选择）；重新启用按钮以备再次操作
                target.disabled = false
                return false
            }
        }
    })
    const host = renderNode({
        nodeType: 'div',
        attributes: { id: 'pluginFriendsApproveHost' },
        childs: button
    })
    // 挂载策略（结构化锚定，官方节点零修改）：
    // ① 先定位请求列表，closest('.container-fluid') 取锚定域——中间存在无类名包装层
    //    （实测父链：.friendRequests ← div(无类名) ← .col-12 ← .row ← .container-fluid），
    //    list.parentElement 会落到空包装；页脚也有 .container-fluid，必须 list.closest 向上取，
    //    且标题只在域内查找，杜绝全局盲选 .text--h1/h1/h2 命中页面任意标题。
    const list = unsafeWindow.document.querySelector('.friendRequests, .row.friendRequests, .friendRequest, .friend')
    const container = list?.closest('.container-fluid') as Element | null
    const heading = (container?.querySelector('.text--h1') ?? container?.querySelector('h1, h2')) as Element | null
    // ② host 仅作为标题的额外子节点追加，不向官方元素添加 class / inline style；
    //    右对齐 flex 布局由 CSS :has(#pluginFriendsApproveHost) 驱动（friendRequests.css），
    //    官方重渲染只要保留 host 子节点布局即在，被清除后由 injectionWatcher 补种。
    // ③ 无标题时退回列表之前插入；再退化挂到锚定域/载体尾部
    if (heading) {
        heading.appendChild(host)
    } else if (list && !isNullOrUndefined(list.parentElement)) {
        list.parentElement.insertBefore(host, list)
    } else {
        originalNodeAppendChild.call(container ?? unsafeWindow.document.body, host)
    }
    log.debug('一键审批按钮已注入')
}

// 注册注入规则：模块加载即生效（基础设施负责监听调度，避免各自实现 watcher/守护）
registerInjectionRule({
    id: 'friendApproveButton',
    enabled: () => config.friendRequestApprove === true,
    isTargetPage: isFriendRequestsPage,
    isReady: () => !isNullOrUndefined(unsafeWindow.document.querySelector('.friendRequest, .friend')),
    markerSelector: '#pluginFriendsApproveHost',
    inject: injectFriendApproveButton
})
