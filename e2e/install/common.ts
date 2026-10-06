/**
 * 跨管理器共享的安装基建（与具体管理器无关）。
 *
 * - createScriptServer：一次性本地 HTTP 服务器，把 dist/*.user.js 以 http 提供
 *   （扩展安装页不能吃 file://；用完即弃，Symbol.dispose 显式释放）；
 * - scriptUrl：拼脚本下载 URL（统一从这里取，避免各驱动散拼）。
 */
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

export interface ScriptServer {
    port: number
    /** 脚本下载 URL（http://127.0.0.1:<port>/<basename>） */
    url: string
    [Symbol.dispose]: () => void
}

/** 一次性本地 HTTP 服务器（async：监听就绪后才返回；await using 自动释放） */
export async function createScriptServer(scriptPath: string): Promise<ScriptServer> {
    const body = readFileSync(scriptPath)
    const server = createHttpServer((_req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': body.length
        })
        res.end(body)
    })
    server.listen(0, '127.0.0.1')
    // listen 是异步的，等 listening 事件后 address() 才有值
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
    })
    const port = (server.address() as AddressInfo).port
    return {
        port,
        url: `http://127.0.0.1:${port}/${path.basename(scriptPath)}`,
        [Symbol.dispose]() {
            server.close()
        }
    }
}

/**
 * GM 测试宿主页服务：极简静页 + 自嵌子帧端点（与 iwara 完全隔离）。
 *
 * 为什么需要独立宿主（用户裁定）：GM 存储按脚本分域，「标签 ≤ 1」下真 remote 事件
 * 的唯一通路 = 同一探针脚本在 顶 frame + 子 frame 的两个实例；宿主页由我们自家服务
 * 提供（127.0.0.1），子帧想嵌几层嵌几层、无 CSP/风控/外网依赖，CI 无头可跑。
 *
 * 路由：
 * - `/gm-host`         宿主页（内嵌一个指向 /gm-frame 的 iframe，探针注入两上下文）；
 * - `/gm-frame`        空子帧页（探针注入 = 第二实例）；
 * - 其余               404。
 */
export interface GMHostServer {
    /** 宿主页 URL（探针顶层实例所在） */
    url: string
    /** 子帧页 URL（探针第二实例所在） */
    frameUrl: string
    [Symbol.dispose]: () => void
}

const GM_HOST_HTML = `<!DOCTYPE html>
<html lang="zh-cn">
<head><meta charset="utf-8"><title>e2e GM host</title></head>
<body>
<iframe id="peer" src="/gm-frame" style="display:none"></iframe>
</body>
</html>`

const GM_FRAME_HTML = `<!DOCTYPE html>
<html lang="zh-cn"><head><meta charset="utf-8"><title>e2e GM frame</title></head><body></body></html>`

/** GM 测试宿主页服务（async：监听就绪后才返回；await using 自动释放） */
export async function createGMHostServer(): Promise<GMHostServer> {
    const server = createHttpServer((req, res) => {
        const pathName = (req.url ?? '/').split('?')[0]
        if (pathName === '/gm-host') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(GM_HOST_HTML)
            return
        }
        if (pathName === '/gm-frame') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(GM_FRAME_HTML)
            return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
    })
    server.listen(0, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve)
        server.once('error', reject)
    })
    const port = (server.address() as AddressInfo).port
    return {
        url: `http://127.0.0.1:${port}/gm-host`,
        frameUrl: `http://127.0.0.1:${port}/gm-frame`,
        [Symbol.dispose]() {
            server.close()
        }
    }
}
