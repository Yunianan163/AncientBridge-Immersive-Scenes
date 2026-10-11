/**
 * voice-proxy.mjs — 贵州葛镜桥「实时语音对话」的本地 WebSocket 代理
 *
 * ## 为什么需要它
 *
 * 豆包实时语音 3.0（Seeduplex）连上游时必须带凭据。如果把 Key 写进前端 js，
 * 任何打开页面的访客都能从源码里把它拿走 —— 苏州双桥当年就踩过这个坑
 * （见《项目现状体检报告》H6：凭据曾落在浏览器可直接下载的 config.js 里）。
 * 所以浏览器只连本机 `ws://127.0.0.1:8124/voice-proxy`，由本进程加上凭据再连上游。
 *
 * ## 为什么零依赖
 *
 * 葛镜桥是纯静态站点：没有 package.json、没有 node_modules，靠 Python 标准库起服务。
 * 为了不给它引入 `npm install` 这一步，这里手写了 WebSocket 的握手与帧编解码，
 * 只用到 Node 标准库。协议本身是 **JSON 文本帧**（见 Seeduplex 文档），
 * 所以只需要处理文本帧和心跳/关闭这几个控制帧，不需要碰二进制音频帧。
 *
 * ## 用法
 *
 *   node tools/voice-proxy.mjs                 # 起代理，默认 8124
 *   node tools/voice-proxy.mjs --port 8124     # 指定端口
 *   node tools/voice-proxy.mjs --probe         # 连通性自检：连上游 → session.create → 打印回包 → 退出
 *
 * 凭据从「进程环境变量 > 贵州葛镜桥/.env」两级读取，两者都没有时不会带着空凭据去连上游，
 * 而是明确回报「未配置」。
 */

import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/* =========================================================== 配置（.env，零依赖解析） */

/** 解析 .env 文本；文件不存在时返回空对象 */
function parseDotenv(text) {
    const out = {}
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        out[key] = value
    }
    return out
}

function loadDotenv() {
    const file = path.join(ROOT, '.env')
    if (!fs.existsSync(file)) return {}
    return parseDotenv(fs.readFileSync(file, 'utf8'))
}

const DOTENV = loadDotenv()
const env = (key, fallback = '') => process.env[key] || DOTENV[key] || fallback

/**
 * 现读磁盘的 .env（每次调用都重读一次）。
 *
 * 人设提示词这类东西用户会反复调，而 Key / 端点基本不动 ——
 * 所以配置接口每次现读磁盘：**改完 .env 只要刷新页面就生效，不用重启代理**。
 * 这只影响 /voice-config 返回给前端的那份参数；发给上游的鉴权头仍是启动时那份。
 */
function liveEnv(key, fallback = '') {
    return process.env[key] || loadDotenv()[key] || DOTENV[key] || fallback
}

const UPSTREAM = env('VOICE_ENDPOINT', 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue')
/** Seeduplex 3.0 的 model 字段是固定值，改不了 */
const MODEL = env('VOICE_MODEL', '1.2.6.1')
/**
 * 音色 ID（代码里的兜底默认值；`.env` 里的 `VOICE_SPEAKER` 优先级更高）。
 *
 * ⚠️ 为什么默认不是苏州双桥那个 `S_tYw86oeY1`：
 *    实测用它会**直接建不了会话** —— 上游报
 *        55000000 "resource ID is mismatched with speaker related resource"
 *    `S_` 前缀是**声音复刻**音色（预付费音色槽位），属于某个账号 / 资源专有，
 *    换个账号就无效（换 `X-Api-Resource-Id` 也救不回来，已试过 3 种）。
 *    用复刻音色请填**自己账号**的槽位 ID。
 */
const VOICE = env('VOICE_SPEAKER', 'zh_female_vv_jupiter_bigtts')
/**
 * 资源 ID。
 *
 * **官方 Seeduplex Web Demo 根本不发这个头** —— 它只发 `X-Api-Key` + `X-Api-Connect-Id`。
 * 所以这里默认留空，只有旧账号确实需要显式指定资源时才用 `.env` 打开。
 * 另外注意：上游那侧报错里出现的 `resource_id=volc.speech.dialog` 是**它自己按路径推出来的**，
 * 与我们发不发这个头无关（实测带不带都是同一句报错）。
 */
const DEFAULT_RESOURCE_ID = ''
let resourceOverride = null
const currentResourceId = () =>
    resourceOverride !== null ? resourceOverride : env('VOICE_RESOURCE_ID', DEFAULT_RESOURCE_ID)

/** `--key <value>` 临时换一把密钥自检，用来区分「密钥无效」和「服务未开通」 */
let keyOverride = null
const currentApiKey = () => (keyOverride !== null ? keyOverride : env('VOICE_API_KEY'))
const PORT = Number(env('VOICE_PROXY_PORT', '8124'))

const DEFAULT_INSTRUCTIONS =
    '你是贵州福泉葛镜桥的 AI 语音讲解员，名叫「沧朔」。葛镜桥是明代万历年间建成的三孔石拱桥，' +
    '横跨麻哈江，因建造者葛镜倾尽家财、三建而成得名，素有「北有赵州桥，南有葛镜桥」之说。' +
    '你说话亲切自然、口语化，像一位熟悉当地历史的朋友；回答简短，一般两三句话说完，' +
    '不要念稿子、不要用列表和标题。只聊葛镜桥与古桥文化相关的话题，其它问题礼貌带回。'

/**
 * 上游鉴权头。
 *
 * 新版控制台只给一个 `X-Api-Key`（文档里 Seeduplex 用的就是它）；
 * 旧版控制台的三件套文档说仍然兼容，所以配了就一起带上，方便老账号直接迁移。
 */
function upstreamHeaders() {
    const headers = {}
    const apiKey = currentApiKey()
    if (apiKey) headers['X-Api-Key'] = apiKey

    const appId = env('VOICE_APP_ID')
    const accessToken = env('VOICE_ACCESS_TOKEN')
    const appKey = env('VOICE_APP_KEY')
    if (appId) headers['X-Api-App-ID'] = appId
    if (accessToken) headers['X-Api-Access-Key'] = accessToken
    if (appKey) headers['X-Api-App-Key'] = appKey

    const resourceId = currentResourceId()
    if (resourceId) headers['X-Api-Resource-Id'] = resourceId

    headers['X-Api-Connect-Id'] = crypto.randomUUID()
    return headers
}

/** 登录凭据是否齐全：新版一把 Key，或旧版三件套 */
function credentialsReady() {
    if (currentApiKey()) return true
    return Boolean(env('VOICE_APP_ID') && env('VOICE_ACCESS_TOKEN') && env('VOICE_APP_KEY'))
}

const log = (...args) => console.log('[voice-proxy]', ...args)
const warn = (...args) => console.warn('[voice-proxy]', ...args)

/* =========================================================== WebSocket 帧编解码 */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa }

/**
 * 编一个 WebSocket 帧。
 *
 * 掩码规则是硬性的：**客户端发往服务端必须加掩码，服务端发往客户端必须不加**，
 * 搞反了对方会直接断开。所以 mask 由调用方按自己的角色决定。
 */
function encodeFrame(payload, opcode = OPCODE.TEXT, mask = false) {
    const len = payload.length
    const lenBytes = len < 126 ? 0 : len < 65536 ? 2 : 8
    const headerLen = 2 + lenBytes + (mask ? 4 : 0)
    const buf = Buffer.allocUnsafe(headerLen + len)

    buf[0] = 0x80 | opcode // FIN=1，不做分片发送
    let off = 2
    if (lenBytes === 0) {
        buf[1] = len
    } else if (lenBytes === 2) {
        buf[1] = 126
        buf.writeUInt16BE(len, 2)
        off = 4
    } else {
        buf[1] = 127
        buf.writeBigUInt64BE(BigInt(len), 2)
        off = 10
    }

    if (mask) {
        buf[1] |= 0x80
        const key = crypto.randomBytes(4)
        key.copy(buf, off)
        off += 4
        for (let i = 0; i < len; i++) buf[off + i] = payload[i] ^ key[i & 3]
    } else {
        payload.copy(buf, off)
    }
    return buf
}

/**
 * 增量式帧解析器：TCP 不保证一个 data 事件就是一个完整帧，
 * 所以必须把字节攒起来，够一个完整帧才吐出来。
 */
class FrameParser {
    constructor() {
        this.buf = Buffer.alloc(0)
    }

    /** @returns {{fin:boolean, opcode:number, payload:Buffer}[]} 本次能解析出的完整帧 */
    push(chunk) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
        const frames = []

        for (;;) {
            if (this.buf.length < 2) break
            const b0 = this.buf[0]
            const b1 = this.buf[1]
            const fin = (b0 & 0x80) !== 0
            const opcode = b0 & 0x0f
            const masked = (b1 & 0x80) !== 0

            let len = b1 & 0x7f
            let off = 2
            if (len === 126) {
                if (this.buf.length < 4) break
                len = this.buf.readUInt16BE(2)
                off = 4
            } else if (len === 127) {
                if (this.buf.length < 10) break
                len = Number(this.buf.readBigUInt64BE(2))
                off = 10
            }

            let maskKey = null
            if (masked) {
                if (this.buf.length < off + 4) break
                maskKey = this.buf.subarray(off, off + 4)
                off += 4
            }

            if (this.buf.length < off + len) break

            let payload = this.buf.subarray(off, off + len)
            if (masked) {
                const plain = Buffer.allocUnsafe(len)
                for (let i = 0; i < len; i++) plain[i] = payload[i] ^ maskKey[i & 3]
                payload = plain
            }

            this.buf = this.buf.subarray(off + len)
            frames.push({ fin, opcode, payload })
        }

        return frames
    }
}

/**
 * 一条 WebSocket 连接的薄封装：负责收发帧、自动处理 ping/pong/close、
 * 并把分片消息拼回完整消息。事件：`message`(Buffer) / `text`(string) / `close` / `error`。
 */
class WsPeer extends EventEmitter {
    /**
     * @param {import('node:net').Socket} socket
     * @param {{mask:boolean, head?:Buffer}} options mask=true 表示「我扮演客户端」
     */
    constructor(socket, { mask, head } = {}) {
        super()
        this.socket = socket
        this.mask = Boolean(mask)
        this.parser = new FrameParser()
        this.closed = false
        this._fragments = []
        this._fragOpcode = OPCODE.TEXT

        socket.setNoDelay?.(true)
        socket.on('data', (chunk) => this._onData(chunk))
        socket.on('close', () => this._onClose())
        socket.on('error', (err) => {
            if (!this.closed) this.emit('error', err)
            this._onClose()
        })
        if (head && head.length) this._onData(head)
    }

    _onData(chunk) {
        let frames
        try {
            frames = this.parser.push(chunk)
        } catch (err) {
            this.emit('error', err)
            this.destroy()
            return
        }

        for (const frame of frames) {
            switch (frame.opcode) {
                case OPCODE.PING:
                    this._raw(encodeFrame(frame.payload, OPCODE.PONG, this.mask))
                    break
                case OPCODE.PONG:
                    break
                case OPCODE.CLOSE:
                    this._raw(encodeFrame(Buffer.alloc(0), OPCODE.CLOSE, this.mask))
                    this.destroy()
                    return
                case OPCODE.CONTINUATION:
                    this._fragments.push(frame.payload)
                    if (frame.fin) this._flushFragments()
                    break
                case OPCODE.TEXT:
                case OPCODE.BINARY:
                    if (frame.fin) {
                        this._deliver(frame.opcode, frame.payload)
                    } else {
                        this._fragOpcode = frame.opcode
                        this._fragments = [frame.payload]
                    }
                    break
                default:
                    break
            }
        }
    }

    _flushFragments() {
        const payload = Buffer.concat(this._fragments)
        const opcode = this._fragOpcode
        this._fragments = []
        this._deliver(opcode, payload)
    }

    _deliver(opcode, payload) {
        this.emit('message', payload, opcode === OPCODE.TEXT)
        if (opcode === OPCODE.TEXT) this.emit('text', payload.toString('utf8'))
    }

    _raw(buf) {
        if (this.closed || !this.socket.writable) return false
        try {
            this.socket.write(buf)
            return true
        } catch {
            return false
        }
    }

    /**
     * 发一个文本帧（本协议上下行都是 JSON 文本）。
     * 掩码按自己的角色自动决定 —— 调用方不需要、也不应该关心这件事。
     */
    send(data) {
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
        return this._raw(encodeFrame(payload, OPCODE.TEXT, this.mask))
    }

    /**
     * 正常关闭：先发一个 close 帧，稍等再断 socket。
     * 直接 destroy 的话对端只能拿到 1006（异常断开），排查问题时会被误导成「连接崩了」。
     */
    close(code = 1000, reason = '') {
        if (this.closed) return
        const text = Buffer.from(String(reason), 'utf8')
        const payload = Buffer.allocUnsafe(2 + text.length)
        payload.writeUInt16BE(code, 0)
        text.copy(payload, 2)
        this._raw(encodeFrame(payload, OPCODE.CLOSE, this.mask))
        setTimeout(() => this.destroy(), 80)
    }

    _onClose() {
        if (this.closed) return
        this.closed = true
        this.emit('close')
    }

    destroy() {
        if (this.closed) return
        this.closed = true
        try { this.socket.destroy() } catch { /* 已经断了 */ }
        this.emit('close')
    }
}

/* =========================================================== 连接上游 */

/**
 * 与上游建立 WebSocket 连接。
 *
 * 这里不能直接用 Node 内置的 `WebSocket`（WHATWG 版不允许自定义请求头），
 * 而 Seeduplex 恰恰要求带 `X-Api-Key`，所以用 http(s).request 自己发 Upgrade，
 * 拿到 `upgrade` 事件后接管 socket。
 */
function connectUpstream({ timeoutMs = 20000, url: target = UPSTREAM } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(target)
        const isTls = url.protocol === 'wss:'
        const lib = isTls ? https : http
        const key = crypto.randomBytes(16).toString('base64')

        const req = lib.request({
            hostname: url.hostname,
            port: url.port || (isTls ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': key,
                Host: url.host,
                ...upstreamHeaders(),
            },
        })

        req.setTimeout(timeoutMs, () => req.destroy(new Error(`连接上游超时（${timeoutMs} ms）`)))

        req.on('upgrade', (res, socket, head) => {
            const expect = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
            if (res.headers['sec-websocket-accept'] !== expect) {
                socket.destroy()
                reject(new Error('上游握手校验失败：Sec-WebSocket-Accept 不匹配'))
                return
            }
            resolve(new WsPeer(socket, { mask: true, head }))
        })

        // 没升级成功时会走 response：把上游的 HTTP 错误体读出来，那通常就是鉴权失败的原因
        req.on('response', (res) => {
            let body = ''
            res.on('data', (c) => { body += c })
            res.on('end', () => {
                reject(new Error(`上游拒绝升级：HTTP ${res.statusCode} ${body.slice(0, 400)}`))
            })
        })

        req.on('error', reject)
        req.end()
    })
}

/* =========================================================== 代理服务 */

/** 保持连接的下行事件日志可读：超长的 base64 音频只留头尾 */
function shorten(text, max = 220) {
    return text.length <= max ? text : `${text.slice(0, max)}…（共 ${text.length} 字符）`
}

function attachLogging(peer, tag) {
    peer.on('text', (text) => {
        if (/"(input_audio_buffer|output_audio)"|output_audio\.delta/.test(text)) return // 音频流不刷屏
        log(`${tag} ←`, shorten(text))
    })
}

async function handleProxySession(clientPeer, req) {
    const origin = req.headers.origin || '(无 Origin)'

    if (!credentialsReady()) {
        warn('凭据未配置 —— 请在 贵州葛镜桥/.env 里填 VOICE_API_KEY')
        clientPeer.send(JSON.stringify({
            type: 'error',
            code: 'VOICE_NOT_CONFIGURED',
            message: '语音服务未配置：请在 贵州葛镜桥/.env 里填写 VOICE_API_KEY（或旧版三件套）后重启代理',
        }))
        clientPeer.close(1011, 'voice-proxy: credentials missing')
        return
    }

    /**
     * ⚠️ 这里必须先挂浏览器的监听、把事件排队，然后才去连上游。
     *
     * 原因是时序：浏览器一 open 就会发 session.create，而连上游要几百毫秒。
     * 如果等连上再挂监听，这期间到达的事件就没人接，session.create 直接丢失，
     * 现象是「WebSocket 连上了但模型毫无反应」，很难查。
     */
    let upstream = null
    const pending = []

    clientPeer.on('message', (payload) => {
        if (upstream && !upstream.closed) upstream.send(payload)
        else pending.push(payload)
    })
    clientPeer.on('close', () => {
        log('浏览器断开')
        upstream?.destroy()
    })
    clientPeer.on('error', (err) => {
        warn('浏览器连接错误：', err.message)
        upstream?.destroy()
    })

    log(`浏览器接入（Origin: ${origin}），正在连上游 ${UPSTREAM}`)

    try {
        upstream = await connectUpstream()
    } catch (err) {
        warn('连上游失败：', err.message)
        clientPeer.send(JSON.stringify({
            type: 'error',
            code: 'UPSTREAM_UNREACHABLE',
            message: `连不上豆包语音服务：${err.message}`,
        }))
        clientPeer.close(1011, 'voice-proxy: upstream unreachable')
        return
    }

    log('上游已连接，开始双向转发')
    attachLogging(upstream, '上游')

    upstream.on('message', (payload) => clientPeer.send(payload))
    upstream.on('close', () => {
        log('上游连接关闭')
        clientPeer.destroy()
    })
    upstream.on('error', (err) => {
        warn('上游连接错误：', err.message)
        clientPeer.destroy()
    })

    // 补发排队中的上行事件（通常就是 session.create）
    for (const payload of pending) upstream.send(payload)
    pending.length = 0
}

/**
 * 给前端取用的「非机密」配置：人设、音色、采样率。
 *
 * ⚠️ 这里面**绝不能出现任何凭据**。浏览器永远只拿得到这些展示/协议参数，
 *    密钥留在本进程里，由它去连上游。
 */
function publicConfig() {
    return {
        configured: credentialsReady(),
        model: liveEnv('VOICE_MODEL', MODEL),
        voice: liveEnv('VOICE_SPEAKER', VOICE),
        // 人设走「现读磁盘」：改完 .env 刷新页面就生效，不必重启代理
        instructions: liveEnv('VOICE_INSTRUCTIONS', DEFAULT_INSTRUCTIONS),
        greeting: liveEnv('VOICE_GREETING', ''),
        speed: Number(liveEnv('VOICE_SPEED', '0')) || 0,
        loudness: Number(liveEnv('VOICE_LOUDNESS', '0')) || 0,
        proactiveSpeak: String(liveEnv('VOICE_PROACTIVE_SPEAK', 'false')).toLowerCase() === 'true',
        input: { format: 'pcm', rate: 16000, chunkMs: 20 },
        output: { format: liveEnv('VOICE_OUTPUT_FORMAT', 'pcm_s16le'), rate: 24000 },
    }
}

function startProxy(port) {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname

        /*
         * 前端开页时会来取一次配置。
         *
         * 注意这是个**跨源**请求：页面在 8123，本代理在 8124，而且页面开了
         * `COEP: require-corp`（serve.py 为 SharedArrayBuffer 而设）。
         * 跨源隔离下 CORS 模式的响应必须带 Access-Control-Allow-Origin，
         * 否则会被拦掉 —— 表现成「语音按钮一直显示连不上」。
         */
        if (pathname === '/voice-config') {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin',
                'Cache-Control': 'no-store',
            })
            res.end(JSON.stringify(publicConfig()))
            return
        }

        res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('voice-proxy：本端口提供 WebSocket（/voice-proxy）与配置（/voice-config）。静态页面请访问 8123。\n')
    })

    server.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (pathname !== '/voice-proxy') {
            socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
            return
        }

        const accept = crypto.createHash('sha1')
            .update(String(req.headers['sec-websocket-key'] || '') + WS_GUID)
            .digest('base64')

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        )

        handleProxySession(new WsPeer(socket, { mask: false, head }), req).catch((err) => {
            warn('代理会话异常：', err)
            try { socket.destroy() } catch { /* ignore */ }
        })
    })

    server.listen(port, '127.0.0.1', () => {
        log(`已启动：ws://127.0.0.1:${port}/voice-proxy`)
        log(`上游：${UPSTREAM}   模型：${MODEL}   音色：${VOICE}`)
        log(credentialsReady()
            ? `凭据：已配置（${env('VOICE_API_KEY') ? 'X-Api-Key' : '旧版三件套'}）`
            : '凭据：⚠️ 未配置 —— 请在 贵州葛镜桥/.env 里填写 VOICE_API_KEY')
    })

    const shutdown = () => {
        log('正在退出…')
        server.close(() => process.exit(0))
        setTimeout(() => process.exit(0), 500)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    return server
}

/* =========================================================== 连通性自检（--probe） */

/**
 * 按文档拼 session.create。字段结构如有偏差，自检时上游的报错会直接指出来。
 *
 * ⚠️ 结构与 `js/voice.js` 的 `_sendSessionCreate()`、以及官方 Web Demo 的
 * `_build_session_create()` 必须保持一致：键名是 `sample_rate`（不是 `rate`），
 * `voice` / `speed` / `loudness` 都在 `audio.output` 里，`extension` 是 session 的同级。
 */
function buildSessionCreate() {
    return {
        type: 'session.create',
        session: {
            model: MODEL,
            instructions: env('VOICE_INSTRUCTIONS', DEFAULT_INSTRUCTIONS),
            audio: {
                input: { format: { type: 'pcm', sample_rate: 16000 } },
                output: {
                    format: { type: env('VOICE_OUTPUT_FORMAT', 'pcm_s16le'), sample_rate: 24000 },
                    voice: VOICE,
                    speed: Number(env('VOICE_SPEED', '0')) || 0,
                    loudness: Number(env('VOICE_LOUDNESS', '0')) || 0,
                },
            },
        },
        extension: {
            extra: {
                enable_proactive_speak: String(env('VOICE_PROACTIVE_SPEAK', 'false')).toLowerCase() === 'true',
            },
        },
    }
}

async function probe({ seconds = 20 } = {}) {
    log(`自检开始：${UPSTREAM}`)
    log(`鉴权头：${Object.keys(upstreamHeaders()).join(', ')}`)
    log(`凭据：${credentialsReady() ? '已配置' : '⚠️ 未配置'}`)

    let peer
    try {
        peer = await connectUpstream()
    } catch (err) {
        warn('连接失败：', err.message)
        process.exitCode = 1
        return
    }

    log('✅ WebSocket 握手成功（说明端点与鉴权头可用）')

    const payload = buildSessionCreate()
    log('→ session.create：', JSON.stringify(payload).slice(0, 300))
    peer.send(JSON.stringify(payload))

    peer.on('text', (text) => {
        // 音频增量太长，只报长度
        if (text.includes('"response.output_audio.delta"') || text.includes('output_audio.delta')) {
            log(`← （音频增量 ${text.length} 字符）`)
            return
        }
        log('←', shorten(text, 400))
    })
    peer.on('error', (err) => warn('连接错误：', err.message))
    peer.on('close', () => log('上游已关闭连接'))

    await new Promise((r) => setTimeout(r, seconds * 1000))
    log(`自检结束（等待 ${seconds}s）`)
    peer.destroy()
}

/* =========================================================== 模拟上游（--mock） */

/**
 * 一个假的 Seeduplex 上游，专门用来在「账号服务还没开通」时验证浏览器这一侧。
 *
 * 它按真实协议收发：session.create → session.created；收够若干片上行音频后
 * 假装识别出一句话 → 推流式文字 → 推一段 440 Hz 音频。
 * 这样就覆盖了：会话建立、上行音频节奏、文字渲染、下行音频播放、打断事件 —— 全部不依赖凭据。
 */
function mockTone(rate, seconds, freq) {
    const n = Math.floor(rate * seconds)
    const buf = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) {
        // 两端淡入淡出，避免起止爆音
        const fade = Math.min(1, i / 800, (n - i) / 800)
        const v = Math.sin((2 * Math.PI * freq * i) / rate) * 0.22 * fade
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
    }
    return buf
}

async function mockReply(peer) {
    const send = (o) => peer.send(JSON.stringify(o))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))

    const question = '葛镜桥为什么叫这个名字？'
    send({ type: 'conversation.item.input_audio_transcription.started' })
    for (let i = 1; i <= question.length; i++) {
        // ⚠️ 必须发「累计快照」而不是单字增量 —— 真实服务端就是这么发的。
        // 之前的 Mock 发的是增量，于是客户端把累计当增量去拼、面板复读成
        // 「你你好听你好听得…」，而测试却一路绿灯。Mock 不照真实行为来，测试就是摆设。
        send({ type: 'conversation.item.input_audio_transcription.delta', delta: question.slice(0, i) })
        await wait(30)
    }
    send({ type: 'conversation.item.input_audio_transcription.completed', transcript: question })

    const answer = '因为修桥的人叫葛镜呀。他倾尽家财、三建三毁才把桥修成，后人就用他的名字做了桥名。'
    for (const ch of answer) {
        send({ type: 'response.output_text.delta', delta: ch })
        await wait(28)
    }
    send({ type: 'response.output_text.done', text: answer })

    send({ type: 'response.output_audio.started' })
    const tone = mockTone(24000, 1.2, 440)
    const step = 4800 // 0.2 秒一片
    for (let i = 0; i < tone.length; i += step) {
        send({
            type: 'response.output_audio.delta',
            // 用 `audio` 而不是 `delta` —— 官方客户端取值时 `audio` 在前，
            // 所以这里就该按首选字段发，才能验到真实那条路径
            audio: tone.subarray(i, Math.min(i + step, tone.length)).toString('base64'),
        })
        await wait(120)
    }
    send({ type: 'response.output_audio.done' })
    send({ type: 'response.done' })
    log('[mock] 一轮模拟回复推送完毕')
}

/**
 * 断言 `session.create` 的形状。
 *
 * 这份结构是照官方 Web Demo（`web_duplex_demo/server.py::_build_session_create`）对齐的，
 * 最容易错的就是层级和键名 —— 我自己第一版就错了三处。所以让 Mock 直接验一遍：
 * 即使账号还没开通、连不上真实上游，协议写错也能马上发现。
 */
function validateSessionCreate(msg) {
    const problems = []
    const session = msg.session || {}
    const input = (session.audio && session.audio.input) || {}
    const output = (session.audio && session.audio.output) || {}

    if (!session.model) problems.push('session.model 缺失')
    if (!session.instructions) problems.push('session.instructions 缺失')
    if (!session.audio) problems.push('session.audio 缺失')

    if (!input.format) problems.push('audio.input.format 缺失')
    else {
        if (input.format.type !== 'pcm') problems.push(`audio.input.format.type 应为 pcm，实际 ${input.format.type}`)
        if (!input.format.sample_rate) problems.push('audio.input.format.sample_rate 缺失（键名不是 rate）')
        if ('rate' in input.format) problems.push('audio.input.format 里出现了错误的键 `rate`，应为 sample_rate')
    }

    if (!output.format) problems.push('audio.output.format 缺失')
    else if (!output.format.sample_rate) problems.push('audio.output.format.sample_rate 缺失（键名不是 rate）')
    if (!output.voice) problems.push('audio.output.voice 缺失 —— 音色必须放在 audio.output 里')
    if ('voice' in session) problems.push('session.voice 存在 —— 音色位置写错了，应在 audio.output.voice')

    if (!('extension' in msg)) problems.push('顶层 extension 缺失 —— 它是 session 的同级')
    if (session.extension) problems.push('session.extension 存在 —— extension 是 session 的同级，不该嵌在 session 里')

    return problems
}

function startMockUpstream(port) {
    const server = http.createServer((_req, res) => {
        res.writeHead(404)
        res.end('mock upstream: WebSocket only\n')
    })

    server.on('upgrade', (req, socket, head) => {
        const accept = crypto.createHash('sha1')
            .update(String(req.headers['sec-websocket-key'] || '') + WS_GUID)
            .digest('base64')
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        )

        const peer = new WsPeer(socket, { mask: false, head })
        log('[mock] 代理已接入')

        let chunks = 0
        let replied = false

        peer.on('text', (text) => {
            let msg = null
            try { msg = JSON.parse(text) } catch { return }

            switch (msg.type) {
                case 'session.create': {
                    const problems = validateSessionCreate(msg)
                    if (problems.length) {
                        warn('[mock] ❌ session.create 结构不正确：')
                        for (const p of problems) warn('[mock]      - ' + p)
                    } else {
                        log('[mock] ✅ session.create 结构校验通过' +
                            '（sample_rate / audio.output.voice / 顶层 extension）')
                    }
                    const out = (msg.session && msg.session.audio && msg.session.audio.output) || {}
                    log('[mock]    请求：model=' + (msg.session && msg.session.model) +
                        ' 输入=' + JSON.stringify((msg.session?.audio?.input?.format) || {}) +
                        ' 输出=' + JSON.stringify(out.format || {}) +
                        ' 音色=' + (out.voice || '(空)'))
                    peer.send(JSON.stringify({ type: 'session.created', session: { id: 'mock-session' } }))
                    break
                }
                case 'session.close':
                    peer.send(JSON.stringify({ type: 'session.closed' }))
                    setTimeout(() => peer.close(1000, 'mock closed'), 60)
                    break
                case 'input_audio_buffer.append':
                    chunks++
                    // 收够 25 片（20 ms × 25 ≈ 0.5 秒音频）就假装识别出一句
                    if (chunks === 25 && !replied) {
                        replied = true
                        log('[mock] 收到 25 片上行音频，开始模拟一轮回复')
                        setTimeout(() => { mockReply(peer).catch((e) => warn('[mock] 回复失败:', e.message)) }, 150)
                    }
                    break
                case 'input_audio_mute.commit':
                    log('[mock] ← 静音（页面切到后台）')
                    break
                case 'input_audio_unmute.commit':
                    log('[mock] ← 取消静音')
                    break
                case 'response.cancel':
                    log('[mock] ← 客户端打断')
                    break
                default:
                    break
            }
        })

        peer.on('close', () => log('[mock] 代理断开'))
    })

    server.listen(port, '127.0.0.1', () => log(`[mock] 模拟上游已启动：ws://127.0.0.1:${port}/`))
    return server
}

/* =========================================================== 凭据诊断（--diagnose） */

/**
 * 用同一把 Key 去打几个不同的语音端点，看它到底覆盖了哪些服务。
 *
 * 为什么需要它：`45000030 requested resource not granted` 只说明「这个资源没授权给你」，
 * 但它区分不了三种情况 —— Key 本身不对 / 账号没开通 / 开通的是**别的**语音服务。
 * 把同一把 Key 同时打到「实时对话」「旧版实时对话」「语音合成」，各自的报错类型
 * 就能把范围收窄：
 *   - 处处都报 Invalid X-Api-Key      → Key 不对，或不属于这个账号
 *   - 只有实时对话报 not granted      → 开通的不是「实时对话式 AI」这一项
 *   - 处处都通过                      → 只是本端点的资源还没生效，重建一把 Key 再试
 */
async function postJsonWithKey(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': currentApiKey(),
            'X-Api-Request-Id': crypto.randomUUID().replace(/-/g, ''),
        },
        body: JSON.stringify(body),
    })
    return { status: res.status, text: (await res.text()).slice(0, 240) }
}

/** 把上游返回归类成人话 */
function classifyHttp(status, text) {
    if (/Invalid X-Api-Key|45000010/i.test(text)) return '❌ 这把 Key 不被该服务认可'
    if (/not granted|45000030/i.test(text)) return '❌ 服务未授权给该账号'
    if (status === 401 || status === 403) return '❌ 鉴权 / 授权被拒'
    if (status >= 400 && status < 500) return '✅ 鉴权通过（只是参数或资源不存在）'
    if (status < 400) return '✅ 可用'
    return '⚠️ 其它状态'
}

/** 从上游的 WebSocket 握手失败信息里抽出 code / message */
function explainHandshakeError(message) {
    const code = (message.match(/"code":"(\d+)"/) || [])[1] || ''
    const msg = (message.match(/"message":"([^"]+)"/) || [])[1] || ''
    if (/Invalid X-Api-Key|45000010/i.test(message)) return `❌ 这把 Key 不被认可（${code}）`
    if (/not granted|45000030/i.test(message)) return `❌ 资源未授权（${code} ${msg}）`
    return `❌ ${message.slice(0, 170)}`
}

async function diagnose() {
    const key = currentApiKey() || ''
    log('==================== 凭据诊断 ====================')
    log(`Key   ：${key ? key.slice(0, 8) + '…（共 ' + key.length + ' 字符）' : '(空)'}`)
    log(`目标端点：${UPSTREAM}`)
    log('')

    const wsCases = [
        ['Seeduplex 3.0（本功能要用的）', 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue'],
        ['旧版实时对话', 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'],
    ]
    for (const [name, url] of wsCases) {
        let verdict
        try {
            const peer = await connectUpstream({ url, timeoutMs: 12000 })
            peer.destroy()
            verdict = '✅ 握手成功 —— 这个端点可用'
        } catch (err) {
            verdict = explainHandshakeError(err.message || String(err))
        }
        log(`【WebSocket】${name}`)
        log(`   ${url}`)
        log(`   → ${verdict}`)
        log('')
    }

    // 语音合成的只读查询：用来判断「这把 Key 到底是不是语音服务的 Key」。
    // 故意传一个不存在的音色 —— 鉴权在前、参数在后，所以报「找不到音色」就说明鉴权过了。
    const ttsUrl = 'https://openspeech.bytedance.com/api/v3/tts/get_voice'
    try {
        const r = await postJsonWithKey(ttsUrl, { speaker_id: 'S_0000000000' })
        log('【HTTP】语音合成 get_voice（只读，不会创建任何资源）')
        log(`   → HTTP ${r.status}  ${classifyHttp(r.status, r.text)}`)
        log(`   ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`)
    } catch (err) {
        log('【HTTP】语音合成 get_voice 请求失败：' + err.message)
    }

    log('')
    log('解读：只要有一处「鉴权通过」，就说明 Key 本身有效，问题在服务开通这一层；')
    log('      若处处都是「Key 不被认可」，说明这把 Key 不对或不属于当前账号。')
    log('==================================================')
}

/* =========================================================== 入口 */

const argv = process.argv.slice(2)
const argValue = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

// `--resource none` 表示这一版干脆不带 X-Api-Resource-Id 这个头
if (argv.includes('--resource')) {
    const value = argValue('--resource', '')
    resourceOverride = /^(none|off|空|-)$/i.test(value) ? '' : value
}

// `--key <value>`：临时换一把密钥自检
if (argv.includes('--key')) keyOverride = argValue('--key', '')

if (argv.includes('--probe')) {
    await probe({ seconds: Number(argValue('--seconds', 20)) })
} else if (argv.includes('--mock')) {
    // 模拟上游：不连真实服务、不用凭据，只用来离线验证浏览器这一侧
    startMockUpstream(Number(argValue('--port', 8199)))
} else if (argv.includes('--diagnose')) {
    await diagnose()
} else if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
用法：
  node tools/voice-proxy.mjs                        起代理（默认端口 8124）
  node tools/voice-proxy.mjs --port 8124            指定端口
  node tools/voice-proxy.mjs --probe                连通性自检
  node tools/voice-proxy.mjs --diagnose             凭据诊断：同一把 Key 打多个语音端点，看覆盖了哪些服务
  node tools/voice-proxy.mjs --probe --resource none    自检时不带 X-Api-Resource-Id
  node tools/voice-proxy.mjs --mock --port 8199     起一个模拟上游（离线验证浏览器侧用）
`)
} else {
    startProxy(Number(argValue('--port', PORT)))
}
