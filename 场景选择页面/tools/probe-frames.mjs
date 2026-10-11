/**
 * 录一段"真实合成帧"（Page.startScreencast），用**与人工看录屏同样的办法**查跳变：
 * 逐帧灰度差 → 找"前后都近乎静止、只有它自己很大"的孤立单帧尖峰。
 *
 * 为什么要用 screencast 而不是连续 Page.captureScreenshot：
 * 后者每次要 100~300ms，采样率太低，会把"跳一帧"直接漏掉，
 * 而且拿到的 k 与拍到的画面并非同一时刻（这点已经误导过我一次）。
 * screencast 走的是合成器出帧，节奏与真人看屏幕一致。
 *
 * ⚠️ 它也能直接分析**外部录屏**：把目录换成解好的 PNG 目录即可复用同一套判据。
 *
 * 用法：node tools/probe-frames.mjs [winW] [winH] [持续ms]
 * 产物：%TEMP%/wb-jump/frames-fixed/*.png  + 控制台一张逐帧差值表
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9367
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const WW = +(process.argv[2] || 2560), WH = +(process.argv[3] || 1440)
const MS = +(process.argv[4] || 2600)
const OUT = path.join(process.env.TEMP, 'wb-jump', 'frames-fixed')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP, 'wb-probe-frames-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-sync', '--disable-background-networking',
  `--window-size=${WW},${WH}`,
  '--hide-scrollbars',
], { stdio: 'ignore' })

let ws, nextId = 1
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method: m, params: p }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)) } }, 60000)
})
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

async function main() {
  let t = null
  for (let i = 0; i < 40 && !t; i++) {
    await sleep(300)
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl) } catch {}
  }
  if (!t) throw new Error('拿不到 CDP 目标')

  const frames = []
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Page.screencastFrame') {
      const { data, sessionId, metadata } = m.params
      frames.push({ ts: metadata.timestamp, data, w: metadata.deviceWidth, h: metadata.deviceHeight })
      send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      return
    }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  })

  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!window.__scene3d && document.getElementById("boot").classList.contains("gone")')) break }
  await sleep(1500)
  console.log(`视口 ${await ev('innerWidth + "x" + innerHeight')}  dpr=${await ev('devicePixelRatio')}`)

  /* ⚠️ 用 JPEG 而不是 PNG、且压到 ≤1280 宽：
     PNG 每帧要编码 2530×1345，screencast 会把渲染主线程占满，
     连 Runtime.evaluate（点箭头那一下）都会超时。
     判"跳一帧"只需要低分辨率的整体位移，1280 足够。 */
  const CW = Math.min(WW, 1280), CH = Math.round(CW * WH / WW)
  await send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1, maxWidth: CW, maxHeight: CH })
  await sleep(250)
  frames.length = 0                       // 丢掉点击前的静止帧
  const t0 = Date.now()
  await ev(`document.getElementById('nav-view').click()`)
  while (Date.now() - t0 < MS) await sleep(60)
  await send('Page.stopScreencast')

  /* 落盘：文件名带上相对点击的毫秒数，方便和 k 曲线对齐 */
  const meta = []
  frames.forEach((f, i) => {
    const nm = `f${String(i).padStart(4, '0')}_t${Math.round((f.ts * 1000) - (t0))}.jpg`
    fs.writeFileSync(path.join(OUT, nm), Buffer.from(f.data, 'base64'))
    meta.push({ i, file: nm, ts: f.ts * 1000, w: f.w, h: f.h })
  })
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 1))
  console.log(`共 ${frames.length} 帧（合成器出帧） → ${OUT}`)
  console.log(`平均 ${((MS / Math.max(frames.length, 1))).toFixed(1)}ms/帧  ≈ ${(1000 / (MS / Math.max(frames.length, 1))).toFixed(1)} fps`)
  console.log('\n接着跑 tools/analyze-frames.py 逐帧求差找孤立尖峰。')
}

main().catch(e => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
