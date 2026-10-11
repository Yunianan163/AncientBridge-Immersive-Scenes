/**
 * 抓文创共创页（5173）整页截图，作为门洞内腔的「店内海报」纹理。
 *
 * ⚠️ vite 只绑 IPv6 回环 —— URL 必须用 http://[::1]:5173/，
 *    写 127.0.0.1 会 10061 假失败（记过两次的坑）。
 *
 * 产物：assets/wenchuang-preview.png（1280x720，16:9）
 * 用法：node tools/shot-wenchuang.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9373
const URL_ = process.env.WC_URL || 'http://[::1]:5173/'
const WW = 1280, WH = 720
const OUT = path.join(process.cwd(), 'assets', 'wenchuang-preview.png')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

fs.mkdirSync(path.dirname(OUT), { recursive: true })

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP || 'C:/Users/32686/AppData/Local/Temp', 'wb-shot-wc-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--window-size=${WW},${WH}`, '--hide-scrollbars',
], { stdio: 'ignore' })

let ws, nextId = 1
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method: m, params: p }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)) } }, 60000)
})
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

async function main() {
  let t = null
  for (let i = 0; i < 40 && !t; i++) {
    await sleep(300)
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl) } catch {}
  }
  if (!t) throw new Error('拿不到 CDP 目标')

  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  })

  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })
  /* 等 React 挂载 + 3D 模型 + 右侧面板就位：canvas 出现后再给足余量 */
  for (let i = 0; i < 30; i++) { await sleep(500); if (await ev('!!document.querySelector("canvas")')) break }
  await sleep(9000)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log('已保存 →', OUT, fs.statSync(OUT).size + 'B')
}
main().catch(e => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {}; edge.kill() })
