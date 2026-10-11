/**
 * 端到端验证「按部位贴图」：上传一张图 → 挨个点部位名 → 每一步都
 *   ① 截图（给人看）  ② 读回**真实材质状态**（给断言看）。
 *
 * 为什么不用眼睛看：贴图有没有真的落到正确的零件上、**不该贴的部位有没有被误伤**，
 * 只有读回材质才知道。这里上传项目自带的 docs/测试贴图.png，走「点部位名」这条最稳的路径。
 *
 * 读材质靠 Scene.tsx 在开发模式下挂的 window.__scene
 * （生产构建里 import.meta.env.DEV 为 false，这段会被摇掉）。
 *
 * 用法：
 *   node scripts/e2e-paint.mjs [--model bag_a] [--prefix 31-bag贴图验证] [--zoom 3]
 *   省略 --model 时跑茶杯（默认）。**必须用 localhost 而不是 127.0.0.1。**
 *
 *   换一张上传图（出效果图用）：
 *   E2E_UPLOAD=docs/纹样示例.png node scripts/e2e-paint.mjs --model bag_a --prefix 32-bag成品
 *   ⚠️ 环境变量里的路径可以是相对的（脚本会 resolve 成绝对路径）——
 *      CDP 的 DOM.setFileInputFiles 不认相对路径，传相对路径会**静默不挂文件**，
 *      点部位时面板报「贴图加载失败」，症状极像「图片格式不对」。
 *
 * 产物：docs/联调截图/<前缀>-1*.png / -2*.png
 *
 * 想加一个商品：在下面 CASES 里加一条就行 —— parts / 可贴部位 / 保留部位 /
 * 期望的质感参数 / 每一步点谁、点完哪些零件该有贴图，全在数据里描述。
 * 每一步还可以给 `upload` 换一张图（验「两面各贴一张不同的图」用），
 * 再给 `differentTexturePairs` 声明哪两个部位该是两张不同的图。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// 产物落点。`E2E_OUT_DIR` 可以覆盖 —— `models:regress` 复跑全表时会把图丢进临时目录，
// 免得每次回归都往 `docs/联调截图/` 里堆一摞再手工删。
const OUT_DIR = process.env.E2E_OUT_DIR
  ? path.resolve(ROOT, process.env.E2E_OUT_DIR)
  : path.join(ROOT, 'docs', '联调截图')
// 默认打 dev server；`E2E_URL=http://localhost:4173/ npm run e2e:paint` 可以拿同一套断言
// 去验**生产构建**（4173 是 `npm run preview`，只绑 IPv6 回环，用 localhost 别用 127.0.0.1）。
const URL_ = process.env.E2E_URL || 'http://localhost:5173/'
// ⚠️ 必须是**绝对路径**：CDP 的 `DOM.setFileInputFiles` 不认相对路径，
// 传相对路径会静默不挂文件 → 点部位时 `surfacePainter` 拿不到图，面板报「贴图加载失败」。
const UPLOAD = path.resolve(ROOT, process.env.E2E_UPLOAD || path.join('docs', '测试贴图.png'))

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const MODEL = argOf('--model', 'mug_a')

// ------------------------------------------------------------------ 商品清单

const CASES = {
  mug_a: {
    label: '茶杯 · 经典款',
    parts: ['cup_body', 'cup_handle', 'cup_inner', 'cup_bottom'],
    partsNote: '四个零件都在（外壁 / 把手 / 内壁 / 杯底）',
    paintable: ['杯身外壁', '把手'],
    reserved: ['杯口与内壁', '杯底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 1,
      roughness: 0.34,
      note: '材质已升级成带清漆层的 MeshPhysicalMaterial（陶瓷釉面）',
    },
    steps: [
      {
        click: '杯身外壁',
        shot: '1杯身',
        paint: { cup_body: true, cup_handle: false, cup_inner: false, cup_bottom: false },
        highlight: '内壁 cup_inner 没被贴上（用户的核心要求）',
      },
      {
        click: '把手',
        shot: '2把手',
        paint: { cup_body: true, cup_handle: true, cup_inner: false, cup_bottom: false },
      },
    ],
    cleanPart: 'cup_body',
  },
  mug_b: {
    label: '茶杯 · 直筒款（塑料）',
    parts: ['cup_body', 'cup_inner', 'cup_bottom'],
    partsNote: '三个零件都在（杯身外壁 / 杯口与内壁 / 杯底）—— 直筒款没有把手',
    paintable: ['杯身外壁'],
    reserved: ['杯口与内壁', '杯底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 0.6,
      note: '材质是塑料档（clearcoat 0.6 的油亮面；陶瓷釉面是 clearcoat 1 的镜面）',
    },
    steps: [
      {
        click: '杯身外壁',
        shot: '1杯身外壁',
        paint: { cup_body: true, cup_inner: false, cup_bottom: false },
        highlight: '杯口唇边（cup_inner）与杯底（cup_bottom）没被贴上 —— 用户的红框只框了杯身那一圈',
      },
    ],
    cleanPart: 'cup_body',
  },
  holder_b: {
    label: '笔筒 · 方（方形截面）',
    parts: ['holder_side', 'holder_inner', 'holder_bottom'],
    partsNote: '三个零件都在（侧面外壁 / 筒口与内壁 / 筒底）',
    paintable: ['筒身外壁'],
    reserved: ['筒口与内壁', '筒底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 1,
      roughness: 0.34,
      note: '材质是陶瓷釉面档（MeshPhysicalMaterial + clearcoat 清漆层）',
    },
    steps: [
      {
        click: '筒身外壁',
        shot: '1筒身外壁',
        upload: 'docs/纹样示例.png',
        paint: { holder_side: true, holder_inner: false, holder_bottom: false },
        highlight: '方形截面同样只有侧面外壁被贴上，筒口内壁与筒底保持干净',
      },
    ],
    cleanPart: 'holder_side',
  },
  holder_a: {
    label: '笔筒 · 圆',
    parts: ['holder_side', 'holder_inner', 'holder_bottom'],
    partsNote: '三个零件都在（侧面外壁 / 筒口与内壁 / 筒底）',
    paintable: ['筒身外壁'],
    reserved: ['筒口与内壁', '筒底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 1,
      roughness: 0.34,
      note: '材质是陶瓷釉面档（MeshPhysicalMaterial + clearcoat 清漆层）',
    },
    steps: [
      {
        click: '筒身外壁',
        shot: '1筒身外壁',
        upload: 'docs/纹样示例.png',
        paint: { holder_side: true, holder_inner: false, holder_bottom: false },
        highlight: '筒口内壁与筒底都没被贴上（用户的核心要求：整只笔筒只贴侧面外壁）',
      },
    ],
    cleanPart: 'holder_side',
  },
  vase_a: {
    label: '花瓶 · 圆肚',
    parts: ['vase_side', 'vase_inner', 'vase_bottom'],
    partsNote: '三个零件都在（瓶身外壁 / 瓶口与内壁 / 瓶底）',
    paintable: ['瓶身外壁'],
    reserved: ['瓶口与内壁', '瓶底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 1,
      roughness: 0.34,
      note: '材质是陶瓷釉面档（MeshPhysicalMaterial + clearcoat 清漆层）',
    },
    steps: [
      {
        click: '瓶身外壁',
        shot: '1瓶身外壁',
        upload: 'docs/纹样示例.png',
        paint: { vase_side: true, vase_inner: false, vase_bottom: false },
        highlight: '整只花瓶只贴瓶身外壁，瓶口内壁与瓶底保持干净（用户的核心要求）',
      },
    ],
    cleanPart: 'vase_side',
  },
  vase_b: {
    label: '花瓶 · 细颈',
    parts: ['vase_side', 'vase_inner', 'vase_bottom'],
    partsNote: '三个零件都在（瓶身外壁 / 瓶口与内壁 / 瓶底）',
    paintable: ['瓶身外壁'],
    reserved: ['瓶口与内壁', '瓶底'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 1,
      roughness: 0.34,
      note: '材质是陶瓷釉面档（MeshPhysicalMaterial + clearcoat 清漆层）',
    },
    steps: [
      {
        click: '瓶身外壁',
        shot: '1瓶身外壁',
        upload: 'docs/纹样示例.png',
        paint: { vase_side: true, vase_inner: false, vase_bottom: false },
        highlight: '细颈花瓶同样只贴瓶身外壁 —— 瓶颈和瓶身是同一个可贴区，内壁与瓶底保持干净',
      },
    ],
    cleanPart: 'vase_side',
  },
  bag_a: {
    label: '帆布包 · 一片式',
    parts: ['bag_front', 'bag_back', 'bag_body'],
    partsNote: '三个零件都在（正面 / 背面 / 侧边与提手）',
    paintable: ['包的正面', '包的背面'],
    reserved: ['侧边与提手'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 0,
      roughness: 0.95,
      sheen: 1,
      note: '材质是帆布档（MeshPhysicalMaterial + sheen 绒面反射）',
    },
    steps: [
      {
        click: '包的正面',
        shot: '1正面',
        upload: 'docs/纹样示例.png',
        paint: { bag_front: true, bag_back: false, bag_body: false },
        highlight: '背面 bag_back 与侧边/提手 bag_body 都没被贴上（点哪儿只贴哪儿）',
      },
      {
        click: '包的背面',
        shot: '2换图后',
        upload: 'docs/纹样示例-朱砂.png',
        paint: { bag_front: true, bag_back: true, bag_body: false },
        highlight: '正面那张图还在，没被新图顶掉',
      },
    ],
    // 正反两面贴的是两张不同的图 —— 靠比贴图实例的 uuid 来验
    differentTexturePairs: [['bag_front', 'bag_back']],
    cleanPart: 'bag_front',
  },
  bag_b: {
    label: '帆布包 · 托特',
    parts: ['bag_front', 'bag_back', 'bag_body'],
    partsNote: '三个零件都在（正面矩形区 / 背面矩形区 / 侧边与提手）',
    paintable: ['包的正面', '包的背面'],
    reserved: ['侧边与提手'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 0,
      roughness: 0.95,
      sheen: 1,
      note: '材质是帆布档（与 bag_a 同一档：MeshPhysicalMaterial + sheen 绒面 + 织纹法线贴图）',
    },
    steps: [
      {
        click: '包的正面',
        shot: '1正面',
        upload: 'docs/纹样示例.png',
        paint: { bag_front: true, bag_back: false, bag_body: false },
        highlight: '背面 bag_back 与侧边/提手 bag_body 都没被贴上（点哪儿只贴哪儿）',
      },
      {
        click: '包的背面',
        shot: '2换图后',
        upload: 'docs/纹样示例-朱砂.png',
        paint: { bag_front: true, bag_back: true, bag_body: false },
        highlight: '正面那张图还在，没被新图顶掉',
      },
    ],
    // 正反两面贴的是两张不同的图 —— 靠比贴图实例的 uuid 来验
    differentTexturePairs: [['bag_front', 'bag_back']],
    cleanPart: 'bag_front',
  },
  fan_a: {
    // 这一档的重点不是「内壁有没有被贴上」，而是**正反两面能不能各贴一张不同的图**
    // —— 用户点名要的「扇面正反面分别贴图」。折扇的扇面是**前后两层薄片**，
    // 拆成了两个独立零件，所以这件事必须在 `differentTexturePairs` 里验。
    // 扇骨走 keepOriginalParts（木色是 `--material fan_ribs=wood` 烤进 GLB 的），
    // 网页端一个字段都不该碰。
    label: '扇子 · 折扇（扇面双层，正反面分别贴图）',
    parts: ['fan_face_front', 'fan_face_back', 'fan_ribs'],
    partsNote: '三个零件都在（扇面·正面 / 扇面·背面 / 扇骨与扇柄）',
    paintable: ['扇面·正面', '扇面·背面'],
    reserved: ['扇骨与扇柄'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 0,
      sheen: 0,
      note: '两片扇面都是纸质档（哑光 + 纸纤维法线图；既没有清漆层也没有绒光）',
    },
    materialParts: ['fan_face_front', 'fan_face_back'],
    // 扇骨不挂 envMap —— 保留原材质的部位**不调 applyEnvironment**，
    // 所以这一条只能点两片扇面（挂了反而说明网页端动了扇骨的材质）
    envParts: ['fan_face_front', 'fan_face_back'],
    original: {
      fan_ribs: {
        type: 'MeshStandardMaterial',
        note: '扇骨与扇柄保留烤进 GLB 的木色材质（没被升级成 MeshPhysicalMaterial、没被贴图）',
      },
    },
    steps: [
      {
        click: '扇面·正面',
        shot: '1扇面正面',
        upload: 'docs/纹样示例-朱砂.png',
        paint: { fan_face_front: true, fan_face_back: false, fan_ribs: false },
        highlight: '背面与扇骨都没被贴上',
      },
      {
        click: '扇面·背面',
        shot: '2扇面背面',
        upload: 'docs/测试贴图.png',
        // ⚠️ 这里的 `paint` 是**相对初始状态**比的（不是相对上一步）——
        // 正面第 1 步已经贴过、此时仍然是「已贴」，所以写 true 才对。
        paint: { fan_face_front: true, fan_face_back: true, fan_ribs: false },
        highlight: '正面那张图还在、没被新图顶掉；扇骨依旧没被贴上',
      },
    ],
    differentTexturePairs: [['fan_face_front', 'fan_face_back']],
    cleanPart: 'fan_face_front',
  },
  fan_b: {
    // 这一档是**第 4 类模型**：自带烘焙贴图的扫描件（整块 50000 面、自带一张 4096² 贴图集）。
    // 所以断言的重点和别的商品不一样 —— 不是「内壁有没有被贴上」，而是
    // 「扇框竹柄的**原有材质**有没有被网页端碰过」。
    label: '扇子 · 团扇（自带烘焙贴图的扫描件）',
    parts: ['fan_face', 'fan_body'],
    partsNote: '两个零件都在（白绢扇面 / 木质扇框与竹柄）',
    paintable: ['扇面（白绢）'],
    reserved: ['扇框与竹柄'],
    // 模型自带的木纹贴图一开始就在扇框上，不是「被贴上去的」
    texturedAtStart: ['fan_body'],
    material: {
      type: 'MeshPhysicalMaterial',
      clearcoat: 0,
      sheen: 1,
      note: '扇面是绢丝档（MeshPhysicalMaterial + sheen 丝光 + 细密织纹法线图）',
    },
    // 质感与 envMap 只该落在扇面上：扇框走 keepOriginalParts，网页端一个字段都不碰
    materialParts: ['fan_face'],
    envParts: ['fan_face'],
    original: {
      fan_body: {
        type: 'MeshStandardMaterial',
        keepTextures: ['tex', 'normalMap'],
        note: '扇框与竹柄保留模型自带材质（木纹贴图 + 法线图，没被升级成 MeshPhysicalMaterial）',
      },
    },
    steps: [
      {
        click: '扇面（白绢）',
        shot: '1扇面',
        upload: 'docs/纹样示例-朱砂.png',
        paint: { fan_face: true, fan_body: false },
        highlight: '木质扇框与竹柄没被贴上（也没被改材质）',
      },
    ],
    cleanPart: 'fan_face',
  },
}

// `--list`：把商品清单以 JSON 打给调用方后直接退出（`models:regress` 靠它拉清单，
// 省得在 runner 里再抄一份商品名 —— 两边一旦漂移，回归就会「漏跑」还看不出来）。
// 放在这里提前退出，不会去开浏览器。
if (argv.includes('--list')) {
  console.log(JSON.stringify(Object.entries(CASES).map(([id, c]) => ({ id, label: c.label }))))
  process.exit(0)
}

const CASE = CASES[MODEL]
if (!CASE) {
  console.error(`不认识的 --model ${MODEL}，可选：${Object.keys(CASES).join(' / ')}`)
  process.exit(1)
}

const PREFIX = argOf('--prefix', MODEL === 'mug_a' ? '15-贴图验证' : `${MODEL}-贴图验证`)
const PORT = 9335
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT_DIR, { recursive: true })

if (!fs.existsSync(UPLOAD)) {
  console.error('找不到要上传的图片：', UPLOAD)
  process.exit(1)
}

const edge = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-e2e-paint'),
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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(OUT_DIR, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('  截图 →', path.basename(file))
}

// ------------------------------------------------------------------ 断言

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `   ${detail}` : ''}`)
}

/** 切换模型下拉框（React 受控 select 要用原生 setter + 手动派发 change） */
const selectModel = async (id) => evaluate(`(() => {
  const sel = document.querySelector('.model-dropdown')
  if (!sel) return '没找到模型下拉框'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, ${JSON.stringify(id)})
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return '已切到 ' + ${JSON.stringify(id)}
})()`)

/** 点一个「部位名」按钮。用 el.click()，React 的委托事件能接住 */
const clickChip = async (label) => evaluate(`(() => {
  const btn = [...document.querySelectorAll('.studio-region-chip')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
  if (!btn) return '没找到按钮：' + ${JSON.stringify(label)} + '  现有：' + [...document.querySelectorAll('.studio-region-chip')].map(b => b.textContent.trim()).join('|')
  btn.click()
  return 'clicked ' + ${JSON.stringify(label)}
})()`)

const regionHead = async () => JSON.parse(await evaluate(`(() => {
  const head = document.querySelector('.studio-region-head')
  const chips = [...document.querySelectorAll('.studio-region-chip')].map(b => b.textContent.trim() + (b.classList.contains('is-locked') ? '(保留)' : ''))
  const warn = document.querySelector('.studio-region-warn')?.textContent.trim() ?? ''
  const notice = document.querySelector('.studio-notice, .studio-toast, .studio-status')?.textContent.trim() ?? ''
  return JSON.stringify({ head: head?.innerText ?? null, chips, warn, notice })
})()`))

/** 往上传控件里塞一张图。⚠️ `DOM.setFileInputFiles` **只认绝对路径**，传相对路径会静默不挂文件 */
const uploadFile = async (file) => {
  const doc = await send('DOM.getDocument', { depth: -1 })
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.studio-drop input[type=file]' })
  if (!input.nodeId) throw new Error('没找到文件输入框')
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] })
  console.log('已上传', path.basename(file))
  await sleep(5000)
}

/** 读回每个零件的真实材质：有没有贴图、颜色干不干净、质感参数是多少 */
const materialSnapshot = () => evaluate(`(() => {
  const scene = window.__scene
  if (!scene) return JSON.stringify({ error: '取不到 window.__scene' })
  const root = scene.getObjectByName('product-root') || scene
  const out = {}
  root.traverse((n) => {
    if (!n.isMesh) return
    const m = Array.isArray(n.material) ? n.material[0] : n.material
    if (!m) return
    out[n.name] = {
      tex: Boolean(m.map),
      // 贴图实例的 uuid：验证「两个部位贴的是不是同一张图」靠它（每贴一次都会新建一张纹理）
      mapUuid: m.map ? (m.map.uuid ?? '') : null,
      // 模型自带的法线图（团扇扇框的木纹凹凸靠它）。保留原材质的部位不该被清掉
      normalMap: Boolean(m.normalMap),
      color: '#' + m.color.getHexString(),
      emissive: '#' + (m.emissive ? m.emissive.getHexString() : '000000'),
      type: m.type,
      metalness: m.metalness ?? null,
      roughness: Number(m.roughness?.toFixed(3)),
      clearcoat: m.clearcoat ?? null,
      sheen: m.sheen ?? null,
      envMapIntensity: m.envMapIntensity ?? null,
      hasEnvMap: Boolean(m.envMap),
    }
  })
  return JSON.stringify(out)
})()`)

/** 把调试用的浮层藏掉，拍一张干净的商品图 */
const hidePanels = (hidden) => evaluate(`(() => {
  let style = document.getElementById('e2e-hide-panels')
  if (!style) { style = document.createElement('style'); style.id = 'e2e-hide-panels'; document.head.appendChild(style) }
  style.textContent = ${JSON.stringify(hidden)}
    ? '.model-selector,.color-controls,.studio-dock,.toolbar,.studio-panel{visibility:hidden!important}' : ''
  return true
})()`)

/**
 * 把调试用的浮层藏掉，拍一张干净的商品图。
 *
 * `zoom > 1` 时拍**放大图**：⚠️ 必须用 `Emulation.setDeviceMetricsOverride` 提高
 * **设备像素比**，不要用 `Page.captureScreenshot` 的 `clip.scale` ——
 * 无头 + swiftshader 下 clip.scale 会截错区域（实测 8×/4× 都只输出 256×208 的同一块）。
 * dpr 只影响渲染分辨率，CSS 像素不变，所以 clip 的坐标照旧。
 */
const cleanShot = async (name, zoom = 1) => {
  await hidePanels(true)
  if (zoom > 1) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 830,
      deviceScaleFactor: zoom,
      mobile: false,
    })
  }
  await sleep(700)
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 250, y: 80, width: 820, height: 760, scale: 1 },
  })
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('  干净截图 →', `${name}.png${zoom > 1 ? `（${zoom}× 放大，用来核对贴图边界落在哪）` : ''}`)
  if (zoom > 1) await send('Emulation.clearDeviceMetricsOverride')
  await hidePanels(false)
}

/**
 * 把商品根节点绕 Y 轴转过去，用来拍背面。
 *
 * 为什么不拖动 OrbitControls：拖多少像素对应转多少角度要看画布高度和阻尼，
 * 只能靠试（实测猜 180° 只转出约 60°）。直接改 `product-root` 的 rotation.y 是**确定的**，
 * 而且 R3F 只在相机那边做自动旋转，不会每帧把这个值覆盖回去。
 * 转完记得用 `restoreProduct()` 还原，别让后面的截图跟着歪。
 */
const turnProduct = async (degrees) => {
  const r = await evaluate(`(() => {
    const root = window.__scene?.getObjectByName('product-root')
    if (!root) return '没找到 product-root'
    if (root.userData.__e2eRotation === undefined) root.userData.__e2eRotation = root.rotation.y
    root.rotation.y += (${degrees} * Math.PI) / 180
    return '已把商品转过 ' + ${degrees} + '°'
  })()`)
  console.log(' ', r)
  await sleep(1200)
}
const restoreProduct = async () => {
  await evaluate(`(() => {
    const root = window.__scene?.getObjectByName('product-root')
    if (!root || root.userData.__e2eRotation === undefined) return false
    root.rotation.y = root.userData.__e2eRotation
    delete root.userData.__e2eRotation
    return true
  })()`)
  await sleep(800)
}

// ------------------------------------------------------------------ 主流程

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
  await send('DOM.enable')
  await send('Page.navigate', { url: URL_ })
  await sleep(14000)

  // 关掉自动旋转，否则截图之间画面在动
  const rotated = await evaluate(`(() => {
    const t = document.querySelector('[aria-label*="auto rotate" i], [aria-label*="自动" i]')
    if (t) { t.click(); return t.getAttribute('aria-label') }
    return null
  })()`)
  console.log('自动旋转开关：', rotated ?? '(没找到，跳过)')

  // 材质断言靠 `window.__scene` 读回真实材质，而它是 **DEV 门控**的 ——
  // 生产构建（`E2E_URL=http://localhost:4173/`）里读不到，那几项必然失败。
  // 先讲清楚，免得看到「3/11 通过」去翻代码找 bug。
  if (!(await evaluate('Boolean(window.__scene)'))) {
    console.log('\n' + '!'.repeat(74))
    console.log('⚠️  这个页面上没有 window.__scene（生产构建不暴露它）')
    console.log('    → 凡是「读回材质」的断言一定失败，**不代表功能坏了**。')
    console.log(`    当前地址：${URL_}`)
    console.log('    想跑**完整**11 项断言请用 dev server（默认 http://localhost:5173/）；')
    console.log('    只想冒烟验生产构建的话，看下面「可贴部位 / 保留部位」那两项 + 截图即可。')
    console.log('!'.repeat(74) + '\n')
  }

  if (MODEL !== 'mug_a') {
    console.log('切换模型：', await selectModel(MODEL))
    await sleep(7000)
  }

  console.log(`\n===== ${CASE.label}（${CASE.parts.length} 个零件）=====`)

  // 有些商品（团扇）是**自带烘焙贴图的扫描件**：扇框竹柄一开始就带着木纹贴图。
  // 这类零件要用 `texturedAtStart` 点名，否则「初始没有任何零件带贴图」会被它误判成失败。
  const texturedAtStart = new Set(CASE.texturedAtStart ?? [])
  const mtlTargets = CASE.materialParts ?? CASE.parts
  const envTargets = CASE.envParts ?? CASE.parts

  console.log('\n【0】初始状态')
  const before = JSON.parse(await materialSnapshot())
  console.log('  ', JSON.stringify(await regionHead()).slice(0, 200))
  check(CASE.partsNote, CASE.parts.every((k) => before[k]), Object.keys(before).join(', '))
  check(texturedAtStart.size
    ? '初始只有自带烘焙贴图的零件带图，打印区是干净的'
    : '初始没有任何零件带贴图',
  Object.entries(before).every(([name, p]) => p.tex === texturedAtStart.has(name)),
  Object.entries(before).map(([k, p]) => `${k}=${p.tex}`).join(' '))
  const first = before[mtlTargets[0]] ?? {}
  const wantMaterial = CASE.material
  check(wantMaterial.note,
    mtlTargets.every((k) => before[k]?.type === wantMaterial.type
      && (wantMaterial.clearcoat === undefined || before[k].clearcoat === wantMaterial.clearcoat)
      && (wantMaterial.sheen === undefined || before[k].sheen === wantMaterial.sheen)),
    `${first.type} clearcoat=${first.clearcoat} roughness=${first.roughness} sheen=${first.sheen}`)
  check('环境贴图已挂到材质上（离线影棚烘出来的）',
    envTargets.every((k) => before[k]?.hasEnvMap),
    envTargets.map((k) => `${k}=${before[k]?.hasEnvMap}`).join(' '))

  // 「保留原材质」的部位（团扇的木质扇框与竹柄）：材质类型、贴图、法线图一个都不许被碰
  for (const [name, spec] of Object.entries(CASE.original ?? {})) {
    const p = before[name] ?? {}
    const texturesOk = (spec.keepTextures ?? []).every((key) =>
      spec.dropTextures?.includes(key) ? !p[key] : Boolean(p[key]))
    check(spec.note ?? `${name} 保留模型自带材质`,
      p.type === spec.type && texturesOk,
      `${p.type} map=${p.tex} normalMap=${p.normalMap} metalness=${p.metalness} roughness=${p.roughness}`)
  }

  // 上传图片（每一步还可以用 step.upload 换一张，见下面的循环）
  await uploadFile(UPLOAD)

  let after = null
  for (const [index, step] of CASE.steps.entries()) {
    console.log(`\n【${index + 1}】贴「${step.click}」`)
    // 换一张图再点 —— 「正反两面各贴一张不同的贴图」就是靠这一步验的
    if (step.upload) await uploadFile(path.resolve(ROOT, step.upload))
    console.log('  ', await clickChip(step.click))
    await sleep(3500)
    await shot(`${PREFIX}-${step.shot}`)
    after = JSON.parse(await materialSnapshot())
    const panel = await regionHead()
    console.log('  ', JSON.stringify(after))

    // 面板上的可贴/保留标记
    if (index === 0) {
      const shown = panel.chips.filter((c) => !c.endsWith('(保留)'))
      check(`可贴部位只有 ${CASE.paintable.join('、')}`,
        shown.join('、') === CASE.paintable.join('、'), panel.chips.join('、'))
      check('其余部位在面板上标成了保留部位',
        CASE.reserved.every((r) => panel.chips.includes(`${r}(保留)`)), panel.chips.join('、'))
    }

    // 该贴的贴上了、不该贴的没被误伤。
    // 判据用「贴图实例的 uuid 有没有换」而不是「有没有贴图」—— 团扇的扇框一开始就带着
    // 模型自带的木纹贴图，只看 `tex` 会把它一直算成「被贴上了」。
    for (const [part, want] of Object.entries(step.paint)) {
      const wasMap = before[part]?.mapUuid ?? null
      const nowMap = after[part]?.mapUuid ?? null
      check(`${part} ${want ? '贴上了' : '没被贴上'}${want === false && step.highlight ? `（${step.highlight}）` : ''}`,
        (wasMap !== nowMap) === want,
        `before=${String(wasMap).slice(0, 8) || 'null'} after=${String(nowMap).slice(0, 8) || 'null'}`)
    }

    // 颜色与自发光没被 UI 高亮污染
    if (index === 0) {
      check(`${CASE.cleanPart} 颜色仍是干净的 #ffffff（没被高亮污染）`,
        after[CASE.cleanPart]?.color === '#ffffff', after[CASE.cleanPart]?.color)
    }
    check('没有零件带着橙色自发光（选中高亮没漏进材质）',
      Object.values(after).every((p) => p.emissive === '#000000'),
      Object.values(after).map((p) => p.emissive).join(' '))
  }

  // 贴完图之后，「保留原材质」的部位必须还是原样：
  // 贴图实例没被换（没被贴上新图）、法线图还在、材质也没被升级成 MeshPhysicalMaterial。
  for (const [name, spec] of Object.entries(CASE.original ?? {})) {
    const p = after?.[name] ?? {}
    check(`贴完图后 ${name} 仍是模型自带材质（没被贴图 / 没被升级 / 法线图还在）`,
      p.type === spec.type
      && Boolean(p.normalMap) === Boolean(before[name]?.normalMap)
      && (p.mapUuid ?? null) === (before[name]?.mapUuid ?? null),
      `${p.type} map=${p.tex} normalMap=${p.normalMap} 贴图实例未变=${(p.mapUuid ?? null) === (before[name]?.mapUuid ?? null)}`)
  }

  // 「两个部位各贴一张不同的图」—— 比贴图实例的 uuid（每贴一次都会新建一张纹理）
  for (const [a, b] of CASE.differentTexturePairs ?? []) {
    check(`${a} 与 ${b} 各贴了一张不同的图（两面能分别定制）`,
      Boolean(after?.[a]?.tex && after?.[b]?.tex && after[a].mapUuid !== after[b].mapUuid),
      `${a}=${String(after?.[a]?.mapUuid).slice(0, 8)}  ${b}=${String(after?.[b]?.mapUuid).slice(0, 8)}`)
  }

  // 拍一张没有浮层遮挡的成品图（给人看质感）
  await cleanShot(`${PREFIX}-成品`)
  // 需要放大看贴图边界时加 --zoom 3
  const zoom = Number(argOf('--zoom', '0')) || 0
  if (zoom > 1) await cleanShot(`${PREFIX}-放大`, zoom)
  // 需要看另一面时加 --spin 180（转过去拍一张，再转回来）
  const spinDeg = Number(argOf('--spin', '0')) || 0
  if (spinDeg) {
    await turnProduct(spinDeg)
    await cleanShot(`${PREFIX}-反面`, Math.max(zoom, 1))
    await restoreProduct()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
  if (failed.length > 0) {
    console.log('未通过：')
    failed.forEach((r) => console.log('  ✗', r.name))
    process.exitCode = 1
  }
}

main().catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
