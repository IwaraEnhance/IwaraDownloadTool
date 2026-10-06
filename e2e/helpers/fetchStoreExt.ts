/**
 * 获取 ScriptCat 扩展（可移植：纯 Node，无 curl/unzip 外部命令依赖）。
 *
 * 原理：Playwright 侧载只接受含 manifest.json 的未打包目录（--load-extension），
 * 商店 CRX 是签名包不能直接加载 → 下载 CRX → 剥离 CRX3 头（Cr24 magic + 版本 +
 * 头长度 + 签名头）→ 纯 ZIP → 用 Node 内置 zlib 解包（无 unzip 命令依赖）。
 *
 * 输出：e2e/.scriptcatStore/（已 gitignore）；经 fixtures 的 sharedSession 自动调用
 * （已存在即跳过），也可用环境变量 SCRIPTCAT_EXT_PATH 指向任意已有扩展目录跳过下载。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:https'
import { createInflateRaw } from 'node:zlib'
import path from 'node:path'
const DEFAULT_EXT_ID = process.env.E2E_EXT_ID ?? 'ndcooeababalnlpkfedmmbbbgkljhpjf' // ScriptCat (Chrome 商店)
const DEFAULT_DIR_NAME = '.scriptcatStore'

/** 商店 CRX 下载端点（非公开契约，prodversion 取当代版本即可） */
function crxUrl(id: string): string {
    const x = encodeURIComponent(`id=${id}&uc`)
    const prodversion = process.env.E2E_CRX_PRODVERSION ?? '153.0.8010.12'
    return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${prodversion}&acceptformat=crx2,crx3&x=${x}`
}

/** CRX3 → ZIP：读取第 8 字节起的 4 字节小端头长度，跳过头部即 ZIP 数据 */
function crxToZip(crx: Buffer): Buffer {
    const magic = crx.readUInt32LE(0)
    // "Cr24" 小端读出 = 0x34327243（'C'=0x43 是最低有效字节）
    if (magic !== 0x34327243) throw new Error('不是 CRX 文件（magic 校验失败）')
    const version = crx.readUInt32LE(4)
    if (version < 3) throw new Error(`仅支持 CRX3，得到版本 ${version}`)
    const headerLength = crx.readUInt32LE(8)
    return crx.subarray(12 + headerLength)
}

/** 跟随重定向下载文件（Node https，代理经环境变量由 UA 无关的系统层处理） */
function download(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = (target: string, redirectsLeft: number): void => {
            const req = get(target, { headers: { 'User-Agent': 'e2e-fetch-ext' } }, (res) => {
                const status = res.statusCode ?? 0
                if ([301, 302, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
                    res.resume()
                    request(new URL(res.headers.location, target).href, redirectsLeft - 1)
                    return
                }
                if (status !== 200) {
                    res.resume()
                    reject(new Error(`下载失败 HTTP ${status}: ${target}`))
                    return
                }
                const file = createWriteStream(dest)
                res.pipe(file)
                file.on('finish', () => file.close(() => resolve()))
                file.on('error', reject)
            })
            req.on('error', reject)
        }
        request(url, 10)
    })
}

/**
 * 纯 Node 解包 ZIP（store/deflate；含目录条目）。
 *
 * ⚠️ 不能按「本地文件头」顺序解析：Chrome 商店 CRX 的 ZIP 是流式写入，通用标志
 * bit3 置位时本地头的 compressedSize=0（真实大小在尾部数据描述符），顺序解析会
 * 错位。正确做法：先解析尾部**中央目录**（EOCD → 中央目录条目，大小/偏移总是
 * 准确），再按目录逐条提取。
 */
async function unzip(zip: Buffer, destDir: string): Promise<void> {
    // 1. 从尾部找 EOCD（签名 PK\x05\x06；注释最长 65535 字节）
    let eocd = -1
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
        if (zip.readUInt32LE(i) === 0x06054b50) {
            eocd = i
            break
        }
    }
    if (eocd < 0) throw new Error('ZIP 解析失败：未找到 EOCD')
    const entries = zip.readUInt16LE(eocd + 10)
    const cdOffset = zip.readUInt32LE(eocd + 16)

    // 2. 遍历中央目录条目（签名 PK\x01\x02），取本地头位置
    let cd = cdOffset
    for (let i = 0; i < entries; i++) {
        if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error(`ZIP 解析失败：中央目录条目 ${i} 签名不符`)
        const method = zip.readUInt16LE(cd + 10)
        const compressedSize = zip.readUInt32LE(cd + 20)
        const nameLength = zip.readUInt16LE(cd + 28)
        const extraLength = zip.readUInt16LE(cd + 30)
        const commentLength = zip.readUInt16LE(cd + 32)
        const localOffset = zip.readUInt32LE(cd + 42)
        const name = zip.subarray(cd + 46, cd + 46 + nameLength).toString('utf8')

        // 3. 定位本地头中的数据起点（重新读本地头的名称/扩展字段长度）
        if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 解析失败：${name} 本地头签名不符`)
        const localNameLength = zip.readUInt16LE(localOffset + 26)
        const localExtraLength = zip.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLength + localExtraLength
        const data = zip.subarray(dataStart, dataStart + compressedSize)

        const target = path.join(destDir, name)
        if (name.endsWith('/')) {
            mkdirSync(target, { recursive: true })
        } else {
            mkdirSync(path.dirname(target), { recursive: true })
            const content =
                method === 8
                    ? await new Promise<Buffer>((resolve, reject) => {
                        const chunks: Buffer[] = []
                        const inflater = createInflateRaw()
                        inflater.on('data', (chunk: Buffer) => chunks.push(chunk))
                        inflater.on('end', () => resolve(Buffer.concat(chunks)))
                        inflater.on('error', reject)
                        inflater.end(data)
                    })
                    : Buffer.from(data)
            writeFileSync(target, content)
        }
        cd += 46 + nameLength + extraLength + commentLength
    }
}

/**
 * 确保扩展就位：已存在直接返回，否则商店下载解包。返回扩展目录。
 * 多管理器参数化：storeId + dirName 由各驱动传入（缺省 ScriptCat；
 * Tampermonkey 传 dhdgffkkebhmkfjojejmpbldmpobfkfo / .tampermonkeyStore）。
 */
export async function fetchExtension(storeId: string = DEFAULT_EXT_ID, dirName: string = DEFAULT_DIR_NAME): Promise<string> {
    // ⚠️ 目录锚定 e2e/ 根（.gitignore 的 /e2e/.scriptcatStore 等条目按此路径生效），
    // 不随本文件位置变化（曾因移入 helpers/ 而落到 e2e/helpers/.scriptcatStore）
    const e2eRoot = path.resolve(import.meta.dirname, '..')
    const outDir = path.join(e2eRoot, dirName)
    const crxPath = path.join(outDir, `${storeId}.crx`)
    const unpacked = path.join(outDir, 'ext')
    if (existsSync(path.join(unpacked, 'manifest.json'))) {
        console.log(`[fetch-ext] 已存在 ${unpacked}（删除该目录可强制重新下载）`)
        return unpacked
    }
    mkdirSync(outDir, { recursive: true })
    const url = crxUrl(storeId)
    console.log(`[fetch-ext] 下载 ${url}`)
    await download(url, crxPath)
    const zip = crxToZip(readFileSync(crxPath))
    rmSync(unpacked, { recursive: true, force: true })
    mkdirSync(unpacked, { recursive: true })
    await unzip(zip, unpacked)
    if (!existsSync(path.join(unpacked, 'manifest.json'))) throw new Error('解压后未找到 manifest.json')
    console.log(`[fetch-ext] 完成：${unpacked}`)
    return unpacked
}

