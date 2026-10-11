// e2e_check_2dgs.mjs —— 无头 Edge CDP 验证 2DGS 网格按 M 切换
// 用法: node tools/e2e_check_2dgs.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const TARGET = 'http://localhost:8123'
const EXPECT_FACES = '2,535,451'
const SHOT = 'E:\\葛镜桥高斯\\2DGS重训\\输出网格\\e2e_mesh_mode.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-e2e-'))
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--disable-sync', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const cleanup = () => { try { edge.kill() } catch {} }
process.on('exit', cleanup)

// 等 CDP 端口就绪
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
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description).join(' '))
    }
}
const send = (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
    const id = ++mid
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' 超时')) } }, timeoutMs)
})
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: TARGET })

// 等泼溅模型就绪（toast「模型已就绪」）或超时
let splatReady = false
for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const t = (await evaluate(`document.querySelector('#toast')?.textContent || ''`)) || ''
    const hasCanvas = await evaluate(`!!document.querySelector('canvas')`)
    if (t.includes('模型已就绪')) { splatReady = true; console.log(`[ok] 泼溅就绪 (${i + 1}s): ${t.trim()}`); break }
    if (i === 20 && !hasCanvas) { console.log('E2E_FAIL: 20s 仍无 canvas'); process.exit(1) }
}
if (!splatReady) console.log('[warn] 未捕到「模型已就绪」toast（可能已过期），继续')

// 按 M 切网格
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))`)
console.log('[..] 已派发 M 键，等待网格加载…')

// ui.js 的 mesh 分支 await loadMesh 后立刻用「网格模式」toast 覆盖「网格已就绪」，
// 所以不能等 toast，直接读 window.__viewer 的真实状态
let st = null
for (let i = 0; i < 60; i++) {
    await sleep(1000)
    st = await evaluate(`(() => {
        const v = window.__viewer
        if (!v) return null
        return { mode: v.displayMode, ready: v.meshReady,
                 tris: v.meshInfo?.tris || 0, verts: v.meshInfo?.verts || 0,
                 ms: Math.round(v.meshInfo?.ms || 0) }
    })()`)
    if (st && st.mode === 'mesh' && st.ready) break
}
console.log('[state]', JSON.stringify(st))

// 再按 M 切回泼溅，验证往返
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))`)
await sleep(1500)
const backMode = await evaluate(`window.__viewer?.displayMode`)
console.log('[back] 切回泼溅:', backMode)

// 截图留档
try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
    console.log('[shot]', SHOT)
} catch (e) { console.log('[warn] 截图失败:', e.message) }

// 汇总
const faceOk = !!st && st.mode === 'mesh' && st.ready && st.tris === 2535451
const backOk = backMode === 'splat'
const fatal = consoleErrors.filter((e) => e && !/favicon|Autofill|DevTools/i.test(e))
console.log('==== E2E 汇总 ====')
console.log('泼溅加载:', splatReady ? 'ok' : '未确认(可能是 toast 已过期)')
console.log('网格切换:', faceOk ? `ok（${st.tris.toLocaleString()} 面 / ${st.verts.toLocaleString()} 顶点 / 加载 ${st.ms}ms）` : 'FAIL -> ' + JSON.stringify(st))
console.log('切回泼溅:', backOk ? 'ok' : 'FAIL -> ' + backMode)
console.log('控制台错误:', fatal.length ? fatal.slice(0, 5) : '无')
const pass = faceOk && backOk && fatal.length === 0
console.log(pass ? 'E2E_PASS' : 'E2E_FAIL')
ws.close()
cleanup()
process.exit(pass ? 0 : 1)
