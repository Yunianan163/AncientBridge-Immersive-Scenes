/**
 * 按模型里真实的零件名，生成 regions 配置骨架。
 *
 * 什么时候用：
 *   在 3ds Max 里拆好零件、命名、导出 GLB 覆盖进来之后跑一次。
 *   它会读每个模型的实际零件名，对照现有命名表：
 *     - 本商品已配过的零件 → 沿用你写好的中文名和「是否可贴」
 *     - 别的商品配过同名零件 → 也沿用，但会在注释里标出来源，让你复核
 *     - 全新零件           → 标成 TODO，你只需要填中文名
 *   把输出粘回 src/data/modelPresets.ts 就完事了，不用改任何逻辑代码。
 *
 * 用法：npm run models:regions
 *
 * 设计原则：只读不写。
 *   这个脚本不碰源码文件，避免自动改写把 modelPresets.ts 弄坏；
 *   粘贴这一步由人来确认，也就顺便成了一次人工复核。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// 共用 `verify-models` 那份「剥掉贴图再解析」——自带内嵌贴图的模型（团扇）直接喂给
// GLTFLoader 会在 Node 里抛 `ReferenceError: self is not defined`，
// 报出来是「解析失败」，看着像模型坏了。详见 lib/glb.mjs。
import { geometryOnlyGlb } from './lib/glb.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PRESETS_FILE = path.join(ROOT, 'src', 'data', 'modelPresets.ts')
const REGIONS_FILE = path.join(ROOT, 'src', 'three', 'regions.ts')

const { WENCHUANG_PRESETS } = await import(pathToFileURL(PRESETS_FILE).href)
const { normalizeName } = await import(pathToFileURL(REGIONS_FILE).href)

const loader = new GLTFLoader()

// --------------------------------------------------------------- 排版工具

/** 显示宽度：CJK 与全角符号算 2 格，其余算 1 格 —— 纯 padEnd 会让中文列歪掉 */
function widthOf(text) {
  let width = 0
  for (const character of String(text)) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(
      character,
    )
      ? 2
      : 1
  }
  return width
}

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - widthOf(text)))

/**
 * 对齐一个字符串字面量。
 * 关键：补空格必须加在引号**外面** —— 加在里面会变成字符串内容，
 * 用户粘贴后中文显示名就会多一个尾随空格。
 */
const padLiteral = (value, width) => pad(`'${value}'`, width)

const materialsOf = (mesh) =>
  Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []

/** 看起来像软件自动生成的占位名：Object_3 / mesh12 / Poly001 / Group */
const AUTO_NAME = /^(object|mesh|node|poly|group|part|shape|editable|geom)[_\-]?\d*$/i

/**
 * 从 mesh 上挑一个最可能是「人工命名」的名字。
 * 优先对象名，其次材质名；两边都像自动生成时，退回对象名。
 */
function pickName(mesh) {
  const candidates = [mesh.name, ...materialsOf(mesh).map((material) => material.name)].filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
  return (
    candidates.find((value) => /[a-z]/i.test(value) && !AUTO_NAME.test(value.trim())) ??
    candidates[0] ??
    '(未命名)'
  )
}

// --------------------------------------------------------------- 现有命名表

/**
 * 两份索引：
 *   ownByPreset —— 每个商品自己的命名表（**必须优先用这份**）
 *   global      —— 所有商品合起来的并集，仅在本商品没配过时才借用
 *
 * 为什么要分两份：`body` 在茶杯里是「杯身外壁（可贴）」，在花瓶里是「瓶身」，
 * 在帆布包里却是「侧边与提手（保留）」。不区分商品就会把语义串到别的商品上。
 */
const ownByPreset = new Map()
const globalKnown = new Map()

for (const preset of WENCHUANG_PRESETS) {
  const own = new Map()
  for (const region of preset.regions ?? []) {
    for (const entry of region.match) {
      const key = normalizeName(entry)
      if (!key) continue
      const value = {
        id: region.id,
        name: region.name,
        // 连同别名一起沿用：配置里写的 ['cup_body', 'body'] 要原样保留，
        // 否则用户粘回去就把「带前缀 / 不带前缀都认」的兼容性弄丢了。
        match: region.match,
        paintable: region.paintable !== false,
        optional: region.optional === true,
        from: preset.name,
      }
      if (!own.has(key)) own.set(key, value)
      if (!globalKnown.has(key)) globalKnown.set(key, value)
    }
  }
  ownByPreset.set(preset.id, own)
}

/** 常量名：mug_a → MUG_A_REGIONS */
const constNameOf = (id) => `${String(id).replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_REGIONS`

/**
 * 剥掉块注释与整行 `//` 注释。
 *
 * ⚠️ 必须先剥：注释里常常留着示例代码（比如把 `MAGNET_REGIONS` 整段注释掉、将来想恢复），
 * `const XXX_REGIONS: RegionConfig[] = [` 这半句照样能被下面的正则匹配上，
 * 但注释里的数组是每行前面带 ` * ` 的，**没有真正闭合的 `\n]`** ——
 * 于是正则会一路吞到**后面那个真常量**的结尾，把它的 `match` 也算进这个幽灵常量，
 * 结果「交集最大」选错，报出「替换现有的 MAGNET_REGIONS 定义」这种张冠李戴的建议。
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 从 modelPresets.ts 源码里抓出所有 `const XXX: RegionConfig[] = [...]` 的定义。
 *
 * 为什么要正则回读源码：import 拿到的是数组**值**，拿不到常量名。
 * 而现有代码里同类商品是共用一个常量的（两个茶杯都用 CUP_REGIONS），
 * 如果脚本按每个商品各造一个常量名，用户粘完还得回手改 `regions:` 的引用。
 * 抓出真名后就能让输出直接对上号，粘贴即生效。
 */
function parseRegionConstants(source) {
  const out = []
  const blockPattern = /const\s+(\w+)\s*:\s*RegionConfig\[\]\s*=\s*\[([\s\S]*?)\n\]/g
  let block
  while ((block = blockPattern.exec(stripComments(source)))) {
    const matches = new Set()
    for (const entry of block[2].matchAll(/match:\s*\[([^\]]*)\]/g)) {
      for (const literal of entry[1].matchAll(/'([^']*)'/g)) matches.add(normalizeName(literal[1]))
    }
    out.push({ name: block[1], matches })
  }
  return out
}

const PRESETS_SOURCE = fs.readFileSync(PRESETS_FILE, 'utf8')
const sourceConstants = parseRegionConstants(PRESETS_SOURCE)

/**
 * 「商品 id → 它的 `regions:` 引用的常量名」。
 *
 * 为什么需要：两个帆布包的零件名一模一样，只按「交集最大」挑，只会挑到**文件里靠前**的
 * 那个（`BAG_A_REGIONS`），而 `bag_b` 实际引用的是 `BAG_REGIONS` ——
 * 建议里报错常量名，用户照着替换就会让两个包一个换成新骨架、另一个还是旧的。
 * 所以认出真引用之后，给它一个压倒性的加权。
 */
function parsePresetRegionRefs(source) {
  const out = new Map()
  const pattern = /id:\s*'([^']+)'[\s\S]*?regions:\s*(\w+)/g
  let match
  while ((match = pattern.exec(stripComments(source)))) out.set(match[1], match[2])
  return out
}

const regionRefByPreset = parsePresetRegionRefs(PRESETS_SOURCE)

/**
 * 找出这个商品的零件名最贴近哪个现有常量（交集最大）。
 * 用「交集最大」而不是「完全相等」，是为了让改了零件的模型也能对回原来那一行，
 * 而不是凭空多出一个新常量。
 *
 * 若这个商品在源码里本来就 `regions: XXX`，那个常量直接算满分 ——
 * 沿用它粘贴后连 `regions:` 的引用都不用改，是最省事的结果。
 */
function bestConstantFor(parts, preferredName) {
  const partsSet = new Set(parts.map((part) => normalizeName(part)))
  let best = null
  for (const entry of sourceConstants) {
    let overlap = 0
    for (const part of partsSet) if (entry.matches.has(part)) overlap += 1
    const score = overlap + (preferredName && entry.name === preferredName ? 1000 : 0)
    if (score > 0 && (best === null || score > best.score)) best = { ...entry, overlap, score }
  }
  return best
}

/** 部位 id：去掉商品前缀再归一化，模型里的 mug_a_body 会得到 body */
function idOf(partName, presetId) {
  const normalized = normalizeName(partName)
  const prefix = `${normalizeName(presetId)}_`
  const stripped = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
  return stripped || 'part'
}

function parseGlb(absolute) {
  const buffer = fs.readFileSync(absolute)
  // 自带内嵌贴图的模型先剥掉贴图（这里只要零件名，跟贴图无关）。剥不了就原样试一次
  const target = geometryOnlyGlb(buffer) ?? buffer
  const arrayBuffer = target.buffer.slice(target.byteOffset, target.byteOffset + target.byteLength)
  return new Promise((resolve) => {
    loader.parse(
      arrayBuffer,
      '',
      (gltf) => {
        const meshes = []
        gltf.scene.traverse((object) => {
          if (object.isMesh) meshes.push(object)
        })
        resolve({ ok: true, meshes })
      },
      (error) => resolve({ ok: false, message: error?.message ?? String(error) }),
    )
  })
}

// --------------------------------------------------------------- 主流程

console.log('')
console.log('═'.repeat(78))
console.log('  regions 配置骨架 —— 按模型里的真实零件名生成')
console.log('═'.repeat(78))

let totalParts = 0
let reused = 0
const todoList = []
const borrowList = []
/** 已经输出过的常量名 → 首个使用它的商品名，用来合并同类商品 */
const emitted = new Set()
const emittedBy = new Map()

for (const preset of WENCHUANG_PRESETS) {
  const absolute = path.join(ROOT, 'public', preset.path)
  const fileName = path.basename(preset.path)

  if (!fs.existsSync(absolute)) {
    console.log(`\n【${preset.name}】${fileName} —— 文件不存在，跳过`)
    continue
  }

  const result = await parseGlb(absolute)
  if (!result.ok) {
    console.log(`\n【${preset.name}】${fileName} —— 解析失败：${result.message}`)
    continue
  }

  // 去重：多个 mesh 可能本来就属于同一个部位（拆分时拆成了好几段）
  const parts = []
  for (const mesh of result.meshes) {
    const name = pickName(mesh)
    if (!parts.some((part) => normalizeName(part) === normalizeName(name))) parts.push(name)
  }

  totalParts += parts.length

  // 沿用现有常量名，避免用户粘完还要回手改 `regions:` 的引用
  const target = bestConstantFor(parts, regionRefByPreset.get(preset.id))
  const constName = target?.name ?? constNameOf(preset.id)

  const own = ownByPreset.get(preset.id) ?? new Map()
  const rows = parts.map((part) => {
    const key = normalizeName(part)
    const mine = own.get(key)
    const borrowed = mine ? null : globalKnown.get(key)
    const lookup = mine ?? borrowed

    if (lookup) reused += 1
    else todoList.push(`${preset.name}（${preset.id}）：${part}`)
    if (borrowed) borrowList.push(`${preset.name} 的 ${part} 沿用了「${borrowed.from}」的设置`)

    return {
      // 能对上现有配置时，沿用它的 id（粘贴回去才不会把 id 改掉）；
      // 只有全新零件才按「去商品前缀」推一个。
      id: lookup?.id ?? idOf(part, preset.id),
      name: lookup?.name ?? 'TODO 中文名',
      // 沿用现有别名；全新零件就用模型里的真实名字当唯一别名。
      match: lookup?.match ?? [part],
      paintable: String(lookup ? lookup.paintable : true),
      optional: lookup?.optional ?? false,
      mark: lookup
        ? borrowed
          ? `   // 沿用「${borrowed.from}」的设置，请复核`
          : ''
        : '   // ← 新零件，填一下中文名',
    }
  })

  console.log('')
  console.log('─'.repeat(78))
  console.log(`【${preset.name}】${fileName} —— ${result.meshes.length} 个 mesh / ${parts.length} 个零件名`)
  console.log(`  实际零件名：${parts.join(', ')}`)

  // 同类商品共用一个常量：第二个商品起只核对零件名，不重复输出代码
  if (emitted.has(constName)) {
    console.log(`  零件与前面的【${emittedBy.get(constName)}】一致，共用 ${constName} —— 核对无误即可跳过。`)
    continue
  }
  if (target) {
    emitted.add(constName)
    emittedBy.set(constName, preset.name)
  }

  console.log('')
  if (target) {
    console.log(`  建议粘贴到 src/data/modelPresets.ts（替换现有的 ${constName} 定义）：`)
  } else {
    console.log(`  模型里出现了现有命名表完全没有的零件，建议新增一个常量，`)
    console.log(`  并把本商品配置里的 regions 指向它：`)
  }
  console.log('')

  const wId = Math.max(...rows.map((row) => widthOf(`'${row.id}'`)))
  const wName = Math.max(...rows.map((row) => widthOf(`'${row.name}'`)))
  const bodies = rows.map((row) => {
    const aliases = `[${row.match.map((value) => `'${value}'`).join(', ')}]`
    return (
      `  { id: ${padLiteral(row.id, wId)}, name: ${padLiteral(row.name, wName)}, ` +
      `match: ${aliases}, paintable: ${row.paintable}${row.optional ? ', optional: true' : ''} },`
    )
  })
  const wBody = Math.max(...bodies.map((body) => widthOf(body)))

  console.log(`const ${constName}: RegionConfig[] = [`)
  bodies.forEach((body, index) => {
    const mark = rows[index].mark
    // 只有带注释的行才补空格对齐 —— 否则会在行尾留下不可见的空白
    console.log(mark ? pad(body, wBody) + mark : body)
  })
  console.log(']')
}

console.log('')
console.log('═'.repeat(78))
console.log('  汇总')
console.log('═'.repeat(78))
console.log(`  ${WENCHUANG_PRESETS.length} 个商品，共 ${totalParts} 个零件名`)
console.log(`  ${reused} 个可直接沿用现有命名表的设置，${todoList.length} 个需要你补中文名`)

if (borrowList.length > 0) {
  console.log('')
  console.log('  跨商品借用了设置（同名不同物的风险点，务必复核）：')
  for (const item of borrowList) console.log(`    - ${item}`)
}

if (todoList.length > 0) {
  console.log('')
  console.log('  需要补中文名的零件：')
  for (const item of todoList) console.log(`    - ${item}`)
  console.log('')
  console.log('  改完之后跑 npm run models:verify，应该全部显示 [精确匹配]。')
} else {
  console.log('')
  console.log('  全部认得出 —— 粘贴前先对照上面的「实际零件名」确认一眼语义没串。')
}

console.log('')
