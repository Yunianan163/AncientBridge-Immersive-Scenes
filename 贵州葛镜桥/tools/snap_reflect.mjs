// snap_reflect.mjs —— 倒影特写诊断
// 1) 验证 reflectionDim 注入是否真的进了着色器
// 2) 贴近桥正下方拍倒影特写（有水/无水对照）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9345
const TARGET = 'http://localhost:8123'
const OUT = 'E:\\葛镜桥高斯\\最新模型\\web\\tools\\e2e_drone\\reflect'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-refl-'))
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
const consoleMsgs = []
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        consoleMsgs.push(msg.params.args?.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
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

for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const ok = await evaluate(`!!(window.__viewer && window.__viewer.environment && window.__viewer.environment.water && window.__viewer.drone)`)
    if (ok) break
}
await sleep(3000)
await evaluate(`window.__viewer.drone.exit()`)

// --- 诊断 1: shader 注入检查 ---
const diag = await evaluate(`(() => {
    const w = window.__viewer.environment.water
    const fs_ = w.material.fragmentShader
    return {
        hasDim: /reflectionSample \\*= [0-9.]+;/.test(fs_),
        dimLine: (fs_.match(/reflectionSample \\*= [0-9.]+;/) || [null])[0],
        hasEdgeFade: fs_.includes('edgeFade'),
        uniformsSize: w.material.uniforms.size?.value,
    }
})()`)
console.log('[shader]', JSON.stringify(diag))

// --- 机位: 桥东南侧贴水, 画面同时含桥与其正下方倒影 ---
// 桥轴线: (-0.156,0.13,0.190) -> (0.155,0.13,-0.147); 桥中心 (0,0.13,0.02)
// 相机放桥下游侧水面上方一点点, 看向桥心略俯
async function shot(name, cam, tgt, hideWater = false) {
    await evaluate(`(() => {
        const v = window.__viewer
        v.camera.position.set(${cam[0]}, ${cam[1]}, ${cam[2]})
        v.controls.target.set(${tgt[0]}, ${tgt[1]}, ${tgt[2]})
        v.controls.update()
        v.environment.water.visible = ${hideWater ? 'false' : 'true'}
    })()`)
    await sleep(1500)
    try {
        const s = await send('Page.captureScreenshot', { format: 'png' }, 30000)
        fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'))
        console.log('[shot]', name)
    } catch (e) { console.log('[fail]', name, e.message) }
}

// 低机位: 水面上方 0.02, 离桥心 ~0.35, 仰视让桥与水面同框
await shot('close_low', [0.18, -0.075, 0.32], [-0.02, 0.06, -0.02])
await shot('close_low_nowater', [0.18, -0.075, 0.32], [-0.02, 0.06, -0.02], true)
// 更贴水面: 几乎与水面齐平
await shot('grazing', [0.30, -0.088, 0.36], [-0.05, 0.04, -0.05])

console.log('[console-errors]', consoleMsgs.length ? consoleMsgs.slice(0, 8) : '无')
ws.close()
try { edge.kill() } catch {}
