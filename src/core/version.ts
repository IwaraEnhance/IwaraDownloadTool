import { VersionState } from './enum'

/**
 * 版本号接口
 * 遵循语义化版本规范(SemVer)
 */
declare interface IVersion {
    major: number
    minor: number
    patch: number
    preRelease: string[]
    buildMetadata: string
    compare(other: IVersion): VersionState
}
/**
 * 版本号实现类
 * 支持语义化版本比较和解析
 */
export class Version implements IVersion {
    major: number
    minor: number
    patch: number
    preRelease: string[]
    buildMetadata: string
    /**
     * 构造函数
     * @param versionString 版本号字符串
     * @throws 如果版本号格式无效
     */
    constructor(versionString: string) {
        if (!versionString || typeof versionString !== 'string') {
            throw new Error('Invalid version string')
        }

        // 解析语义化版本  MAJOR.MINOR.PATCH-PRE_RELEASE+BUILD_METADATA
        const dashIndex = versionString.indexOf('-')
        const plusIndex = versionString.indexOf('+')

        let version: string, preRelease: string, buildMetadata: string

        if (dashIndex === -1 && plusIndex === -1) {
            // 纯版本号: "1.2.3"
            version = versionString
            preRelease = ''
            buildMetadata = ''
        } else if (plusIndex !== -1 && (dashIndex === -1 || plusIndex < dashIndex)) {
            // 仅构建元数据，无预发布: "1.0.0+build"
            version = versionString.substring(0, plusIndex)
            preRelease = ''
            buildMetadata = versionString.substring(plusIndex + 1)
        } else {
            // 有预发布（可能还有构建元数据）: "1.0.0-alpha.1" 或 "1.0.0-beta+sha.1234"
            version = versionString.substring(0, dashIndex)
            const rest = versionString.substring(dashIndex + 1)
            const buildSep = rest.indexOf('+')
            if (buildSep !== -1) {
                preRelease = rest.substring(0, buildSep)
                buildMetadata = rest.substring(buildSep + 1)
            } else {
                preRelease = rest
                buildMetadata = ''
            }
        }

        const versionParts = version.split('.').map(Number)
        if (versionParts.some(isNaN)) {
            throw new Error('Version string contains invalid numbers')
        }
        this.major = versionParts[0] || 0
        this.minor = versionParts.length > 1 ? versionParts[1] : 0
        this.patch = versionParts.length > 2 ? versionParts[2] : 0
        this.preRelease = preRelease ? preRelease.split('.') : []
        this.buildMetadata = buildMetadata || ''
    }
    private static compareValues<T extends number | string>(a: T, b: T): VersionState {
        if (a < b) return VersionState.Low
        if (a > b) return VersionState.High
        return VersionState.Equal
    }
    /**
     * 比较版本号
     * @param other 要比较的版本号
     * @returns 比较结果状态
     */
    public compare(other: IVersion): VersionState {
        let state = Version.compareValues(this.major, other.major)
        if (state !== VersionState.Equal) return state
        state = Version.compareValues(this.minor, other.minor)
        if (state !== VersionState.Equal) return state
        state = Version.compareValues(this.patch, other.patch)
        if (state !== VersionState.Equal) return state

        // SemVer 规则 11: 有预发布版本 < 无预发布版本
        if (this.preRelease.length === 0 && other.preRelease.length > 0) {
            return VersionState.High // 1.0.0 > 1.0.0-alpha
        }
        if (this.preRelease.length > 0 && other.preRelease.length === 0) {
            return VersionState.Low // 1.0.0-alpha < 1.0.0
        }

        // 从左到右逐段比较预发布标识符
        const maxLen = Math.max(this.preRelease.length, other.preRelease.length)
        for (let i = 0; i < maxLen; i++) {
            // SemVer 规则 12: 字段更多者优先级更高
            if (i >= this.preRelease.length) return VersionState.Low
            if (i >= other.preRelease.length) return VersionState.High

            const pre1 = this.preRelease[i]
            const pre2 = other.preRelease[i]

            const isNum1 = !isNaN(+pre1)
            const isNum2 = !isNaN(+pre2)

            // SemVer 规则 11: 数字标识符 < 字母标识符
            if (isNum1 && !isNum2) return VersionState.Low
            if (!isNum1 && isNum2) return VersionState.High

            const val1 = isNum1 ? +pre1 : pre1
            const val2 = isNum2 ? +pre2 : pre2

            if (val1 < val2) return VersionState.Low
            if (val1 > val2) return VersionState.High
        }

        return VersionState.Equal
    }
    /**
     * 基座版本比较：仅比较 MAJOR.MINOR.PATCH，忽略预发布段与构建元数据。
     *
     * 这是版本迁移门控（runMigrations）的正确比较语义：迁移逻辑随代码携带，
     * 判定「存储中的旧版本是否需要迁移」应比较旧版本与当前构建的**基座版本**——
     * 基座相同即本代码就是该基座版本发布线的实现（含全部已注册迁移），无需迁移。
     *
     * 为什么不能用标准 compare：dev 渠道构建产物版本为 `x.y.z-dev.<uuid>`
     * （build.ts resolveVersion，每次构建可区分），SemVer 规则 11 决定预发布段
     * 恒低于正式版——若用它做迁移门控，dev 用户每次加载页面都会判定迁移
     * pending → main() reload → 再 pending → 无限重载循环（e2e 实测）。
     * 构建元数据同理（SemVer 规则 10 不参与优先级，但预发布段是真实不等）。
     */
    public baseCompare(other: IVersion): VersionState {
        let state = Version.compareValues(this.major, other.major)
        if (state !== VersionState.Equal) return state
        state = Version.compareValues(this.minor, other.minor)
        if (state !== VersionState.Equal) return state
        return Version.compareValues(this.patch, other.patch)
    }
    /**
     * 转换为字符串
     * @returns 语义化版本字符串
     */
    public toString(): string {
        const version = `${this.major}.${this.minor}.${this.patch}`
        const preRelease = this.preRelease.length ? `-${this.preRelease.join('.')}` : ''
        const buildMetadata = this.buildMetadata ? `+${this.buildMetadata}` : ''
        return `${version}${preRelease}${buildMetadata}`
    }
}
