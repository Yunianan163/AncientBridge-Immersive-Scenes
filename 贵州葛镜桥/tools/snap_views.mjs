// snap_views.mjs —— 批量机位快照：验证水面倒影 + 挑选开场机位
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9341
const TARGET = 'http://localhost:8123'
const OUT = 'E:\\葛镜桥高斯\\最新模型\\web\\tools\\e2e_drone\\views'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-snap-'))
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--disable-sync', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => { try { edge.kill() } catch {} })

let version = null
for (let i = 0; i < 30 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(500) }
}
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let mid = 0
const pending = new Map()
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
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

for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const ok = await evaluate(`!!(window.__viewer && window.__viewer.environment && window.__viewer.environment.water && window.__viewer.drone)`)
    if (ok) break
}
// 停掉自动巡航，免得机位被抢
await evaluate(`window.__viewer.drone.exit()`)

// 候选机位：名字 -> [camX,camY,camZ, tgtX,tgtY,tgtZ]
const VIEWS = {
    // 开场候选：河面上游看主拱，距离递减
    intro_far:   [-0.42, -0.035, -0.34,  0.02, 0.085, 0.05],
    intro_mid:   [-0.30, -0.050, -0.24,  0.00, 0.100, 0.02],
    intro_near:  [-0.22, -0.055, -0.16,  0.00, 0.105, 0.02],
    // 对岸（下游东南侧）看桥
    intro_se:    [ 0.45, -0.040,  0.36, -0.02, 0.100, -0.02],
    // 水面验证：俯视水面 + 桥的倒影
    water_test:  [ 0.30,  0.080,  0.24,  0.05, -0.095, -0.02],
    // 高空全景
    aerial:      [-0.55,  0.300,  0.30,  0.10,  0.050,  0.05],
}

for (const [name, v] of Object.entries(VIEWS)) {
    await evaluate(`(() => {
        const v = window.__viewer
        if (v.drone.active) v.drone.exit()
        v.camera.position.set(${v[0]}, ${v[1]}, ${v[2]})
        v.controls.target.set(${v[3]}, ${v[4]}, ${v[5]})
        v.controls.update()
    })()`)
    await sleep(1200)   // 等反射渲染与排序
    const state = await evaluate(`(() => ({
        cam: window.__viewer.camera.position.toArray().map(x => +x.toFixed(3)),
        tgt: window.__viewer.controls.target.toArray().map(x => +x.toFixed(3)),
        droneActive: window.__viewer.droneActive,
    }))()`)
    console.log('[state]', name, JSON.stringify(state))
    try {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, 30000)
        fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'))
        console.log('[shot]', name)
    } catch (e) { console.log('[fail]', name, e.message) }
}
ws.close()
try { edge.kill() } catch {}
