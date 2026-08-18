import '../core/env'
import { isArray, isNullOrUndefined, stringify, UUID } from '../core/env'
import { DownloadType, ToastType } from '../core/enum'
import { config } from '../core/config'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { newToast, toastNode } from '../ui/notify'
import { analyzeLocalPath } from '../download/downloadPath'

const log = createLogger('EnvCheck')

/**
 * 检查浏览器环境是否支持下载
 * @async
 * @returns {Promise<boolean>} 如果环境检查通过返回true，否则返回false
 */
export async function EnvCheck(): Promise<boolean> {
    try {
        if (GM_info.scriptHandler !== 'ScriptCat' && GM_info.downloadMode !== 'browser') {
            log.debug(GM_info)
            throw new Error('%#browserDownloadModeError#%')
        }
    } catch (error: any) {
        let toast = newToast(ToastType.Error, {
            node: toastNode([`%#configError#%`, { nodeType: 'br' }, stringify(error)], '%#settingsCheck#%'),
            position: 'center',
            onClick() {
                toast.hide()
            }
        })
        toast.show()
        return false
    }
    return true
}

/**
 * 检查本地下载路径是否有效
 * @async
 * @returns {Promise<boolean>} 如果路径有效返回true，否则返回false
 */
export async function localPathCheck(): Promise<boolean> {
    try {
        let pathTest = analyzeLocalPath(
            config.downloadPath.replaceVariable({
                NowTime: new Date(),
                UploadTime: new Date(),
                AUTHOR: 'test',
                ID: 'test',
                TITLE: 'test',
                ALIAS: 'test',
                QUALITY: 'test'
            })
        )
        if (isNullOrUndefined(pathTest)) throw 'analyzeLocalPath error'
        if (pathTest.fullPath.isEmpty()) throw 'analyzeLocalPath isEmpty'
    } catch (error: any) {
        let toast = newToast(ToastType.Error, {
            node: toastNode([`%#downloadPathError#%`, { nodeType: 'br' }, stringify(error)], '%#settingsCheck#%'),
            position: 'center',
            onClick() {
                toast.hide()
            }
        })
        toast.show()
        return false
    }
    return true
}

/**
 * 检查Aria2 RPC连接是否正常
 * @async
 * @returns {Promise<boolean>} 如果连接正常返回true，否则返回false
 */
export async function aria2Check(): Promise<boolean> {
    try {
        let res = await (
            await unlimitedFetch(config.aria2Path, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'aria2.tellActive',
                    id: UUID(),
                    params: ['token:' + config.aria2Token]
                })
            })
        ).json()
        if (res.error) {
            throw new Error(res.error.message)
        }
    } catch (error: any) {
        let toast = newToast(ToastType.Error, {
            node: toastNode([`Aria2 RPC %#connectionTest#%`, { nodeType: 'br' }, stringify(error)], '%#settingsCheck#%'),
            position: 'center',
            onClick() {
                toast.hide()
            }
        })
        toast.show()
        return false
    }
    return true
}

/**
 * 检查iwaradl RPC连接是否正常
 * @async
 * @returns {Promise<boolean>} 如果连接正常返回true，否则返回false
 */
export async function iwaradlCheck(): Promise<boolean> {
    try {
        let res = await (
            await unlimitedFetch(config.iwaradlPath, {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    authorization: `Bearer ${config.iwaradlToken}`
                }
            })
        ).json()

        if (!isArray(res)) {
            throw new Error(`后端未启动或无响应`)
        }
    } catch (error: any) {
        newToast(ToastType.Error, {
            node: toastNode([`iwaradl RPC %#connectionTest#%`, { nodeType: 'br' }, stringify(error)], '%#settingsCheck#%'),
            position: 'center',
            onClick() {
                this.hide()
            }
        }).show()
        return false
    }
    return true
}

/**
 * 根据配置的下载类型执行相应的环境检查
 * @async
 * @returns {Promise<boolean>} 如果检查通过返回true，否则返回false
 */
export async function check(): Promise<boolean> {
    if (await localPathCheck()) {
        switch (config.downloadType) {
            case DownloadType.Aria2:
                return await aria2Check()
            case DownloadType.Iwaradl:
                return await iwaradlCheck()
            case DownloadType.Browser:
                return await EnvCheck()
            default:
                break
        }
        return true
    } else {
        return false
    }
}
