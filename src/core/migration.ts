import { Version } from './version'
import { VersionState } from './enum'
import { createLogger } from './log'
import { isConvertibleToNumber, isNullOrUndefined, isString } from './env'
import { GM_KEY_IS_FIRST_RUN, GM_KEY_SELECT_LIST, GM_KEY_VERSION } from './constants'

const log = createLogger('Migration')

/** 迁移所需的运行时依赖（由调用方注入，避免与 main.ts 循环依赖） */
export interface MigrationDeps {
    /** 页面选择列表（数据结构变更时需清空） */
    selectList: { clear(): void }
    /** 用户提示器（注入：alert 文案由调用方按 i18n 生成，core 不直接依赖 i18n） */
    notifyIncompatible?: () => void
}

export interface Migration {
    from: string
    name: string
    run: (deps: MigrationDeps) => void | Promise<void>
    /** 数据保全型迁移标记：true = 不触发用户提示（notifyIncompatible）。
     * 「配置不兼容需重新配置」提示仅适用于全量重置/清数据类迁移——
     * 数据无损转换型（如 aria2track-queue-split）静默执行即可，弹提示只会误导用户。 */
    silent?: boolean
}

/**
 * 版本迁移注册表：从旧版本升级到当前版本时，按声明顺序执行。
 * - `from`：低于该版本需要执行此迁移（取历史上发布过的最高阈值）
 * - `run`：迁移操作（支持异步，可访问注入的 deps）
 * 新增迁移只需在数组末尾追加一项，无需改动 main() 主流程。
 *
 * 历史阈值演变（git 历史，均为同一语义迁移被更高阈值覆盖）：
 * - 全量重置类（置 isFirstRun=true → 首次引导清空全部配置）：
 *   3.1.164 → 3.2.5 → 3.2.143 → 3.2.153 → 3.3.0，最终阈值 3.3.0 覆盖所有更早版本
 * - selectList 清理类：3.2.76（仅清 selectList），已被 3.3.0 的全量重置覆盖
 * - 清 selectList + 删库类：3.3.22 → 3.3.31，取最高阈值 3.3.31，
 *   避免 [3.3.22, 3.3.31) 的存量用户（曾发布过 v3.3.27~v3.3.31）漏迁移
 *
 * ⚠️ 本模块不得有模块级 db.ts 依赖：db.ts 顶层 `Database.getInstance()` 在 import
 * 时即 open indexedDB（Node/单测环境无此全局直接崩）。需要 db 的迁移在 run 内
 * 动态 import（既延迟加载，又保证迁移注册表可被低依赖环境单测）。
 */
export const migrations: ReadonlyArray<Migration> = [
    // v3.3.0：低于该版本的旧配置结构不兼容，强制走首次安装引导（会清空全部配置）
    { from: '3.3.0', name: 'reset-to-first-run', run: () => GM_setValue(GM_KEY_IS_FIRST_RUN, true) },
    // v3.3.31：selectList / 本地数据库结构变更，清空选择列表与数据库（历史上阈值曾为 3.3.22）
    {
        from: '3.3.31',
        name: 'clear-selectlist-and-db',
        run: async ({ selectList }) => {
            selectList.clear()
            GM_deleteValue(GM_KEY_SELECT_LIST)
            // 动态 import：避免模块级依赖 db.ts（见上方 JSDoc 的模块级依赖禁令）
            const { db } = await import('./db')
            await db.delete()
        }
    },
    // v3.3.129：Aria2Track 队列拆分——旧版把终态记录（completedAt/pushedAt/pushDone 标记的
    // 条目，含 downloadParams/Cookie header，~300B+/条）长期堆在 Aria2TrackQueue 单键里，
    // 每次写全量序列化导致任务多时 GM 存储单键无界膨胀。新版队列只存未终态任务，终态
    // 去重迁到独立瘦表 Aria2TrackDone（videoId → doneAt，~30B/条）。本迁移把旧队列中的
    // 历史终态条目转换为新表记录（保留 30 天去重语义）：doneAt 取各终态时间戳的最精确者
    // （pushedAt > completedAt > addedAt），活任务条目剥掉已废弃字段留队继续追踪。
    // 数据访问直接走 GM 原语（不经 GMSyncDictionary）：迁移必须绕过高层抽象的
    // 「构造即读入内存 + saveToStorage 回写」副作用，直改物理存储。
    {
        from: '3.3.129',
        name: 'aria2track-queue-split',
        // 数据保全型：终态历史无损转换 + 活任务原样保留，无需用户重配不打扰
        silent: true,
        run: () => {
            type LegacyTask = {
                videoId: string
                gid: string
                addedAt?: number
                completedAt?: number
                pushedAt?: number
                pushDone?: boolean
                pushFailedAt?: number
                [key: string]: unknown
            }
            const rawQueue = GM_getValue<unknown>('Aria2TrackQueue', [])
            if (!Array.isArray(rawQueue) || rawQueue.length === 0) return

            // 多标签页隔离：先用占位锁顶住管理器锁键（TTL 30s ≥ 迁移耗时几个数量级），
            // 让其他页面的旧版管理循环 isHeld() 失败而让位——否则旧页会在迁移写盘的
            // 瞬态（oldValue→newValue 中间态）上触发 remote 回调并起 worker。
            // 占位锁无心跳、到点自过期，迁移失败也不死锁；本页后续正常启动时锁已让位
            //（isHeld= false → 重新选举，无竞态）。
            // ⚠️ 直写 GMLock 物理键（{owner, expires}）而非 new GMLock().acquire——
            // 迁移层不引 features 依赖，且不触发 web 后端探测。
            const MIGRATION_LOCK_KEY = 'GMLock:aria2TrackManager'
            const MIGRATION_LOCK_OWNER = 'migration-queue-split'
            GM_setValue(MIGRATION_LOCK_KEY, { owner: MIGRATION_LOCK_OWNER, expires: Date.now() + 30_000 })

            // Aria2TrackDone 物理形态 = GMSyncDictionary 契约的 entries 数组
            //（Array<[videoId, doneAt]>，见 dictionary.toArray）；读取兼容旧对象形态
            //（历史版本曾以对象存储/迁移写入——新页面加载时 filter/validator 会抛，
            // GMSyncDictionary 构造兜底空表后 saveToStorage 反手清盘，迁移成果丢失）
            const rawDone = GM_getValue<unknown>('Aria2TrackDone', [])
            const migrated: Array<[string, number]> = Array.isArray(rawDone)
                ? rawDone.filter((e): e is [string, number] => Array.isArray(e) && isString(e[0]) && isConvertibleToNumber(e[1]))
                : typeof rawDone === 'object' && rawDone !== null
                    ? Object.entries(rawDone as Record<string, unknown>).filter((e): e is [string, number] => isConvertibleToNumber(e[1]))
                    : []
            const doneKeys = new Set(migrated.map(([k]) => k))
            const liveQueue: Array<[string, unknown]> = []
            let doneCount = 0
            for (const [key, value] of rawQueue as Array<[string, LegacyTask]>) {
                if (!isString(key) || !value || !isString(value.videoId)) {
                    liveQueue.push([key, value]) // 结构异常条目原样保留，不做破坏性清理
                    continue
                }
                // 终态判定（与旧版 isAria2TrackDone 语义一致）：推送成功 / 推送已处理 /
                // 已完成且推送未启用——pushFailedAt 单独存在不算终态（worker 仍在重试）
                const isDone =
                    !isNullOrUndefined(value.pushedAt) ||
                    !isNullOrUndefined(value.pushDone) ||
                    (!isNullOrUndefined(value.completedAt) && !value.pushFailedAt)
                if (isDone) {
                    // doneAt 取「完成时刻」的最精确时间戳：pushedAt（推送成功）> completedAt（下载完成）> addedAt
                    const doneAt = [value.pushedAt, value.completedAt, value.addedAt].find(
                        (t): t is number => isConvertibleToNumber(t)
                    )
                    // 已在同表（重复迁移/跨页竞态）不重复计条
                    if (!isNullOrUndefined(doneAt) && !doneKeys.has(key)) {
                        migrated.push([key, doneAt])
                        doneKeys.add(key)
                        doneCount++
                    }
                    continue // 终态条目从队列删除
                }
                // 活任务：剥掉已废弃的终态字段（completedAt/pushDone/pushedAt——理论上非终态
                // 不会有值，防御性删除），保留 pushFailedAt（新版仍在用）
                const { completedAt: _c, pushDone: _p, pushedAt: _pd, ...live } = value
                liveQueue.push([key, live])
            }
            if (doneCount > 0) GM_setValue('Aria2TrackDone', migrated)
            GM_setValue('Aria2TrackQueue', liveQueue)
            // 占位锁即刻释放（迁移完成，其他页面下一轮选举即可接管）；
            // 立删而非等 30s 过期——缩短多标签页恢复窗口
            GM_deleteValue(MIGRATION_LOCK_KEY)
            log.info(`aria2track-queue-split: 终态迁移 ${doneCount} 条 → Aria2TrackDone（entries 形态），活任务 ${liveQueue.length} 条留队`)
        }
    }
]

export type MigrationResult = 'none' | 'reload' | 'failed'

/**
 * 迁移门控语义（重要，勿改回标准 SemVer 比较）：
 * 迁移逻辑随代码携带——`x.y.z-dev.<uuid>` 构建产物的代码本身就是基座 `x.y.z`
 * 发布线的实现（新版数据模型 + 全部已注册迁移都在内）。因此用 baseCompare
 * 仅比较 major.minor.patch：存储中的旧版本基座落后于当前构建基座才需要迁移。
 * `-dev.<uuid>` 预发布段/`+build` 元数据不参与门控（若用标准 compare，dev
 * 版本恒低于正式版会导致每次加载都 pending → reload 死循环，e2e 实测）。
 * 写入端无需任何「剥离」补丁：dev 版本原样写回，基座比较天然 Equal。
 */
export async function runMigrations(deps: MigrationDeps): Promise<MigrationResult> {
    // 全新安装没有版本记录，不属于升级，无需迁移（避免误弹「配置不兼容」）
    const installedVersion = GM_getValue(GM_KEY_VERSION, '')
    if (installedVersion.isEmpty()) return 'none'

    const installed = new Version(installedVersion)
    const pending = migrations.filter(({ from }) => installed.baseCompare(new Version(from)) === VersionState.Low)
    if (pending.length === 0) return 'none'

    // 仅存在需要用户知晓的迁移（非 silent：全量重置/清数据类）时才提示——
    // 纯数据保全型迁移（silent）静默执行，不拉响「配置不兼容」惊扰用户
    if (pending.some((m) => !m.silent)) deps.notifyIncompatible?.()
    for (const { from, name, run } of pending) {
        try {
            log.info(`migration: ${name} (installed < ${from})`)
            await run(deps)
        } catch (error) {
            log.error(`migration failed: ${name}`, error)
            return 'failed'
        }
    }
    // 版本号原样写回（含 dev 预发布段）：门控走 baseCompare 只看基座，
    // 写回什么后缀都不影响下一轮判定；保留完整版本便于调试识别具体构建
    GM_setValue(GM_KEY_VERSION, GM_info.script.version)
    return 'reload'
}
