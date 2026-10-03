import type { ManagerDriver, ManagerId } from './types'
import { scriptcatDriver } from './scriptcat'
import { tampermonkeyDriver } from './tampermonkey'

export type { ManagerDriver, ManagerId }

/** 未实现驱动占位：E2E_MANAGER 选到时给出明确指引，而不是静默回退已实现驱动 */
function notImplemented(id: Exclude<ManagerId, 'scriptcat' | 'tampermonkey'>): ManagerDriver {
    const unavailable = async (): Promise<never> => {
        throw new Error(`E2E_MANAGER=${id} 尚未实现：当前可用 scriptcat（缺省）/ tampermonkey；接入方式见 e2e/managers/types.ts 的 ManagerDriver 接口`)
    }
    return {
        id,
        resolveExtension: unavailable,
        installScript: unavailable
    }
}

const DRIVERS: Record<ManagerId, ManagerDriver> = {
    scriptcat: scriptcatDriver,
    tampermonkey: tampermonkeyDriver,
    violentmonkey: notImplemented('violentmonkey')
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
