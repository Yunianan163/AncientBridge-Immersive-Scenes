/**
 * 材质体检：读回网页里商品每个零件的真实材质参数。
 *
 * 为什么需要它：表面质感（陶瓷釉面 / 哑光…）改的是 metalness / roughness /
 * clearcoat / envMapIntensity 这些**看不见的数字**，光看截图很难判断
 * 「到底生效了没有、生效成了什么」。这个脚本把它们打出来，用来排除
 * 「以为是观感问题，其实是代码没跑」这类误判。
 *
 * 依赖 Scene.tsx 在开发模式下挂的 window.__scene。
 *
 * 用法：node scripts/check-material.mjs
 * 产物：终端输出（不写文件）
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

const EDGE = process.env.E2E_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.E2E_PORT || 9334)
const URL_ = process.env.E2E_URL || 'http://localhost:5173/'
const WAIT = Number(process.env.E2E_WAIT || 12000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', `wb-mat-profile-${PORT}`),
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--window-size=1280,800',
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
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r?.result?.value
}

async function main() {
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

  const dump = await evaluate(`(() => {
    const scene = window.__scene
    if (!scene) return JSON.stringify({ error: '取不到 window.__scene（要用开发模式跑）' })
    const root = scene.getObjectByName('product-root') || scene
    const out = []
    root.traverse((n) => {
      if (!n.isMesh) return
      const list = Array.isArray(n.material) ? n.material : [n.material]
      for (const m of list) {
        if (!m) continue
        out.push({
          part: n.name,
          material: m.name,
          type: m.type,
          color: '#' + m.color.getHexString(),
          metalness: m.metalness,
          roughness: m.roughness,
          clearcoat: m.clearcoat,
          clearcoatRoughness: m.clearcoatRoughness,
          sheen: m.sheen,
          envMapIntensity: m.envMapIntensity,
          hasEnvMap: Boolean(m.envMap),
          hasMap: Boolean(m.map),
        })
      }
    })
    return JSON.stringify({
      renderer: {
        exposure: scene.environment ? 'env 已设' : 'env 未设',
        envIntensity: scene.environmentIntensity,
      },
      parts: out,
    }, null, 2)
  })()`)

  console.log(dump)
  ws.close()
  edge.kill()
}

main().catch((err) => {
  console.error('失败：', err.message)
  edge.kill()
  process.exit(1)
})
