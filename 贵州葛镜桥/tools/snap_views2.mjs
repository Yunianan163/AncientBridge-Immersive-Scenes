// snap_views2.mjs —— 第二轮机位快照：开场构图验证 + 水面倒影对比
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9343
const TARGET = 'http://localhost:8123'
const OUT = 'E:\\葛镜桥高斯\\最新模型\\web\\tools\\e2e_drone\\views2'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-snap2-'))
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
// 关键：等过自动起航的 1.2s 延时，再停巡航
await sleep(3000)
await evaluate(`window.__viewer.drone.exit()`)

// 桥的世界坐标端点（config 注释里俯视拟合的桥轴线，桥面高程 0.13）
const BRIDGE = `[[-0.156, 0.13, 0.190], [0.155, 0.13, -0.147], [0.0, 0.13, 0.021]]`

// 摆机位 + 截图 + 桥端点屏幕投影
async function shot(name, cam, tgt, hideWater = false) {
    await evaluate(`(() => {
        const v = window.__viewer
        v.camera.position.set(${cam[0]}, ${cam[1]}, ${cam[2]})
        v.controls.target.set(${tgt[0]}, ${tgt[1]}, ${tgt[2]})
        v.controls.update()
        v.environment.water.visible = ${hideWater ? 'false' : 'true'}
    })()`)
    await sleep(1000)
    // 桥端点投影到屏幕（0..1 坐标，越界为负/超1）
    const proj = await evaluate(`(() => {
        const v = window.__viewer, T = window.__THREE
        const pts = ${BRIDGE}
        const out = []
        v.camera.updateMatrixWorld()
        const pv = new T.Vector3()
        for (const p of pts) {
            pv.set(p[0], p[1], p[2]).project(v.camera)
            out.push([+(pv.x * 0.5 + 0.5).toFixed(3), +(-pv.y * 0.5 + 0.5).toFixed(3)])
        }
        return out
    })()`)
    const state = await evaluate(`window.__viewer.environment.water.visible`)
    try {
        const s = await send('Page.captureScreenshot', { format: 'png' }, 30000)
        fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'))
        console.log('[shot]', name, '桥投影(左端/右端/中心):', JSON.stringify(proj), 'water:', state)
    } catch (e) { console.log('[fail]', name, e.message) }
}

// 开场候选：西岸（上游侧）
await shot('intro_w', [-0.24, -0.048, -0.20], [0.02, 0.05, -0.02])
// 开场候选：东岸（下游侧）
await shot('intro_e', [0.26, -0.048, 0.24], [-0.02, 0.05, 0.0])
// 倒影测试：低掠过水面看向桥，画面里同时有桥与其倒影
await shot('reflect_test', [0.55, -0.03, 0.42], [-0.05, 0.02, -0.02])
// 同机位隐藏水面（对照）
await shot('reflect_hidden', [0.55, -0.03, 0.42], [-0.05, 0.02, -0.02], true)

ws.close()
try { edge.kill() } catch {}
