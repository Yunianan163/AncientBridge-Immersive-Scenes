/**
 * 验证「智能推荐」面板已从文创页删除。
 * 打开 5173，等 React 挂载 + HMR，查 .recommend-panel / .recommend-head 不应存在。
 * （vite 只绑 IPv6，URL 用 [::1]）
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TMP = 'C:/Users/32686/AppData/Local/Temp'
const URL = 'http://[::1]:5173/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws, nextId = 1
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method: m, params: p }))
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)) } }, 20000)
})
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

const edge = spawn(EDGE, [
  '--remote-debugging-port=9388', '--user-data-dir=' + path.join(TMP, 'wb-norec-profile'),
  '--headless=new', '--no-first-run', '--window-size=1280,800', URL,
], { stdio: 'ignore' })

async function main() {
  let target = null
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try { const list = await (await fetch('http://127.0.0.1:9388/json/list')).json(); target = list.find((t) => t.type === 'page') } catch {}
  }
  if (!target) throw new Error('没拿到 CDP target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  })
  await send('Page.enable'); await send('Runtime.enable')
  // 等 React 挂载完成（vite HMR 后组件渲染）
  await sleep(7000)
  const hasPanel = await ev("!!document.querySelector('.recommend-panel')")
  const hasHead = await ev("!!document.querySelector('.recommend-head')")
  const hasToggle = await ev("!!document.querySelector('.recommend-toggle')")
  const modelSel = await ev("!!document.querySelector('[class*=model]')")   // ModelSelector 应还在
  console.log('recommend-panel 存在:', hasPanel, '(应为 false)')
  console.log('recommend-head 存在:', hasHead, '(应为 false)')
  console.log('recommend-toggle 存在:', hasToggle, '(应为 false)')
  console.log('ModelSelector 类仍在:', modelSel, '(应为 true，器物选择没被误删)')
  const ok = hasPanel === false && hasHead === false && hasToggle === false && modelSel === true
  console.log('\n结论:', ok ? '✅ 智能推荐已删除，器物选择保留' : '❌ 删除不彻底或误删')
  if (!ok) process.exitCode = 1
}
main().catch((e) => { console.error('验证失败:', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {}; edge.kill() })
