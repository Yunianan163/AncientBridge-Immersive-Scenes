/**
 * 分层探针 —— 只读，把一个 GLB 里**每个零件**按高度分层，看面数 / 半径 / 朝向分布。
 *
 * 和 `models:section`（截面探针）互补：那个回答「横截面是圆还是方」，
 * 这个回答「纵向上哪一段是什么」—— 判断 AI 生成的整块软体里：
 *   · 内腔到底建了多深（决定 `--extract-inner` 够不够）
 *   · 底部有几级、`--extract-region` 的 `y` 区间该取多少
 *     （实测坑：花瓶底是两级的，`y=0~0.06` 正好切在中间，半个凹底会留在可贴区）
 *   · 拆分之后可贴零件里还**残留**着哪些不该有的面（朝下的底面、内腔底等）
 *
 * 用法：
 *   npm run models:layers -- holder_b
 *   npm run models:layers -- public/models/products/vase_a.glb
 *   npm run models:layers -- vase_a vase_b        # 可以一次看几个
 *   npm run models:layers -- vase_a --layers 20   # 换分层数（默认 12）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// --------------------------------------------------------------- GLB 读取

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
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

/** 浮点 accessor（POSITION / NORMAL） */
function readAccessor(gltf, index) {
  const accessor = gltf.json.accessors[index]
  const components = NUM_COMPONENTS[accessor.type]
  const Ctor = COMPONENT[accessor.componentType]
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

/** 索引 accessor 必须按整数读 —— 用 readFloatLE 会把索引读成一堆浮点垃圾 */
function readIndices(gltf, index) {
  const accessor = gltf.json.accessors[index]
  const Ctor = COMPONENT[accessor.componentType]
  const view = gltf.json.bufferViews[accessor.bufferView]
  const bytes = Ctor.BYTES_PER_ELEMENT
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride ?? bytes
  const out = new Uint32Array(accessor.count)
  for (let i = 0; i < accessor.count; i++) out[i] = gltf.bin.readUIntLE(base + i * stride, bytes)
  return out
}

// --------------------------------------------------------------- 分析

/** 取出一个 GLB 里每个零件的三角形（面心 + 面法向） */
function trianglesOf(gltf) {
  const parts = []
  for (const mesh of gltf.json.meshes ?? []) {
    const tris = []
    for (const prim of mesh.primitives ?? []) {
      const pos = readAccessor(gltf, prim.attributes.POSITION)
      const nrm = readAccessor(gltf, prim.attributes.NORMAL)
      const idx = readIndices(gltf, prim.indices)
      for (let t = 0; t < idx.length / 3; t++) {
        const a = idx[t * 3]
        const b = idx[t * 3 + 1]
        const c = idx[t * 3 + 2]
        const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
        const [ax, ay, az] = v(a)
        const [bx, by, bz] = v(b)
        const [cx, cy, cz] = v(c)
        tris.push({
          cx: (ax + bx + cx) / 3,
          cy: (ay + by + cy) / 3,
          cz: (az + bz + cz) / 3,
          nx: (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) / 3,
          ny: (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) / 3,
          nz: (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]) / 3,
        })
      }
    }
    parts.push({ name: mesh.name || `mesh${parts.length}`, tris })
  }
  return parts
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN)

function report(file, layers) {
  const gltf = readGlb(file)
  const parts = trianglesOf(gltf)
  const all = parts.flatMap((p) => p.tris)
  if (!all.length) return

  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const t of all) {
    minY = Math.min(minY, t.cy); maxY = Math.max(maxY, t.cy)
    minX = Math.min(minX, t.cx); maxX = Math.max(maxX, t.cx)
    minZ = Math.min(minZ, t.cz); maxZ = Math.max(maxZ, t.cz)
  }
  const H = maxY - minY || 1
  const axisX = (minX + maxX) / 2
  const axisZ = (minZ + maxZ) / 2

  console.log(`\n${'='.repeat(84)}`)
  console.log(`文件  ${path.relative(ROOT, file).replace(/\\/g, '/')}`)
  console.log(
    `  共 ${parts.length} 个零件 / ${all.length} 面   整体包围盒 `
    + `${(maxX - minX).toFixed(3)} × ${H.toFixed(3)} × ${(maxZ - minZ).toFixed(3)}   `
    + `中轴 (${axisX.toFixed(3)}, ${axisZ.toFixed(3)})`,
  )

  for (const part of parts) {
    if (!part.tris.length) continue
    const buckets = Array.from({ length: layers }, () => ({ n: 0, out: 0, in: 0, up: 0, down: 0, slant: 0, other: 0, rOut: [], rIn: [], rDown: [] }))
    for (const t of part.tris) {
      const dx = t.cx - axisX
      const dz = t.cz - axisZ
      const r = Math.hypot(dx, dz)
      const i = Math.max(0, Math.min(layers - 1, Math.floor(((t.cy - minY) / H) * layers)))
      const b = buckets[i]
      b.n += 1
      const radialDot = r < 1e-9 ? 0 : (t.nx * dx + t.nz * dz) / r
      if (Math.abs(t.ny) > 0.6) {
        if (t.ny > 0) b.up += 1
        // 「朝下」按 `--extract-region` 用的 cos=0.7 分两档：
        //   朝下↓ = ny ≤ −0.7，真朝下，会被 `axis=-y;cos=0.7` 摘走
        //   斜下  = −0.7 < ny < −0.6，斜着往下的裙边，本来就属于侧壁，不会被摘
        // 不分开的话，一眼看过去会以为「可贴区里还残留着底面」。
        else if (t.ny <= -0.7) {
          b.down += 1
          b.rDown.push(r)
        } else b.slant += 1
      } else if (radialDot > 0.5) {
        b.out += 1
        b.rOut.push(r)
      } else if (radialDot < -0.5) {
        b.in += 1
        b.rIn.push(r)
      } else b.other += 1
    }

    const total = part.tris.length
    console.log(`\n  零件  ${part.name}   ${total} 面   占全模型 ${((total / all.length) * 100).toFixed(1)}%`)
    console.log('    层   y(实际)           面数    内向   外向   朝上  朝下↓   斜下   其他 | 外向半径 内向半径')
    for (let i = 0; i < layers; i++) {
      const b = buckets[i]
      if (!b.n) continue
      const y0 = (minY + (i / layers) * H).toFixed(3)
      const y1 = (minY + ((i + 1) / layers) * H).toFixed(3)
      const f = (v) => (Number.isNaN(v) ? '   -   ' : v.toFixed(3).padStart(7))
      console.log(
        `    ${String(i).padStart(2)}  ${y0}~${y1}  ${String(b.n).padStart(7)}  `
        + `${String(b.in).padStart(5)}  ${String(b.out).padStart(5)}  ${String(b.up).padStart(5)}  `
        + `${String(b.down).padStart(5)}  ${String(b.slant).padStart(5)}  ${String(b.other).padStart(5)} | `
        + `${f(median(b.rOut))} ${f(median(b.rIn))}`,
      )
    }

    // 「朝下↓」这一类是把 `--extract-region axis=-y` 摘走的候选，单独汇总一下：
    // 它在哪几层、半径多大，一眼就能看出「摘干净了没有」。
    // ⚠️ 只看总中位半径会误判：底层（该摘）和顶层（常是口沿翻边）混在一起算，
    // 中位数被层数多的一方拉走。所以**必须逐层报半径**，再拿它跟同层的内/外壁半径对比：
    //   · 底层还有一堆              → 摘底那刀没切够（抬 `y` 上界，如花瓶 0.06 → 0.12）
    //   · 顶层有、半径 ≈ 该层外壁半径（或更大）→ 外扩口沿的**下表面**，从侧下方看得见，属外壁，留着对
    //     （实测：花瓶圆肚 1259 面 r≈0.174 / 同层外壁 0.198，细颈 414 面 r≈0.113 / 同层外壁 0.096）
    //   · 顶层有、半径 ≈（甚至小于）该层内壁半径 → 口沿往内的翻边，属内壁，该归 `_inner`
    //   · 底部/腰部零星几十面且半径 ≈ 同层外壁 → 壁与底交界的倒角，属外壁，忽略即可
    const down = buckets.flatMap((b, i) => b.rDown.map((r) => ({ r, i })))
    if (down.length) {
      const rs = down.map((d) => d.r).sort((a, b) => a - b)
      const byLayer = new Map()
      for (const d of down) {
        if (!byLayer.has(d.i)) byLayer.set(d.i, [])
        byLayer.get(d.i).push(d.r)
      }
      const perLayer = [...byLayer.keys()].sort((a, b) => a - b)
        .map((i) => {
          const list = byLayer.get(i)
          const ref = buckets[i]
          return `第 ${String(i).padStart(2)} 层 ${String(list.length).padStart(6)} 面 半径中位 ${median(list).toFixed(3)}`
            + `（同层 外壁 ${Number.isNaN(median(ref.rOut)) ? ' - ' : median(ref.rOut).toFixed(3)}`
            + ` / 内壁 ${Number.isNaN(median(ref.rIn)) ? ' - ' : median(ref.rIn).toFixed(3)}）`
        })
      console.log(
        `    ↳ 朝下↓ 共 ${String(down.length).padStart(6)} 面，`
        + `半径 ${rs[0].toFixed(3)}~${rs[rs.length - 1].toFixed(3)}（总中位 ${median(rs).toFixed(3)}）`,
      )
      for (const line of perLayer) console.log(`       ${line}`)
    }
  }
}

// --------------------------------------------------------------- 入口

const argv = process.argv.slice(2)
const layerArg = argv.indexOf('--layers')
const LAYERS = layerArg >= 0 ? Number(argv[layerArg + 1]) || 12 : 12
const targets = argv.filter((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--')))
if (!targets.length) {
  console.error('用法：node scripts/probe-layers.mjs <商品 id | GLB 路径> [...] [--layers 12]')
  process.exit(1)
}
for (const target of targets) {
  const file = target.includes('/') || /\.glb$/i.test(target)
    ? path.resolve(ROOT, target)
    : path.join(ROOT, 'public', 'models', 'products', `${target}.glb`)
  if (!fs.existsSync(file)) {
    console.error(`\n✗ 找不到 ${file}`)
    continue
  }
  report(file, LAYERS)
}
console.log('')
