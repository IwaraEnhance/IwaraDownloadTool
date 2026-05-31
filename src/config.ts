
import "./env";
import { isNullOrUndefined, stringify } from "./env";
import { originalConsole } from "./hijack";
import { DownloadType } from "./enum";
import { i18nList } from "./i18n";
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
    language: string = DEFAULT_CONFIG.language
    autoFollow: boolean = DEFAULT_CONFIG.autoFollow
    autoLike: boolean = DEFAULT_CONFIG.autoLike
    autoDownloadMetadata: boolean = DEFAULT_CONFIG.autoDownloadMetadata
    addUnlistedAndPrivate: boolean = DEFAULT_CONFIG.addUnlistedAndPrivate
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
                GM_getValue('isDebug') && originalConsole.debug(`[Debug] get: ${property} ${/password/i.test(property) || /token/i.test(property) || /authorization/i.test(property) ? '凭证已隐藏' : stringify(value)}`)
                return value
            },
            set: function (target, property: string, value) {
                if (property === 'configChange') {
                    target.configChange = value
                    return true
                }
                GM_setValue(property, value)
                GM_getValue('isDebug') && originalConsole.debug(`[Debug] set: ${property} ${/password/i.test(property) || /token/i.test(property) || /authorization/i.test(property) ? '凭证已隐藏' : stringify(value)}`)
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

    private static getLanguage(value?: string): string {
        function formatLanguage(value: string) {
            return value.replace('-', '_').toLowerCase()
        }
        function getMainLanguage(value: string) {
            return value.split('_').shift()!
        }
        if (!isNullOrUndefined(GM_getValue('language', undefined))) {
            let custom = formatLanguage(value ?? DEFAULT_CONFIG.language)
            if (!isNullOrUndefined(custom)) {
                if (!isNullOrUndefined(i18nList[custom])) {
                    return custom
                } else {
                    let customMain = getMainLanguage(custom)
                    if (!isNullOrUndefined(i18nList[customMain])) {
                        return customMain
                    }
                }
            }
        }
        let env = formatLanguage(navigator.language ?? navigator.languages[0] ?? DEFAULT_CONFIG.language)
        if (!isNullOrUndefined(i18nList[env])) {
            return env
        } else {
            let main = getMainLanguage(env)
            if (!isNullOrUndefined(i18nList[main])) {
                return main
            }
        }
        return DEFAULT_CONFIG.language
    }
}
export const config = Config.getInstance();
