/**
 * 人在模式（HITL，Human-In-The-Loop）：每个用例执行完毕后暂停，等待人类在终端
 * 目视确认测试结果（有头窗口中的页面状态、脚本行为等自动化断言覆盖不了的部分）。
 *
 * 开关：E2E_HUMAN=1 启用；未启用时 fixtures 不注入本钩子（自动化模式零开销）。
 *
 * 交互：终端提示 [y]通过 / [f]失败（标记用例失败）/ [r]重跑（重新执行用例体）。
 * 有头窗口在该阶段保持打开，供人工检查页面/脚本 UI；确认后按驱动 cleanup 收尾。
 */
import { createInterface } from 'node:readline'

export type HumanVerdict = 'pass' | 'fail' | 'retry'

const HUMAN_MODE = /^(1|true|yes)$/i.test(process.env.E2E_HUMAN?.trim() ?? '')

/** 是否启用人在模式（E2E_HUMAN=1） */
export function isHumanMode(): boolean {
    return HUMAN_MODE
}

/** 人在模式下单用例超时放宽（人工目视检查耗时不可控；默认 10 分钟） */
export function humanTimeoutMs(): number {
    return Number(process.env.E2E_HUMAN_TIMEOUT ?? 600_000)
}

/** 从 stdin 读一行（终端交互；EOF/流关闭返回空串） */
function readLine(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, terminal: true })
        process.stdout.write(prompt)
        const timeout = setTimeout(() => {
            // 保护自动化环境（无 stdin）：30 秒无输入按失败处理，避免挂死
            rl.close()
            resolve('')
        }, 30_000)
        rl.once('line', (line) => {
            clearTimeout(timeout)
            rl.close()
            resolve(line.trim().toLowerCase())
        })
        rl.once('close', () => resolve(''))
    })
}

/**
 * 人工确认循环：返回 'pass' 或 'fail'（'retry' 时由调用方重新执行用例体）。
 * prompt 展示用例标题与自动化断言结果，人类对照有头窗口目视检查后按键。
 */
export async function askVerdict(
    info: { title: string; durationMs: number },
    autoPassed: boolean
): Promise<HumanVerdict> {
    console.log(
        `\n[human] ═══ 人工确认 ═══ ${info.title}\n` +
        `[human] 自动化断言: ${autoPassed ? '✓ 通过' : '✗ 失败'}（耗 ${Math.round(info.durationMs)}ms）\n` +
        '[human] 请目视检查有头窗口中的页面/脚本行为，然后选择:\n' +
        '[human]   y = 通过  f = 失败  r = 重跑用例'
    )
    for (; ;) {
        const line = await readLine('[human] 请输入 (y/f/r): ')
        if (line === 'y' || line === 'f' || line === 'r') return line as HumanVerdict
        if (line === '') {
            // stdin 不可用（CI/无终端）：跟随自动化结果，避免挂死
            console.log('[human] 无终端输入，跟随自动化断言结果')
            return autoPassed ? 'pass' : 'fail'
        }
        console.log('[human] 无效输入，请输入 y / f / r')
    }
}
