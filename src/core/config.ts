
import "./env";
import { isNullOrUndefined, stringify } from "./env";
import { createLogger } from "./log";
import { DownloadType } from "./enum";
import { i18nList, Language } from "../i18n";

const log = createLogger('Config');
const DEFAULT_CONFIG: ImportConfig = {
    language: 'zh',
    autoFollow: false,
    autoLike: false,
    autoCopySaveFileName: false,
    autoDownloadMetadata: false,
    enableUnsafeMode: false,
    enableBeautify: false,
    enableWidescreen: false,
    experimentalFeatures: false,
    autoInjectCheckbox: true,
    checkDownloadLink: false,
    filterLikedVideos: false,
    checkPriority: true,
    addUnlistedAndPrivate: false,
    filterUnlistedAndPrivate: false,
    autoCollapseMenu: true,
    downloadPriority: 'Source',
    downloadType: DownloadType.Others,
    downloadPath: '/Iwara/%#AUTHOR#%/%#TITLE#%[%#ID#%].mp4',
    downloadProxy: '',
    downloadProxyUsername: '',
    downloadProxyPassword: '',
    aria2Path: 'http://127.0.0.1:6800/jsonrpc',
    aria2Token: '',
    iwaradlPath: 'http://127.0.0.1:23456/api/tasks',
    iwaradlToken: '',
    mediaCenterApi: 'http://127.0.0.1:3000',
    mediaCenterApiKey: '',
    pathNormalize: true,
    pathReplaceEmojis: true,
    pathFoldMarks: true,
    pathSanitize: true,
    pathTruncate: true,
    pathTitleMaxLength: 72,
    pathAliasMaxLength: 64,
    priority: {
        'Source': 100,
        '540': 99,
        '360': 98,
        'preview': 1
    }
};

export class Config {
    [key: string]: any
    private static instance: Config;
    configChange?: Function;
    authorization?: string
    language: Language = DEFAULT_CONFIG.language
    autoFollow: boolean = DEFAULT_CONFIG.autoFollow
    autoLike: boolean = DEFAULT_CONFIG.autoLike
    autoDownloadMetadata: boolean = DEFAULT_CONFIG.autoDownloadMetadata
    addUnlistedAndPrivate: boolean = DEFAULT_CONFIG.addUnlistedAndPrivate
    filterUnlistedAndPrivate: boolean = DEFAULT_CONFIG.filterUnlistedAndPrivate
    autoCollapseMenu: boolean = DEFAULT_CONFIG.autoCollapseMenu
    enableUnsafeMode: boolean = DEFAULT_CONFIG.enableUnsafeMode
    enableBeautify: boolean = DEFAULT_CONFIG.enableBeautify
    enableWidescreen: boolean = DEFAULT_CONFIG.enableWidescreen
    experimentalFeatures: boolean = DEFAULT_CONFIG.experimentalFeatures
    autoInjectCheckbox: boolean = DEFAULT_CONFIG.autoInjectCheckbox
    autoCopySaveFileName: boolean = DEFAULT_CONFIG.autoCopySaveFileName
    filterLikedVideos: boolean = DEFAULT_CONFIG.filterLikedVideos
    checkDownloadLink: boolean = DEFAULT_CONFIG.checkDownloadLink
    checkPriority: boolean = DEFAULT_CONFIG.checkPriority
    downloadPriority: string = DEFAULT_CONFIG.downloadPriority
    downloadType: DownloadType = DEFAULT_CONFIG.downloadType
    downloadPath: string = DEFAULT_CONFIG.downloadPath
    downloadProxy: string = DEFAULT_CONFIG.downloadProxy
    downloadProxyUsername: string = DEFAULT_CONFIG.downloadProxyUsername
    downloadProxyPassword: string = DEFAULT_CONFIG.downloadProxyPassword
    aria2Path: string = DEFAULT_CONFIG.aria2Path
    aria2Token: string = DEFAULT_CONFIG.aria2Token
    iwaradlPath: string = DEFAULT_CONFIG.iwaradlPath
    iwaradlToken: string = DEFAULT_CONFIG.iwaradlToken
    mediaCenterApi: string = DEFAULT_CONFIG.mediaCenterApi
    mediaCenterApiKey: string = DEFAULT_CONFIG.mediaCenterApiKey
    pathNormalize: boolean = DEFAULT_CONFIG.pathNormalize
    pathReplaceEmojis: boolean = DEFAULT_CONFIG.pathReplaceEmojis
    pathFoldMarks: boolean = DEFAULT_CONFIG.pathFoldMarks
    pathSanitize: boolean = DEFAULT_CONFIG.pathSanitize
    pathTruncate: boolean = DEFAULT_CONFIG.pathTruncate
    pathTitleMaxLength: number = DEFAULT_CONFIG.pathTitleMaxLength
    pathAliasMaxLength: number = DEFAULT_CONFIG.pathAliasMaxLength
    priority: Record<string, number> = DEFAULT_CONFIG.priority
    constructor(importConfig?: ImportConfig) {
        let body = new Proxy(this, {
            get: function (target, property: string) {
                if (property === 'configChange') {
                    return target.configChange
                }
                let value = GM_getValue(property, target[property])
                if (property === 'language') {
                    return Config.getLanguage(value)
                }
                log.debug(`get: ${property} ${/password/i.test(property) || /token/i.test(property) || /authorization/i.test(property) ? '凭证已隐藏' : stringify(value)}`)
                return value
            },
            set: function (target, property: string, value) {
                if (property === 'configChange') {
                    target.configChange = value
                    return true
                }
                GM_setValue(property, value)
                log.debug(`set: ${property} ${/password/i.test(property) || /token/i.test(property) || /authorization/i.test(property) ? '凭证已隐藏' : stringify(value)}`)
                if (!isNullOrUndefined(target.configChange)) target.configChange(property)
                return true
            }
        })
        for (const key of Object.keys(DEFAULT_CONFIG)) {
            GM_addValueChangeListener(
                key,
                (name: string, old_value: any, new_value: any, remote: boolean) => {
                    if (remote && !isNullOrUndefined(body.configChange)) body.configChange(name)
                }
            )
        }
        if (!isNullOrUndefined(importConfig)) {
            Object.assign(body, importConfig)
        }

        return body
    }

    public static getInstance(): Config {
        if (isNullOrUndefined(Config.instance)) Config.instance = new Config()
        return Config.instance;
    }
    public static destroyInstance() {
        Config.instance = undefined as any;
    }
    public static initInstance(importConfig?: ImportConfig) {
        Config.instance = new Config(importConfig ?? DEFAULT_CONFIG);
    }

    /** 尝试匹配语言，优先精确匹配，再降级到主语言部分 */
    private static resolveLanguage(lang: string): Language | undefined {
        const normalized = lang.replace('-', '_').toLowerCase() as Language;
        if (i18nList[normalized]) return normalized;
        const main = normalized.split('_')[0] as Language;
        if (i18nList[main]) return main;
        return undefined;
    }

    private static getLanguage(value?: string): Language {
        const candidates = [value, navigator.language, ...(navigator.languages ?? [])];
        for (const lang of candidates) {
            if (!lang) continue;
            const resolved = Config.resolveLanguage(lang);
            if (resolved) return resolved;
        }
        return DEFAULT_CONFIG.language;
    }
}
export const config = Config.getInstance();
