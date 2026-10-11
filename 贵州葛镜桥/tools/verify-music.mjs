/**
 * 验证葛镜桥背景音乐按钮：存在、src 正确、点击能播放、再点能暂停。
 * 掐掉 *.ply 等大文件避免 248MB 加载卡死（只验音乐控件，不验模型）。
 * ★ 用 Input.dispatchMouseEvent（真实手势）而非 element.click()，
 *   否则无头下 audio.play() 被自动播放策略拦；并加 --autoplay-policy 兜底。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TMP = 'C:/Users/32686/AppData/Local/Temp'
const URL = 'http://127.0.0.1:8123/'

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
  '--remote-debugging-port=9389', '--user-data-dir=' + path.join(TMP, 'wb-music-profile2'),
  '--headless=new', '--no-first-run', '--window-size=1280,800',
  '--autoplay-policy=no-user-gesture-required', URL,
], { stdio: 'ignore' })

// 用真实鼠标手势点按钮（携带用户激活，能过自动播放策略）
async function clickBtn() {
  const raw = await ev("(() => { const b = document.getElementById('musicbtn').getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2, y:b.y+b.height/2, w:b.width}); })()")
  const box = JSON.parse(raw)
  if (!box.w) { console.log('  按钮无可点击区域'); return false }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  return true
}

async function main() {
  let target = null
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try { const list = await (await fetch('http://127.0.0.1:9389/json/list')).json(); target = list.find((t) => t.type === 'page') } catch {}
  }
  if (!target) throw new Error('没拿到 CDP target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  })
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*.ply', '*.ktx2', '*.splat', '*.sog'] })
  await sleep(3500)
  // 掐掉 ply 后模型加载不完，loadmask 不消失会盖住按钮 —— 隐藏它模拟"加载完成后点音乐"
  await ev("(() => { const m = document.getElementById('loadmask'); if (m) m.style.display = 'none'; return !!m; })()")

  const src = await ev("(() => { const a = document.getElementById('bgm'); return a ? a.src : null; })()")
  const loop = await ev("(() => { const a = document.getElementById('bgm'); return a ? a.loop : null; })()")
  const vol = await ev("(() => { const a = document.getElementById('bgm'); return a ? a.volume : null; })()")
  console.log('音频 src:', src ? src.slice(-50) : '❌ 无 audio')
  console.log('loop:', loop, '(应 true)  volume:', vol, '(应 0.5)')

  // 第一次点击 → 播放
  console.log('\n[第一次点击 → 应播放]')
  await clickBtn()
  await sleep(1000)
  const paused1 = await ev("document.getElementById('bgm').paused")
  const on1 = await ev("document.getElementById('musicbtn').classList.contains('is-on')")
  const title1 = await ev("document.getElementById('musicbtn').title")
  console.log('  paused=' + paused1 + '(应false)  is-on=' + on1 + '(应true)  title=' + title1)

  // 第二次点击 → 暂停
  console.log('[第二次点击 → 应暂停]')
  await clickBtn()
  await sleep(600)
  const paused2 = await ev("document.getElementById('bgm').paused")
  const on2 = await ev("document.getElementById('musicbtn').classList.contains('is-on')")
  const title2 = await ev("document.getElementById('musicbtn').title")
  console.log('  paused=' + paused2 + '(应true)  is-on=' + on2 + '(应false)  title=' + title2)

  const ok = !!src && String(src).includes('.mp3') && loop === true && vol === 0.5
    && paused1 === false && on1 === true
    && paused2 === true && on2 === false
  console.log('\n结论:', ok ? '✅ 音乐按钮可播放可暂停' : '❌ 有问题（若仅无头音频后端限制，真实浏览器不受影响）')
  if (!ok) process.exitCode = 1
}
main().catch((e) => { console.error('验证失败:', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {}; edge.kill() })
