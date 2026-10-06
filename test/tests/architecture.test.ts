import { Test, TestGroup } from '../framework.ts'

// 架构守护测试（docs/DECOUPLING.md §7）。
//
// 扫描 src 下全部 .ts 文件的相对 import 边，按分层规则表断言：
// 1. 无越权边（层→禁止层）；2. 无 `from '../main'`（组装根不被反向依赖）；
// 3. 无循环依赖（Tarjan 强连通分量）。
//
// 白名单条目 = 待办清单：完成一项删除一条（白名单只许缩小，不许扩大）。

// ── 依赖规则表（§3.1）：dir → 允许的目录集合 ──
// 'main' 表示 src 根的 main.ts；其余为 src/ 下的一级目录
const RULES: Record<string, string[]> = {
    // core：纯基础设施，禁止依赖一切上层
    core: ['core'],
    // context：状态归属地，仅依赖 core
    context: ['core'],
    // network：纯 API 客户端，仅 core + context（site）
    network: ['core', 'context'],
    // download：执行器，仅 core + context
    download: ['core', 'context'],
    // ui：纯渲染，core + context 只读
    ui: ['core', 'context'],
    // features：编排层，可依赖全部下层
    features: ['core', 'context', 'network', 'download', 'ui', 'features'],
    // main：组装根，可依赖一切
    main: ['core', 'context', 'network', 'download', 'ui', 'features']
}

/** 越权边白名单（遗留收口项；格式 'from-dir/file -> to-dir'，完成即删） */
const EDGE_WHITELIST: ReadonlySet<string> = new Set([
    // §E 收口已完成（2026-09-26）：download 执行器与 envCheck 的用户报告改走 core/notify 通道，白名单清零
])

/** 循环依赖白名单（应恒为空；出现即待办） */
const CYCLE_WHITELIST: ReadonlySet<string> = new Set([])

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'

const SRC_ROOT = resolve(import.meta.dirname, '../../src')

interface ImportEdge {
    from: string // 相对 src 的路径，如 'core/env.ts' 或 'main.ts'
    to: string // 'core/env.ts' 等
}

/** 递归收集 src 下全部 .ts 文件 */
function collectTsFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) out.push(...collectTsFiles(full))
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
    }
    return out
}

/** 提取一个文件的相对 import 边（忽略类型导入与裸包名） */
function extractEdges(file: string, files: ReadonlySet<string>): ImportEdge[] {
    const text = readFileSync(file, 'utf-8')
    const edges: ImportEdge[] = []
    const fromRel = relative(SRC_ROOT, file).replaceAll('\\', '/')
    const matches = text.matchAll(/import\s+(?:type\s+)?[^'";]*?from\s+['"](\.\.?\/[^'"]+)['"]/g)
    for (const match of matches) {
        const spec = match[1]
        // 相对当前文件解析，归一化到 src 相对路径
        const targetAbs = resolve(dirname(file), spec)
        const toRel = relative(SRC_ROOT, targetAbs).replaceAll('\\', '/')
        if (!files.has(toRel + '.ts') && !files.has(toRel.replace(/\.ts$/, '') + '.ts')) continue
        edges.push({ from: fromRel, to: toRel.endsWith('.ts') ? toRel : toRel + '.ts' })
    }
    return edges
}

function topLevel(rel: string): string {
    return rel.includes('/') ? rel.split('/')[0] : 'main'
}

const architectureTestGroup = new TestGroup('架构守护', '分层依赖规则 + 循环依赖检测（docs/DECOUPLING.md §7）')

const allFiles = collectTsFiles(SRC_ROOT).filter((f) => !f.endsWith('.md'))
const fileSet = new Set(allFiles.map((f) => relative(SRC_ROOT, f).replaceAll('\\', '/').replace(/\.ts$/, '')))
const edges = allFiles.flatMap((f) => extractEdges(f, fileSet))

architectureTestGroup.add(
    new Test('全部相对 import 边符合分层规则', 'async', function () {
        const violations: string[] = []
        for (const edge of edges) {
            const fromDir = topLevel(edge.from)
            const toDir = topLevel(edge.to)
            const allowed = RULES[fromDir]
            if (!allowed) {
                violations.push(`${edge.from}: 未知来源层 '${fromDir}'`)
                continue
            }
            if (!allowed.includes(toDir)) {
                const key = `${edge.from.split('/').slice(0, 2).join('/')} -> ${toDir}`
                if (EDGE_WHITELIST.has(key) || EDGE_WHITELIST.has(`${edge.from} -> ${toDir}`)) continue
                violations.push(`${edge.from} -> ${edge.to} (层 '${fromDir}' 禁止依赖 '${toDir}')`)
            }
        }
        this.assertTrue(violations.length === 0, `存在越权依赖边:\n${violations.join('\n')}`)
    })
)

architectureTestGroup.add(
    new Test('组装根 main.ts 不被任何模块反向依赖', 'async', function () {
        const offenders = edges.filter((e) => topLevel(e.to) === 'main').map((e) => `${e.from} -> ${e.to}`)
        this.assertTrue(offenders.length === 0, `禁止 import main（状态经 context、动作经注入）:\n${offenders.join('\n')}`)
    })
)

architectureTestGroup.add(
    new Test('无循环依赖（Tarjan 强连通分量）', 'async', function () {
        // 构建邻接表（仅相对 import）
        const adj = new Map<string, string[]>()
        for (const edge of edges) {
            const list = adj.get(edge.from) ?? []
            list.push(edge.to)
            adj.set(edge.from, list)
        }
        // 迭代式 Tarjan
        const index = new Map<string, number>()
        const low = new Map<string, number>()
        const onStack = new Set<string>()
        const stack: string[] = []
        let counter = 0
        const sccs: string[][] = []
        const visited = new Set<string>()

        function strongConnect(node: string): void {
            const work: Array<{ node: string; childIdx: number }> = [{ node, childIdx: 0 }]
            while (work.length > 0) {
                const frame = work[work.length - 1]
                if (frame.childIdx === 0) {
                    index.set(frame.node, counter)
                    low.set(frame.node, counter)
                    counter++
                    stack.push(frame.node)
                    onStack.add(frame.node)
                    visited.add(frame.node)
                }
                const children = adj.get(frame.node) ?? []
                let recursed = false
                while (frame.childIdx < children.length) {
                    const next = children[frame.childIdx]
                    frame.childIdx++
                    if (!index.has(next)) {
                        work.push({ node: next, childIdx: 0 })
                        recursed = true
                        break
                    } else if (onStack.has(next)) {
                        low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!))
                    }
                }
                if (recursed) continue
                if (low.get(frame.node) === index.get(frame.node)) {
                    const scc: string[] = []
                    let member: string
                    do {
                        member = stack.pop()!
                        onStack.delete(member)
                        scc.push(member)
                    } while (member !== frame.node)
                    if (scc.length > 1) sccs.push(scc)
                }
                work.pop()
                if (work.length > 0) {
                    const parent = work[work.length - 1]
                    low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
                }
            }
        }

        for (const node of adj.keys()) {
            if (!visited.has(node)) strongConnect(node)
        }

        const cycles = sccs.map((s) => s.sort().join(' <-> '))
        const unexpected = cycles.filter((c) => !CYCLE_WHITELIST.has(c))
        this.assertTrue(unexpected.length === 0, `存在循环依赖:\n${unexpected.join('\n')}`)
    })
)

export default architectureTestGroup
