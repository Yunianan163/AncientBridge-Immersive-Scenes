/**
 * 商品模型自检：直接读 modelPresets.ts 里的声明，逐个检查
 *   1. 文件是否存在
 *   2. 能否被 three 的 GLTFLoader 正常解析
 *   3. 每个零件是否带 UV 坐标（没有 UV 就没法贴图）
 *   4. 模型里的零件名能不能和 regions 命名表对上（对不上就会退化成「只贴所选表面」）
 *
 * 用法：npm run models:verify
 * 正式模型从 3ds Max 导出替换进来之后跑一遍，能立刻发现「UV 没展开」「名字和配置对不上」这两类问题，
 * 不用等贴上去才看到贴图扭曲或者贴错位置。
 *
 * 实现说明：这里跑的就是网页端同一份代码逻辑
 *   —— GLTFLoader 解析 + three/regions.ts 的名字匹配。
 *   所以自检通过，网页里就一定能认出来。
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// 「剥掉贴图再解析」的实现在 lib/glb.mjs（emit-regions.mjs 也用它，两边共用一份）。
// 为什么必须剥：自带内嵌贴图的 GLB 在 Node 里会让 GLTFLoader 抛
// `ReferenceError: self is not defined` —— 看着像模型损坏，其实是环境问题。详见那个文件。
import { geometryOnlyGlb } from './lib/glb.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PRESETS_FILE = path.join(ROOT, 'src', 'data', 'modelPresets.ts')
const REGIONS_FILE = path.join(ROOT, 'src', 'three', 'regions.ts')

// --------------------------------------------------------------- 读取配置

/**
 * 优先直接 import 那份 TS 配置（Node 22.18+ / 24 自带类型擦除，不需要编译）。
 * 拿不到就退回正则提取路径：少一项「部位名对照」，其余检查照常。
 */
async function loadPresets() {
  try {
    const [presetModule, regionModule] = await Promise.all([
      import(pathToFileURL(PRESETS_FILE).href),
      import(pathToFileURL(REGIONS_FILE).href),
    ])
    return { presets: presetModule.WENCHUANG_PRESETS, regionApi: regionModule, exact: true }
  } catch (error) {
    console.log(`提示：无法直接读取 TS 配置（${error.message}），退回按路径检查，跳过部位名对照。\n`)
    const source = fs.readFileSync(PRESETS_FILE, 'utf8')
    // 只检查真正进入下拉框的这批配置（WENCHUANG_PRESETS）；
    // LEGACY_PRESETS 引用的底座示例模型体积很大、默认不下载，检查它们只会产生无意义的报错。
    const start = source.indexOf('export const WENCHUANG_PRESETS')
    const end = source.indexOf('export const MODEL_PRESETS')
    const scoped = start >= 0 ? source.slice(start, end > start ? end : undefined) : source
    const paths = [...scoped.matchAll(/path:\s*'(models\/[^']+)'/g)].map((match) => match[1])
    return {
      presets: paths.map((relative) => ({ id: path.basename(relative, '.glb'), path: relative })),
      regionApi: null,
      exact: false,
    }
  }
}

const { presets, regionApi, exact } = await loadPresets()

if (presets.length === 0) {
  console.error('没在 modelPresets.ts 里找到任何商品配置')
  process.exit(1)
}

// --------------------------------------------------------------- 逐个检查

const loader = new GLTFLoader()
let pass = 0
const failures = []
const warnings = []

for (const preset of presets) {
  const relative = preset.path
  const absolute = path.join(ROOT, 'public', relative)
  const name = path.basename(relative)

  if (!fs.existsSync(absolute)) {
    failures.push(`${name}：文件不存在（${absolute}）`)
    console.log(`缺失  ${name}`)
    continue
  }

  if (relative.endsWith('.gltf')) {
    // .gltf + 外部 .bin 的格式这里不做深度解析，交给浏览器
    console.log(`跳过  ${name}（.gltf 分体格式）`)
    continue
  }

  const buffer = fs.readFileSync(absolute)
  // 自带贴图的模型要先剥掉贴图（Node 里 GLTFLoader 读内嵌图片会碰全局 `self`）——
  // 自检只看零件名 / UV / 部位匹配，剥不剥贴图对结论没有影响
  const parsed = geometryOnlyGlb(buffer)
  const parseTarget = parsed ?? buffer
  const arrayBuffer = parseTarget.buffer.slice(parseTarget.byteOffset, parseTarget.byteOffset + parseTarget.byteLength)

  const result = await new Promise((resolve) => {
    loader.parse(
      arrayBuffer,
      '',
      (gltf) => {
        const meshes = []
        gltf.scene.traverse((object) => {
          if (object.isMesh) meshes.push(object)
        })
        resolve({ ok: true, scene: gltf.scene, meshes, bytes: buffer.length })
      },
      (error) => resolve({ ok: false, message: error && error.message ? error.message : String(error) }),
    )
  })

  if (!result.ok) {
    failures.push(`${name}：解析失败 —— ${result.message}`)
    console.log(`损坏  ${name}  ${result.message}`)
    continue
  }

  const kb = (result.bytes / 1024).toFixed(1)
  const withUv = result.meshes.filter((mesh) => Boolean(mesh.geometry.attributes.uv)).length
  const noUv = result.meshes.filter((mesh) => !mesh.geometry.attributes.uv)

  if (withUv === 0) {
    failures.push(`${name}：没有任何 mesh 带 UV 坐标，贴图会失败`)
    console.log(`无UV  ${name}  mesh=${result.meshes.length}  ${kb} KB`)
    continue
  }

  const partsLabel = result.meshes.map((mesh) => mesh.name || '(未命名)').join(', ')
  console.log(`正常  ${name}  mesh=${result.meshes.length}  带UV=${withUv}/${result.meshes.length}  ${kb} KB`)
  console.log(`      零件：${partsLabel}`)

  if (noUv.length > 0) {
    warnings.push(`${name}：${noUv.map((mesh) => mesh.name || '(未命名)').join('、')} 没有 UV，贴图时会自动跳过`)
    console.log(`      注意：${noUv.length} 个零件没有 UV`)
  }

  // ---- 部位名对照
  if (regionApi && preset.regions) {
    const report = regionApi.inspectRegions(result.scene, preset.regions)

    for (const hit of report.matched) {
      const tag = regionApi.isPaintable(hit.region) ? '可贴' : '保留'
      const level = ['', '精确', '去后缀', '去分隔符', '分词'][hit.level] || `L${hit.level}`
      console.log(`      部位  ${hit.region.name}（${tag}） ← ${hit.key}  ${hit.meshes.length} 个零件  [${level}匹配]`)
    }
    if (report.missing.length > 0) {
      const detail = report.missing.map((region) => `${region.name}（预期 ${region.match.join(' / ')}）`).join('、')
      warnings.push(`${name}：命名表里有 ${report.missing.length} 个部位在模型里找不到 —— ${detail}`)
      console.log(`      缺部位：${detail}`)
    }
    if (report.unassignedParts.length > 0) {
      warnings.push(`${name}：${report.unassignedParts.join('、')} 没被任何部位收编（配置里漏了）`)
      console.log(`      未归类零件：${report.unassignedParts.join('、')}`)
    }
  } else if (!regionApi) {
    // 退回模式，没有部位信息可查
  } else {
    warnings.push(`${name}：配置里没有写 regions，点击只能贴到命中的那一个 mesh`)
    console.log('      未配置 regions：点击只能贴到命中的那一个零件')
  }

  pass += 1
}

// --------------------------------------------------------------- 目录里没被引用的模型

/**
 * 扫一遍 `public/models/products/`，列出**没被任何 preset 引用**的 GLB。
 *
 * ⚠️ 这**不是错误**，所以只进 warnings、不影响通过数、不改退出码。
 * 为什么还是要报：冰箱贴两个位置先后换成了笔筒，`magnet_a.glb` / `magnet_b.glb`
 * 于是成了「目录里有、下拉框里没有」的孤儿。不报出来，下次有人（或 AI）翻目录时
 * 会以为是漏配了两个商品 —— 前两轮就差点去删它们。
 * （那两份孤儿已于 2026-10-09 连同 `make-placeholder-models.mjs` 里的生成项一起删掉 ——
 *  它们本来就只是占位件，正式模型目录里从来没有过冰箱贴。本检测留着防下次再出同类残留。）
 */
const PRODUCTS_DIR = path.join(ROOT, 'public', 'models', 'products')
const referenced = new Set(presets.map((preset) => path.basename(preset.path)))
const orphans = fs.existsSync(PRODUCTS_DIR)
  ? fs.readdirSync(PRODUCTS_DIR)
    .filter((file) => file.toLowerCase().endsWith('.glb') && !referenced.has(file))
    .sort()
  : []

// --------------------------------------------------------------- 汇总

if (orphans.length > 0) {
  const note = `public/models/products/ 里还有 ${orphans.length} 个 GLB 没被任何商品引用：`
    + `${orphans.join('、')}（多半是撤下来的旧模型，不是错误）`
  warnings.push(note)
  console.log('')
  console.log(note)
  console.log('  留着就能随时加回 modelPresets.ts；真要清掉，记得连着 scripts/make-placeholder-models.mjs')
  console.log('  里对应的生成项一起删，否则下次 `npm run models:placeholder` 又会把它们生出来。')
}

console.log('')
console.log(`${pass}/${presets.length} 个模型通过自检`)
if (!exact) {
  console.log('（本次为降级模式：只检查了文件与 UV，未做部位名对照）')
}

if (warnings.length > 0) {
  console.log('')
  console.log('可以改进的地方：')
  warnings.forEach((message) => console.log(`  - ${message}`))
}

if (failures.length > 0) {
  console.log('')
  console.log('需要处理的问题：')
  failures.forEach((message) => console.log(`  - ${message}`))
  process.exitCode = 1
}
