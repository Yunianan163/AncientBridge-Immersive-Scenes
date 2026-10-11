/**
 * 场景选择页 · 文创坊「按指定机位取景」探针。
 *
 * 为什么单独有这个脚本：用户报观感问题（"某处变形了"）时，
 * 报障截图往往**不是** e2e 默认拍的那两档机位 —— 直接拿 e2e 的图去比对，
 * 会因为取景不同而把结论带偏。这个脚本用**真实 wheel 事件**走 OrbitControls
 * （与用户滚轮拉近完全同一条代码路径），把相机移到指定距离再截图。
 *
 * 用法：
 *   node tools/probe-closeup.mjs                 # 默认 0.70（切场档）与 0.47（约 1.5 倍近景）
 *   E2E_DISTS=1.02,0.70,0.47 node tools/probe-closeup.mjs
 *   E2E_VIEWPORT=880x820 node tools/probe-closeup.mjs    # 也可用 E2E_VIEWPORT=828x774 复现用户窗口
 * 产物：tools/shots/_probe-商店-<距离>.png
 *
 * 判「用户在哪一档」的办法：量画面里「文创坊」匾额占宽度的百分比。
 * 实测参考（850px 宽视口）：切场档 1.02 → 14.4%，近景 0.47 → 25.3%。
 * 两位桥的标记尺寸也可以当第二种尺子，互相印证。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, 'shots')
fs.mkdirSync(OUT_DIR, { recursive: true })

const EDGE = process.env.E2E_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.E2E_PORT || 9367)
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const [VW, VH] = (process.env.E2E_VIEWPORT || '880,820').split(',').map(Number)
const DISTS = (process.env.E2E_DISTS || '0.70,0.47').split(',').map(Number)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-shopclose-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-sync', '--disable-background-networking',
  `--window-size=${VW},${VH}`,
], { stdio: 'ignore' })

let ws
let nextId = 1
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)) } }, 60000)
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r?.result?.value
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const f = path.join(OUT_DIR, name + '.png')
  fs.writeFileSync(f, Buffer.from(data, 'base64'))
  console.log('  截图 →', path.basename(f), fs.statSync(f).size + 'B')
  return f
}

async function main() {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('拿不到 Edge 调试目标')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true })
    ws.addEventListener('error', j, { once: true })
  })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })

  /* 时序：三件事分别等掉，再等几帧真渲染（只等 __scene3d 会打在载入层那一帧） */
  for (let i = 0; i < 90; i++) {
    await sleep(300)
    if (await evaluate('!!window.__scene3d && !!document.querySelector("#nav-view.on")')) break
  }
  console.log('  视口 =', JSON.stringify(await evaluate('[innerWidth,innerHeight]')),
              ' fov =', await evaluate('__scene3d.camera.fov'))

  await evaluate(`document.getElementById('nav-view').click()`)
  for (let i = 0; i < 40; i++) {
    await sleep(150)
    if ((await evaluate('__scene3d.viewK()')) >= 1) break
  }
  await evaluate('__scene3d.flyShop(true)')     // dryRun：飞到终点但不跳转
  await sleep(1400)

  const dist = () => evaluate('__scene3d.camera.position.distanceTo(__scene3d.controls.target)')
  const { width, height } = await evaluate('({width:innerWidth,height:innerHeight})')

  for (const want of DISTS) {
    /* 滚轮只能"拉近或拉远"，先回到切场档再逐格调到目标 */
    await evaluate(`__scene3d.showShop()`)
    await evaluate('__scene3d.flyShop(true)')
    await sleep(900)
    let guard = 0
    const dir = want < (await dist()) ? -120 : 120      // deltaY < 0 = 拉近
    while (Math.abs((await dist()) - want) > 0.02 && guard++ < 40) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: Math.round(width / 2), y: Math.round(height / 2),
        deltaX: 0, deltaY: dir, modifiers: 0,
      })
      await sleep(70)
      const d = await dist()
      if ((dir < 0 && d < want - 0.15) || (dir > 0 && d > want + 0.15)) break   // 过头就停
    }
    await sleep(450)
    console.log(`  目标 ${want} → 实际距离 ${(await dist()).toFixed(3)}`)
    await shot(`_probe-商店-${want.toFixed(2)}`)
  }
}

main()
  .catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
