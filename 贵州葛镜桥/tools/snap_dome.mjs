// snap_dome.mjs —— 顶部天空穹顶效果验证：三个机位截图
// 用法: node tools/snap_dome.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9347
const OUT = 'E:/葛镜桥高斯/最新模型/web/tools/ab_dome'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dome-'))
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
const consoleErrors = []
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    else if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
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
await send('Page.navigate', { url: 'http://localhost:8123/?x=1' })

// 加载途中截一张：看新宣纸风格的加载卡
await sleep(2500)
await shot('view_loadmask')

let ready = false
for (let i = 0; i < 120; i++) {
    await sleep(1000)
    ready = await evaluate(`!!(window.__viewer && window.__viewer.loadInfo && window.__viewer.loadInfo.ms > 0)`)
    if (ready) break
}
if (!ready) { console.log('FAIL: 页面未就绪'); process.exit(1) }
await sleep(3000)

// 机位 1：开场机位（默认视角，确认场景内观感不变）
await shot('view_intro')

// 机位 2：远观（模拟用户截图：从场景外上方看，验证下方不再白茫茫）
await evaluate(`(() => {
    const v = window.__viewer
    if (v.droneActive) v.drone.exit()
    v.camera.position.set(1.5, 0.35, 1.6)
    v.controls.target.set(0.40, -0.03, -0.44)
    v.controls.update()
    return true
})()`)
await sleep(1200)
await shot('view_far')

// 机位 3：侧面低角度（验证地平线淡出带自然）
await evaluate(`(() => {
    const v = window.__viewer
    v.camera.position.set(-1.2, 0.05, 1.0)
    v.controls.target.set(0.40, 0.02, -0.30)
    v.controls.update()
    return true
})()`)
await sleep(1200)
await shot('view_lowside')

const errs = consoleErrors.filter((e) => e && !/favicon|Autofill|DevTools|GroupMarkerNotSet/i.test(e))
console.log('控制台错误:', errs.length ? errs.slice(0, 5) : '无')
ws.close()
cleanup()
console.log('DONE')
process.exit(0)
