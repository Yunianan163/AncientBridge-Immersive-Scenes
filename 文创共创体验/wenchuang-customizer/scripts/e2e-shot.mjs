/**
 * 用系统自带 Edge 的 CDP 给网页拍一张截图 + 读回关键 DOM，用于肉眼确认 3D 效果。
 *
 * 为什么单独写一个：开发过程中要反复「看模型长什么样、贴图对不对」，
 * 每次都手写一遍 CDP 太浪费。这个脚本只做「打开 → 等 → 截图 → 读 DOM」，不做交互。
 *
 * 用法：
 *   node scripts/e2e-shot.mjs [输出文件名，默认 shot]
 *   node scripts/e2e-shot.mjs 11-新模型 --wait 14000
 *
 * 产物：docs/联调截图/<名字>.png
 * 依赖：无（Node 22 自带 WebSocket / fetch），必须用 localhost 而不是 127.0.0.1。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '..', 'docs', '联调截图')

const EDGE = process.env.E2E_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.E2E_PORT || 9333)
const URL_ = process.env.E2E_URL || 'http://localhost:5173/'

const args = process.argv.slice(2)
const NAME = args.find((a) => !a.startsWith('--')) || 'shot'
const waitIndex = args.indexOf('--wait')
const WAIT = waitIndex >= 0 ? Number(args[waitIndex + 1]) : 12000

fs.mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-e2e-profile'),
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=msEdgeSyncPromo,msImplicitSignin,msEdgeCollectionsPromotion,EdgeIdentity',
    '--window-size=1440,900',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 1
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时: ${method}`))
      }
    }, 60000)
  })

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.value
}

const screenshot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = path.join(OUT_DIR, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

async function main() {
  // 找到 CDP 的 webSocket 端点
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      /* 还没起来 */
    }
  }
  if (!target) throw new Error('连不上 Edge CDP')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })
  await sleep(WAIT)

  const report = await evaluate(`(() => {
    const text = (sel) => Array.from(document.querySelectorAll(sel)).map(e => e.textContent.trim()).filter(Boolean)
    const canvas = document.querySelector('canvas')
    return JSON.stringify({
      title: document.title,
      canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
      headings: text('h1, h2, h3').slice(0, 12),
      buttons: text('button').slice(0, 30),
      badge: text('.scene-error-badge'),
      footer: text('footer, .studio-hint, .studio-status').slice(0, 10),
      bodyLen: document.body.innerText.length,
    })
  })()`)

  const file = await screenshot(NAME)
  console.log('截图 →', file)
  console.log(report ? JSON.stringify(JSON.parse(report), null, 2) : '(没有读到 DOM)')
}

main()
  .catch((err) => {
    console.error('失败：', err.message)
    process.exitCode = 1
  })
  .finally(() => {
    try { ws?.close() } catch { /* ignore */ }
    edge.kill()
  })
