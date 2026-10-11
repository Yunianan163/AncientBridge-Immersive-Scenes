/**
 * 场景选择页 · 文创坊（地图旁边那间 3D 铺子）端到端验证。
 *
 * 验的是**真实代码路径**，不是"我以为它接了"：
 *   · 点 DOM 上的换卷箭头（#nav-view）→ 切场是否真的发生
 *   · 在 canvas 上跑一次真实射线拾取（与 pointerup 同一条路径）→ 商店有没有进拾取列表
 *   · 调 flyShop() 走完整飞行 → 焦点有没有落在画面正中、距离对不对
 *
 * 用法：
 *   node tools/e2e_shop.mjs                # 默认用真 GPU 无头
 *   E2E_HW=0 node tools/e2e_shop.mjs       # 用 swiftshader 软渲染（纯机制验证时更稳）
 * 产物：tools/shots/*.png
 *
 * ⚠️ 项目既有约定是**真 GPU 无头**（见 .workbuddy/memory/MEMORY.md「无头 e2e 约定」）；
 *    软渲染只在"不依赖机器 GPU 状态"的纯机制验证里才用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, 'shots')
fs.mkdirSync(OUT_DIR, { recursive: true })

const EDGE = process.env.E2E_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.E2E_PORT || 9351)
const URL_ = process.env.E2E_URL || 'http://127.0.0.1:8080/'
const HW = process.env.E2E_HW !== '0'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const flags = [
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-mapshop-profile'),
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-sync', '--disable-background-networking',
  '--disable-features=msEdgeSyncPromo,msImplicitSignin,msEdgeCollectionsPromotion,EdgeIdentity',
  '--window-size=1440,900',
]
/* 真 GPU 无头是默认；只有显式 E2E_HW=0 才降级到软渲染 */
if (!HW) flags.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader')

const edge = spawn(EDGE, flags, { stdio: 'ignore' })

let ws
let nextId = 1
const pending = new Map()
const consoleErrors = []

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
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const f = path.join(OUT_DIR, name + '.png')
  fs.writeFileSync(f, Buffer.from(data, 'base64'))
  return f
}

/* ── 断言小工具 ── */
let pass = 0, fail = 0
const results = []
function check(name, ok, detail) {
  if (ok) { pass++; results.push(`  ✅ ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; results.push(`  ❌ ${name}${detail ? '  ' + detail : ''}`) }
  console.log(results[results.length - 1])
}

/** 轮询等待页面里的条件成立 */
async function waitFor(expr, timeout = 30000, label = expr) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(expr)) return true } catch { /* 页面还没就绪 */ }
    await sleep(250)
  }
  throw new Error('等待超时：' + label)
}

/**
 * 采样一次「切场」的全程逐帧数据，返回平滑性统计。
 *
 * 判据（与人工看录屏同源，可直接复用）：
 *   - `maxAim`   相机 forward 与「position→target」的夹角最大值。
 *                **与实现无关**：相机任何时刻都该盯着自己的 target。修复前会到十几度。
 *   - `maxScore` 孤立尖峰倍率 = 该帧屏幕位移 ÷ 左右 ±5 帧位移的中位数。
 *                不能用绝对阈值 —— 动画中段本来就走得最快（实测峰值 ~13px/帧），
 *                正常 1~2×，真跳变 700× 量级。
 *
 * ⚠️ 两个必须记住的点：
 *   1. **动画结束后不能停采**。这处 bug（相机朝向被冻住、结束时才被拽正）的跳变
 *      恰好落在动画结束那一帧；把 `k>=1`（或回程的 `k<=0`）滤掉，就正好把要抓的那帧滤没了。
 *   2. 起点要么是 0 要么是 1，所以"动画是否开始"要用「k 偏离起始值」判断，
 *      不能写成 `k > 1e-4`（回程时首帧 k=1，会把点击前的静止帧也算进来）。
 */
async function sampleSwitch(startAtShop) {
  const from = startAtShop ? 1 : 0
  await evaluate(startAtShop ? `__scene3d.showShop()` : `__scene3d.showMap()`)
  await sleep(500)
  await evaluate(`(() => {
    const S = window.__scene3d, T = S.THREE
    window.__samp = []
    ;(function loop () {
      const sh = S.shopState()
      /* 店身中段的世界坐标：group 的位移与缩放都要算上 */
      const p = new T.Vector3(S.SHOP.x, sh.pos[1] + 0.135 * sh.scale, S.SHOP.z)
      p.project(S.camera)
      const fwd = new T.Vector3(0, 0, -1).applyQuaternion(S.camera.quaternion)
      const want = S.controls.target.clone().sub(S.camera.position).normalize()
      window.__samp.push({
        k: S.viewK(),
        ndc: [p.x, p.y],
        sx: (p.x * 0.5 + 0.5) * innerWidth,
        sy: (-p.y * 0.5 + 0.5) * innerHeight,
        aim: Math.acos(Math.min(1, Math.max(-1, fwd.dot(want)))) * 180 / Math.PI,
      })
      if (window.__samp.length < 560) requestAnimationFrame(loop)
    })()
    return true
  })()`)
  await sleep(150)
  await evaluate(`document.getElementById('nav-view').click()`)
  await sleep(1800)
  const samp = JSON.parse(await evaluate('JSON.stringify(window.__samp)'))

  let maxAim = 0, maxStep = 0, moved = 0, animating = false
  const steps = [null]                     // steps[i] = 第 i 帧相对上一帧的屏幕位移
  for (let i = 1; i < samp.length; i++) {
    const a = samp[i - 1], b = samp[i]
    if (Math.abs(b.k - from) > 1e-4) animating = true
    if (!animating) { steps.push(null); continue }
    /* 动画两端（k 到 0 或 1）之后**继续**做位移统计 —— 跳变往往就落在那一帧 */
    if (b.k > 1e-4 && b.k < 1 - 1e-4) {
      moved++
      if (b.aim > maxAim) maxAim = b.aim
    }
    /* 只统计焦点在画面内的帧：屏幕外 2000+px 的点透视畸变极大，量不准 */
    const onScreen = Math.abs(a.ndc[0]) <= 1 && Math.abs(a.ndc[1]) <= 1 &&
                     Math.abs(b.ndc[0]) <= 1 && Math.abs(b.ndc[1]) <= 1
    const d = onScreen ? Math.hypot(b.sx - a.sx, b.sy - a.sy) : null
    if (d !== null && d > maxStep) maxStep = d
    steps.push(d)
  }

  let maxScore = 0, scoreAt = null
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] === null) continue
    const nb = []
    for (let j = Math.max(0, i - 5); j <= Math.min(steps.length - 1, i + 5); j++) {
      if (j !== i && steps[j] !== null) nb.push(steps[j])
    }
    if (nb.length < 4) continue
    nb.sort((p, q) => p - q)
    const base = Math.max(nb[Math.floor(nb.length / 2)], 0.5)   // 局部基准，兜 0
    const sc = steps[i] / base
    if (sc > maxScore) { maxScore = sc; scoreAt = { i, step: steps[i], base, k: samp[i].k } }
  }
  return { maxAim, maxStep, maxScore, scoreAt, moved }
}

async function main() {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* 还没起来 */ }
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
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ||
                         msg.params?.exceptionDetails?.text || '(未捕获异常)')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args || []).map(a => a.value ?? a.description).join(' '))
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL_ })

  console.log('\n── 启动与初始态 ──')
  await waitFor('!!window.__scene3d', 40000, '三维地图初始化完成')
  /* ★ __scene3d 是在 buildMap 之后同步挂上的，可载入层退场与箭头的放出
     还排在 260ms 后的定时器里、再叠 0.6s 淡出 —— 必须显式等这两件事，
     否则断言会打在「地图已建好但画面上还是载入层」的那一帧上
     （症状：箭头 .on 还没加上、首张截图是近纯色，几 KB）。 */
  await waitFor('!!document.querySelector("#nav-view.on")', 10000, '换卷箭头放出')
  await waitFor('document.getElementById("boot").classList.contains("gone")', 10000, '载入层退场')
  await sleep(1400)   // 再等两三帧真渲染，确保截图不是空帧

  const boot = await evaluate(`JSON.stringify({
    view: __scene3d.view(),
    viewK: __scene3d.viewK(),
    shop: __scene3d.shopState(),
    fallbackHidden: document.getElementById('fallback').hidden,
    pinCount: document.querySelectorAll('#labels .pin').length,
    /* 右上角那枚「文创共创体验」门帖已按需求删除 —— 这条断言是防它被误加回来 */
    hudRightGone: !document.getElementById('hud-right') && !document.getElementById('wenchuang-card')
                  && document.querySelectorAll('.wcard').length === 0,
    navOn: !!document.querySelector('#nav-view.on'),
    navDir: document.querySelector('#nav-view').dataset.dir,
    navTxt: document.getElementById('nav-txt').textContent.trim(),
    shopPinExists: !!document.getElementById('shop-pin') && !!document.getElementById('shop-pin-led'),
    navBox: (() => { const r = document.getElementById('nav-view').getBoundingClientRect();
                     return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
    h1: document.querySelector('#hud-top h1').innerText.trim(),
    viewport: [innerWidth, innerHeight],
  })`)
  const b = JSON.parse(boot)
  console.log('  初始态：', JSON.stringify(b))

  check('页面无 JS 异常', consoleErrors.length === 0, consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '')
  check('降级层未误触发（三维渲染正常）', b.fallbackHidden === true)
  check('地图已建成（两枚城市标记在位）', b.pinCount === 2, `pin=${b.pinCount}`)
  check('初始视图 = map / viewK = 0', b.view === 'map' && b.viewK === 0, `${b.view} / ${b.viewK}`)
  check('商店初始不可见（scale 收到极小）',
        b.shop.visible === false && b.shop.scale < 0.01,
        `visible=${b.shop.visible} scale=${b.shop.scale}`)
  check('换卷箭头已放出且有尺寸',
        b.navOn === true && b.navBox[2] > 20 && b.navBox[3] > 40, `box=${JSON.stringify(b.navBox)}`)
  check('箭头初始朝右、题字为「文创坊」', b.navDir === 'right' && b.navTxt === '文创坊',
        `${b.navDir} / ${b.navTxt}`)
  check('箭头挂在地图右侧（不与地图重叠）',
        b.navBox[0] > b.viewport[0] * 0.75, `x=${b.navBox[0]} of ${b.viewport[0]}`)
  check('标题是地图那一组', b.h1 === '古桥数字场景', b.h1)
  check('右上角的「文创共创体验」按钮已移除', b.hudRightGone === true,
        `hudRightGone=${b.hudRightGone}`)
  /* 按钮删了，但「地图 → 文创坊」这条路必须还在（箭头 + 商店题匾两处入口） */
  check('删除按钮后进文创坊的入口仍在（箭头 + 商店题匾）',
        b.navOn === true && b.shopPinExists === true,
        `nav=${b.navOn} shopPin=${b.shopPinExists}`)

  const f1 = await shot('10-选择页-地图视图')
  console.log('  截图 →', path.basename(f1), fs.statSync(f1).size + 'B')

  /* ── 点箭头：真实 DOM click ── */
  console.log('\n── 点换卷箭头（真实 DOM click）──')
  await evaluate(`document.getElementById('nav-view').click()`)
  await sleep(1800)

  const mid = JSON.parse(await evaluate(`JSON.stringify({
    view: __scene3d.view(),
    viewK: __scene3d.viewK(),
    shop: __scene3d.shopState(),
    navDir: document.querySelector('#nav-view').dataset.dir,
    navTxt: document.getElementById('nav-txt').textContent.trim(),
    h1: document.querySelector('#hud-top h1').innerText.trim(),
    shopPinLive: document.getElementById('shop-pin').classList.contains('live'),
    shopPinBox: (() => { const r = document.getElementById('shop-pin').getBoundingClientRect();
                         return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
    cityPinsLive: Array.from(document.querySelectorAll('#labels .pin')).filter(e => e.classList.contains('live')).length,
    pinAt: __scene3d.shopPinAt(),
    offset: __scene3d.shopOffset(),
  })`))
  console.log('  切场后：', JSON.stringify(mid))

  check('视图已切到 shop 且过渡走完', mid.view === 'shop' && mid.viewK === 1, `${mid.view} / ${mid.viewK}`)
  check('地图已收起（缩到极小 + 沉下去）',
        mid.shop.mapScale < 0.01 && mid.shop.mapY < -0.6,
        `mapScale=${mid.shop.mapScale.toFixed(5)} mapY=${mid.shop.mapY.toFixed(3)}`)
  check('商店已升起（可见且 scale ≈ 1）',
        mid.shop.visible === true && Math.abs(mid.shop.scale - 1) < 0.001,
        `scale=${mid.shop.scale.toFixed(4)}`)
  check('镜头已落到商店正脸机位（商店居中）',
        Math.abs(mid.offset.dx) < 40 && Math.abs(mid.offset.dy) < 40 && mid.offset.onScreen,
        `dx=${mid.offset.dx.toFixed(1)} dy=${mid.offset.dy.toFixed(1)}`)
  check('「文创共创体验」题匾已浮出',
        mid.shopPinLive === true && mid.shopPinBox[2] > 80,
        `live=${mid.shopPinLive} box=${JSON.stringify(mid.shopPinBox)}`)
  check('题匾落在商店上方（不挡住店面）',
        mid.pinAt.onScreen && mid.pinAt.dy < mid.offset.dy,
        `匾dy=${mid.pinAt.dy.toFixed(1)} 店dy=${mid.offset.dy.toFixed(1)}`)
  check('城市标记已随地图退场', mid.cityPinsLive === 0, `live=${mid.cityPinsLive}`)
  check('箭头反向为左、题字变「返回地图」', mid.navDir === 'left' && mid.navTxt === '返回地图',
        `${mid.navDir} / ${mid.navTxt}`)
  check('标题切到「文创坊」', mid.h1 === '文创坊', mid.h1)

  const f2 = await shot('11-选择页-商店视图')
  console.log('  截图 →', path.basename(f2), fs.statSync(f2).size + 'B')

  /* ── 切场平滑性：**两个方向都要验** ──
     回归的坑见 sampleSwitch() 的注释。
     ⚠️ 为什么不能只验一个方向：用户那段录屏里其实有**两**处孤立尖峰 ——
     f0063（进文创坊）与 f0149（回地图），说明进和回都要经过同一段代码。
     修是修在共用路径上，但断言只验一个方向就等于没验。 */
  console.log('\n── 切场平滑性（逐帧，判「不许跳」）──')
  for (const [label, startAtShop] of [['地图 → 文创坊', false], ['文创坊 → 地图', true]]) {
    const r = await sampleSwitch(startAtShop)
    console.log(`  【${label}】动画中 ${r.moved} 帧；朝向误差 max=${r.maxAim.toFixed(4)}°；`
                + `单帧最大位移=${r.maxStep.toFixed(2)}px；`
                + `孤立尖峰倍率 max=${r.maxScore.toFixed(2)}×`
                + `（基准 ${r.scoreAt ? r.scoreAt.base.toFixed(2) : '-'}px）`)
    check(`【${label}】采样覆盖了整段动画`, r.moved > 40, `动画帧=${r.moved}`)
    check(`【${label}】全程相机都盯着 target（朝向无突变）`, r.maxAim < 1.0,
          `max aim=${r.maxAim.toFixed(4)}°（修复前会到十几度）`)
    check(`【${label}】途中没有"孤立尖峰"式跳变`, r.maxScore < 6,
          `最尖的一帧是局部基准的 ${r.maxScore.toFixed(2)}×`
          + `（位移 ${r.scoreAt ? r.scoreAt.step.toFixed(1) : '-'}px`
          + ` @ viewK=${r.scoreAt ? r.scoreAt.k.toFixed(3) : '-'}）`)
  }
  /* 上面的循环以"回地图"收尾，而后面几段（拾取 / 推近）都要求处在商店视图 */
  await evaluate(`__scene3d.showShop()`)
  await sleep(600)


  /* ── 店面几何：屋顶底面必须是**轴对齐长方形**，不是斜菱形 ──
     回归的是这个坑：Mesh 的变换是 T·R·S，scale 先于 rotation 生效，
     所以「rotation.y = π/4 之后再 scale.x = 1.24」实际是做
     「先把菱形拉长、再整体转 45°」→ 得到一个斜菱形，四个角朝斜向戳出去。
     判据：长方形底面的任意一个角都**同时**满足 |x| = 半宽 且 |z| = 半深；
     斜菱形做不到（它有两组不同的半径，各自的角只满足其中之一）。 */
  console.log('\n── 店面几何（屋顶底面形状 / 匾额遮挡 / 灯笼材质）──')
  const geo = JSON.parse(await evaluate(`(() => {
    const R = __scene3d.shopRefs
    if (!R || !R.roof || !R.sign) return JSON.stringify({ err: 'shopRefs 未暴露' })
    const pos = R.roof.geometry.attributes.position
    let yMin = Infinity
    for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, pos.getY(i))
    const seen = []
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - yMin) > 1e-6) continue
      const k = pos.getX(i).toFixed(5) + '|' + pos.getZ(i).toFixed(5)
      if (!seen.includes(k)) seen.push(k)
    }
    const pts = seen.map(s => s.split('|').map(Number))
      /* 丢掉底面封盖的心点 (0, 0) —— 它不是"角" */
      .filter(([x, z]) => Math.abs(x) > 1e-5 || Math.abs(z) > 1e-5)
    const hx = Math.max(...pts.map(p => Math.abs(p[0])))
    const hz = Math.max(...pts.map(p => Math.abs(p[1])))
    const rect = pts.length === 4 && pts.every(([x, z]) =>
      Math.abs(Math.abs(x) - hx) < 1e-4 && Math.abs(Math.abs(z) - hz) < 1e-4)
    /* 前檐必须是一条平行于 x 轴的水平线：取 z = +hz 的两个角，x 应互为相反数 */
    const front = pts.filter(p => Math.abs(p[1] - hz) < 1e-4)
    const eaveParallelX = front.length === 2 &&
      Math.abs(front[0][0] + front[1][0]) < 1e-4
    const roofFrontZ = hz + R.roof.position.z
    return JSON.stringify({
      n: pts.length, hx: +hx.toFixed(4), hz: +hz.toFixed(4), ratio: +(hx / hz).toFixed(3),
      rect, eaveParallelX,
      signZ: +R.sign.position.z.toFixed(4), roofFrontZ: +roofFrontZ.toFixed(4),
      plaqueClear: R.sign.position.z > roofFrontZ,
      lampEmissive: R.lamps.map(l => +l.material.emissiveIntensity.toFixed(3)),
    })
  })()`))
  console.log('  屋顶底面四角：', JSON.stringify(geo))
  check('屋顶底面是轴对齐长方形（不是斜菱形）', geo.rect === true && geo.n === 4,
        `n=${geo.n} hx=${geo.hx} hz=${geo.hz} rect=${geo.rect}`)
  check('前檐是一条平行于 x 轴的水平线', geo.eaveParallelX === true,
        `front=${JSON.stringify(geo)}`)
  check('屋面面宽 > 进深（与 0.235×0.175 的屋身同比例）', geo.ratio > 1.15 && geo.ratio < 1.4,
        `hx/hz=${geo.ratio}（屋身 1.343）`)
  check('匾额在屋顶前缘之外（不被屋檐盖住）',
        geo.plaqueClear === true, `匾 z=${geo.signZ} vs 屋面 z=${geo.roofFrontZ}`)
  check('灯笼不是纯自发光（否则球面退化成平贴色片）',
        geo.lampEmissive.every(v => v > 0.1 && v < 0.5), JSON.stringify(geo.lampEmissive))

  /* 店内海报：门洞内腔后壁挂着文创页截图。⚠️ 纹理 404 时 TextureLoader 静默失败
     （poster 只剩纯色背板）—— 用「纹理 image 宽度 > 0」兜住这个隐蔽退化。 */
  const posterSt = JSON.parse(await evaluate(`JSON.stringify({
    has: !!(__scene3d.shopRefs && __scene3d.shopRefs.poster),
    loaded: !!(window.__scene3d.shopRefs && __scene3d.shopRefs.poster.material.map
               && __scene3d.shopRefs.poster.material.map.image
               && __scene3d.shopRefs.poster.material.map.image.width > 0),
  })`))
  check('店内海报挂上了，且纹理真的加载成功（404 会静默变黑背板）',
        posterSt.has === true && posterSt.loaded === true, JSON.stringify(posterSt))

  /* ── 拾取：在 canvas 上跑真实射线，看商店有没有进列表 ── */
  console.log('\n── 射线拾取（与 canvas pointerup 同一条路径）──')
  const pickHit = await evaluate(`(() => {
    const o = __scene3d.shopOffset();
    const cx = innerWidth / 2 + o.dx, cy = innerHeight / 2 + o.dy;
    return JSON.stringify({ at: [Math.round(cx), Math.round(cy)],
                            hit: __scene3d.pickAt(cx, cy),
                            empty: __scene3d.pickAt(12, innerHeight - 12) });
  })()`)
  const ph = JSON.parse(pickHit)
  console.log('  拾取：', pickHit)
  check('点在商店上能拾到 wenchuang', ph.hit === 'wenchuang', String(ph.hit))
  check('点在空白处拾不到东西', ph.empty === null, String(ph.empty))

  /* ── 推近飞行（dryRun，不跳转） ── */
  console.log('\n── 推近飞向商店（dryRun）──')
  await evaluate(`__scene3d.flyShop(true)`)
  await sleep(1700)
  const flown = JSON.parse(await evaluate(`JSON.stringify({
    offsetDoor: __scene3d.shopOffset(0.0665),
    dist: __scene3d.camDistTo(__scene3d.SHOP.x, 0.135, __scene3d.SHOP.z),
    flyDist: __scene3d.SHOP.flyDist,
    target: [__scene3d.controls.target.x, __scene3d.controls.target.y, __scene3d.controls.target.z],
  })`))
  console.log('  飞行终点：', JSON.stringify(flown))
  /* v3：进店飞行焦点是「门心」（低角度平视大门），不再是店身中段 ——
     大门（门洞）落在画面正中才是这条断言要的东西。 */
  check('推近后大门（门心）精确落在画面正中',
        Math.abs(flown.offsetDoor.dx) < 12 && Math.abs(flown.offsetDoor.dy) < 12,
        `dx=${flown.offsetDoor.dx.toFixed(2)} dy=${flown.offsetDoor.dy.toFixed(2)}`)
  check('相机到店身距离 ≈ flyDist',
        Math.abs(flown.dist - flown.flyDist) < 0.05,
        `dist=${flown.dist.toFixed(3)} flyDist=${flown.flyDist}`)
  check('飞行焦点 = 门心（低角度平视大门，不是地面也不是屋顶）',
        Math.abs(flown.target[1] - 0.0665) < 0.005, `y=${flown.target[1].toFixed(3)}`)

  const f3 = await shot('12-选择页-商店推近')
  console.log('  截图 →', path.basename(f3), fs.statSync(f3).size + 'B')

  /* ── 返回地图 ── */
  console.log('\n── 点箭头返回地图 ──')
  await evaluate(`document.getElementById('nav-view').click()`)
  await sleep(1800)
  const back = JSON.parse(await evaluate(`JSON.stringify({
    view: __scene3d.view(), viewK: __scene3d.viewK(), shop: __scene3d.shopState(),
    navTxt: document.getElementById('nav-txt').textContent.trim(),
    offset: __scene3d.offsetOf('suzhou'), mapBox: __scene3d.mapBox(),
    method: __scene3d.camera.position.toArray().map(n => +n.toFixed(3)),
  })`))
  console.log('  回到地图：', JSON.stringify(back))
  check('视图已回到 map / viewK = 0', back.view === 'map' && back.viewK === 0, `${back.view} / ${back.viewK}`)
  check('地图已复原（scale ≈ 1、不再下沉）',
        back.shop.mapScale > 0.99 && Math.abs(back.shop.mapY) < 0.001,
        `mapScale=${back.shop.mapScale.toFixed(4)} mapY=${back.shop.mapY.toFixed(4)}`)
  check('商店已缩回（不可见）', back.shop.visible === false, `visible=${back.shop.visible}`)
  check('箭头恢复朝右 / 题字「文创坊」', back.navTxt === '文创坊', back.navTxt)
  check('地图回到居中（与原有复位行为一致）',
        Math.abs(back.mapBox.dx) < 40 && Math.abs(back.mapBox.dy) < 40,
        `mapBox dx=${back.mapBox.dx.toFixed(1)} dy=${back.mapBox.dy.toFixed(1)}`)

  const f4 = await shot('13-选择页-返回地图')
  console.log('  截图 →', path.basename(f4), fs.statSync(f4).size + 'B')

  /* ── 两座桥的原有飞行未被破坏（回归） ── */
  console.log('\n── 回归：两座桥的飞行仍然正常 ──')
  for (const key of ['suzhou', 'gejin']) {
    await evaluate(`__scene3d.fly('${key}')`)
    await sleep(1400)
    const o = JSON.parse(await evaluate(`JSON.stringify(__scene3d.offsetOf('${key}'))`))
    check(`飞 ${key} 后光柱焦点落在画面正中`,
          Math.abs(o.dx) < 12 && Math.abs(o.dy) < 12, `dx=${o.dx.toFixed(2)} dy=${o.dy.toFixed(2)}`)
    await evaluate(`__scene3d.gotoMap ? null : null`)
  }
  await evaluate(`document.getElementById('btn-reset').click()`)
  await sleep(1200)

  check('全程无 JS 异常', consoleErrors.length === 0,
        consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '')

  /* ── 最后一件事：真跳转 ──
     放在最末，因为跳走就回不来了。走的是用户真正的动作：
     点箭头切到商店视图 → 点商店上方那块「文创共创体验」题匾
     → 门开与抵近同时 → 穿门推进 → 到门面即压暗跳转 5173。
     时序：门开 0→620（与 fly 并行）→ fly 900 → push 1200
           （veil ≈ push 700ms / 全局 ≈1.6s，跳转 ≈1.86s）。 */
  console.log('\n── 点题匾 → 门开+推进 → 到门面跳转（收尾，跳走不回头）──')
  await evaluate(`document.getElementById('nav-view').click()`)
  await sleep(1700)
  const live1 = await evaluate('document.getElementById("shop-pin").classList.contains("live")')
  check('题匾此时可点', live1 === true, String(live1))
  await evaluate(`document.getElementById('shop-pin').click()`)
  /* 门开进行到 2/3（≈420ms，easeOut 下已 100°+）时查一次门的角度，
     再继续等跳转 —— 给"门真的开了"装上牙。 */
  await sleep(420)
  const doorAng = await evaluate(`(() => {
    const ds = (window.__scene3d.shopRefs && window.__scene3d.shopRefs.doors) || []
    return ds.map(d => +(d.pivot.rotation.y * 180 / Math.PI).toFixed(1))
  })()`)
  const okOpen = Array.isArray(doorAng) && doorAng.length === 2
    && Math.abs(doorAng[0]) > 45 && Math.abs(doorAng[1]) > 45
    && doorAng[0] < 0 && doorAng[1] > 0          // 左门 −θ 向外、右门 +θ 向外
  check('进店时两扇门真的绕外侧铰链敞开（左 −θ / 右 +θ）', okOpen, JSON.stringify(doorAng))
  await sleep(4600)
  const where = String(await evaluate('location.href'))
  const title = String(await evaluate('document.title'))
  console.log('  跳转后：', where, '|', title)
  check('点题匾后真的进入了文创共创体验（5173）',
        /(localhost|127\.0\.0\.1):5173/.test(where), where)
  check('落地页确实是文创页（标题含「双桥记」）', title.includes('双桥记'), title)

  console.log(`\n汇总：${pass}/${pass + fail} 通过` + (fail ? `  ❌ ${fail} 项失败` : '  ✅ 全通过'))
  console.log('截图目录：', OUT_DIR)
  if (fail) process.exitCode = 1
}

main()
  .catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch { /* ignore */ } ; edge.kill() })
