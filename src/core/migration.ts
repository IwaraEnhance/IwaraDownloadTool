import { Version } from "./version";
import { VersionState } from "./enum";
import { createLogger } from "./log";
import { i18nList } from "../i18n";
import { config } from "./config";
import { db } from "./db";
import { GM_KEY_IS_FIRST_RUN, GM_KEY_SELECT_LIST, GM_KEY_VERSION } from "./constants";

const log = createLogger('Migration');

/** 迁移所需的运行时依赖（由调用方注入，避免与 main.ts 循环依赖） */
export interface MigrationDeps {
    /** 页面选择列表（数据结构变更时需清空） */
    selectList: { clear(): void }
}

export interface Migration {
    from: string
    name: string
    run: (deps: MigrationDeps) => void | Promise<void>
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
            await db.delete()
        },
    },
]

export type MigrationResult = 'none' | 'reload' | 'failed'

/**
 * 执行所有需要运行的版本迁移。
 * @param deps 迁移所需的运行时依赖
 * @returns 'none'   无需迁移（含全新安装）
 *          'reload' 迁移完成，版本号已更新，需要重载页面
 *          'failed' 迁移失败，中止启动（版本号未更新，下次启动自动重试）
 */
export async function runMigrations(deps: MigrationDeps): Promise<MigrationResult> {
    // 全新安装没有版本记录，不属于升级，无需迁移（避免误弹「配置不兼容」）
    const installedVersion = GM_getValue(GM_KEY_VERSION, '')
    if (installedVersion.isEmpty()) return 'none'

    const installed = new Version(installedVersion)
    const pending = migrations.filter(({ from }) => installed.compare(new Version(from)) === VersionState.Low)
    if (pending.length === 0) return 'none'

    alert(i18nList[config.language].configurationIncompatible)
    for (const { from, name, run } of pending) {
        try {
            log.info(`migration: ${name} (installed < ${from})`)
            await run(deps)
        } catch (error) {
            log.error(`migration failed: ${name}`, error)
            return 'failed'
        }
    }
    GM_setValue(GM_KEY_VERSION, GM_info.script.version)
    return 'reload'
}
