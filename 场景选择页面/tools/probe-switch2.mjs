/**
 * 逐帧采样「地图 → 文创坊」切场，定位"末帧跳一下"。
 *
 * 记录每帧：两盏灯笼的投影屏幕坐标（间距 = 缩放代理，中点 = 位置代理）、
 * 相机全状态（position / target / fov / aspect / viewOffset / lift）。
 * 末帧跳变会同时出现在「间距突变」或「中点突变」上 —— 据此区分是几何、相机还是投影补偿。
 *
 * 用法：node tools/probe-switch2.mjs [winW] [winH]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9365
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const WW = +(process.argv[2] || 2560), WH = +(process.argv[3] || 1440)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP, 'wb-probe-switch2-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-sync', '--disable-background-networking',
  `--window-size=${WW},${WH}`,
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

  console.log(`视口 = ${await ev('innerWidth + "x" + innerHeight')}  dpr=${await ev('devicePixelRatio')}`)

  await ev(`
    (function(){
      const S = window.__scene3d, T = S.THREE;
      // 两盏灯笼的世界坐标（group 局部 (±0.126, 0.136, 0.112) + SHOP.x/0）
      const L = () => [new T.Vector3(S.SHOP.x - 0.126, 0, 0), new T.Vector3(S.SHOP.x + 0.126, 0, 0)];
      const g = S.__gshop || null;
      window.__samples = [];
      (function loop(){
        const shop = S.shopState();
        const v = S.camera.view;
        /* 灯笼的世界 y 要算上 group 的 y */
        const y = 0.136 + shop.pos[1];
        const proj = (x) => {
          const p = new T.Vector3(x, y, S.SHOP.z + 0.112);
          p.project(S.camera);
          return [ (p.x*0.5+0.5)*innerWidth, (-p.y*0.5+0.5)*innerHeight ];
        };
        const a = proj(S.SHOP.x - 0.126), b = proj(S.SHOP.x + 0.126);

        /* ★ 相机朝向误差（度）：当前 forward 与「position→target」的夹角。
           flyTo 只 lerp position/target、不更新 quaternion 时，这个值会在飞行中
           一路偏大，直到动画结束 controls.update() 把它一把拽回 0 —— 那就是"跳"。 */
        const fwd = new T.Vector3(0, 0, -1).applyQuaternion(S.camera.quaternion);
        const want = S.controls.target.clone().sub(S.camera.position).normalize();
        const aimErr = Math.acos(Math.min(1, Math.max(-1, fwd.dot(want)))) * 180 / Math.PI;

        window.__samples.push({
          t: performance.now(),
          k: +S.viewK().toFixed(4),
          sc: +shop.scale.toFixed(5),
          gy: +shop.pos[1].toFixed(5),
          ax: +a[0].toFixed(2), ay: +a[1].toFixed(2),
          bx: +b[0].toFixed(2), by: +b[1].toFixed(2),
          cx: +((a[0]+b[0])/2).toFixed(2), cy: +((a[1]+b[1])/2).toFixed(2),
          span: +(b[0]-a[0]).toFixed(2),
          aim: +aimErr.toFixed(3),
          cam: S.camera.position.toArray().map(v2 => +v2.toFixed(5)),
          tgt: S.controls.target.toArray().map(v2 => +v2.toFixed(5)),
          fov: S.camera.fov, asp: +S.camera.aspect.toFixed(5),
          lift: +S.lift().toFixed(2),
          voff: v ? v.offsetY : null,
          vh: v ? v.height : null, fh: v ? v.fullHeight : null,
          vw: v ? v.width : null, fw: v ? v.fullWidth : null,
        });
        if (window.__samples.length < 900) requestAnimationFrame(loop);
        else window.__samplesDone = true;
      })();
    })();
    true
  `)
  await sleep(300)
  const t1 = await ev('performance.now()')
  await ev(`document.getElementById('nav-view').click()`)
  for (let i = 0; i < 120; i++) { await sleep(200); if (await ev('!!window.__samplesDone')) break }

  const S = JSON.parse(await ev('JSON.stringify(window.__samples)'))
  fs.mkdirSync(path.join(process.env.TEMP, 'wb-jump'), { recursive: true })
  fs.writeFileSync(path.join(process.env.TEMP, 'wb-jump', 'switch2.json'), JSON.stringify(S, null, 1))

  const R = S.map((s, i) => {
    const p = i ? S[i-1] : null
    return { ...s, rt: s.t - t1,
      dcy: p ? +(s.cy - p.cy).toFixed(2) : 0,
      dspan: p ? +(s.span - p.span).toFixed(2) : 0,
      daim: p ? +(s.aim - p.aim).toFixed(3) : 0,
      dcam: p ? +Math.hypot(s.cam[0]-p.cam[0], s.cam[1]-p.cam[1], s.cam[2]-p.cam[2]).toFixed(6) : 0,
      dt: p ? +(s.t - p.t).toFixed(1) : 0 }
  })
  const after = R.filter(r => r.rt > -30)
  console.log('\n帧  相对ms  帧间隔  viewK   灯笼中点y  中点Δy  朝向误差°  朝向Δ°   相机位移   fov  aspect')
  for (const r of after) {
    if (r.rt > 1900) break
    console.log(`${r.rt.toFixed(0).padStart(6)} ${String(r.dt).padStart(6)} ${String(r.k).padStart(7)} ${String(r.cy).padStart(10)} ${String(r.dcy).padStart(8)} ${String(r.aim).padStart(9)} ${String(r.daim).padStart(8)} ${String(r.dcam).padStart(9)} ${String(r.fov).padStart(4)} ${String(r.asp).padStart(7)}`)
  }
  const big = after.filter(r => Math.abs(r.dcy) > 20)
  console.log('\n单帧纵向位移 > 20px 的帧：')
  for (const r of big) console.log(`   rt=${r.rt.toFixed(0)}ms dcy=${r.dcy} dspan=${r.dspan} 朝向误差=${r.aim}° (Δ${r.daim}°) dcam=${r.dcam} dt=${r.dt}ms`)
  if (!big.length) console.log('   （无 —— 本次未复现）')
}
main().catch(e => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
