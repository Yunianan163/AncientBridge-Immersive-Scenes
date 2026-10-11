/**
 * 逐帧采样「地图 → 文创坊」的切场过渡，定位"末帧跳一下"的来源。
 *
 * 做法：在页面里挂一个 rAF 采样器（和渲染循环同频），把每帧的
 *   camera.position / controls.target / liftPx / viewK / 商店 scale
 * 记进数组，切场后再取回来。然后算**逐帧差分**——哪一帧的位移远大于
 * 邻帧，就是跳变帧；同时看是哪个量在那一刻突变。
 *
 * 用法：node tools/probe-switch.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9364
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const OUT = path.join(process.cwd(), 'tools', 'shots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP, 'wb-probe-switch-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-sync', '--disable-background-networking',
  '--window-size=1440,900',
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
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!window.__scene3d && document.getElementById("boot").classList.contains("gone")')) break }
  await sleep(1500)

  /* 装采样器：与渲染循环同频，记 420 帧（约 7 秒） */
  await ev(`
    window.__samples = [];
    (function loop(){
      const s = window.__scene3d;
      if (s) {
        window.__samples.push({
          t: performance.now(),
          p: s.camera.position.toArray().map(v => +v.toFixed(5)),
          g: s.controls.target.toArray().map(v => +v.toFixed(5)),
          lift: +s.lift().toFixed(2),
          k: +s.viewK().toFixed(4),
          sc: +s.shopState().scale.toFixed(4),
        });
      }
      if (window.__samples.length < 420) requestAnimationFrame(loop);
      else window.__samplesDone = true;
    })();
    true
  `)

  await sleep(300)
  const t0 = await ev('performance.now()')
  await ev(`document.getElementById('nav-view').click()`)
  const t1 = await ev('performance.now()')
  console.log(`点击 nav-view 完成，等 4.2s 采样…`)

  for (let i = 0; i < 90; i++) { await sleep(200); if (await ev('!!window.__samplesDone')) break }

  const raw = await ev('JSON.stringify(window.__samples)')
  const S = JSON.parse(raw).map(s => ({ ...s, rt: s.t - (t1 - 0) }))   // rt：相对点击的时刻

  /* 逐帧位移（相机位置变化量） */
  const rows = S.map((s, i) => {
    const prev = i ? S[i - 1] : null
    const dp = prev ? Math.hypot(s.p[0] - prev.p[0], s.p[1] - prev.p[1], s.p[2] - prev.p[2]) : 0
    const dg = prev ? Math.hypot(s.g[0] - prev.g[0], s.g[1] - prev.g[1], s.g[2] - prev.g[2]) : 0
    const dl = prev ? Math.abs(s.lift - prev.lift) : 0
    return { i, rt: s.rt, dp, dg, dl, lift: s.lift, k: s.k, sc: s.sc, p: s.p, g: s.g }
  })

  const after = rows.filter(r => r.rt > -20)
  const mx = Math.max(...after.map(r => r.dp))
  console.log(`\n切场后相机最大单帧位移 = ${mx.toFixed(5)} 世界单位`)
  console.log('帧  相对时刻ms   相机位移     target位移    补偿Δpx   viewK    商店scale')
  for (const r of after) {
    if (r.rt > 1600) break
    const flag = r.dp > mx * 0.30 && r.rt > 200 ? '  <<<< 末段尖峰' : ''
    console.log(`${String(r.i).padStart(3)} ${r.rt.toFixed(1).padStart(9)} ${r.dp.toFixed(6).padStart(11)} ${r.dg.toFixed(6).padStart(12)} ${r.dl.toFixed(1).padStart(9)} ${String(r.k).padStart(7)} ${String(r.sc).padStart(10)}${flag}`)
  }

  /* 末尾稳定段：取 k 到 1 之后的前后各 3 帧，看最终态在不在一条线上 */
  const done = after.filter(r => r.k >= 1)
  if (done.length) {
    console.log(`\nviewK 到 1 之后共 ${done.length} 帧，逐帧相机位置：`)
    for (const r of done.slice(0, 6)) {
      console.log(`   rt=${r.rt.toFixed(1)}ms  pos=[${r.p.map(v => v.toFixed(5)).join(', ')}]  g=[${r.g.map(v => v.toFixed(5)).join(', ')}]  lift=${r.lift}  dp=${r.dp.toFixed(6)}`)
    }
  }
  fs.writeFileSync(path.join(process.env.TEMP, 'wb-jump', 'switch-samples.json'), JSON.stringify(rows, null, 1))
  console.log('\n原始采样 →', path.join(process.env.TEMP, 'wb-jump', 'switch-samples.json'))
}

main().catch(e => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
