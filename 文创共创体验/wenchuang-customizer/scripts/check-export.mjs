/**
 * 导出体检：点「下载 GLB」，把下载到的文件拆开，核对材质。
 *
 * 为什么必须单独验一次：导出走的是 GLTFExporter，它会把材质**原样烘进文件**。
 * 历史上踩过两次坑：
 *   ① 悬停加亮（color ×1.2）和选中高亮（emissive 橙）被烘进 GLB 的
 *      baseColorFactor / emissiveFactor；
 *   ② 材质从 MeshStandardMaterial 升级成 MeshPhysicalMaterial（为了釉面的 clearcoat），
 *      导出路径变了，必须重新确认 clearcoat 有没有正确落到 KHR_materials_clearcoat 扩展上。
 *   ⑤ 反向保证：**「保留原材质」的零件必须和源文件逐字段一致**（团扇的木质扇框与竹柄）——
 *      它不该被套 finish、也不该被调色板改色。断言方式是把导出结果和
 *      `public/models/products/<id>.glb` 里的那一条材质对着比。
 *
 * 帆布包还要多验两条（它同时用两张**不同的**贴图 + 程序生成的织纹法线贴图）：
 *   ③ 两个部位各贴一张不同的图时，导出的 GLB 里要**内嵌两张不同的 image** ——
 *      光看「都有 baseColorTexture」不够，两个材质可能指向同一张图；
 *   ④ 织纹走的是 `normalMap`，导出要落到 glTF **核心**的 `normalTexture`
 *      （以前用 `bumpMap` 只能写成非标准的 `EXT_materials_bump`，别退回去）。
 *
 * 用法：
 *   node scripts/check-export.mjs [--model bag_a]
 *   省略 --model 时跑茶杯（默认，会贴一张图）。**必须用 localhost 而不是 127.0.0.1。**
 *
 * 产物：终端输出 + 下载到的 GLB 留在临时目录里（`%TEMP%/wb-export-check`）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const UPLOAD = path.resolve(ROOT, process.env.E2E_UPLOAD || path.join('docs', '测试贴图.png'))
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'wb-export-check')

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
    steps: [{ click: '杯身外壁' }],
    /** 只有这些零件该带 baseColorTexture */
    textured: ['cup_body'],
    /** 釉面档：clearcoatFactor 应该是 1，且 extensionsUsed 里要有 KHR_materials_clearcoat */
    clearcoat: 1,
    expectNormalTexture: false,
  },
  mug_b: {
    label: '茶杯 · 直筒款（塑料）',
    steps: [{ click: '杯身外壁' }],
    /** 只有杯身外壁该带 baseColorTexture —— 杯口唇边与杯底必须是干净的 */
    textured: ['cup_body'],
    /** 塑料档：clearcoatFactor 应该是 0.6（不是陶瓷的 1，也不是帆布的 0） */
    clearcoat: 0.6,
    expectNormalTexture: false,
  },
  holder_b: {
    label: '笔筒 · 方',
    steps: [{ upload: 'docs/纹样示例.png', click: '筒身外壁' }],
    /** 只有筒身外壁该带 baseColorTexture —— 内壁与筒底必须是干净的 */
    textured: ['holder_side'],
    /** 陶瓷釉面档：clearcoatFactor 应该是 1 */
    clearcoat: 1,
    expectNormalTexture: false,
  },
  holder_a: {
    label: '笔筒 · 圆',
    steps: [{ upload: 'docs/纹样示例.png', click: '筒身外壁' }],
    /** 只有筒身外壁该带 baseColorTexture —— 内壁与筒底必须是干净的 */
    textured: ['holder_side'],
    /** 陶瓷釉面档：clearcoatFactor 应该是 1 */
    clearcoat: 1,
    expectNormalTexture: false,
  },
  vase_a: {
    label: '花瓶 · 圆肚',
    steps: [{ upload: 'docs/纹样示例.png', click: '瓶身外壁' }],
    /** 只有瓶身外壁该带 baseColorTexture —— 瓶口内壁与瓶底必须是干净的 */
    textured: ['vase_side'],
    /** 陶瓷釉面档：clearcoatFactor 应该是 1 */
    clearcoat: 1,
    expectNormalTexture: false,
  },
  vase_b: {
    label: '花瓶 · 细颈',
    steps: [{ upload: 'docs/纹样示例.png', click: '瓶身外壁' }],
    /** 只有瓶身外壁该带 baseColorTexture —— 瓶口内壁与瓶底必须是干净的 */
    textured: ['vase_side'],
    /** 陶瓷釉面档：clearcoatFactor 应该是 1 */
    clearcoat: 1,
    expectNormalTexture: false,
  },
  bag_a: {
    label: '帆布包 · 一片式',
    // 正反两面各贴一张**不同的**图 —— 导出后要能看到两张内嵌 image
    steps: [
      { upload: 'docs/纹样示例.png', click: '包的正面' },
      { upload: 'docs/纹样示例-朱砂.png', click: '包的背面' },
    ],
    textured: ['bag_front', 'bag_back'],
    /** 帆布档：没有清漆层 */
    clearcoat: 0,
    /** 帆布用程序生成的织纹法线贴图，应该导出成 glTF 核心的 normalTexture */
    expectNormalTexture: true,
  },
  bag_b: {
    label: '帆布包 · 托特',
    // 正反两块矩形打印区各贴一张**不同的**图 —— 和 bag_a 一样要看到两张内嵌 image
    steps: [
      { upload: 'docs/纹样示例.png', click: '包的正面' },
      { upload: 'docs/纹样示例-朱砂.png', click: '包的背面' },
    ],
    textured: ['bag_front', 'bag_back'],
    clearcoat: 0,
    expectNormalTexture: true,
  },
  fan_b: {
    // 这一档验的是相反方向的保证：**扇框与竹柄必须和源文件里一模一样**。
    // 所以 `keepOriginal` 里的零件会被排除在「底色必须纯白 / 只有贴图区能带贴图」这些
    // 断言之外，改为直接和 public/models/products/fan_b.glb 里的材质逐字段比对。
    label: '扇子 · 团扇（自带烘焙贴图的扫描件）',
    steps: [{ upload: 'docs/纹样示例-朱砂.png', click: '扇面（白绢）' }],
    textured: ['fan_face'],
    /** 绢丝档：绢面本身没有清漆层 */
    clearcoat: 0,
    /** 这些零件保留模型自带材质，不参与「纯白底色」类断言 */
    keepOriginal: ['fan_body'],
    /** 原样保留的零件上必须还在的字段 */
    keepFields: ['baseColorTexture', 'normalTexture'],
    /** 绢面是绢丝档：绒面反射（sheen）要落到 KHR_materials_sheen 上，别丢了 */
    expectSheen: true,
  },
}

// `--list`：把商品清单以 JSON 打给调用方后直接退出（`models:regress` 靠它拉清单）。
// 放在这里提前退出，不会去开浏览器、也不会清下载目录。
if (argv.includes('--list')) {
  console.log(JSON.stringify(Object.entries(CASES).map(([id, c]) => ({ id, label: c.label }))))
  process.exit(0)
}

const CASE = CASES[MODEL]
if (!CASE) {
  console.error(`不认识的 --model ${MODEL}，可选：${Object.keys(CASES).join(' / ')}`)
  process.exit(1)
}

const PORT = 9337
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true })
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

const edge = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'wb-e2e-export'),
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

/** 读 GLB 里的 JSON 定义 */
function readMaterials(file) {
  const buf = fs.readFileSync(file)
  let offset = 12
  let json = null
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(offset + 8, offset + 8 + length).toString('utf8'))
    offset += 8 + length
  }
  return json
}

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

/** 往上传控件里塞一张图。⚠️ `DOM.setFileInputFiles` **只认绝对路径**，传相对路径会静默不挂文件 */
const uploadFile = async (file) => {
  const doc = await send('DOM.getDocument', { depth: -1 })
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.studio-drop input[type=file]' })
  if (!input.nodeId) throw new Error('没找到文件输入框')
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] })
  console.log('已上传', path.basename(file))
  await sleep(5000)
}

const clickChip = async (label) => evaluate(`(() => {
  const btn = [...document.querySelectorAll('.studio-region-chip')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
  if (!btn) return '没找到按钮：' + ${JSON.stringify(label)} + '  现有：' + [...document.querySelectorAll('.studio-region-chip')].map(b => b.textContent.trim()).join('|')
  btn.click()
  return 'clicked ' + ${JSON.stringify(label)}
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
  await send('DOM.enable')
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true,
  })
  await send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(14000)

  await evaluate(`(() => {
    const t = document.querySelector('[aria-label*="auto rotate" i], [aria-label*="自动" i]')
    if (t) t.click()
  })()`)

  if (MODEL !== 'mug_a') {
    console.log('切换模型：', await selectModel(MODEL))
    await sleep(7000)
  }
  console.log(`\n===== ${CASE.label} =====`)

  // 贴图（每一步都可以换一张图），让导出的 GLB 里带上贴图 + 走过材质克隆那条路径
  for (const step of CASE.steps) {
    await uploadFile(step.upload ? path.resolve(ROOT, step.upload) : UPLOAD)
    console.log('  ', await clickChip(step.click))
    await sleep(3500)
  }

  console.log('\n点「下载 GLB」…')
  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下载 GLB')
    if (!btn) return '没找到按钮'
    btn.click()
    return 'ok'
  })()`)
  console.log('  ', clicked)
  await sleep(8000)

  const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.endsWith('.glb'))
  check('下载到了 GLB 文件', files.length > 0, files.join(', '))
  if (files.length === 0) {
    console.log('目录内容：', fs.readdirSync(DOWNLOAD_DIR))
    return
  }

  const file = path.join(DOWNLOAD_DIR, files[0])
  const gltf = readMaterials(file)
  console.log(`\n  文件 ${files[0]}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`)
  console.log('  extensionsUsed:', JSON.stringify(gltf.extensionsUsed ?? []))
  console.log(`  images: ${gltf.images?.length ?? 0} 张   textures: ${gltf.textures?.length ?? 0} 个`)
  gltf.materials.forEach((m) => {
    console.log(`  · ${m.name}`)
    console.log(`      baseColorFactor ${JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor)}`)
    console.log(`      metallic ${m.pbrMetallicRoughness?.metallicFactor}  roughness ${m.pbrMetallicRoughness?.roughnessFactor}`)
    console.log(`      emissiveFactor ${JSON.stringify(m.emissiveFactor ?? [0, 0, 0])}`)
    console.log(`      baseColorTexture ${m.pbrMetallicRoughness?.baseColorTexture ? '有' : '无'}`
      + `  normalTexture ${m.normalTexture ? '有' : '无'}`
      + `  clearcoat ${JSON.stringify(m.extensions?.KHR_materials_clearcoat ?? null)}`)
  })

  const all = gltf.materials
  // 「保留原材质」的零件（团扇的木质扇框与竹柄）不参与「底色必须是纯白」这类断言 ——
  // 它本来就带着模型自带的 0.8 底色和木纹贴图。它走的是一条**相反**的断言：下面单独验。
  const keepOriginal = new Set(CASE.keepOriginal ?? [])
  const victims = all.filter((m) => !keepOriginal.has(m.name))

  // glTF 里 baseColorFactor 的默认值就是 [1,1,1,1]，导出器对纯白**会省略这个字段**。
  // 所以「干净」= undefined 或 [1,1,1,1]；只要出现别的数字就说明被污染了。
  const isCleanWhite = (m) => {
    const v = m.pbrMetallicRoughness?.baseColorFactor
    return v === undefined || v.every((n) => n === 1)
  }
  /** 材质 → 它引用的图片下标（没有贴图就 null） */
  const imageIndexOf = (m) => {
    const ti = m.pbrMetallicRoughness?.baseColorTexture?.index
    if (ti === undefined) return null
    return gltf.textures?.[ti]?.source ?? null
  }

  check('被网页端改色 / 贴图的材质，底色都是干净的纯白（没被 hover ×1.2 污染）',
    victims.every(isCleanWhite),
    victims.map((m) => m.name + '=' + JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor)).join(' '))
  check('没有任何材质带 emissiveFactor（没被选中高亮的橙色污染）',
    all.every((m) => !m.emissiveFactor || m.emissiveFactor.every((v) => v === 0)))

  // ★ 「保留原材质」的零件：导出结果必须和 public/models/products/<id>.glb 里的
  //   那一条材质**逐字段一致** —— 这才叫「原样保留」，光看「字段还在」说明不了问题。
  if (keepOriginal.size > 0) {
    const source = readMaterials(path.join(ROOT, 'public', 'models', 'products', `${MODEL}.glb`))
    for (const name of keepOriginal) {
      const mine = all.find((m) => m.name === name)
      const theirs = source?.materials?.find((m) => m.name === name)
      const fields = (m) => ({
        // baseColorFactor 是线性值，导出器直接写内部值；保留 4 位小数足够（原样时应当完全相等）
        baseColor: (m?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]).map((v) => Number(v.toFixed(4))),
        // glTF 里 metallicFactor / roughnessFactor 的默认值都是 **1**，
        // 导出器对「等于默认值」的字段会**省略不写** —— 比较前先把默认值补回来，
        // 否则源文件的 `roughnessFactor: null` 会被误判成「和导出的 1 不一样」。
        metallic: m?.pbrMetallicRoughness?.metallicFactor ?? 1,
        roughness: m?.pbrMetallicRoughness?.roughnessFactor ?? 1,
        baseColorTexture: Boolean(m?.pbrMetallicRoughness?.baseColorTexture),
        normalTexture: Boolean(m?.normalTexture),
      })
      const a = fields(mine)
      const b = fields(theirs)
      check(`${name} 原样保留：导出结果与源文件里的材质逐字段一致`,
        Boolean(mine) && Boolean(theirs) && JSON.stringify(a) === JSON.stringify(b),
        `导出 ${JSON.stringify(a)}  源文件 ${JSON.stringify(b)}`)
      check(`${name} 的贴图一起带出来了（baseColorTexture / normalTexture 都在）`,
        (CASE.keepFields ?? []).every((key) => (key === 'normalTexture' ? Boolean(mine?.normalTexture) : Boolean(mine?.pbrMetallicRoughness?.[key]))),
        CASE.keepFields?.join('、') ?? '')
    }
  }

  const withTexture = all
    .filter((m) => !keepOriginal.has(m.name) && m.pbrMetallicRoughness?.baseColorTexture)
    .map((m) => m.name).sort()
  check(`只有被贴图的部位带 baseColorTexture（${CASE.textured.join(' / ')}）`,
    withTexture.join(',') === [...CASE.textured].sort().join(','),
    withTexture.join(',') || '(都没有)')

  // ★ 两面贴的是两张不同的图时，导出里必须是**两张不同的内嵌 image**
  if (CASE.textured.length > 1) {
    const idx = CASE.textured.map((name) => imageIndexOf(all.find((m) => m.name === name)))
    check(`${CASE.textured.join(' 与 ')} 的贴图是两张不同的内嵌图片（不是同一张被复用）`,
      idx.every((v) => v !== null) && new Set(idx).size === idx.length,
      `图片下标 ${JSON.stringify(idx)}，文件里共 ${gltf.images?.length ?? 0} 张 image`)
  }

  if (CASE.expectNormalTexture) {
    // ⚠️ 用 `victims` 而不是 `all`：保留原材质的零件（团扇的扇框竹柄就是这种）**本来就没贴图**，
    // 拿 `all` 一起要求「每一条材质都得有 normalTexture」会误报。
    // 「保留部位和其它零件比材质」这件事上面那段逐字段比对已经管了。
    check('程序生成的表面纹理（织纹 / 纸纤维）走的是 glTF 核心的 normalTexture（不是非标准的 EXT_materials_bump）',
      victims.every((m) => Boolean(m.normalTexture))
        && !(gltf.extensionsUsed ?? []).some((e) => e.includes('bump')),
      all.map((m) => m.name + '=' + (m.normalTexture ? '有' : '无')).join(' '))
  }

  if (CASE.clearcoat > 0) {
    // ⚠️ 浮点不能拿 `===` 精确比：glTF 里 clearcoatFactor 是 float32，
    //    0.6 从 JSON 里读回来是 0.6000000238418579 —— 精确比会假失败。
    //    （陶瓷的 1、金属的 0 在 float32 里是精确的，所以以前没暴露这个问题。）
    check(`清漆层带上了 KHR_materials_clearcoat 扩展（clearcoatFactor ≈ ${CASE.clearcoat}）`,
      (gltf.extensionsUsed ?? []).includes('KHR_materials_clearcoat')
        && all.every((m) => {
          const v = m.extensions?.KHR_materials_clearcoat?.clearcoatFactor
          return typeof v === 'number' && Math.abs(v - CASE.clearcoat) < 1e-5
        }),
      JSON.stringify(all[0]?.extensions?.KHR_materials_clearcoat ?? null))
  } else {
    check('帆布档没有清漆层（clearcoat 不该被写成 1）',
      all.every((m) => {
        const v = m.extensions?.KHR_materials_clearcoat?.clearcoatFactor
        return v === undefined || v === 0
      }),
      JSON.stringify(all[0]?.extensions?.KHR_materials_clearcoat ?? null))
  }

  if (CASE.expectSheen) {
    // 绢丝 / 帆布那层「绒面反射」只有 MeshPhysicalMaterial.sheen 能表达，
    // 导出要落到 glTF 的 KHR_materials_sheen 扩展上，否则换个软件打开就变普通布了。
    const sheen = all.find((m) => m.name === CASE.textured[0])?.extensions?.KHR_materials_sheen
    check('绢丝档的绒面反射带上了 KHR_materials_sheen 扩展',
      (gltf.extensionsUsed ?? []).includes('KHR_materials_sheen')
        && Boolean(sheen) && Number(sheen.sheenColorFactor?.[0]) > 0,
      JSON.stringify(sheen ?? null))
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
  if (failed.length) {
    failed.forEach((r) => console.log('  ✗', r.name))
    process.exitCode = 1
  }
}

main().catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
  .finally(() => { try { ws?.close() } catch {} ; edge.kill() })
