/**
 * 截面探针 —— 只读，判断一个回转体/柱体商品的**截面形状**，以及主法向分布。
 *
 * 用途：决定 `models:fix` 该用哪种 UV 投影、以及「只贴侧面外壁」的摘法是否成立。
 *   圆截面（各角度半径恒定）  → `cylinder-y` 柱面展开等比，最舒服
 *   方截面（半径每 90° 一个峰谷）→ `cylinder-y` 仍可用，但四个面各分到图案的 1/4、
 *                                  越靠竖棱越被拉开（宽高比 1.6× 量级）
 *   截面半径峰值出现在 45°/135°/225°/315° → 四个面朝 ±X/±Z（正方体是轴对齐的）
 *
 * 顺带能反解圆角半径：方截面半宽 a、圆角 R 时 `r_max = (a − R)·√2 + R`。
 *
 * 用法：
 *   npm run models:section -- holder_b            # 商品 id
 *   npm run models:section -- public/models/products/holder_b.glb
 *   npm run models:section -- holder_a holder_b   # 可以一次看几个
 *
 * 为什么不用体检页目测：`model-inspect.html` 是 3/4 斜视相机，透视偏移会让「方不方」
 * 看不准；这里直接读顶点，给的是数值。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// --------------------------------------------------------------- GLB 读取

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readGlb(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('不是 GLB 文件（缺少 glTF 魔数）')
  let offset = 12
  let json = null
  let bin = null
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.toString('utf8', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type.startsWith('JSON')) json = JSON.parse(body.toString('utf8'))
    else if (type.startsWith('BIN')) bin = body
    offset += 8 + length
  }
  if (!json || !bin) throw new Error('GLB 缺少 JSON / BIN 块')
  return { json, bin }
}

function readAccessor(gltf, index) {
  const accessor = gltf.json.accessors[index]
  const components = NUM_COMPONENTS[accessor.type]
  const Ctor = COMPONENT[accessor.componentType]
  if (!Ctor) throw new Error(`不支持的 componentType ${accessor.componentType}`)
  const view = gltf.json.bufferViews[accessor.bufferView]
  const bytes = Ctor.BYTES_PER_ELEMENT
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride ?? bytes * components
  const out = new Float64Array(accessor.count * components)
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      out[i * components + c] = gltf.bin.readFloatLE(base + i * stride + c * bytes)
    }
  }
  return out
}

// --------------------------------------------------------------- 分析

const BINS = 36
/** 方向角：0° = +Z（默认相机方向），90° = +X，180° = -Z */
const anglesOf = (dx, dz) => ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360

function analyze(file) {
  const gltf = readGlb(file)
  console.log(`\n${'─'.repeat(72)}`)
  console.log(`文件  ${path.relative(ROOT, file).replace(/\\/g, '/')}`)

  for (const mesh of gltf.json.meshes ?? []) {
    for (const [p, prim] of (mesh.primitives ?? []).entries()) {
      const pos = readAccessor(gltf, prim.attributes.POSITION)
      const nrm = prim.attributes.NORMAL != null ? readAccessor(gltf, prim.attributes.NORMAL) : null
      const count = pos.length / 3

      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < 3; c++) {
          const v = pos[i * 3 + c]
          if (v < min[c]) min[c] = v
          if (v > max[c]) max[c] = v
        }
      }
      const size = [0, 1, 2].map((c) => max[c] - min[c])
      const label = mesh.name || `mesh${p}`
      console.log(
        `\n零件  ${label}   顶点 ${count}   包围盒 ${size.map((v) => v.toFixed(3)).join(' × ')}`,
      )

      // 只取中段（45%~55% 高）的顶点看横向截面，避开口沿翻边与底部
      const cx = (min[0] + max[0]) / 2
      const cz = (min[2] + max[2]) / 2
      const low = min[1] + size[1] * 0.45
      const high = min[1] + size[1] * 0.55
      const rMin = new Array(BINS).fill(Infinity)
      const rMax = new Array(BINS).fill(0)
      let sampled = 0
      for (let i = 0; i < count; i++) {
        const y = pos[i * 3 + 1]
        if (y < low || y > high) continue
        const r = Math.hypot(pos[i * 3] - cx, pos[i * 3 + 2] - cz)
        const b = Math.min(BINS - 1, Math.floor((anglesOf(pos[i * 3] - cx, pos[i * 3 + 2] - cz) / 360) * BINS))
        if (r < rMin[b]) rMin[b] = r
        if (r > rMax[b]) rMax[b] = r
        sampled += 1
      }

      if (!sampled) {
        console.log('  中段没有顶点，跳过截面分析（可能是薄片件）')
      } else if (rMin.filter((v) => v !== Infinity).length < 24) {
        // 薄片件 / 把手这类零件的中段只扫到几个角向分桶，硬算会得到负数圆角半径
        console.log(
          `  中段只扫到 ${rMin.filter((v) => v !== Infinity).length}/36 个角向分桶 —— ` +
            '这个零件太薄或太偏，截面读数不可靠。想看整体形状就把它**拆分前**的原始模型喂进来。',
        )
      } else {
        const rows = []
        let globalMin = Infinity
        let globalMax = 0
        for (let b = 0; b < BINS; b++) {
          if (rMin[b] === Infinity) continue
          const mid = (rMin[b] + rMax[b]) / 2
          rows.push({ angle: b * 10, r: mid })
          if (mid < globalMin) globalMin = mid
          if (mid > globalMax) globalMax = mid
        }
        const byAngle = new Map(rows.map((row) => [row.angle, row.r]))
        const line = []
        for (let a = 0; a < 360; a += 30) {
          const r = byAngle.get(a) ?? byAngle.get(a === 0 ? 0 : a)
          line.push(r === undefined ? '  -  ' : r.toFixed(3))
        }
        console.log('  截面半径（每 30°，0°=+Z 90°=+X 180°=-Z 270°=-X）：')
        console.log('    ' + line.join(' '))
        console.log(
          `    最小 ${globalMin.toFixed(3)} / 最大 ${globalMax.toFixed(3)} = ${(globalMax / globalMin).toFixed(3)}`,
        )

        const ratio = globalMax / globalMin
        const peakAngles = rows
          .filter((row) => row.r > globalMin + (globalMax - globalMin) * 0.8)
          .map((row) => row.angle)
        // 峰值每 90° 出现一次 → 方截面；几乎不波动 → 圆截面
        const squared = ratio > 1.15
        console.log(
          `    → ${squared ? `**方/多边形截面**（半径起伏 ${((ratio - 1) * 100).toFixed(0)}%）` : '**圆截面**（半径基本恒定）'}`,
        )
        if (squared) {
          const a = globalMin
          const R = (a * Math.SQRT2 - globalMax) / (Math.SQRT2 - 1)
          console.log(
            `    峰值角 ${peakAngles.join('° / ')}°；半宽 a≈${a.toFixed(3)}，` +
              `反解圆角半径 R≈${R.toFixed(3)}（占半宽 ${((R / a) * 100).toFixed(0)}%）`,
          )
          console.log('    峰值都在 45/135/225/315 附近 → 四个面朝 ±X/±Z（轴对齐方体）')
        }
        console.log(
          '    UV 结论：' +
            (squared
              ? '`cylinder-y` 仍可用，但四个面各分到图案 1/4、越靠竖棱越被拉开'
              : '`cylinder-y` 柱面展开等比，可直接用'),
        )
      }

      if (nrm) {
        const hist = new Array(BINS).fill(0)
        let up = 0
        let down = 0
        for (let i = 0; i < count; i++) {
          const ny = nrm[i * 3 + 1]
          if (ny > 0.7) {
            up += 1
            continue
          }
          if (ny < -0.7) {
            down += 1
            continue
          }
          const b = Math.min(
            BINS - 1,
            Math.floor((anglesOf(nrm[i * 3], nrm[i * 3 + 2]) / 360) * BINS),
          )
          hist[b] += 1
        }
        const top = hist
          .map((n, b) => ({ angle: b * 10, n }))
          .sort((x, y) => y.n - x.n)
          .slice(0, 4)
        console.log(
          `  法向：近竖直的朝上 ${up} / 朝下 ${down}；` +
            `水平法向最集中的四个方向 ${top.map((t) => `${t.angle}°(${t.n})`).join(' ')}`,
        )
        console.log('    （「只贴外壁」时：朝上的水平面若半径大于内壁半径，会留在外壁一侧）')
      }
    }
  }
}

// --------------------------------------------------------------- 入口

const args = process.argv.slice(2)
const targets = args.length ? args : ['mug_a', 'holder_a', 'holder_b']
for (const target of targets) {
  const file = target.includes('/') || /\.glb$/i.test(target)
    ? path.resolve(ROOT, target)
    : path.join(ROOT, 'public', 'models', 'products', `${target}.glb`)
  if (!fs.existsSync(file)) {
    console.log(`\n[跳过] ${target} —— 找不到 ${path.relative(ROOT, file)}`)
    continue
  }
  try {
    analyze(file)
  } catch (error) {
    console.log(`\n[失败] ${target} —— ${error.message}`)
  }
}
console.log('')
