import './env'
import { delay, isNullOrUndefined } from './env'
import { PageType, ToastType } from './enum'
import { newToast, toastNode } from '../ui/notify'
import { createLogger } from './log'
import { GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS } from './constants'
import { getPageTypeFromPath } from './pageType'
import { renderNode, unlimitedFetch } from './extension'
import { originalNodeAppendChild } from './hijack'
import { getAuth, verifyLogin } from '../network/auth'
import { apiEndpoint } from '../main'
import { i18nList } from '../i18n'
import { config } from './config'
import { registerInjectionRule } from './injectionWatcher'
import friendRequestsCSS from '../css/friendRequests.css'

const log = createLogger('FriendRequests')

/** 审批条件上下文：传给每个条件的判定函数 */
export interface ApprovalContext {
    /** 请求对方（发起者）的完整用户信息 */
    user: Iwara.User
    /** 原始请求条目（条件扩展可读取 createdAt 等原始字段） */
    entry: Iwara.FriendRequestEntry
}

/**
 * 审批条件接口（预留扩展点）。
 * 每个条件实现 `test(ctx)`，返回 true 表示"满足该条件，可批准"。
 * 多条件之间是 OR 语义：任一满足即批准；内置条件注册在 BUILTIN_APPROVAL_CONDITIONS，
 * 用户在配置中按 id 勾选启用，跨页同步存放在 GM 键 GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS。
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

/** 内置审批条件注册表：新增条件在此追加即可（配置按 id 引用，i18n 键 approvalCondition_<id>) */
export const BUILTIN_APPROVAL_CONDITIONS: ApprovalCondition[] = [conditionAlways, conditionFollowedBy, conditionFollowing]

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

/** 依次执行条件列表（OR 语义：任一满足即 true）。条件判定异常视为不满足并记日志 */
export async function checkApprovalConditions(ids: string[], ctx: ApprovalContext): Promise<boolean> {
    for (const id of ids) {
        const condition = getApprovalCondition(id)
        if (isNullOrUndefined(condition)) continue
        try {
            if (await condition.test(ctx)) return true
        } catch (error) {
            log.warn(`审批条件 ${id} 判定异常: ${String(error)}`)
        }
    }
    return false
}

/** 分页拉取当前用户收到的全部好友请求（entry.user.id !== me.id 为"收到的请求"，官方前端同语义） */
export async function fetchAllFriendRequests(meId: string, maxPages = 32): Promise<Iwara.FriendRequestEntry[]> {
    const received: Iwara.FriendRequestEntry[] = []
    for (let page = 0; page < maxPages; page++) {
        const res = await unlimitedFetch(`https://${apiEndpoint}/user/${meId}/friends/requests?page=${page}`, {
            method: 'GET',
            headers: await getAuth()
        })
        if (!res.ok) throw new Error(`fetchFriendRequests failed: HTTP ${res.status}`)
        const data = (await res.json()) as Iwara.FriendRequestsPage
        received.push(...(data.results ?? []).filter((e) => e.user.id !== meId))
        // 不足一页即取完（limit 缺失时以本页长度兜底）
        const limit = data.limit > 0 ? data.limit : (data.results ?? []).length
        if ((data.results ?? []).length < limit || data.results.length === 0) break
    }
    return received
}

/** 批准（接受）好友请求：POST /user/:userId/friends（与官方 requestFriend 一致，无 body） */
export async function approveFriendRequest(userId: string): Promise<boolean> {
    const res = await unlimitedFetch(`https://${apiEndpoint}/user/${userId}/friends`, {
        method: 'POST',
        headers: await getAuth()
    })
    if (!res.ok) log.warn(`批准好友请求失败 ${userId}: HTTP ${res.status}`)
    return res.ok
}

/** 拒绝（删除）好友请求：DELETE /user/:userId/friends（与官方 destroyFriend 一致，预留） */
export async function rejectFriendRequest(userId: string): Promise<boolean> {
    const res = await unlimitedFetch(`https://${apiEndpoint}/user/${userId}/friends`, {
        method: 'DELETE',
        headers: await getAuth()
    })
    if (!res.ok) log.warn(`拒绝好友请求失败 ${userId}: HTTP ${res.status}`)
    return res.ok
}

// ── /friends/requests 页面注入：一键同意按钮 + 批准进度条 ──

/** 进度面板元素（懒创建单例） */
let panel: HTMLDivElement | undefined
let panelBar: HTMLDivElement | undefined
let panelText: HTMLSpanElement | undefined
/** 运行标志：防重入（按钮点击期间禁用） */
let running = false
/** CSS 只注入一次 */
let cssInjected = false

function ensureCSS() {
    if (cssInjected) return
    GM_addStyle(friendRequestsCSS)
    cssInjected = true
}

/** 更新进度面板（首次调用自动创建并挂到 body）。text 经 renderNode 管线处理（i18n 占位符会被替换） */
function updatePanel(done: number, total: number, text: string) {
    if (isNullOrUndefined(panel) || isNullOrUndefined(panelBar) || isNullOrUndefined(panelText)) {
        ensureCSS()
        panelBar = renderNode({ nodeType: 'div', className: 'friendsApproveBar' }) as HTMLDivElement
        panel = renderNode({
            nodeType: 'div',
            className: 'friendsApprove',
            childs: [
                { nodeType: 'span', className: 'friendsApproveText', childs: text },
                { nodeType: 'div', className: 'friendsApproveTrack', childs: panelBar }
            ],
            attributes: { id: 'pluginFriendsApprovePanel' }
        }) as HTMLDivElement
        panelText = panel.querySelector('.friendsApproveText') as HTMLSpanElement
        panel.style.display = 'none'
        originalNodeAppendChild.call(unsafeWindow.document.body, panel)
    } else {
        // 后续更新复用节点，但文本必须走 renderNode 替换 i18n 占位符（textContent 不经过管线）
        const rendered = renderNode({ nodeType: 'span', className: 'friendsApproveText', childs: text })
        panelText!.replaceWith(rendered)
        panelText = rendered as HTMLSpanElement
    }
    panel!.style.display = ''
    panelBar!.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'
}

/** 隐藏进度面板 */
function hidePanel() {
    if (!isNullOrUndefined(panel)) panel.style.display = 'none'
}

/** 获取当前登录用户（verifyLogin + GET /user） */
async function getMe(): Promise<Iwara.User | null> {
    if (!(await verifyLogin())) return null
    try {
        const res = await unlimitedFetch(`https://${apiEndpoint}/user`, { method: 'GET', headers: await getAuth() })
        if (!res.ok) return null
        return ((await res.json()) as Iwara.LocalUser).user ?? null
    } catch (error) {
        log.warn('获取当前用户失败:', error)
        return null
    }
}

/**
 * 一键批准流程：拉取全部收到的请求 → 逐条按启用条件判定（OR）→ 满足者逐个 POST 批准 → 进度条反馈。
 * 每个批准之间 delay 节流，避免请求风暴。running 防重入。
 */
export async function runApproveAll(): Promise<void> {
    if (running) return
    running = true
    try {
        const me = await getMe()
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
        // 阶段一：条件判定
        const qualified: Iwara.FriendRequestEntry[] = []
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            updatePanel(i, entries.length, `%#friendApproveChecking#% ${i + 1}/${entries.length}`)
            const peer = entry.user.id === me.id ? entry.target : entry.user
            if (await checkApprovalConditions(conditionIds, { user: peer, entry })) qualified.push(entry)
        }
        // 阶段二：逐个批准
        let approved = 0
        for (let i = 0; i < qualified.length; i++) {
            updatePanel(i, qualified.length, `%#friendApproveRunning#% ${i + 1}/${qualified.length}`)
            if (await approveFriendRequest(qualified[i].user.id)) approved++
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

/** 是否好友请求页（/friends/requests） */
export function isFriendRequestsPage(): boolean {
    return getPageTypeFromPath(unsafeWindow.location.hash.trimHead('#').trimHead('!').split('?')[0] || unsafeWindow.location.pathname) === PageType.Friends && unsafeWindow.location.pathname.replace(/\/+$/, '').endsWith('/requests')
}

/**
 * 在 /friends/requests 页注入"一键同意"按钮。重复调用安全（已有注入则跳过）。
 * 按钮挂在官方页头之后；触发由两部分完成：main.ts pageChange（SPA 跳转 + 冷加载）与
 * injectionWatcher 的常驻调度（列表渲染就绪后注入、被 React 清除后补种），本函数不做延时轮询。
 */
export async function injectFriendApproveButton(): Promise<void> {
    if (!isFriendRequestsPage()) return
    if (!isNullOrUndefined(unsafeWindow.document.querySelector('#pluginFriendsApprove'))) return
    if (!(await verifyLogin())) return
    // 官方请求列表（React 异步加载）尚未渲染时立即返回，由 injectionWatcher 监听到就绪后再注入
    if (isNullOrUndefined(unsafeWindow.document.querySelector('.friendRequest, .friend'))) return
    ensureCSS()
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
    log.debug('一键同意按钮已注入 /friends/requests')
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
