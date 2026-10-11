// snap_ab.mjs —— 同机位 A/B 对比截图：定位崖壁泛白的原因
// 用法: node tools/snap_ab.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9343
const OUT = 'E:/葛镜桥高斯/最新模型/web/tools/ab_white'
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-ab-'))
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--disable-sync', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const cleanup = () => { try { edge.kill() } catch {} }
process.on('exit', cleanup)

let version = null
for (let i = 0; i < 30 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(500) }
}
if (!version) { console.log('FAIL: CDP 未就绪'); process.exit(1) }

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = pages.find((p) => p.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let mid = 0
const pending = new Map()
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}, timeoutMs = 90000) => new Promise((res, rej) => {
    const id = ++mid
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' 超时')) } }, timeoutMs)
})
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value
const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, 30000)
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'))
    console.log('[shot]', name)
}

await send('Page.enable')
await send('Runtime.enable')

// 为了让泛白区域占画面主体，机位贴近用户截图的位置：桥面东侧上空、面朝北岸崖壁
const CASES = [
    ['base',            ''],                       // 当前默认
    ['sky0',            '&sky=0'],                 // 关掉天空：验证泛白是否天空导致
    ['alpha40',         '&alpha=40'],              // 提高半透明噪点剔除
    ['maxsize256',      '&maxsize=256'],           // 限制贴脸大高斯
    ['sh0',             '&sh=0'],                  // 关球谐（排除视角相关泛白）
    ['alpha40_max256',  '&alpha=40&maxsize=256'],  // 组合
]

for (const [name, q] of CASES) {
    await send('Page.navigate', { url: `http://localhost:8123/?x=1${q}` })
    let ready = false
    for (let i = 0; i < 120; i++) {
        await sleep(1000)
        ready = await evaluate(`!!(window.__viewer && window.__viewer.loadInfo && window.__viewer.loadInfo.ms > 0)`)
        if (ready) break
    }
    if (!ready) { console.log('[skip]', name, '未就绪'); continue }
    await sleep(3500)   // 等自动飞行模式切入 + 渲染稳定（enter 不移动相机，机位不变）
    await shot(name)
}
ws.close()
cleanup()
console.log('DONE')
process.exit(0)
