import type { ManagerDriver, ManagerId } from './types'
import { scriptcatDriver } from './scriptcat'
import { tampermonkeyDriver } from './tampermonkey'

export type { ManagerDriver, ManagerId }

const DRIVERS: Record<ManagerId, ManagerDriver> = {
    scriptcat: scriptcatDriver,
    tampermonkey: tampermonkeyDriver
}

let cached: ManagerDriver | undefined

/** 解析当前脚本管理器驱动（E2E_MANAGER，缺省 scriptcat；同进程记忆化） */
export function resolveManager(): ManagerDriver {
    if (cached) return cached
    const id = (process.env.E2E_MANAGER ?? 'scriptcat').trim().toLowerCase() as ManagerId
    const driver: ManagerDriver | undefined = DRIVERS[id]
    if (!driver) {
        throw new Error(`未知 E2E_MANAGER=${id}，可选：${Object.keys(DRIVERS).join(' / ')}`)
    }
    cached = driver
    return driver
}
