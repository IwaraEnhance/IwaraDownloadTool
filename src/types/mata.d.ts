/**
 * mata.json 类型声明（项目权威信息源的结构契约）。
 *
 * mata.json 是用户脚本的唯一权威信息源：user.js 元数据（可序列化到 // @Key 头）、
 * 构建信息（displayName/version 等内部键，不出现在产物头）、e2e 测试信息。
 * 序列化/反序列化见 build/mata.ts；e2e 侧读取见 e2e/helpers/mataInfo.ts。
 */

/** 本地化文本表（default = 主语言，其余键 = locale 后缀；序列化为 @key 与 @key:<locale>） */
declare interface MataLocalizedText {
    default: string
    [locale: string]: string | undefined
}

/** e2e 测试信息（框架与项目的全部交接点；不含框架实现细节） */
declare interface MataE2E {
    /** 主脚本构建入口（相对仓库根；缺省 src/main.ts） */
    entry?: string
    /** e2e 探针脚本入口（相对仓库根；缺省 = 项目无探针，相关 spec 不应存在） */
    probeEntry?: string
    /**
     * e2e 目标站点首页。缺省时框架从 include 与 match 推导：
     * 具体域名模式（「协议-分域-域名-路径段」形态）可推导；泛通配词干模式
     * （「任意协议-任意子域-词干-路径段」形态）只能证明「可注入」而无法还原
     * 完整域名——此类项目必须显式声明 targetSite。
     */
    targetSite?: string
}

/** mata.json 顶层结构（全局命名空间风格，与 aria2.d.ts / iwara.d.ts 同惯例） */
declare namespace Mata {
    interface LocalizedText extends MataLocalizedText { }
    interface E2E extends MataE2E { }

    // ── 内部键（不序列化进 userscript 头） ──
    /** 构建产物文件名基座（自 package.json displayName 迁移至此） */
    export interface Root {
        displayName: string
        /** 用户脚本版本（X.Y.Z；dev 渠道构建附加 -dev.<uuid>） */
        version: string
        /** e2e 测试信息（可选；无此键 = 项目未接入自动测试） */
        e2e?: E2E

        // ── 可序列化键（→ `// @key value` 头，键名与 userscript 元数据一致） ──
        /** 脚本名（default → @name，其余 → @name:<locale>） */
        name: LocalizedText
        /** 描述（default → @description，其余 → @description:<locale>；与 name 同构） */
        description: LocalizedText
        icon?: string
        namespace?: string
        author?: string
        license?: string
        copyright?: string
        supportURL?: string
        homepageURL?: string
        /** 值含 %#release_tag#% / %#display_name#% / %#version#% 等模板占位符，构建时替换；
         *  URL 文件名段一律用 %#display_name#% 引用（产改名只动 displayName 一处） */
        updateURL?: string
        downloadURL?: string
        connect?: string[]
        include?: string[]
        match?: string[]
        require?: string[]
        resource?: string[]
        grant?: string[]
        'run-at'?: string
        /** true = 输出裸键 `// @noframes`（声明后管理器不注入 iframe）；缺省/false = 不输出 */
        noframes?: boolean
    }
}
