/**
 * 生成 10 个文创商品的「占位模型」（GLB）。
 *
 * 为什么要它：
 *   正式模型（3ds Max 拆分 + 命名后导出）还没到位时，页面里 10 个商品位会 404，
 *   整个「生图 → 点击选面 → 贴图 → 导出」链路没法提前联调。
 *   这里用纯代码生成一批带正确 UV、并且**按部位拆好并命名**的几何体顶上。
 *
 * 关键：占位模型刻意和正式模型用同一套部位命名（body / inner / handle / face / neck / front / back），
 *      所以 src/data/modelPresets.ts 里的 regions 命名表现在就是可用的，
 *      正式 GLB 覆盖进来后只要沿用同名，配置一行都不用改。
 *
 * 用法：npm run models:placeholder
 * 产物：public/models/products/{mug,vase,bag,fan}_{a,b}.glb
 *
 * 说明：占位模型只保证「能渲染 + 部位拆好 + 名字对得上 + UV 干净」，
 *      造型是简化的近似体，不代表最终商品外观。
 *
 * ⚠️⚠️ **现在跑它会覆盖掉正式模型，而且花瓶 / 折扇的零件名已经对不上了。** 这个脚本停留在
 *      「10 个商品位还没有模型」的那个阶段，之后再没跟着更新：
 *        · 会**直接覆盖** `mug_a` / `bag_a` / `bag_b` / `vase_a` / `vase_b` 这几个
 *          **已经是正式模型**的文件；`holder_a` / `holder_b` 它根本不生成；
 *        · 花瓶的占位件用的是旧的 `vase_body` / `vase_neck` 两段命名，而现在的
 *          `VASE_REGIONS` 只有一块 `vase_side` —— 覆盖后花瓶会「点哪个部位都贴不上」。
 *        · 折扇（`fan_a`）已于 2026-10-08 从商品列表下架，它那份占位件也不用再生成了。
 *        · 冰箱贴（`magnet_a` / `magnet_b`）的生成项已于 2026-10-09 删除 —— 同时清掉了
 *          `public/models/products/` 里那两份孤儿 GLB（原先属「目录里有、下拉框里没有」）。
 *      **只有在一批模型还没到位、要临时顶上去时才跑。正式模型就位后不要跑。**
 *      真要重做花瓶占位件，先把下面 `vase_a` / `vase_b` 的零件名改成
 *      `vase_side` / `vase_inner` / `vase_bottom`，对齐 `modelPresets.ts` 的 `VASE_REGIONS`。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'models', 'products')

// --------------------------------------------------------------- 几何构造

/**
 * 旋转体：把 (半径, 高度) 剖面绕 Y 轴旋转成曲面。
 * UV 用「角度 × 剖面弧长」参数化，是这类回转体最自然的展开方式，不会扭曲。
 *
 * from / to 是剖面点下标，用它可以只取整个回转面的一段——
 * 这正是把杯子拆成「杯身外壁 / 杯口内壁」的做法。
 * 相邻两段共用边界点（例如都含下标 4），所以切开之后不会留下缝隙。
 */
function revolveRange(profile, from, to, segments = 64) {
  const rows = []
  for (let i = from; i <= to; i++) rows.push(i)

  // UV 只按本段自身的弧长归一化：贴图会刚好铺满这个部位，而不是铺满整只杯子
  const cumulative = [0]
  for (let k = 1; k < rows.length; k++) {
    const a = profile[rows[k - 1]]
    const b = profile[rows[k]]
    cumulative.push(cumulative[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cumulative[cumulative.length - 1] || 1
  const rowLen = segments + 1

  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  rows.forEach((index, k) => {
    const [radius, y] = profile[index]
    // 剖面前后点连线的切线，其垂线即回转面的法线。
    // 注意邻居取自**完整剖面**，这样切片边界处的法线仍是真实曲面法线，
    // 不会因为切到端点、前后邻居是自己而退化成零向量。
    const prev = profile[Math.max(index - 1, 0)]
    const next = profile[Math.min(index + 1, profile.length - 1)]
    let tr = next[0] - prev[0]
    let ty = next[1] - prev[1]
    const len = Math.hypot(tr, ty) || 1
    tr /= len
    ty /= len
    const nr = ty
    const ny = -tr

    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2
      positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle))
      normals.push(nr * Math.cos(angle), ny, nr * Math.sin(angle))
      // glTF 里 uv.v = 0 对应图片顶部，所以这里把弧长反过来
      uvs.push(j / segments, 1 - cumulative[k] / total)
    }
  })

  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < segments; j++) {
      const a = k * rowLen + j
      const b = a + 1
      const c = (k + 1) * rowLen + j
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  return { positions, normals, uvs, indices }
}

/** 完整回转体 */
const revolve = (profile, segments = 64) => revolveRange(profile, 0, profile.length - 1, segments)

/**
 * 长方体：每个面单独一套 [0,1]² UV。
 * faces 选面序号，用来把「正面」单独拆成一个贴图区。
 *   0 = +Z（正面） 1 = -Z（背面） 2 = +X 3 = -X 4 = +Y 5 = -Y
 */
function boxFaces(width, height, depth, faces = [0, 1, 2, 3, 4, 5], translate = [0, 0, 0]) {
  const hx = width / 2
  const hy = height / 2
  const hz = depth / 2
  const [ox, oy, oz] = translate

  const allFaces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ]
  // 左下 → 右下 → 右上 → 左上，配合 UV 原点在左上角
  const quadUv = [[0, 1], [1, 1], [1, 0], [0, 0]]

  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  faces.forEach((faceIndex, order) => {
    const face = allFaces[faceIndex]
    const base = order * 4
    face.v.forEach((vertex, i) => {
      positions.push(vertex[0] + ox, vertex[1] + oy, vertex[2] + oz)
      normals.push(face.n[0], face.n[1], face.n[2])
      uvs.push(quadUv[i][0], quadUv[i][1])
    })
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })

  return { positions, normals, uvs, indices }
}

const box = (width, height, depth, translate) => boxFaces(width, height, depth, [0, 1, 2, 3, 4, 5], translate)

/** 圆面（躺平在 XZ 平面）：用平面投影 UV，方图贴上去就是一个正圆图案 */
function disc(radius, segments = 64) {
  const positions = [0, 0, 0]
  const normals = [0, 1, 0]
  const uvs = [0.5, 0.5]
  const indices = []

  for (let j = 0; j <= segments; j++) {
    const angle = (j / segments) * Math.PI * 2
    const x = radius * Math.cos(angle)
    const z = radius * Math.sin(angle)
    positions.push(x, 0, z)
    normals.push(0, 1, 0)
    uvs.push((x / radius + 1) / 2, (z / radius + 1) / 2)
  }
  for (let j = 0; j < segments; j++) {
    indices.push(0, j + 1, j + 2)
  }

  return { positions, normals, uvs, indices }
}

/** 环形扇面（折扇的扇面）：按「角度 × 半径」参数化展开 */
function sector(innerRadius, outerRadius, sweepRadians, segments = 48) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  for (let j = 0; j <= segments; j++) {
    const angle = -sweepRadians / 2 + (j / segments) * sweepRadians
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    positions.push(innerRadius * cos, 0, innerRadius * sin)
    normals.push(0, 1, 0)
    uvs.push(j / segments, 1)
    positions.push(outerRadius * cos, 0, outerRadius * sin)
    normals.push(0, 1, 0)
    uvs.push(j / segments, 0)
  }
  for (let j = 0; j < segments; j++) {
    const a = j * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }

  return { positions, normals, uvs, indices }
}

/** 圆环的一段（茶杯把手）：环面躺在 XY 平面，绕 Z 轴走 */
function torusArc(majorRadius, tubeRadius, sweepRadians, center = [0, 0, 0], tubeSegments = 12, arcSegments = 48) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const [cx, cy, cz] = center
  const rowLen = tubeSegments + 1

  for (let i = 0; i <= arcSegments; i++) {
    const theta = -sweepRadians / 2 + (i / arcSegments) * sweepRadians
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    for (let j = 0; j <= tubeSegments; j++) {
      const phi = (j / tubeSegments) * Math.PI * 2
      const cosP = Math.cos(phi)
      const sinP = Math.sin(phi)
      // 管壁法线 = 环的径向分量 × 管的径向分量，再加上环的轴向分量
      const nx = cosT * cosP
      const ny = sinT * cosP
      const nz = sinP
      positions.push(
        cx + majorRadius * cosT + tubeRadius * nx,
        cy + majorRadius * sinT + tubeRadius * ny,
        cz + tubeRadius * nz,
      )
      normals.push(nx, ny, nz)
      uvs.push(i / arcSegments, j / tubeSegments)
    }
  }

  for (let i = 0; i < arcSegments; i++) {
    for (let j = 0; j < tubeSegments; j++) {
      const a = i * rowLen + j
      const b = a + 1
      const c = (i + 1) * rowLen + j
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  return { positions, normals, uvs, indices }
}

// --------------------------------------------------------------- GLB 写出

const pad4 = (n) => (4 - (n % 4)) % 4

/**
 * 把若干「部位」写成一个 GLB。
 * 每个部位 = 一个 node + 一个 mesh + 一个 material，**名字全部相同**：
 * 这样无论后续用「分离成独立对象」（读 node/mesh 名）还是「多维子材质」（读 material 名）导出，
 * 网页端都能靠同一个部位名把人认出来。
 */
function buildGlb(parts) {
  const binParts = []
  const bufferViews = []
  let byteLength = 0

  const pushView = (typedArray, target) => {
    const padding = pad4(byteLength)
    if (padding) {
      binParts.push(Buffer.alloc(padding))
      byteLength += padding
    }
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
    const byteOffset = byteLength
    binParts.push(bytes)
    byteLength += bytes.byteLength
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target })
    return bufferViews.length - 1
  }

  const nodes = []
  const meshes = []
  const materials = []
  const accessors = []

  parts.forEach((part, partIndex) => {
    const geometry = part.geometry
    const position = new Float32Array(geometry.positions)
    const normal = new Float32Array(geometry.normals)
    const uv = new Float32Array(geometry.uvs)
    const index = new Uint32Array(geometry.indices)

    const positionView = pushView(position, 34962)
    const normalView = pushView(normal, 34962)
    const uvView = pushView(uv, 34962)
    const indexView = pushView(index, 34963)

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < geometry.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = geometry.positions[i + axis]
        if (value < min[axis]) min[axis] = value
        if (value > max[axis]) max[axis] = value
      }
    }

    const accessorBase = accessors.length
    accessors.push(
      { bufferView: positionView, componentType: 5126, count: position.length / 3, type: 'VEC3', min, max },
      { bufferView: normalView, componentType: 5126, count: normal.length / 3, type: 'VEC3' },
      { bufferView: uvView, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: indexView, componentType: 5125, count: index.length, type: 'SCALAR' },
    )

    const materialIndex = materials.length
    materials.push({
      name: part.name,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.05,
        roughnessFactor: 0.65,
      },
      // 占位模型多为薄壳/单面，双面渲染更保险
      doubleSided: true,
    })

    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes: { POSITION: accessorBase, NORMAL: accessorBase + 1, TEXCOORD_0: accessorBase + 2 },
          indices: accessorBase + 3,
          material: materialIndex,
          mode: 4,
        },
      ],
    })

    nodes.push({ mesh: partIndex, name: part.name })
  })

  const gltf = {
    asset: { version: '2.0', generator: 'wenchuang-placeholder-generator' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  }

  const binary = Buffer.concat(binParts, byteLength)
  const jsonChunk = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPadding = pad4(jsonChunk.length)
  const jsonPadded = Buffer.concat([jsonChunk, Buffer.alloc(jsonPadding, 0x20)])
  const binPaddingSize = pad4(binary.length)
  const binaryPadded = Buffer.concat([binary, Buffer.alloc(binPaddingSize)])

  const totalLength = 12 + 8 + jsonPadded.length + 8 + binaryPadded.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binaryPadded.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binaryPadded])
}

// --------------------------------------------------------------- 商品定义

/** 带壁厚的杯子剖面：[半径, 高度] */
const cupProfile = (bottomRadius, topRadius, height) => {
  const wall = 0.035
  return [
    [0, 0],                                  // 0
    [bottomRadius, 0],                       // 1
    [bottomRadius + wall * 0.5, wall],       // 2
    [topRadius - wall * 0.6, height * 0.92], // 3
    [topRadius, height],                     // 4  ← 杯口外沿（杯身/内壁在这里分界）
    [topRadius - wall * 1.2, height],        // 5
    [topRadius - wall * 1.6, height * 0.92], // 6
    [bottomRadius + wall, wall * 1.4],       // 7
    [0, wall * 1.4],                         // 8
  ]
}

/**
 * 茶杯：cup_body（杯身外壁，可贴） / cup_handle（把手，可贴） / cup_inner（杯口内壁，保留）
 *
 * 零件名统一写成 <商品前缀>_<部位>，这套名字在三个地方保持完全一致：
 *   docs/模型拆分与命名规范.md ←→ src/data/modelPresets.ts 的 regions 表 ←→ 模型里的对象名
 * 正式模型照这套命名，覆盖进来即可零改动生效。
 */
const cupParts = (profile, handleCenter, handleRadius) => [
  { name: 'cup_body', geometry: revolveRange(profile, 0, 4, 72) },
  { name: 'cup_inner', geometry: revolveRange(profile, 4, 8, 72) },
  { name: 'cup_handle', geometry: torusArc(handleRadius, 0.045, (240 * Math.PI) / 180, handleCenter) },
]

/** 花瓶：vase_body（瓶身，可贴） / vase_neck（瓶颈，可贴） */
const vaseParts = (profile) => [
  { name: 'vase_body', geometry: revolveRange(profile, 0, 5, 72) },
  { name: 'vase_neck', geometry: revolveRange(profile, 5, 9, 72) },
]

const PRODUCTS = {
  mug_a: () => cupParts(cupProfile(0.3, 0.38, 1.06), [0.48, 0.55, 0], 0.16),
  mug_b: () => cupParts(cupProfile(0.27, 0.3, 1.24), [0.4, 0.62, 0], 0.15),
  vase_a: () =>
    vaseParts([
      [0, 0],
      [0.2, 0],
      [0.3, 0.1],
      [0.42, 0.45],
      [0.44, 0.62],
      [0.36, 0.88],
      [0.24, 1.08],
      [0.19, 1.22],
      [0.22, 1.34],
      [0.245, 1.4],
    ]),
  vase_b: () =>
    vaseParts([
      [0, 0],
      [0.26, 0],
      [0.34, 0.08],
      [0.4, 0.38],
      [0.34, 0.62],
      [0.2, 0.82],
      [0.12, 1.0],
      [0.11, 1.2],
      [0.16, 1.36],
      [0.2, 1.46],
    ]),
  // 帆布包：bag_front / bag_back 两面可贴，其余归 bag_body
  bag_a: () => [
    { name: 'bag_front', geometry: boxFaces(0.95, 1.05, 0.18, [0]) },
    { name: 'bag_back', geometry: boxFaces(0.95, 1.05, 0.18, [1]) },
    { name: 'bag_body', geometry: boxFaces(0.95, 1.05, 0.18, [2, 3, 4, 5]) },
  ],
  bag_b: () => [
    { name: 'bag_front', geometry: boxFaces(1.02, 1.16, 0.3, [0]) },
    { name: 'bag_back', geometry: boxFaces(1.02, 1.16, 0.3, [1]) },
    { name: 'bag_body', geometry: boxFaces(1.02, 1.16, 0.3, [2, 3, 4, 5]) },
  ],
  // 扇子：fan_face（扇面，可贴） / fan_handle（扇骨扇柄，保留）
  fan_a: () => [
    { name: 'fan_face', geometry: sector(0.14, 0.92, (150 * Math.PI) / 180, 56) },
    { name: 'fan_handle', geometry: box(0.34, 0.05, 0.045, [-0.31, 0, 0]) },
  ],
  fan_b: () => [
    { name: 'fan_face', geometry: disc(0.52, 64) },
    { name: 'fan_handle', geometry: box(0.07, 0.36, 0.05, [0, 0, -0.52 - 0.18]) },
  ],
}

// --------------------------------------------------------------- 执行

fs.mkdirSync(OUT_DIR, { recursive: true })

let written = 0
for (const [id, build] of Object.entries(PRODUCTS)) {
  const parts = build()
  const buffer = buildGlb(parts)
  const file = path.join(OUT_DIR, `${id}.glb`)
  fs.writeFileSync(file, buffer)

  const detail = parts
    .map((part) => {
      const triangles = part.geometry.indices.length / 3
      return `${part.name}(${triangles}面)`
    })
    .join(' + ')

  console.log(`✓ ${id}.glb  ${(buffer.length / 1024).toFixed(1)} KB  ${parts.length} 个部位：${detail}`)
  written += 1
}

console.log(`\n已生成 ${written} 个占位模型 → ${path.relative(process.cwd(), OUT_DIR)}`)
console.log('零件名用的是「<商品前缀>_<部位>」（cup_body / vase_neck / bag_front …），')
console.log('和 docs/模型拆分与命名规范.md、src/data/modelPresets.ts 的 regions 表三处一致。')
console.log('正式 GLB 照这套命名覆盖进来即可替换，配置无需改动。')
console.log('覆盖后先跑一遍：npm run models:verify')
