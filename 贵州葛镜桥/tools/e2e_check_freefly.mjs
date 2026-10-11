// e2e_check_freefly.mjs —— 无头 Edge CDP 验证：天空 + 无人机自由飞行（WASD/QE/拖动转向）
// 用法: node tools/e2e_check_freefly.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341
const TARGET = 'http://localhost:8123'
const OUT = 'E:/葛镜桥高斯/最新模型/web/tools/e2e_freefly'
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
const key = async (type, k, mods = {}) => {
    await send('Input.dispatchKeyEvent', { type, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0, nativeVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0, ...mods })
}
const holdKey = async (k, ms) => { await key('keyDown', k); await sleep(ms); await key('keyUp', k) }
const cam = async () => await evaluate(`window.__viewer.camera.position.toArray().map(v=>+v.toFixed(4))`)

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: TARGET })

// ---- 0. 等页面就绪：环境(天空) + 无人机 + 水面已移除 ----
let bootState = null
for (let i = 0; i < 90; i++) {
    await sleep(1000)
    bootState = await evaluate(`(() => {
        const v = window.__viewer
        if (!v) return null
        return { sky: !!(v.environment && v.environment.sky),
                 waterGone: !(v.environment && v.environment.water),
                 drone: !!v.drone,
                 loadMs: Math.round(v.loadInfo?.ms || 0) }
    })()`)
    if (bootState && bootState.sky && bootState.drone) { console.log(`[ok] 页面就绪 (${i + 1}s)`, JSON.stringify(bootState)); break }
}
if (!bootState || !bootState.sky || !bootState.drone) {
    console.log('E2E_FAIL: 页面未就绪', JSON.stringify(bootState))
    consoleAll.slice(-30).forEach((l) => console.log(l))
    process.exit(1)
}
const waterGone = bootState.waterGone
console.log('[env] 天空: ok   水面已移除:', waterGone ? 'ok' : 'FAIL(仍存在)')

// ---- 1. 自动进入飞行模式（main.js 1.2s 后切入） ----
await sleep(2500)
const autoFly = await evaluate(`window.__viewer.droneActive`)
console.log('[drone] 自动进入飞行模式:', autoFly ? 'ok' : 'FAIL')

// ---- 2. W 前进：位移在视线方向上的投影应显著为正 ----
const dir0 = await evaluate(`window.__viewer.camera.getWorldDirection(new window.__THREE.Vector3()).toArray().map(v=>+v.toFixed(4))`)
const pW0 = await cam()
await holdKey('w', 1500)
const pW1 = await cam()
const dx = pW1[0] - pW0[0], dy = pW1[1] - pW0[1], dz = pW1[2] - pW0[2]
const projW = dx * dir0[0] + dy * dir0[1] + dz * dir0[2]
console.log(`[W] 沿视线投影位移: ${projW.toFixed(4)} (${pW0} -> ${pW1})`)

// ---- 3. Q 上升 / E 下降 ----
const pQ0 = await cam()
await holdKey('q', 1200)
const pQ1 = await cam()
const riseY = pQ1[1] - pQ0[1]
console.log(`[Q] 高度变化: ${riseY.toFixed(4)} (${pQ0[1]} -> ${pQ1[1]})`)

const pE0 = await cam()
await holdKey('e', 1200)
const pE1 = await cam()
const dropY = pE1[1] - pE0[1]
console.log(`[E] 高度变化: ${dropY.toFixed(4)} (${pE0[1]} -> ${pE1[1]})`)

// ---- 4. A 左平移：位移与视线右向的点积应为负 ----
const right0 = await evaluate(`(() => {
    const v = window.__viewer
    const fwd = new window.__THREE.Vector3(); v.camera.getWorldDirection(fwd)
    const right = new window.__THREE.Vector3().crossVectors(fwd, v.camera.up).normalize()
    return right.toArray().map(x=>+x.toFixed(4))
})()`)
const pA0 = await cam()
await holdKey('a', 1200)
const pA1 = await cam()
const projA = (pA1[0]-pA0[0])*right0[0] + (pA1[1]-pA0[1])*right0[1] + (pA1[2]-pA0[2])*right0[2]
console.log(`[A] 沿右向投影位移: ${projA.toFixed(4)} (应为负)`)

// ---- 5. 拖动转向：yaw 应发生变化，画面随转动 ----
const yaw0 = await evaluate(`window.__viewer.drone._yaw`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 })
for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720 - i * 30, y: 450, button: 'left', buttons: 1 })
    await sleep(30)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 480, y: 450, button: 'left', clickCount: 1 })
await sleep(300)
const yaw1 = await evaluate(`window.__viewer.drone._yaw`)
const yawDelta = yaw1 - yaw0
console.log(`[drag] yaw: ${(+yaw0).toFixed(4)} -> ${(+yaw1).toFixed(4)} (Δ${(+yawDelta).toFixed(4)})`)

// ---- 6. 飞行中截图 ----
try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    fs.writeFileSync(path.join(OUT, 'flying.png'), Buffer.from(shot.data, 'base64'))
    console.log('[shot] flying.png')
} catch (e) { console.log('[warn] 截图失败:', e.message) }

// ---- 7. D 退出飞行 / 再进入 ----
await key('keyDown', 'd'); await key('keyUp', 'd')
await sleep(400)
const exited = await evaluate(`!window.__viewer.droneActive && window.__viewer.controls.enabled`)
await key('keyDown', 'd'); await key('keyUp', 'd')
await sleep(400)
const reentered = await evaluate(`window.__viewer.droneActive`)
console.log(`[D] 退出飞行: ${exited ? 'ok' : 'FAIL'}   重新进入: ${reentered ? 'ok' : 'FAIL'}`)

// ---- 8. R 键（飞行中）应退出并回到开场机位 ----
await key('keyDown', 'r'); await key('keyUp', 'r')
await sleep(800)
const afterReset = await evaluate(`(() => ({ drone: window.__viewer.droneActive,
    cam: window.__viewer.camera.position.toArray().map(v=>+v.toFixed(3)),
    fps: +window.__viewer.fps.toFixed(1) }))()`)
console.log('[R] 飞行中重置:', JSON.stringify(afterReset))
try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    fs.writeFileSync(path.join(OUT, 'intro.png'), Buffer.from(shot.data, 'base64'))
    console.log('[shot] intro.png')
} catch (e) { console.log('[warn] 截图失败:', e.message) }

// ---- 9. 汇总 ----
const fatal = consoleErrors.filter((e) => e && !/favicon|Autofill|DevTools|GroupMarkerNotSet/i.test(e))
const pass = waterGone && autoFly && projW > 0.02 && riseY > 0.02 && dropY < -0.02 && projA < -0.02
    && Math.abs(yawDelta) > 0.2 && exited && reentered && !afterReset.drone && fatal.length === 0
console.log('==== E2E 汇总 ====')
console.log('天空:', bootState.sky ? 'ok' : 'FAIL')
console.log('水面已移除:', waterGone ? 'ok' : 'FAIL')
console.log('自动进入飞行:', autoFly ? 'ok' : 'FAIL')
console.log('W 前进:', projW > 0.02 ? 'ok' : 'FAIL')
console.log('Q 上升:', riseY > 0.02 ? 'ok' : 'FAIL')
console.log('E 下降:', dropY < -0.02 ? 'ok' : 'FAIL')
console.log('A 左移:', projA < -0.02 ? 'ok' : 'FAIL')
console.log('拖动转向:', Math.abs(yawDelta) > 0.2 ? 'ok' : 'FAIL')
console.log('D 切换往返:', (exited && reentered) ? 'ok' : 'FAIL')
console.log('R 重置:', !afterReset.drone ? 'ok' : 'FAIL')
console.log('FPS:', afterReset.fps)
console.log('控制台错误:', fatal.length ? fatal.slice(0, 8) : '无')
console.log(pass ? 'E2E_PASS' : 'E2E_FAIL')
ws.close()
cleanup()
process.exit(pass ? 0 : 1)
