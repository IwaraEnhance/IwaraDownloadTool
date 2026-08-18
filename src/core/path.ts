import './env'
import { hasFunction, isNullOrUndefined, stringify } from './env'

/** 变量占位符分隔符（与 String.prototype.replaceVariable 默认前缀/后缀一致） */
const VARIABLE_PREFIX = '%#'
const VARIABLE_SUFFIX = '#%'

/** 将字符串转义为正则安全形式（参考 replaceVariable 内部实现） */
function escapeRegex(str: string): string {
    return str.replace(/[\.\*\+\?\^\$\{\}\(\)\|\[\]\\]/g, '\\$&')
}

/**
 * 路径段中的原子组成部分
 * - literal: 字面文本
 * - variable: 变量引用，形如 %#name#% 或 %#name:format#%
 */
type PathPart = { kind: 'literal'; value: string } | { kind: 'variable'; name: string; format: string | null }

/**
 * 词法单元
 * - sep: 路径分隔符（\ 或 /，记录原始字符以辅助类型判定）
 * - text: 分隔符之间的非空段文本（含变量占位符，由 parseParts 进一步切分）
 */
type PathToken = { kind: 'sep'; char: '\\' | '/' } | { kind: 'text'; value: string }

/**
 * 路径段节点
 * - kind: 段语义（"." 为 dot，".." 为 dotdot，其余为 name）
 * - parts: 段内的原子列表（字面文本 + 变量引用）
 */
interface PathSegment {
    kind: 'name' | 'dot' | 'dotdot'
    parts: PathPart[]
}

/**
 * 路径语法树（AST）
 * - type: 路径类型
 * - root: 根节点（Windows 盘符 "C:" / Unix 根 "/"，相对路径为 null）
 * - segments: 段节点列表（不含根，空段与尾部分隔符已剥离）
 */
interface PathAST {
    type: 'Windows' | 'Unix' | 'Relative'
    root: string | null
    segments: PathSegment[]
}

/**
 * 路径处理类
 * 实现LocalPath接口，提供路径解析和规范化功能
 * 支持Windows、Unix和相对路径
 *
 * 基于 AST 实现：构造时先把路径字符串解析为语法树（词法层把 %#变量#% 识别为独立节点），
 * 再依次执行 语义校验 → 规范化（解析 "./.." 导航）→ 提取目录/文件名/基础名/扩展名。
 * 变量节点在 AST 中保持为不透明节点，渲染时还原为 %#name#% / %#name:format#% 形式，
 * 可通过 resolve() 一次性替换为实际值。
 */
export class Path implements LocalPath {
    public readonly fullPath: string // 归一化后的完整路径
    public readonly directory: string // 目录部分
    public readonly fullName: string // 文件名（包含拓展名）
    public readonly type: 'Windows' | 'Unix' | 'Relative'
    public readonly extension: string // 拓展名（不含点）
    public readonly baseName: string // 文件名（不含拓展名）

    /** 解析出的路径语法树（含变量节点），可供后续解释/渲染复用 */
    public readonly ast: PathAST

    /** 规范化后的语法树（已解析 "./.." 导航），供 resolve() 等解释器复用 */
    private readonly normalized: PathAST

    /**
     * 构造函数：解析为 AST → 校验 → 规范化 → 提取各组成部分
     * @param input 输入路径字符串（可含 %#变量#% / %#变量:格式#%）
     * @param validate 是否校验路径合法性（默认 true）
     * @throws 如果路径为空、为 UNC、非法或导航越界
     */
    constructor(input: string, validate: boolean = true) {
        // 空路径处理
        if (input === '') {
            throw new Error('路径不能为空')
        }

        // 不接受UNC路径（以"\\\\"开头）
        if (input.startsWith('\\\\')) {
            throw new Error('不接受UNC路径')
        }

        // 词法 + 语法分析：解析为 AST
        const ast = Path.parse(input)
        this.type = ast.type
        this.ast = ast

        // 语义校验（基于 AST：变量名豁免非法字符，变量格式参数仍需检查）
        if (validate) Path.validate(ast)

        // 语义分析：解析 "." 与 ".." 导航，得到规范化 AST
        const normalized = Path.normalize(ast)
        this.normalized = normalized

        // 解释执行：从规范化 AST 提取各组成部分
        this.fullPath = Path.render(normalized)
        this.directory = Path.extractDirectory(normalized)
        this.fullName = Path.extractFileName(normalized)
        const { baseName, extension } = Path.extractBaseAndExtension(this.fullName)
        this.baseName = baseName
        this.extension = extension
    }

    /**
     * 词法分析：将路径字符串切分为词法单元流
     * - 分隔符（\ 或 /）→ sep 单元（记录原始字符以辅助类型判定）
     * - 分隔符之间的非空文本 → text 单元（含变量占位符，由 parseParts 进一步切分）
     * 重复/首尾分隔符自然产生空文本并跳过，无需额外的合并与裁剪处理
     * @param input 原始路径字符串
     * @returns 词法单元流
     */
    private static tokenize(input: string): PathToken[] {
        const tokens: PathToken[] = []
        let start = 0
        for (let i = 0; i <= input.length; i++) {
            const ch = input[i]
            if (ch === '\\' || ch === '/' || i === input.length) {
                // 分隔符之间若有非空文本，产出 text 单元
                if (i > start) {
                    tokens.push({ kind: 'text', value: input.substring(start, i) })
                }
                // 分隔符本身产出 sep 单元
                if (ch === '\\' || ch === '/') {
                    tokens.push({ kind: 'sep', char: ch })
                }
                start = i + 1
            }
        }
        return tokens
    }

    /**
     * 语法分析：将词法单元流解析为 AST
     * 依据单元流判定路径类型与根节点：
     * - 首个单元为盘符文本（如 "C:"）且其后为分隔符 → Windows，根为盘符
     * - 首个单元为 "/" 分隔符 → Unix，根为 "/"
     * - 其余 → Relative（无根，前导分隔符视为冗余直接忽略）
     * 文本单元转为段节点，分隔符单元直接跳过（重复/首尾分隔符自然折叠）
     * @param input 原始路径字符串
     * @returns 路径语法树
     */
    private static parse(input: string): PathAST {
        const tokens = Path.tokenize(input)
        const first = tokens[0]
        const second = tokens[1]

        // 类型判定：盘符 + 分隔符 → Windows；"/" 开头 → Unix；否则 Relative
        const isWindows = first.kind === 'text' && /^[A-Za-z]:$/.test(first.value) && second.kind === 'sep'
        const isUnix = !isWindows && first.kind === 'sep' && first.char === '/'
        const type = isWindows ? 'Windows' : isUnix ? 'Unix' : 'Relative'

        // 根节点：Windows 为盘符、Unix 为 "/"；同时跳过根相关单元
        let root: string | null = null
        let index = 0
        if (isWindows && first.kind === 'text') {
            root = first.value
            index = 2 // 跳过盘符与其后的分隔符
        } else if (isUnix) {
            root = '/'
            index = 1 // 跳过根分隔符
        }

        // 文本单元 → 段节点（含变量原子），分隔符单元忽略
        const segments: PathSegment[] = []
        for (; index < tokens.length; index++) {
            const token = tokens[index]
            if (token.kind === 'sep') continue
            segments.push({
                kind: token.value === '.' ? 'dot' : token.value === '..' ? 'dotdot' : 'name',
                parts: Path.parseParts(token.value)
            })
        }
        return { type, root, segments }
    }

    /**
     * 词法分析：将段文本切分为「字面 + 变量」原子列表
     * 识别 ${VARIABLE_PREFIX}name${VARIABLE_SUFFIX} 与 ${VARIABLE_PREFIX}name:format${VARIABLE_SUFFIX} 两种变量语法
     * @param text 段原始文本
     * @param prefix 变量前缀（默认 %#）
     * @param suffix 变量后缀（默认 #%）
     * @returns 原子列表
     */
    private static parseParts(text: string, prefix: string = VARIABLE_PREFIX, suffix: string = VARIABLE_SUFFIX): PathPart[] {
        const parts: PathPart[] = []
        let lastIndex = 0
        // 动态构建变量正则：前缀/后缀经转义，避免特殊字符干扰（参考 replaceVariable）
        const varRe = new RegExp(`${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 'g')
        let match: RegExpExecArray | null
        while ((match = varRe.exec(text)) !== null) {
            // 变量之前的字面文本
            if (match.index > lastIndex) {
                parts.push({ kind: 'literal', value: text.substring(lastIndex, match.index) })
            }
            // 变量内容：冒号前为变量名，冒号后为格式参数
            const content = match[1]
            const colon = content.indexOf(':')
            if (colon === -1) {
                parts.push({ kind: 'variable', name: content, format: null })
            } else {
                parts.push({
                    kind: 'variable',
                    name: content.substring(0, colon),
                    format: content.substring(colon + 1)
                })
            }
            lastIndex = varRe.lastIndex
        }
        // 变量之后的字面文本
        if (lastIndex < text.length) {
            parts.push({ kind: 'literal', value: text.substring(lastIndex) })
        }
        return parts
    }

    /**
     * 语义校验（基于 AST）
     * 变量节点视为不透明：变量名豁免非法字符检查，变量格式参数仍需检查
     * @param ast 路径语法树
     * @throws 如果路径非法
     */
    private static validate(ast: PathAST): void {
        if (ast.type === 'Windows') {
            if (!ast.root || !/^[A-Za-z]:$/.test(ast.root)) {
                throw new Error('无效的Windows路径格式')
            }
            for (const segment of ast.segments) {
                Path.checkSegmentChars(segment)
            }
        } else if (ast.type === 'Unix') {
            // Unix 路径不进行非法字符检测，仅检查空字符
            Path.checkNullChars(ast)
        } else {
            // 相对路径：非法字符 + 空字符
            for (const segment of ast.segments) {
                Path.checkSegmentChars(segment)
            }
            Path.checkNullChars(ast)
        }
    }

    /**
     * 检查单个段内的字面文本与变量格式参数是否含非法字符
     * @param segment 路径段节点
     * @throws 如果含非法字符
     */
    private static checkSegmentChars(segment: PathSegment): void {
        const invalidChars = /[<>:"|?*]/
        for (const part of segment.parts) {
            if (part.kind === 'literal') {
                if (invalidChars.test(part.value)) {
                    throw new Error(`路径段 "${Path.renderSegment(segment)}" 含有非法字符`)
                }
            } else if (part.format !== null && invalidChars.test(part.format)) {
                throw new Error(`路径变量格式化参数 "${part.format}" 含有非法字符`)
            }
        }
    }

    /**
     * 检查路径中是否含空字符
     * @param ast 路径语法树
     * @throws 如果含空字符
     */
    private static checkNullChars(ast: PathAST): void {
        for (const segment of ast.segments) {
            for (const part of segment.parts) {
                if (part.kind === 'literal' && part.value.indexOf('\0') !== -1) {
                    throw new Error('路径中包含非法空字符')
                }
            }
        }
    }

    /**
     * 规范化：解析 "." 与 ".." 导航
     * 绝对路径导航越界直接抛错，相对路径保留多余的 ".."
     * @param ast 原始语法树
     * @returns 规范化后的语法树
     */
    private static normalize(ast: PathAST): PathAST {
        const isAbsolute = ast.type !== 'Relative'
        const stack: PathSegment[] = []
        for (const segment of ast.segments) {
            if (segment.kind === 'dot') continue
            if (segment.kind === 'dotdot') {
                const top = stack[stack.length - 1]
                if (top && top.kind !== 'dotdot') {
                    stack.pop()
                } else if (isAbsolute) {
                    throw new Error('绝对路径不能越界')
                } else {
                    // 相对路径保留多余的 ".."
                    stack.push(segment)
                }
            } else {
                stack.push(segment)
            }
        }
        return { type: ast.type, root: ast.root, segments: stack }
    }

    /**
     * 解释执行：将 AST 序列化为规范化的路径字符串
     * 变量节点还原为 %#name#% / %#name:format#% 形式
     * @param ast 路径语法树
     * @returns 规范化路径字符串
     */
    private static render(ast: PathAST): string {
        const sep = ast.type === 'Windows' ? '\\' : '/'
        const body = ast.segments.map(Path.renderSegment).join(sep)
        if (ast.type === 'Windows') {
            return ast.root ? ast.root + sep + body : body
        }
        if (ast.type === 'Unix') {
            return '/' + body
        }
        return body
    }

    /**
     * 渲染单个段节点为文本
     * @param segment 路径段节点
     * @returns 段文本
     */
    private static renderSegment(segment: PathSegment): string {
        let text = ''
        for (const part of segment.parts) {
            if (part.kind === 'literal') {
                text += part.value
            } else {
                text += `${VARIABLE_PREFIX}${part.name}${part.format !== null ? ':' + part.format : ''}${VARIABLE_SUFFIX}`
            }
        }
        return text
    }

    /**
     * 提取目录部分
     * 等价于「规范化字符串中最后一个分隔符之前的内容」：
     * - 纯根路径：Windows "C:\\"、Unix "/"、相对 ""
     * - 根下仅一个段：目录即根本身（Windows 为盘符 "C:"，Unix 为 ""）
     * - 多个段：根 + 除末段外的所有段
     * @param ast 规范化后的语法树
     * @returns 目录部分字符串
     */
    private static extractDirectory(ast: PathAST): string {
        const sep = ast.type === 'Windows' ? '\\' : '/'
        const count = ast.segments.length
        if (count === 0) {
            // 纯根路径
            if (ast.type === 'Windows') return (ast.root ?? '') + sep
            if (ast.type === 'Unix') return '/'
            return ''
        }
        if (count === 1) {
            // 根下仅一个段：目录为根本身（Windows 为盘符 "C:"，Unix/相对为 ""）
            if (ast.type === 'Windows') return ast.root ?? ''
            return ''
        }
        const body = ast.segments.slice(0, -1).map(Path.renderSegment).join(sep)
        if (ast.type === 'Windows') return (ast.root ?? '') + sep + body
        if (ast.type === 'Unix') return '/' + body
        return body
    }

    /**
     * 提取文件名部分：最后一个段
     * 无段（纯根路径）返回 ""
     * @param ast 规范化后的语法树
     * @returns 文件名部分字符串
     */
    private static extractFileName(ast: PathAST): string {
        const last = ast.segments[ast.segments.length - 1]
        return last ? Path.renderSegment(last) : ''
    }

    /**
     * 分离文件名和扩展名
     * @param fileName 完整文件名
     * @returns 包含baseName和extension的对象
     *
     * 从文件名中分离基础名称和拓展名
     */
    private static extractBaseAndExtension(fileName: string): { baseName: string; extension: string } {
        const lastDot = fileName.lastIndexOf('.')
        if (lastDot <= 0) {
            return { baseName: fileName, extension: '' }
        }
        return {
            baseName: fileName.substring(0, lastDot),
            extension: fileName.substring(lastDot + 1)
        }
    }

    /**
     * 解析路径中的变量并返回渲染结果
     * 基于规范化 AST 逐变量节点替换，取值语义参考 replaceVariable：
     * - 值含 format 方法且提供了非空格式参数 → stringify(value.format(format))
     * - 值为 Date → value.format('YYYY-MM-DD')
     * - 其余 → stringify(value)
     * - 未提供的变量保持 %#name#% 原样
     * @param replacements 变量名 → 值 的替换表
     * @returns 替换变量后的规范化路径字符串
     * @remarks 替换值本身若包含其他占位符（如值为 "%#ID#%"），委托 replaceVariable 完成剩余循环解析（含循环检测）
     */
    public resolve(replacements: Record<string, unknown>): string {
        const sep = this.type === 'Windows' ? '\\' : '/'
        const body = this.normalized.segments.map((segment) => segment.parts.map((part) => (part.kind === 'literal' ? part.value : Path.resolveValue(part.name, part.format, replacements))).join('')).join(sep)
        const rendered = this.type === 'Windows' ? (this.normalized.root ?? '') + sep + body : this.type === 'Unix' ? '/' + body : body
        // 替换值可能引入新的占位符：委托 replaceVariable 完成剩余循环解析
        return rendered.replaceVariable(replacements)
    }

    /**
     * 解析单个变量节点为字符串（取值语义参考 replaceVariable）
     * @param name 变量名
     * @param format 格式参数（可能为 null）
     * @param replacements 替换表
     * @returns 替换后的字符串；变量未提供时保持 %#name#% 原样
     */
    private static resolveValue(name: string, format: string | null, replacements: Record<string, unknown>): string {
        const value = replacements[name]
        if (isNullOrUndefined(value)) {
            // 未提供该变量：保持占位符原样
            return `${VARIABLE_PREFIX}${name}${format !== null ? ':' + format : ''}${VARIABLE_SUFFIX}`
        }
        if (format !== null && !format.isEmpty() && hasFunction(value, 'format')) {
            return stringify(value.format(format))
        }
        return stringify(value instanceof Date ? value.format('YYYY-MM-DD') : value)
    }
}
