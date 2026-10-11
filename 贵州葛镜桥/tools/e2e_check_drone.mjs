// e2e_check_drone.mjs —— 无头 Edge CDP 验证：天空 + 反射水面 + 无人机巡航
// 用法: node tools/e2e_check_drone.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const TARGET = 'http://localhost:8123'
const OUT = 'E:\\葛镜桥高斯\\最新模型\\web\\tools\\e2e_drone'
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-e2e-'))
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
if (!version) { console.log('E2E_FAIL: CDP 端口未就绪'); process.exit(1) }

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = pages.find((p) => p.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let mid = 0
const pending = new Map()
const consoleErrors = []
const consoleAll = []
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
    } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args?.map((a) => a.value ?? a.description).join(' ')
        if (msg.params.type === 'error') consoleErrors.push(text)
        consoleAll.push(`[${msg.params.type}] ${text}`)
    }
}
const send = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
    const id = ++mid
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' 超时')) } }, timeoutMs)
})
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: TARGET })

// 等页面就绪：环境 + 无人机都初始化完（__viewer 挂上且 environment.water 存在）
let bootState = null
for (let i = 0; i < 90; i++) {
    await sleep(1000)
    bootState = await evaluate(`(() => {
        const v = window.__viewer
        if (!v) return null
        return { env: !!(v.environment && v.environment.water && v.environment.sky),
                 drone: !!v.drone,
                 loadMs: Math.round(v.loadInfo?.ms || 0) }
    })()`)
    if (bootState && bootState.env && bootState.drone) { console.log(`[ok] 页面就绪 (${i + 1}s)`, JSON.stringify(bootState)); break }
}
if (!bootState || !bootState.env) {
    console.log('E2E_FAIL: 环境未就绪')
    console.log('--- 页面控制台输出 ---')
    consoleAll.slice(-30).forEach((l) => console.log(l))
    console.log('--- 加载遮罩状态 ---')
    console.log(await evaluate(`(() => ({
        tip: document.querySelector('#load-tip')?.textContent || '',
        stage: document.querySelector('#load-stage')?.textContent || '',
        maskVisible: !!(document.querySelector('#loadmask') &&
                        document.querySelector('#loadmask').offsetParent !== null),
        hasViewer: !!window.__viewer,
    }))()`))
    process.exit(1)
}

// ---- 1. 无人机自动起航验证 + 飞行轨迹采样 ----
await sleep(2000)
let p1 = await evaluate(`(() => ({ t: window.__viewer.drone._t, active: window.__viewer.drone._active,
    cam: window.__viewer.camera.position.toArray().map(v => +v.toFixed(4)),
    curveOk: !!window.__viewer.drone._curve, dur: window.__viewer.drone._duration }))()`)
const autoFly = await evaluate(`window.__viewer.droneActive`)
await sleep(4000)
let p2 = await evaluate(`(() => ({ t: window.__viewer.drone._t, active: window.__viewer.drone._active,
    cam: window.__viewer.camera.position.toArray().map(v => +v.toFixed(4)) }))()`)
const moved = p1 && p2 && p1.cam.some((v, i) => Math.abs(v - p2.cam[i]) > 1e-4)
console.log('[drone] 自动起航:', autoFly, ' 4s 位移:', moved, JSON.stringify(p1), '->', JSON.stringify(p2))

// 飞行中的截图
try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    fs.writeFileSync(path.join(OUT, 'flying.png'), Buffer.from(shot.data, 'base64'))
    console.log('[shot] flying.png')
} catch (e) { console.log('[warn] 截图失败:', e.message) }

// ---- 2. 暂停巡航 + 回到开场机位，截「初始视角」图 ----
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))`)
await sleep(800)
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))`)
await sleep(1500)
const introState = await evaluate(`(() => ({
    drone: window.__viewer.droneActive,
    cam: window.__viewer.camera.position.toArray().map(v => +v.toFixed(3)),
    fps: +window.__viewer.fps.toFixed(1),
}))()`)
console.log('[intro]', JSON.stringify(introState))
try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    fs.writeFileSync(path.join(OUT, 'intro.png'), Buffer.from(shot.data, 'base64'))
    console.log('[shot] intro.png')
} catch (e) { console.log('[warn] 截图失败:', e.message) }

// ---- 3. D 键恢复巡航，验证暂停/继续往返 ----
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))`)
await sleep(1000)
const resumed = await evaluate(`window.__viewer.droneActive`)
console.log('[drone] 恢复巡航:', resumed)

// ---- 4. 汇总 ----
const fatal = consoleErrors.filter((e) => e && !/favicon|Autofill|DevTools|GroupMarkerNotSet/i.test(e))
console.log('==== E2E 汇总 ====')
console.log('天空+水面:', bootState.env ? 'ok' : 'FAIL')
console.log('自动起航:', autoFly ? 'ok' : 'FAIL')
console.log('飞行位移:', moved ? 'ok' : 'FAIL')
console.log('暂停回开场:', !introState.drone ? 'ok' : 'FAIL')
console.log('恢复巡航:', resumed ? 'ok' : 'FAIL')
console.log('FPS:', introState.fps)
console.log('控制台错误:', fatal.length ? fatal.slice(0, 8) : '无')
const pass = bootState.env && autoFly && moved && !introState.drone && resumed && fatal.length === 0
console.log(pass ? 'E2E_PASS' : 'E2E_FAIL')
ws.close()
cleanup()
process.exit(pass ? 0 : 1)
