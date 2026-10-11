/**
 * 录「门敞开 → 镜头推进 → 到门口换景」全过程（真实合成帧）。
 *
 * 触发的是用户真实路径：先到商店视图，再 flyShop(false)（真进场，非 dryRun）——
 * v3 时序：开门(880ms)与抵近(900ms)同时进行、同时结束 → push(easeOut，起步即最快，
 * ~200ms 后 veil) → veil 后 260ms 跳转 ≈ 1.36s。
 *
 * 产物：%TEMP%/wb-door/frames/*.jpg  + _meta.json
 * 接着跑 tools/contact-sheet.py 选关键时刻拼一张分镜图。
 *
 * 用法：node tools/probe-door.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9371
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const WW = +(process.argv[2] || 2560), WH = +(process.argv[3] || 1440)
const MS = +(process.argv[4] || 1450)   /* 跳转 ≈1.36s，赶在导航离开前停采 */
const OUT = path.join(process.env.TEMP || 'C:/Users/32686/AppData/Local/Temp', 'wb-door', 'frames')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP || 'C:/Users/32686/AppData/Local/Temp', 'wb-probe-door-profile'),
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
  await sleep(1200)
  console.log('视口', await ev('innerWidth + "x" + innerHeight'), 'dpr=' + await ev('devicePixelRatio'))

  /* 瞬时切到商店视图，省掉 1150ms 切场动画，直接进「点题匾」那一刻 */
  await ev('window.__scene3d.showShop()')
  await sleep(600)

  /* JPEG + ≤1280 宽：PNG 编码 2530×1345 会占满主线程（probe-frames.mjs 踩过） */
  const CW = Math.min(WW, 1280), CH = Math.round(CW * WH / WW)
  await send('Page.startScreencast', { format: 'jpeg', quality: 84, everyNthFrame: 1, maxWidth: CW, maxHeight: CH })
  await sleep(250)
  frames.length = 0

  const t0 = Date.now()
  /* 真进场：flyShop(false) → flyTo(抵近 900ms) → enterShopSequence（门开+穿门） */
  await ev('window.__scene3d.flyShop(false)')
  while (Date.now() - t0 < MS) await sleep(60)
  await send('Page.stopScreencast')

  const meta = []
  frames.forEach((f, i) => {
    const ms = Math.round((f.ts * 1000) - (t0))
    const nm = `f${String(i).padStart(4, '0')}_t${ms > 0 ? ms : 0}.jpg`
    fs.writeFileSync(path.join(OUT, nm), Buffer.from(f.data, 'base64'))
    meta.push({ i, file: nm, ts: f.ts * 1000, ms, w: f.w, h: f.h })
  })
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 1))
  console.log(`共 ${frames.length} 帧 → ${OUT}`)
  console.log(`平均 ${(MS / Math.max(frames.length, 1)).toFixed(1)}ms/帧`)
}
main().catch(e => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
