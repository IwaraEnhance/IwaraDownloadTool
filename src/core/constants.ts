/**
 * 全局常量：GM 存储键 / localStorage 键等（跨模块共享，单一来源）。
 * 新增存储键时在此声明，避免各模块字符串字面量重复、改键名时遗漏。
 */

// ── GM 存储键 ──
/** 调试开关 */
export const GM_KEY_IS_DEBUG = 'isDebug'
/** 首次安装标记（true 时走首次引导） */
export const GM_KEY_IS_FIRST_RUN = 'isFirstRun'
/** 已安装脚本版本号（升级迁移依据） */
export const GM_KEY_VERSION = 'version'
/** 页面选中视频列表（GMSyncDictionary 键名） */
export const GM_KEY_SELECT_LIST = 'selectList'
/** 好友请求一键批准：已启用的审批条件 id 列表（string[]，JSON 存储） */
export const GM_KEY_FRIEND_REQUEST_APPROVAL_CONDITIONS = 'friendRequestApprovalConditions'

// ── localStorage 键 ──
/** Iwara 登录令牌（refresh_token） */
export const LS_KEY_TOKEN = 'token'
/** 缓存的 access token */
export const LS_KEY_ACCESS_TOKEN = 'accessToken'
/** 内容分级偏好 */
export const LS_KEY_RATING = 'rating'
