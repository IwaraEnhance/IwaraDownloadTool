import "./env";
import { hasFunction, isNullOrUndefined, isVideoInfo, prune, stringify, UUID } from "./env";
import { VersionState } from "./enum";
import { originalAddEventListener, originalRemoveEventListener } from "./hijack";

/** 变量占位符分隔符（与 String.prototype.replaceVariable 默认前缀/后缀一致） */
const VARIABLE_PREFIX = '%#';
const VARIABLE_SUFFIX = '#%';

/** 将字符串转义为正则安全形式（参考 replaceVariable 内部实现） */
function escapeRegex(str: string): string {
    return str.replace(/[\.\*\+\?\^\$\{\}\(\)\|\[\]\\]/g, '\\$&');
}

/**
 * 路径段中的原子组成部分
 * - literal: 字面文本
 * - variable: 变量引用，形如 %#name#% 或 %#name:format#%
 */
type PathPart =
    | { kind: 'literal'; value: string }
    | { kind: 'variable'; name: string; format: string | null };

/**
 * 词法单元
 * - sep: 路径分隔符（\ 或 /，记录原始字符以辅助类型判定）
 * - text: 分隔符之间的非空段文本（含变量占位符，由 parseParts 进一步切分）
 */
type PathToken =
    | { kind: 'sep'; char: '\\' | '/' }
    | { kind: 'text'; value: string };

/**
 * 路径段节点
 * - kind: 段语义（"." 为 dot，".." 为 dotdot，其余为 name）
 * - parts: 段内的原子列表（字面文本 + 变量引用）
 */
interface PathSegment {
    kind: 'name' | 'dot' | 'dotdot';
    parts: PathPart[];
}

/**
 * 路径语法树（AST）
 * - type: 路径类型
 * - root: 根节点（Windows 盘符 "C:" / Unix 根 "/"，相对路径为 null）
 * - segments: 段节点列表（不含根，空段与尾部分隔符已剥离）
 */
interface PathAST {
    type: 'Windows' | 'Unix' | 'Relative';
    root: string | null;
    segments: PathSegment[];
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
    public readonly fullPath: string;   // 归一化后的完整路径
    public readonly directory: string;  // 目录部分
    public readonly fullName: string;   // 文件名（包含拓展名）
    public readonly type: 'Windows' | 'Unix' | 'Relative';
    public readonly extension: string;  // 拓展名（不含点）
    public readonly baseName: string;   // 文件名（不含拓展名）

    /** 解析出的路径语法树（含变量节点），可供后续解释/渲染复用 */
    public readonly ast: PathAST;

    /** 规范化后的语法树（已解析 "./.." 导航），供 resolve() 等解释器复用 */
    private readonly normalized: PathAST;

    /**
     * 构造函数：解析为 AST → 校验 → 规范化 → 提取各组成部分
     * @param input 输入路径字符串（可含 %#变量#% / %#变量:格式#%）
     * @param validate 是否校验路径合法性（默认 true）
     * @throws 如果路径为空、为 UNC、非法或导航越界
     */
    constructor(input: string, validate: boolean = true) {
        // 空路径处理
        if (input === "") {
            throw new Error("路径不能为空");
        }

        // 不接受UNC路径（以"\\\\"开头）
        if (input.startsWith('\\\\')) {
            throw new Error("不接受UNC路径");
        }

        // 词法 + 语法分析：解析为 AST
        const ast = Path.parse(input);
        this.type = ast.type;
        this.ast = ast;

        // 语义校验（基于 AST：变量名豁免非法字符，变量格式参数仍需检查）
        if (validate) Path.validate(ast);

        // 语义分析：解析 "." 与 ".." 导航，得到规范化 AST
        const normalized = Path.normalize(ast);
        this.normalized = normalized;

        // 解释执行：从规范化 AST 提取各组成部分
        this.fullPath = Path.render(normalized);
        this.directory = Path.extractDirectory(normalized);
        this.fullName = Path.extractFileName(normalized);
        const { baseName, extension } = Path.extractBaseAndExtension(this.fullName);
        this.baseName = baseName;
        this.extension = extension;
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
        const tokens: PathToken[] = [];
        let start = 0;
        for (let i = 0; i <= input.length; i++) {
            const ch = input[i];
            if (ch === '\\' || ch === '/' || i === input.length) {
                // 分隔符之间若有非空文本，产出 text 单元
                if (i > start) {
                    tokens.push({ kind: 'text', value: input.substring(start, i) });
                }
                // 分隔符本身产出 sep 单元
                if (ch === '\\' || ch === '/') {
                    tokens.push({ kind: 'sep', char: ch });
                }
                start = i + 1;
            }
        }
        return tokens;
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
        const tokens = Path.tokenize(input);
        const first = tokens[0];
        const second = tokens[1];

        // 类型判定：盘符 + 分隔符 → Windows；"/" 开头 → Unix；否则 Relative
        const isWindows = first.kind === 'text'
            && /^[A-Za-z]:$/.test(first.value)
            && second.kind === 'sep';
        const isUnix = !isWindows && first.kind === 'sep' && first.char === '/';
        const type = isWindows ? 'Windows' : isUnix ? 'Unix' : 'Relative';

        // 根节点：Windows 为盘符、Unix 为 "/"；同时跳过根相关单元
        let root: string | null = null;
        let index = 0;
        if (isWindows && first.kind === 'text') {
            root = first.value;
            index = 2; // 跳过盘符与其后的分隔符
        } else if (isUnix) {
            root = '/';
            index = 1; // 跳过根分隔符
        }

        // 文本单元 → 段节点（含变量原子），分隔符单元忽略
        const segments: PathSegment[] = [];
        for (; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.kind === 'sep') continue;
            segments.push({
                kind: token.value === '.' ? 'dot' : token.value === '..' ? 'dotdot' : 'name',
                parts: Path.parseParts(token.value),
            });
        }
        return { type, root, segments };
    }

    /**
     * 词法分析：将段文本切分为「字面 + 变量」原子列表
     * 识别 ${VARIABLE_PREFIX}name${VARIABLE_SUFFIX} 与 ${VARIABLE_PREFIX}name:format${VARIABLE_SUFFIX} 两种变量语法
     * @param text 段原始文本
     * @param prefix 变量前缀（默认 %#）
     * @param suffix 变量后缀（默认 #%）
     * @returns 原子列表
     */
    private static parseParts(
        text: string,
        prefix: string = VARIABLE_PREFIX,
        suffix: string = VARIABLE_SUFFIX
    ): PathPart[] {
        const parts: PathPart[] = [];
        let lastIndex = 0;
        // 动态构建变量正则：前缀/后缀经转义，避免特殊字符干扰（参考 replaceVariable）
        const varRe = new RegExp(`${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 'g');
        let match: RegExpExecArray | null;
        while ((match = varRe.exec(text)) !== null) {
            // 变量之前的字面文本
            if (match.index > lastIndex) {
                parts.push({ kind: 'literal', value: text.substring(lastIndex, match.index) });
            }
            // 变量内容：冒号前为变量名，冒号后为格式参数
            const content = match[1];
            const colon = content.indexOf(':');
            if (colon === -1) {
                parts.push({ kind: 'variable', name: content, format: null });
            } else {
                parts.push({
                    kind: 'variable',
                    name: content.substring(0, colon),
                    format: content.substring(colon + 1),
                });
            }
            lastIndex = varRe.lastIndex;
        }
        // 变量之后的字面文本
        if (lastIndex < text.length) {
            parts.push({ kind: 'literal', value: text.substring(lastIndex) });
        }
        return parts;
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
                throw new Error("无效的Windows路径格式");
            }
            for (const segment of ast.segments) {
                Path.checkSegmentChars(segment);
            }
        } else if (ast.type === 'Unix') {
            // Unix 路径不进行非法字符检测，仅检查空字符
            Path.checkNullChars(ast);
        } else {
            // 相对路径：非法字符 + 空字符
            for (const segment of ast.segments) {
                Path.checkSegmentChars(segment);
            }
            Path.checkNullChars(ast);
        }
    }

    /**
     * 检查单个段内的字面文本与变量格式参数是否含非法字符
     * @param segment 路径段节点
     * @throws 如果含非法字符
     */
    private static checkSegmentChars(segment: PathSegment): void {
        const invalidChars = /[<>:"|?*]/;
        for (const part of segment.parts) {
            if (part.kind === 'literal') {
                if (invalidChars.test(part.value)) {
                    throw new Error(`路径段 "${Path.renderSegment(segment)}" 含有非法字符`);
                }
            } else if (part.format !== null && invalidChars.test(part.format)) {
                throw new Error(`路径变量格式化参数 "${part.format}" 含有非法字符`);
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
                    throw new Error("路径中包含非法空字符");
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
        const isAbsolute = ast.type !== 'Relative';
        const stack: PathSegment[] = [];
        for (const segment of ast.segments) {
            if (segment.kind === 'dot') continue;
            if (segment.kind === 'dotdot') {
                const top = stack[stack.length - 1];
                if (top && top.kind !== 'dotdot') {
                    stack.pop();
                } else if (isAbsolute) {
                    throw new Error("绝对路径不能越界");
                } else {
                    // 相对路径保留多余的 ".."
                    stack.push(segment);
                }
            } else {
                stack.push(segment);
            }
        }
        return { type: ast.type, root: ast.root, segments: stack };
    }

    /**
     * 解释执行：将 AST 序列化为规范化的路径字符串
     * 变量节点还原为 %#name#% / %#name:format#% 形式
     * @param ast 路径语法树
     * @returns 规范化路径字符串
     */
    private static render(ast: PathAST): string {
        const sep = ast.type === 'Windows' ? '\\' : '/';
        const body = ast.segments.map(Path.renderSegment).join(sep);
        if (ast.type === 'Windows') {
            return ast.root ? ast.root + sep + body : body;
        }
        if (ast.type === 'Unix') {
            return '/' + body;
        }
        return body;
    }

    /**
     * 渲染单个段节点为文本
     * @param segment 路径段节点
     * @returns 段文本
     */
    private static renderSegment(segment: PathSegment): string {
        let text = '';
        for (const part of segment.parts) {
            if (part.kind === 'literal') {
                text += part.value;
            } else {
                text += `${VARIABLE_PREFIX}${part.name}${part.format !== null ? ':' + part.format : ''}${VARIABLE_SUFFIX}`;
            }
        }
        return text;
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
        const sep = ast.type === 'Windows' ? '\\' : '/';
        const count = ast.segments.length;
        if (count === 0) {
            // 纯根路径
            if (ast.type === 'Windows') return (ast.root ?? '') + sep;
            if (ast.type === 'Unix') return '/';
            return '';
        }
        if (count === 1) {
            // 根下仅一个段：目录为根本身（Windows 为盘符 "C:"，Unix/相对为 ""）
            if (ast.type === 'Windows') return ast.root ?? '';
            return '';
        }
        const body = ast.segments.slice(0, -1).map(Path.renderSegment).join(sep);
        if (ast.type === 'Windows') return (ast.root ?? '') + sep + body;
        if (ast.type === 'Unix') return '/' + body;
        return body;
    }

    /**
     * 提取文件名部分：最后一个段
     * 无段（纯根路径）返回 ""
     * @param ast 规范化后的语法树
     * @returns 文件名部分字符串
     */
    private static extractFileName(ast: PathAST): string {
        const last = ast.segments[ast.segments.length - 1];
        return last ? Path.renderSegment(last) : '';
    }

    /**
     * 分离文件名和扩展名
     * @param fileName 完整文件名
     * @returns 包含baseName和extension的对象
     * 
     * 从文件名中分离基础名称和拓展名
     */
    private static extractBaseAndExtension(fileName: string): { baseName: string; extension: string } {
        const lastDot = fileName.lastIndexOf('.');
        if (lastDot <= 0) {
            return { baseName: fileName, extension: '' };
        }
        return {
            baseName: fileName.substring(0, lastDot),
            extension: fileName.substring(lastDot + 1),
        };
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
        const sep = this.type === 'Windows' ? '\\' : '/';
        const body = this.normalized.segments
            .map((segment) => segment.parts
                .map((part) => part.kind === 'literal'
                    ? part.value
                    : Path.resolveValue(part.name, part.format, replacements))
                .join(''))
            .join(sep);
        const rendered = this.type === 'Windows'
            ? (this.normalized.root ?? '') + sep + body
            : this.type === 'Unix' ? '/' + body : body;
        // 替换值可能引入新的占位符：委托 replaceVariable 完成剩余循环解析
        return rendered.replaceVariable(replacements);
    }

    /**
     * 解析单个变量节点为字符串（取值语义参考 replaceVariable）
     * @param name 变量名
     * @param format 格式参数（可能为 null）
     * @param replacements 替换表
     * @returns 替换后的字符串；变量未提供时保持 %#name#% 原样
     */
    private static resolveValue(
        name: string,
        format: string | null,
        replacements: Record<string, unknown>
    ): string {
        const value = replacements[name];
        if (isNullOrUndefined(value)) {
            // 未提供该变量：保持占位符原样
            return `${VARIABLE_PREFIX}${name}${format !== null ? ':' + format : ''}${VARIABLE_SUFFIX}`;
        }
        if (format !== null && !format.isEmpty() && hasFunction(value, 'format')) {
            return stringify(value.format(format));
        }
        return stringify(value instanceof Date ? value.format('YYYY-MM-DD') : value);
    }
}

/**
 * 版本号接口
 * 遵循语义化版本规范(SemVer)
 */
declare interface IVersion {
    major: number;
    minor: number;
    patch: number;
    preRelease: string[];
    buildMetadata: string;
    compare(other: IVersion): VersionState;
}
/**
 * 版本号实现类
 * 支持语义化版本比较和解析
 */
export class Version implements IVersion {
    major: number;
    minor: number;
    patch: number;
    preRelease: string[];
    buildMetadata: string;
    /**
     * 构造函数
     * @param versionString 版本号字符串
     * @throws 如果版本号格式无效
     */
    constructor(versionString: string) {
        if (!versionString || typeof versionString !== 'string') {
            throw new Error("Invalid version string");
        }

        // 解析语义化版本  MAJOR.MINOR.PATCH-PRE_RELEASE+BUILD_METADATA
        const dashIndex = versionString.indexOf('-');
        const plusIndex = versionString.indexOf('+');

        let version: string, preRelease: string, buildMetadata: string;

        if (dashIndex === -1 && plusIndex === -1) {
            // 纯版本号: "1.2.3"
            version = versionString;
            preRelease = '';
            buildMetadata = '';
        } else if (plusIndex !== -1 && (dashIndex === -1 || plusIndex < dashIndex)) {
            // 仅构建元数据，无预发布: "1.0.0+build"
            version = versionString.substring(0, plusIndex);
            preRelease = '';
            buildMetadata = versionString.substring(plusIndex + 1);
        } else {
            // 有预发布（可能还有构建元数据）: "1.0.0-alpha.1" 或 "1.0.0-beta+sha.1234"
            version = versionString.substring(0, dashIndex);
            const rest = versionString.substring(dashIndex + 1);
            const buildSep = rest.indexOf('+');
            if (buildSep !== -1) {
                preRelease = rest.substring(0, buildSep);
                buildMetadata = rest.substring(buildSep + 1);
            } else {
                preRelease = rest;
                buildMetadata = '';
            }
        }

        const versionParts = version.split('.').map(Number);
        if (versionParts.some(isNaN)) {
            throw new Error("Version string contains invalid numbers");
        }
        this.major = versionParts[0] || 0;
        this.minor = versionParts.length > 1 ? versionParts[1] : 0;
        this.patch = versionParts.length > 2 ? versionParts[2] : 0;
        this.preRelease = preRelease ? preRelease.split('.') : [];
        this.buildMetadata = buildMetadata || '';
    }
    private static compareValues<T extends number | string>(a: T, b: T): VersionState {
        if (a < b) return VersionState.Low;
        if (a > b) return VersionState.High;
        return VersionState.Equal;
    }
    /**
     * 比较版本号
     * @param other 要比较的版本号
     * @returns 比较结果状态
     */
    public compare(other: IVersion): VersionState {
        let state = Version.compareValues(this.major, other.major);
        if (state !== VersionState.Equal) return state;
        state = Version.compareValues(this.minor, other.minor);
        if (state !== VersionState.Equal) return state;
        state = Version.compareValues(this.patch, other.patch);
        if (state !== VersionState.Equal) return state;

        // SemVer 规则 11: 有预发布版本 < 无预发布版本
        if (this.preRelease.length === 0 && other.preRelease.length > 0) {
            return VersionState.High; // 1.0.0 > 1.0.0-alpha
        }
        if (this.preRelease.length > 0 && other.preRelease.length === 0) {
            return VersionState.Low;  // 1.0.0-alpha < 1.0.0
        }

        // 从左到右逐段比较预发布标识符
        const maxLen = Math.max(this.preRelease.length, other.preRelease.length);
        for (let i = 0; i < maxLen; i++) {
            // SemVer 规则 12: 字段更多者优先级更高
            if (i >= this.preRelease.length) return VersionState.Low;
            if (i >= other.preRelease.length) return VersionState.High;

            const pre1 = this.preRelease[i];
            const pre2 = other.preRelease[i];

            const isNum1 = !isNaN(+pre1);
            const isNum2 = !isNaN(+pre2);

            // SemVer 规则 11: 数字标识符 < 字母标识符
            if (isNum1 && !isNum2) return VersionState.Low;
            if (!isNum1 && isNum2) return VersionState.High;

            const val1 = isNum1 ? +pre1 : pre1;
            const val2 = isNum2 ? +pre2 : pre2;

            if (val1 < val2) return VersionState.Low;
            if (val1 > val2) return VersionState.High;
        }

        return VersionState.Equal;
    }
    /**
     * 转换为字符串
     * @returns 语义化版本字符串
     */
    public toString(): string {
        const version = `${this.major}.${this.minor}.${this.patch}`;
        const preRelease = this.preRelease.length ? `-${this.preRelease.join('.')}` : '';
        const buildMetadata = this.buildMetadata ? `+${this.buildMetadata}` : '';
        return `${version}${preRelease}${buildMetadata}`;
    }
}

/**
 * 字典类
 * 扩展原生Map，提供更方便的转换方法
 * @template T 值类型
 */
export class Dictionary<T> extends Map<string, T> {
    constructor(data: Array<[string, T]> = []) {
        // 不用 super(data) 填充：Map 构造器内部通过 this.set() 添加元素，
        // 若子类 override 了 set（如 SyncDictionary），会在子类自身字段
        // （如 channel）初始化前被调用而崩溃。改用 super.set() 直接填充。
        super()
        for (const [key, value] of data) {
            super.set(key, value)
        }
    }
    public toArray(): Array<[string, T]> {
        return Array.from(this)
    }
    public keysArray(): Array<string> {
        return Array.from(this.keys())
    }
    public valuesArray(): Array<T> {
        return Array.from(this.values())
    }
}

export class GMSyncDictionary<T> extends Dictionary<T> {
    /** 当通过 set 或接收消息设置时触发 */
    public onSet?: (key: string, value: T) => void;
    /** 当删除时触发 */
    public onDel?: (key: string) => void;
    /** 完成初次或增量同步后触发 */
    public onSync?: () => void;

    private name: string;
    private listenerId: number | null = null;
    private static readonly BATCH_THRESHOLD = 10;

    /**
     * 构造函数
     * @param name 存储在GM_setValue中的键名
     * @param initial 初始值列表
     * @param validator 值校验器（默认校验 VideoInfo，可传入自定义校验以存储其他类型）
     */
    constructor(name: string, initial: Array<[string, T]> = [], validator: (value: unknown) => boolean = isVideoInfo) {
        let stored = initial.any() ? initial : GM_getValue(name, initial);
        try {
            super(stored.filter(([_, value]) => validator(value)));
        } catch (error) {
            super()
        }
        this.name = name;
        this.saveToStorage();
        this.setupValueChangeListener();
    }

    /**
     * 设置GM值变化监听器
     */
    private setupValueChangeListener(): void {
        // 移除现有的监听器（如果有）
        if (this.listenerId !== null) {
            GM_removeValueChangeListener(this.listenerId);
        }
        this.listenerId = GM_addValueChangeListener(
            this.name,
            (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => {
                // 只有远程变化才需要处理（其他标签页的修改）
                if (key === this.name && remote) {
                    this.handleRemoteChange(newValue as [string, T][]);
                }
            }
        );
    }

    /**
     * 处理远程变化
     * @param newValue 新的值
     */
    private handleRemoteChange(newValue: [string, T][]): void {
        if (isNullOrUndefined(newValue)) {
            // 如果新值为空，清空字典
            super.clear();
            this.onSync?.();
            return;
        }
        const currentKeys = new Set(this.keys());
        const addedOrUpdated: Array<[string, T]> = [];
        const deleted: string[] = [];
        for (const [key, value] of newValue) {
            if (!currentKeys.has(key)) {
                addedOrUpdated.push([key, value]);
            } else {
                const currentValue = this.get(key);
                if (currentValue !== value) {
                    addedOrUpdated.push([key, value]);
                }
                currentKeys.delete(key);
            }
        }
        for (const key of currentKeys) {
            deleted.push(key);
        }
        const totalChanges = addedOrUpdated.length + deleted.length;
        if (totalChanges > GMSyncDictionary.BATCH_THRESHOLD) {
            super.clear();
            for (const [key, value] of newValue) {
                super.set(key, value);
            }
            this.onSync?.();
        } else {
            for (const [key, value] of addedOrUpdated) {
                super.set(key, value);
                this.onSet?.(key, value);
            }
            for (const key of deleted) {
                super.delete(key);
                this.onDel?.(key);
            }
        }
    }

    /**
     * 保存当前字典到GM存储
     */
    private saveToStorage(): void {
        GM_setValue(this.name, this.toArray());
    }

    /**
     * 重写set方法：设置值并保存到GM存储
     */
    public override set(key: string, value: T): this {
        super.set(key, value);
        this.saveToStorage();
        this.onSet?.(key, value);
        return this;
    }

    /**
     * 重写delete方法：删除值并保存到GM存储
     */
    public override delete(key: string): boolean {
        const result = super.delete(key);
        if (result) {
            this.saveToStorage();
            this.onDel?.(key);
        }
        return result;
    }

    /**
     * 重写clear方法：清空字典并保存到GM存储
     */
    public override clear(): void {
        super.clear();
        this.saveToStorage();
        this.onSync?.();
    }

    /**
     * 获取值（从父类继承）
     */
    public override get(key: string): T | undefined {
        return super.get(key);
    }

    /**
     * 检查键是否存在（从父类继承）
     */
    public override has(key: string): boolean {
        return super.has(key);
    }

    /**
     * 获取字典大小（从父类继承）
     */
    public override get size(): number {
        return super.size;
    }

    /**
     * 销毁监听器
     */
    public destroy(): void {
        if (this.listenerId !== null) {
            GM_removeValueChangeListener(this.listenerId);
            this.listenerId = null;
        }
    }
}

export class SyncDictionary<T> extends Dictionary<T> {
    /** 当通过 set 或接收消息设置时触发 */
    public onSet?: (key: string, value: T) => void;
    /** 当删除时触发 */
    public onDel?: (key: string) => void;
    /** 完成初次或增量同步后触发 */
    public onSync?: () => void;

    public timestamp: number;
    public lifetime: number;
    private id: string;
    private channel: BroadcastChannel;

    /**
     * @param channelName 通信通道，同一名称标签页间同步
     * @param initial 初始纯值列表，会附加当前时戳
     */
    constructor(channelName: string, initial: Array<[string, T]> = []) {
        const hasInitial = prune(initial).any();
        super(hasInitial ? initial : undefined);
        this.timestamp = hasInitial ? Date.now() : 0;
        this.lifetime = hasInitial ? performance.now() : 0;
        this.id = UUID();
        this.channel = new BroadcastChannel(channelName);
        this.channel.onmessage = ({ data: msg }: { data: Message<T> }) => this.handleMessage(msg);
        this.channel.postMessage({ type: 'sync', id: this.id, timestamp: this.timestamp, lifetime: this.lifetime });
    }
    private setTimestamp(timestamp?: number) {
        this.timestamp = timestamp ?? Date.now();
        this.lifetime = performance.now();
    }
    /**
     * 重写：设置值并广播，同时记录时间戳
     */
    public override set(key: string, value: T): this {
        this.setTimestamp()
        super.set(key, value);
        this.channel.postMessage({ type: 'set', key, value, timestamp: this.timestamp, lifetime: this.lifetime, id: this.id });
        this.onSet?.(key, value);
        return this;
    }
    /**
     * 重写：删除并广播，同时记录时间戳
     */
    public override delete(key: string): boolean {
        this.setTimestamp()
        const existed = super.delete(key);
        if (existed) {
            this.onDel?.(key);
            this.channel.postMessage({ type: 'delete', key, timestamp: this.timestamp, lifetime: this.lifetime, id: this.id });
        }
        return existed;
    }
    /**
     * 重写：清空并广播，同时记录时间戳
     */
    public override clear(): void {
        this.setTimestamp()
        super.clear();
        this.channel.postMessage({ timestamp: this.timestamp, lifetime: this.lifetime, id: this.id, type: 'state', state: super.toArray() });
        this.onSync?.();
    }
    /**
     * 处理同步消息
     */
    private handleMessage(msg: Message<T>) {
        if (msg.id === this.id) return;
        if (msg.type === 'sync') {
            this.channel.postMessage({ timestamp: this.timestamp, lifetime: this.lifetime, id: this.id, type: 'state', state: super.toArray() });
            return;
        }
        if (msg.timestamp === this.timestamp && msg.lifetime === this.lifetime) return;
        if (msg.timestamp < this.timestamp || msg.lifetime < this.lifetime) return;
        switch (msg.type) {
            case 'state': {
                super.clear();
                for (let index = 0; index < msg.state.length; index++) {
                    const [key, value] = msg.state[index];
                    super.set(key, value);
                }
                this.setTimestamp(msg.timestamp);
                this.onSync?.();
                break;
            }
            case 'set': {
                const { key, value } = msg;
                super.set(key, value);
                this.setTimestamp(msg.timestamp);
                this.onSet?.(key, value);
                break;
            }
            case 'delete': {
                const { key } = msg;
                if (super.delete(key)) {
                    this.setTimestamp(msg.timestamp);
                    this.onDel?.(key);
                }
                break;
            }
        }
    }

    /**
     * 关闭底层 BroadcastChannel，释放跨页通信资源。
     * 幂等：多次调用安全；关闭后实例不应再使用。
     * 浏览器中页面卸载会自动清理，但 Node 测试环境必须显式关闭，
     * 否则未关闭的 BroadcastChannel 会保持事件循环活跃导致进程无法退出。
     */
    public close(): void {
        this.channel.close();
    }
}

export class MultiPage {
    public readonly pageId: string;
    public onLastPage?: () => void;
    public onPageJoin?: (pageId: string) => void;
    public onPageLeave?: (pageId: string) => void;
    private readonly channel: BroadcastChannel;
    private beforeUnloadHandler: () => void;
    constructor() {
        this.pageId = UUID();
        GM_saveTab({ id: this.pageId });
        this.channel = new BroadcastChannel('page-status-channel');
        this.channel.onmessage = (event: MessageEvent<PageEvent>) => this.handleMessage(event.data);
        this.channel.postMessage({ type: 'join', id: this.pageId });
        this.beforeUnloadHandler = () => {
            this.channel.postMessage({ type: 'leave', id: this.pageId });
            originalRemoveEventListener.call(unsafeWindow.document, 'beforeunload', this.beforeUnloadHandler);
        };
        originalAddEventListener.call(unsafeWindow.document, 'beforeunload', this.beforeUnloadHandler);
    }
    public suicide() {
        this.channel.postMessage({ type: 'suicide', id: this.pageId });
    }
    private handleMessage(message: PageEvent) {
        switch (message.type) {
            case 'suicide':
                if (this.pageId !== message.id) unsafeWindow.close();
                break;
            case 'join':
                this.onPageJoin?.(message.id);
                break;
            case 'leave':
                this.onPageLeave?.(message.id);
                GM_getTabs((tabs) => {
                    if (Object.keys(tabs).length > 1) return;
                    this.onLastPage?.();
                });
                break;
        }
    }
}
