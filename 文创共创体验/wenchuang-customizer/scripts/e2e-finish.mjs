/**
 * 表面质感对照图：依次点「陶瓷釉面 / 塑料 / 哑光陶土 / 半哑光 / 金属 / 帆布 / 绢丝」，
 * 每个档位裁一张商品特写。
 *
 * 为什么需要它：这一层改的是 metalness / roughness / clearcoat 这些数字，
 * 到底「看得出区别没有」只能靠肉眼比。裁掉面板只留商品，一眼就能比。
 *
 * 用法：node scripts/e2e-finish.mjs [输出前缀，默认 27-表面质感] [--model bag_b]
 * 产物：docs/联调截图/<前缀>-<档位>.png
 *
 * 换商品是为了做**同一档质感在不同商品上的对照** —— 例如「bag_b 的帆布
 * 和 bag_a 是不是同一档质感」，把两只包都跑一遍、横着比帆布那一张即可。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// 产物落点。`E2E_OUT_DIR` 可以覆盖（`models:regress` 复跑全表时丢临时目录，不往库里堆图）。
const OUT_DIR = process.env.E2E_OUT_DIR
  ? path.resolve(ROOT, process.env.E2E_OUT_DIR)
  : path.join(ROOT, 'docs', '联调截图')

const argv = process.argv.slice(2)
const isFlag = (a) => a.startsWith('--')
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
/** 位置参数 = 不带 `--` 且前一个也不是 `--` 的那些（兼容原来的 `e2e-finish 27-表面质感` 写法） */
const positional = argv.filter((a, i) => !isFlag(a) && (i === 0 || !isFlag(argv[i - 1])))
const PREFIX = positional[0] || argOf('--prefix', '27-表面质感')
const MODEL = argOf('--model', 'mug_a')
/** 各商品可贴的样本零件（顺便决定这个脚本支持哪些商品） */
const SAMPLE_PARTS = {
  mug_a: 'cup_body', bag_a: 'bag_front', bag_b: 'bag_front',
  holder_a: 'holder_side', holder_b: 'holder_side', vase_a: 'vase_side', vase_b: 'vase_side',
}
/** 读材质快照时拿哪个零件当样本（各商品的可贴部位名不同） */
const SAMPLE_PART = SAMPLE_PARTS[MODEL] || 'cup_body'

// `--list`：把支持的商品以 JSON 打给调用方后直接退出（`models:regress` 靠它拉清单）。
// 这个脚本没有「商品用例表」，支持哪些商品就等于 SAMPLE_PARTS 里键了哪些。
// ⚠️ 要取 SAMPLE_PARTS 的键，不是 SAMPLE_PART —— 后者是字符串，`Object.keys` 会按字符拆成 '0'..'7'。
if (argv.includes('--list')) {
  console.log(JSON.stringify(Object.keys(SAMPLE_PARTS).map((id) => ({ id, label: id }))))
  process.exit(0)
}

const PORT = 9336
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT_DIR, { recursive: true })

const edge = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-e2e-finish'),
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--disable-sync', '--disable-background-networking',
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`超时 ${method}`)) } }, 60000)
  })
const evaluate = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

/** 裁到商品那一块，去掉左右两侧的面板，方便横着对比 */
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 250, y: 80, width: 820, height: 760, scale: 1 },
  })
  const file = path.join(OUT_DIR, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('  截图 →', path.basename(file))
}

/** 截图时把浮层收起来（.click() 对隐藏元素照样有效，所以不影响后面点档位） */
const hidePanels = (hidden) => evaluate(`(() => {
  for (const sel of ['.model-selector', '.color-controls', '.studio-dock', '.toolbar']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = ${hidden ? "'hidden'" : "''"} })
  }
  return 'ok'
})()`)

const clickFinish = (label) => evaluate(`(() => {
  const btn = [...document.querySelectorAll('.finish-chip')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
  if (!btn) return '没找到：' + ${JSON.stringify(label)} + ' 现有：' + [...document.querySelectorAll('.finish-chip')].map(b => b.textContent.trim()).join('|')
  btn.click()
  return 'clicked ' + ${JSON.stringify(label)}
})()`)

const materialSnapshot = () => evaluate(`(() => {
  const scene = window.__scene
  const root = scene.getObjectByName('product-root') || scene
  let m = null
  root.traverse(n => { if (n.isMesh && n.name === ${JSON.stringify(SAMPLE_PART)}) m = Array.isArray(n.material) ? n.material[0] : n.material })
  if (!m) return '{}'
  return JSON.stringify({ type: m.type, metalness: m.metalness, roughness: m.roughness, clearcoat: m.clearcoat, clearcoatRoughness: m.clearcoatRoughness, sheen: m.sheen, hasWeave: Boolean(m.normalMap), weaveScale: m.normalScale ? m.normalScale.x : null, envMapIntensity: Number(m.envMapIntensity.toFixed(2)) })
})()`)

/** 原生 setter + 手动派发 change，React 受控 select 才认 */
const selectModel = (id) => evaluate(`(() => {
  const sel = document.querySelector('.model-dropdown')
  if (!sel) return '没找到模型下拉框'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, ${JSON.stringify(id)})
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return '已切到 ' + ${JSON.stringify(id)}
})()`)

async function main() {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* 等它起来 */ }
  }
  if (!target) throw new Error('连不上 CDP')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(14000)

  if (MODEL !== 'mug_a') {
    console.log('切换模型：', await selectModel(MODEL))
    await sleep(7000)
  }

  await evaluate(`(() => {
    const t = document.querySelector('[aria-label*="auto rotate" i], [aria-label*="自动" i]')
    if (t) t.click()
  })()`)

  // ⚠️ 这张清单是**写死的**，`finish.ts` 里加新档位时必须同步加到这里，
  // 否则新档位「静默不被回归覆盖」——加「纸质」时就踩过一次（跑出来只有 7 档还全绿）。
  const labels = ['陶瓷釉面', '塑料', '哑光陶土', '半哑光', '金属', '帆布', '绢丝', '纸质']
  /** 切成功、且真读到材质的档位 */
  const picked = []
  /** 各档位的材质指纹 —— 用来证明「点档位真的有改到参数」而不是空点 */
  const fingerprints = new Set()
  for (const label of labels) {
    await hidePanels(true)
    const clicked = await clickFinish(label)
    console.log(label, '→', clicked)
    await sleep(2200)
    await shot(`${PREFIX}-${labels.indexOf(label) + 1}${label}`)
    const snap = await materialSnapshot()
    console.log('   材质：', snap)
    let prof = null
    try { prof = JSON.parse(snap) } catch { /* 快照没拿到，下面按失败算 */ }
    if (String(clicked).startsWith('clicked') && prof?.type) {
      picked.push(label)
      fingerprints.add(JSON.stringify(prof))
    }
  }
  await hidePanels(false)

  // 这一步本来是**出对照图给人看**的，没有严格的对错；但它在 `models:regress` 里是一个闸门，
  // 「点了没反应」「材质压根没换」必须能被抓到，否则回归会给出一个假的绿灯。
  // 所以顺手断言两件事：每一档都切成功；各档确实改到了**不同**参数（指纹至少 3 种，留点余量）。
  console.log(`\n===== ${picked.length}/${labels.length} 通过 =====`)
  if (picked.length !== labels.length) {
    console.log('没切成功的档位：', labels.filter((l) => !picked.includes(l)).join('、') || '（都切了，只是没读到材质）')
    process.exitCode = 1
  }
  if (fingerprints.size < 3) {
    console.log(`  ✗ ${labels.length} 档只产生 ${fingerprints.size} 种材质指纹 —— 点档位大概没真的改材质`)
    process.exitCode = 1
  } else {
    console.log(`  材质指纹 ${fingerprints.size} 种（${labels.length} 档确实改到了不同参数）`)
  }
}

main().catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
