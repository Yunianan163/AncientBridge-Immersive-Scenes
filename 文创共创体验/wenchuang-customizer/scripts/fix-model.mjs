/**
 * 把「从 3ds Max 导出的商品 GLB」修成网页端能直接用的样子。
 *
 * 为什么需要它：
 *   混元 3D → 3ds Max 拆分 → 导出 GLB 这条链路上，导出结果经常带着两个毛病：
 *
 *   ① **没有 UV（TEXCOORD_0）**。贴图靠模型自身的 UV 坐标，没有 UV 就完全贴不上去
 *      （网页端会提示「这个部位没有 UV 坐标」）。Max 的 ATF 导出器在不支持的情况下
 *      会干脆不写 UV 通道，或者对象根本没加 UVW 展开修改器。
 *   ② **材质是 fallback**。没有材质的对象会被导出成 `fallback Material`：
 *      `baseColorFactor = [0,0,0,1]` 且缺省 `metallicFactor / roughnessFactor`，
 *      而 glTF 里这两个因子的默认值都是 **1** —— 结果是「纯黑 + 全金属」，
 *      渲染出来是一坨发暗的金属块。
 *
 *   这个脚本把这两件事一次修掉，顺便把节点层级烘焙掉（Max 导出常见
 *   「外层 ×1000、内层 ×0.001」这种互相抵消的父子缩放，留着只会给后续处理添乱）。
 *
 *   ③ **一个部位里混进了不属于它的面**。手动「选择面 → 分离」极易多选/漏选：
 *      茶杯的杯底被选进了把手、杯口内壁和杯身连着分不开……这些都能按几何自动拆：
 *
 *        --island-names   <零件>=<名字1>,<名字2>,...   按「互不相连」拆开（多选进来的那块）
 *        --extract-inner  <零件>=<新名字>              把「法向朝轴心」的面拆出来（杯口内壁）
 *        --extract-region <零件>=<新名字>;axis=+z;cos=0.7;y=0~0.53
 *                                                     按「朝向 + 包围盒范围」拆出一块（软体模型划可贴区）
 *        --extract-by-color <零件>=<新名字>;min=205    按「烘焙贴图在三角形 UV 处的采样色」拆出一块
 *        --rename         <旧名>=<新名>                把零件改个名（给拆分剩下的那块用）
 *
 *      AI 建模出的**一整块光滑软体**（连通块只有 1 个、相邻面二面角全都很小）
 *      三种都靠不上，只能用 `--extract-region` 按朝向 + 位置圈出「正面」这种区域。
 *
 *   ④ **模型自带烘焙贴图**（扫描件 / AI 上色件）。这类模型和上面几种都不一样：
 *      · 分区**只能按贴图颜色认**（「这块面在贴图里是白的」→ 它就是那块白布）→ `--extract-by-color`；
 *      · 它已经带 UV，但那是**贴图集的 UV**，要当打印区的那块必须换成平面展开 → `--uv-force`；
 *      · 除打印区以外的零件要**原样保留**（贴图、粗糙度都不许动）→ `--material <零件>=keep`；
 *      · 贴图集动辄 4096²、几十 MB，网页端必须压 → `--texture-size 1024`。
 *
 * 用法：
 *   node scripts/fix-model.mjs <输入.glb> [--out <输出.glb>] [--force] [--dry]
 *                              [--island-names <零件>=<名1>,<名2>] [--extract-inner <零件>=<新名>]
 *                              [--extract-region <零件>=<新名>;axis=..;cos=..;x=..;y=..;z=..;r=..;center=..]
 *                              [--extract-by-color <零件>=<新名>;min=..;max=..;tol=..]
 *                              [--uv-force <零件>[,<零件>...]] [--material <零件>=keep|clean]
 *                              [--texture-size <像素>] [--rename <旧名>=<新名>]
 *
 *   --out            输出路径，省略时原地覆盖（脚本自己会先备份成 <名字>.raw.glb）
 *   --force          已经有 UV 的零件也重新生成一遍
 *   --uv-force       只对列出的零件重新生成 UV（其余零件仍是「已有 UV 就保留」）
 *   --dry            只体检不改文件
 *   --island-names   按连通块拆分，可重复给多个
 *   --extract-inner  按「朝内 / 朝外」拆分，可重复给多个
 *   --extract-region 按「朝向 + 包围盒归一化范围」拆分，可重复给多个
 *                    axis = +x|-x|+y|-y|+z|-z（默认 +z）
 *                    cos  = 法向与 axis 的夹角余弦下限（默认 0.7，越大越「正对着」）
 *                    x/y/z = 归一化区间，写作 `0~0.53`，两端可留空表示 0 / 1
 *                    r   = 到 center 的**平面距离**的归一化区间（1.0 = 该区域顶点里最远的那个）。
 *                          给「扇环 / 环带」这类轴对齐包围盒圈不出来的区域用。
 *                          按三角形重心**整块归类**，不做几何裁切
 *                    center = r 的圆心，写**世界坐标**（`1.6583,0.1069`）；不给则用包围盒中心
 *   --extract-by-color  按「材质里那张 baseColor 贴图在本三角形 UV 处的颜色」拆分，可重复给多个
 *                    min = 每个通道都要大于它（默认 200）；max = 每个通道都要 ≤ 它（默认 255）
 *                    tol = 最大通道与最小通道之差的上限，用来要求「是中性色」（默认 255 = 不限）
 *                    想圈「白绢 / 白瓷」这种中性浅色，min 放到 150、tol 收到 16
 *                    （木头是暖色，通道差 ≥ 40，圈不进来；只写 min=200 会漏掉被阴影压暗的那几层）
 *                    例：团扇的白色绢面 `--extract-by-color "node_0=fan_face;min=150;tol=16"`
 *   --material       每个零件怎么处理材质：keep = 原样保留（贴图 / 数值一个都不动）；
 *                    clean = 清掉所有贴图并归到「白坯 + 瓷感」数值；
 *                    wood = 把「木色 + 木质数值」烤进 GLB（给 AI 出的、零贴图的零件用，
 *                           必须和网页端的 keepOriginalParts 配对，否则颜色会被调色板覆盖）。
 *                    可重复给多个
 *   --texture-size   把内嵌贴图降采样到不超过这个边长（整数倍盒式平均），并重编码成 RGB PNG。
 *                    4096² 的扫描贴图能到 30 MB+，压到 1024 通常只剩 2 MB 左右
 *   --rename         把零件改名，可重复给多个
 *
 * 产物：修好的 GLB，日志里会打印每个部位用了什么投影补 UV、做了哪些拆分、贴图压到多大。
 *
 * 用法示例：
 *   # 只补 UV / 修材质
 *   npm run models:fix -- "D:/.../文创商品模型/mug_a.glb" --out public/models/products/mug_a.glb
 *
 *   # 茶杯：把混进把手的杯底拆出来 + 把杯口内壁拆成独立部位（不可贴）
 *   npm run models:fix -- "D:/.../文创商品模型/mug_a.glb" --out public/models/products/mug_a.glb \
 *     --island-names "cup_handle=cup_bottom,cup_handle" \
 *     --extract-inner "cup_body=cup_inner"
 *
 *   # 帆布包（AI 出的整块光滑软体）：正面拆成可贴部位，其余全部保留
 *   npm run models:fix -- "D:/.../文创商品模型/bag_a.glb" --out public/models/products/bag_a.glb \
 *     --extract-region "node_0=bag_front;axis=+z;cos=0.7;y=0~0.53" \
 *     --rename "node_0=bag_body"
 *
 *   # 团扇（自带烘焙贴图的扫描件）：按「中性浅色」认出白绢面（**两层薄片都要圈到**，
 *   # 否则背面看不到正面图案），平面展开给它当打印区，扇框与竹柄原样保留，贴图压到 1024
 *   npm run models:fix -- "D:/.../文创商品模型/fan_b.glb" --out public/models/products/fan_b.glb \
 *     --extract-by-color "node_0=fan_face;min=150;tol=16" \
 *     --uv-force "fan_face" --material "fan_body=keep" --material "fan_face=clean" \
 *     --texture-size 1024 --rename "node_0=fan_body"
 */

import fs from 'node:fs'
import path from 'node:path'
import { decodePng, downscaleToAtMost, encodePng } from './lib/png.mjs'

const pad4 = (n) => (4 - (n % 4)) % 4

// --------------------------------------------------------------- 部位 → 投影方式

/**
 * 补 UV 时按部位名选投影方式。**投影方式决定了贴图怎么「铺」到这块面上**：
 *
 *   cylinder-y  绕 Y 轴的柱面展开。回转体（杯身、瓶身）用这个，图案会像
 *               印刷一样绕一圈，不会横向拉伸。接缝放在 -Z（背面），
 *               接缝两侧的 u 分别是 1.0 和 0.0，在 Repeat 采样下严丝合缝，
 *               肉眼看不到拼缝；图案中心正对 +Z（正面，也就是默认相机方向）。
 *   planar-z    沿 Z 轴的平面投影，等于「从正面看过去的样子」。
 *               把手、冰箱贴正面、包的正背面这种「一片」的面用这个。
 *   planar-z-back  同 planar-z，但 u 左右翻转。**给「从背面看」的那块面用** ——
 *               观察点在 -Z 时 X 轴在屏幕上左右相反，不翻的话文字/印章会镜像。
 *   planar-x    沿 X 轴投影，备用。
 *   auto        按包围盒猜：XZ 两个方向的跨度都不小于 Y 跨度的 0.4 倍 → cylinder-y，
 *               否则取最薄的那个轴做平面投影。
 *
 * 想换某个部位的贴法，改这张表即可，不用动代码。
 */
const PROJECTION_BY_PART = {
  cup_body: 'cylinder-y',
  cup_inner: 'cylinder-y',
  cup_handle: 'planar-z',
  cup_bottom: 'planar-y',
  vase_side: 'cylinder-y',
  vase_inner: 'cylinder-y',
  vase_bottom: 'planar-y',
  holder_side: 'cylinder-y',
  holder_inner: 'cylinder-y',
  holder_bottom: 'planar-y',
  magnet_face: 'planar-z',
  magnet_body: 'planar-z',
  bag_front: 'planar-z',
  bag_back: 'planar-z-back',
  bag_body: 'planar-z',
  fan_face: 'planar-z',
  fan_body: 'planar-z',
  // 折扇（`fan_a`）：扇面是前后两层薄片，各贴一张图。
  // 背面用 `planar-z-back`（u 左右翻转），这样「同一张图贴两面」时从背面看图案也是正的。
  fan_face_front: 'planar-z',
  fan_face_back: 'planar-z-back',
  fan_ribs: 'planar-z',
}

// --------------------------------------------------------------- 烤进模型里的「木质」色

/**
 * `--material <零件>=wood` 用的木色，写成 **sRGB 十六进制**（就是取色器里那个值），
 * 下面再转成 glTF 要的线性空间。
 *
 * 为什么是纯色而不是一张木纹贴图：
 *   扇骨是一堆**放射状细条**，UV 走 `planar-z` 平面投影 —— 贴图的方向在整个零件上
 *   只有一个（u 跟着 x、v 跟着 y），而「木纹纤维」的方向要**顺着每根扇骨**才对，
 *   放射状排列下没有一个方向能对齐。硬贴上去纹理会横着切过所有扇骨，比纯色更像错误。
 *   真实的竹骨折扇本来也接近**均匀色 + 抛光**，纯色是更诚实的做法。
 */
const WOOD_HEX = [0xa8, 0x7b, 0x4f] // #A87B4F —— 暖调竹木色

/** sRGB 通道（0~255）→ 线性（glTF 的 baseColorFactor 用的是线性空间） */
function srgbToLinear(channel) {
  const c = channel / 255
  return Number((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).toFixed(4))
}

/** 部位名 → 用哪种投影（先按整名查，再按「去前缀/去后缀」的末段查） */
function projectionFor(partName, bounds) {
  const exact = PROJECTION_BY_PART[partName]
  if (exact) return exact
  const tail = partName.split('_').pop()
  for (const [key, value] of Object.entries(PROJECTION_BY_PART)) {
    if (key.split('_').pop() === tail) return value
  }
  return 'auto'
}

/** auto：靠包围盒形状猜——「转得起来的」给柱面，「薄片」给平面 */
function autoProjection(size) {
  const [sx, sy, sz] = size
  const footprint = Math.max(sx, sz)
  if (sy > 0 && sx >= sy * 0.4 && sz >= sy * 0.4) return 'cylinder-y'
  if (footprint === 0) return 'cylinder-y'
  // 平面投影挑「最薄」的那根轴当视线方向
  if (sx <= sy && sx <= sz) return 'planar-x'
  if (sy <= sx && sy <= sz) return 'planar-y'
  return 'planar-z'
}

// --------------------------------------------------------------- GLB 读写

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB 文件（magic 对不上）')
  let json = null
  let bin = null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    if (type === 0x004e4942) bin = data
    offset += 8 + length
  }
  if (!json) throw new Error('GLB 里没有 JSON chunk')
  return { json, bin }
}

/** 读一个 accessor 成强类型数组（处理 byteStride 与 interleaved） */
function readAccessor(json, bin, index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const Ctor = COMPONENT[accessor.componentType]
  if (!Ctor) throw new Error(`不支持的 componentType: ${accessor.componentType}`)
  const width = COMPONENT_COUNT[accessor.type]
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride
  if (!stride || stride === Ctor.BYTES_PER_ELEMENT * width) {
    return new Ctor(bin.buffer, bin.byteOffset + start, accessor.count * width)
  }
  const out = new Ctor(accessor.count * width)
  for (let i = 0; i < accessor.count; i++) {
    out.set(new Ctor(bin.buffer, bin.byteOffset + start + i * stride, width), i * width)
  }
  return out
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** 列主序 4×4 相乘（a 在左） */
function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice()
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

const transformPoint = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

const transformDirection = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z,
  m[1] * x + m[5] * y + m[9] * z,
  m[2] * x + m[6] * y + m[10] * z,
]

/** 收集「有哪些 mesh 实例」，每个实例带自己的世界矩阵 */
function collectInstances(json) {
  const instances = []
  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex]
    const world = multiply(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
      instances.push({
        node,
        mesh: json.meshes[node.mesh],
        world,
        name: node.name || json.meshes[node.mesh]?.name || `part_${node.mesh}`,
      })
    }
    for (const child of node.children ?? []) walk(child, world)
  }
  const scene = json.scenes[json.scene ?? 0]
  for (const root of scene.nodes) walk(root, IDENTITY)
  return instances
}

// --------------------------------------------------------------- 连通块体检

/**
 * 按三角形连通性把顶点分组（并查集），返回按点数从大到小排好的块。
 *
 * 用途：**发现「一个部位里混进了不属于它的面」**。
 * 拆模型时用「选择面 → 分离」很容易多选/漏选，比如茶杯的杯底被一起选进了把手，
 * 结果就是「点把手贴图，杯底也跟着变」、而且把手补 UV 时的包围盒被杯底撑大，
 * 图案被挤到一角。这个体检能一眼看出来。
 */
function clusterize(position, indices) {
  const vertexCount = position.length / 3

  // 先按坐标「焊接」一遍：混元 / Max 导出的网格经常有「位置重合但没有共享顶点」
  // 的情况（沿圆周一圈圈 tessellate 出来的同心环就是典型），不焊接的话
  // 一整块连续的面会被误报成几十个小块。
  const welded = new Int32Array(vertexCount)
  const seen = new Map()
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(position[i * 3] * 1e4)},${Math.round(position[i * 3 + 1] * 1e4)},${Math.round(position[i * 3 + 2] * 1e4)}`
    const found = seen.get(key)
    if (found === undefined) {
      seen.set(key, i)
      welded[i] = i
    } else {
      welded[i] = found
    }
  }

  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  const find = (x) => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== root) {
      const next = parent[x]
      parent[x] = root
      x = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let t = 0; t < indices.length; t += 3) {
    union(welded[indices[t]], welded[indices[t + 1]])
    union(welded[indices[t]], welded[indices[t + 2]])
  }

  const groups = new Map()
  for (let i = 0; i < vertexCount; i++) {
    if (welded[i] !== i) continue // 重合点只算一次，避免把块「撑大」
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

// --------------------------------------------------------------- 按几何拆分

/**
 * 把三角形按「连通块」分组（复用 clusterize 的坐标焊接思路）。
 *
 * 用途：`--island-names cup_handle=cup_bottom,cup_handle`
 * 拆模型时「选择面 → 分离」多选了，会把杯底一起选进把手。这两块在几何上是
 * **互不相连**的两片，所以能可靠地自动拆开，比再回 Max 手动选面稳得多。
 */
function groupTrianglesByIsland(position, indices) {
  const vertexCount = position.length / 3
  const welded = new Int32Array(vertexCount)
  const seen = new Map()
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(position[i * 3] * 1e4)},${Math.round(position[i * 3 + 1] * 1e4)},${Math.round(position[i * 3 + 2] * 1e4)}`
    const found = seen.get(key)
    if (found === undefined) {
      seen.set(key, i)
      welded[i] = i
    } else {
      welded[i] = found
    }
  }

  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  const find = (x) => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== root) {
      const next = parent[x]
      parent[x] = root
      x = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const triangleCount = indices.length / 3
  for (let t = 0; t < triangleCount; t++) {
    union(welded[indices[t * 3]], welded[indices[t * 3 + 1]])
    union(welded[indices[t * 3]], welded[indices[t * 3 + 2]])
  }

  const groups = new Map()
  for (let t = 0; t < triangleCount; t++) {
    const root = find(welded[indices[t * 3]])
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(t)
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/** 三角形的几何指标：中心、面法向、到轴的半径、法向与径向的夹角余弦、法向的 Y 分量 */
function triangleMetrics(position, indices, triangleId) {
  const a = indices[triangleId * 3]
  const b = indices[triangleId * 3 + 1]
  const c = indices[triangleId * 3 + 2]
  const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2]
  const bx = position[b * 3], by = position[b * 3 + 1], bz = position[b * 3 + 2]
  const cx = position[c * 3], cy = position[c * 3 + 1], cz = position[c * 3 + 2]
  // 几何法向比顶点法向可靠：顶点法向是平滑过的，Fillet 处会「歪」向平均方向
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len
  ny /= len
  nz /= len
  return {
    cx: (ax + bx + cx) / 3,
    cy: (ay + by + cy) / 3,
    cz: (az + bz + cz) / 3,
    nx,
    ny,
    nz,
  }
}

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * 把一个零件按「面朝里 / 面朝外」拆成两块。
 *
 * 用途：`--extract-inner cup_body=cup_inner`
 * 茶杯的杯身和杯口内壁在几何上是**连着的一整片**（沿杯口翻过去），
 * 靠连通块分不开，但它有一个非常可靠的特征 —— **法向朝不朝杯子的中轴**：
 *   · 外壁的法向背离中轴（dot > 0）
 *   · 内壁的法向指向中轴（dot < 0）
 *   · 内底这种水平面靠「半径小 + 法向朝上」判定
 * 于是可以自动拆开，不需要回 Max 手动刷选（手动选这种光滑回转面极易漏选）。
 *
 * 阈值都做成「用数据自己估」而不是写死常数：
 *   · 中轴 = 该零件 XZ 包围盒中心
 *   · 内壁半径 = 所有「朝里」三角形的半径中位数
 */
function splitInnerOuter(position, indices, triangleIds, options = {}) {
  const axisX = options.axisX
  const axisZ = options.axisZ

  const metrics = new Map()
  for (const t of triangleIds) {
    const m = triangleMetrics(position, indices, t)
    const dx = m.cx - axisX
    const dz = m.cz - axisZ
    const radius = Math.hypot(dx, dz)
    const radialDot = radius < 1e-9 ? 0 : (m.nx * dx + m.nz * dz) / radius
    metrics.set(t, { ...m, radius, radialDot })
  }

  const inwardRadii = [...metrics.values()].filter((m) => m.radialDot < -0.5).map((m) => m.radius)
  const innerRadius = median(inwardRadii)

  const inner = []
  const outer = []
  for (const t of triangleIds) {
    const m = metrics.get(t)
    let isInner
    if (Math.abs(m.ny) > 0.6) {
      // 接近水平的顶/底面：朝上且在空腔半径以内 = 杯内底面；否则是杯口环 / 杯底
      isInner = m.ny > 0 && innerRadius > 0 && m.radius < innerRadius
    } else {
      isInner = m.radialDot < 0
    }
    ;(isInner ? inner : outer).push(t)
  }

  return { inner, outer, innerRadius, inwardCount: inwardRadii.length }
}

const AXIS_VECTORS = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
}

/** 解析 `0~0.53` 这种「包围盒归一化区间」，两端可以留空（表示 0 / 1） */
function parseRange(text) {
  const [rawA = '', rawB = ''] = String(text).split('~')
  const a = rawA.trim() === '' ? 0 : Number(rawA)
  const b = rawB.trim() === '' ? 1 : Number(rawB)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return a <= b ? [a, b] : [b, a]
}

/**
 * 把「朝某个方向的、且落在指定包围盒范围内的面」拆出来。
 *
 * 用途：`--extract-region "node_0=bag_front;axis=+z;cos=0.7;y=0~0.53"`
 *
 * 为什么需要它：`--island-names`（按连通性）和 `--extract-inner`（按朝不朝轴心）
 * 都失效的第三种情况 —— **AI 建模出的「一整块光滑软体」**。
 * 实测 `bag_a.glb`：50000 面是**一个连通块**，而且**整块都是光滑的**
 * （相邻面二面角全都小于 25°，没有任何硬边）—— 也就是说这种模型里
 * 「包的正面」根本不是一个几何上独立的零件，只能靠**朝向 + 位置**圈出来。
 *
 * 判定规则：
 *   ① 面法向与 `axis` 的夹角余弦 ≥ `cos`（默认 0.7 ≈ 45°）—— 「朝这边」的面；
 *   ② 面重心的 `x / y / z` 归一化到该零件的包围盒（0~1）后落在给定区间内。
 *   包围盒用**归一化比例**而不是绝对数值，换模型 / 换单位都不用改参数。
 *
 * ⚠️ ② 的边界是**按平面切出来的，不是整块三角形丢掉**。
 * 整块丢的话边界由三角形的边决定，一个三角形在屏幕上约 4 像素宽，
 * 切出来是一条明显的**锯齿**（实测帆布包打印区上沿像被撕开一样）。
 * 切开之后边界是一条精确的直线，和用户在截图上画的框一模一样。
 */

const ALL_AXES = ['x', 'y', 'z']

/**
 * 把一块三角形网格按一组「轴对齐半空间」裁开（Sutherland–Hodgman）。
 * `planes` 的每一项是 `{ axis, dir, value }`，`dir = +1` 表示 `coord >= value` 算保留侧。
 * 返回裁剪后的完整几何（顶点是重建的，所以 position / normal / uv 都要一起重建）。
 */
function clipGeometry(position, normal, uv, indices, triangleIds, planes) {
  const outPos = []
  const outNrm = normal ? [] : null
  const outUv = uv ? [] : null
  const outIdx = []
  // 顶点去重表：原顶点直接用 `v<索引>` 当键（这样相邻三角形依然共用顶点，
  // 不会把顶点数撑成「三角形数 × 3」——实测不去重的话文件会大一倍多）；
  // 新插出来的交点用「平面 + 两个端点」当键，同一条边同一个平面只会插出一个点。
  const welded = new Map()

  const emit = (v) => {
    const found = welded.get(v.key)
    if (found !== undefined) return found
    const index = outPos.length / 3
    outPos.push(v.p[0], v.p[1], v.p[2])
    if (outNrm && v.n) outNrm.push(v.n[0], v.n[1], v.n[2])
    if (outUv && v.uv) outUv.push(v.uv[0], v.uv[1])
    welded.set(v.key, index)
    return index
  }

  const clipPolygon = (poly, plane, planeId) => {
    const inside = (v) => plane.dir * (v.p[plane.axis] - plane.value) >= 0
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const ain = inside(a)
      if (ain) out.push(a)
      if (ain === inside(b)) continue
      const da = a.p[plane.axis] - plane.value
      const db = b.p[plane.axis] - plane.value
      const t = da === db ? 0 : da / (da - db)
      const keys = [a.key, b.key].sort()
      out.push({
        p: a.p.map((v, k) => v + (b.p[k] - v) * t),
        n: a.n && b.n ? a.n.map((v, k) => v + (b.n[k] - v) * t) : null,
        uv: a.uv && b.uv ? a.uv.map((v, k) => v + (b.uv[k] - v) * t) : null,
        key: `e${planeId}_${keys[0]}_${keys[1]}`,
      })
    }
    return out
  }

  for (const t of triangleIds) {
    let poly = [0, 1, 2].map((k) => {
      const vi = indices[t * 3 + k]
      return {
        p: [position[vi * 3], position[vi * 3 + 1], position[vi * 3 + 2]],
        n: normal ? [normal[vi * 3], normal[vi * 3 + 1], normal[vi * 3 + 2]] : null,
        uv: uv ? [uv[vi * 2], uv[vi * 2 + 1]] : null,
        key: `v${vi}`,
      }
    })
    for (let i = 0; i < planes.length; i++) {
      poly = clipPolygon(poly, planes[i], i)
      if (poly.length < 3) break
    }
    if (poly.length < 3) continue

    for (let i = 1; i + 1 < poly.length; i++) {
      outIdx.push(emit(poly[0]), emit(poly[i]), emit(poly[i + 1]))
    }
  }

  return {
    position: new Float32Array(outPos),
    normal: outNrm ? new Float32Array(outNrm) : null,
    uv: outUv ? new Float32Array(outUv) : null,
    indices: new Uint32Array(outIdx),
    vertices: outPos.length / 3,
  }
}

/** 把两块几何首尾接起来（索引整体平移），用于「盒内剩下的 + 盒外裁下来的」拼回一块 */
function concatParts(a, b) {
  if (!a || a.position.length === 0) return b
  if (!b || b.position.length === 0) return a
  const offset = a.position.length / 3
  const position = new Float32Array(a.position.length + b.position.length)
  position.set(a.position)
  position.set(b.position, a.position.length)

  let normal = null
  if (a.normal && b.normal) {
    normal = new Float32Array(a.normal.length + b.normal.length)
    normal.set(a.normal)
    normal.set(b.normal, a.normal.length)
  }
  let uv = null
  if (a.uv && b.uv) {
    uv = new Float32Array(a.uv.length + b.uv.length)
    uv.set(a.uv)
    uv.set(b.uv, a.uv.length)
  }
  const indices = new Uint32Array(a.indices.length + b.indices.length)
  indices.set(a.indices)
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + offset

  return { position, normal, uv, indices, vertices: position.length / 3 }
}

/**
 * 按「朝向 + 包围盒归一化范围」圈出一块面，返回**两套完整几何**（选中的 / 剩下的）。
 *
 * 位置范围那几条边界会用 `clipGeometry` 真正**切开**，不是整块三角形丢掉 ——
 * 这样打印区的上沿是一条精确的直线，而不是一条锯齿。
 * 剩下的那块 = 「盒内但朝向不符的」+「盒外的」，两者拼起来正好补齐整张面，不会有洞。
 */
function splitByRegion(position, normal, uv, indices, triangleIds, spec) {
  const axis = AXIS_VECTORS[spec.axis ?? '+z'] ?? AXIS_VECTORS['+z']
  const cos = Number.isFinite(spec.cos) ? spec.cos : 0.7

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const t of triangleIds) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      for (let a = 0; a < 3; a++) {
        const value = position[v * 3 + a]
        if (value < min[a]) min[a] = value
        if (value > max[a]) max[a] = value
      }
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

  // `r=` 的半径区间：和 x/y/z 一样归一化，**1.0 = 该区域顶点里离 center 最远的那个**，
  // 所以换模型 / 换单位都不用改参数。center 用**绝对坐标**给，且必须是**世界坐标**
  // ——`position` 在这里已经被父节点的变换乘过了（`center=1.6583,0.1069`），
  // 不给就默认用包围盒中心。
  //
  // 这一条是给「扇环 / 环带」这类**轴对齐包围盒圈不出来**的区域准备的（比如绕轴一圈的
  // 环状图案区）。加它的时候正在拆折扇，一度以为扇面得靠半径圈 —— 但实测**扇面不需要**：
  // 扇面内弧在网格里本来就是它自己的边界，靠「朝向 + 高度」两刀就干净分开了。
  // 所以这条目前**没有正式模型在用**，
  // 留着是补工具这块缺口，真要用先拿 `--dry` 核对面数与目视分类图。
  let radial = null
  if (spec.r) {
    const ccx = spec.center ? spec.center[0] : (min[0] + max[0]) / 2
    const ccy = spec.center ? spec.center[1] : (min[1] + max[1]) / 2
    let rMax = 0
    for (const t of triangleIds) {
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k]
        const d = Math.hypot(position[v * 3] - ccx, position[v * 3 + 1] - ccy)
        if (d > rMax) rMax = d
      }
    }
    if (rMax > 1e-9) radial = { cx: ccx, cy: ccy, lo: spec.r[0] * rMax, hi: spec.r[1] * rMax }
  }

  // 归一化区间 → 轴对齐的半空间；区间两端贴到 0 / 1 就不生成平面（没有可切的）
  const ranges = [spec.x, spec.y, spec.z]
  const planes = []
  for (let a = 0; a < 3; a++) {
    const range = ranges[a]
    if (!range || size[a] < 1e-9) continue
    if (range[0] > 0) planes.push({ axis: a, dir: 1, value: min[a] + range[0] * size[a] })
    if (range[1] < 1) planes.push({ axis: a, dir: -1, value: min[a] + range[1] * size[a] })
  }

  const inside = planes.length
    ? clipGeometry(position, normal, uv, indices, triangleIds, planes)
    : buildSubPart(position, normal, uv, indices, triangleIds)

  const picked = []
  const rest = []
  const triCount = inside.indices.length / 3
  let radialCut = 0
  for (let t = 0; t < triCount; t++) {
    const m = triangleMetrics(inside.position, inside.indices, t)
    const facing = m.nx * axis[0] + m.ny * axis[1] + m.nz * axis[2]
    let ok = facing >= cos
    // ⚠️ 半径这一条是**按三角形重心整块归类**，不做几何裁切 —— 和 x/y/z 那几条
    // 「用平面真切开」不同。原因：半径边界在真实模型里通常正好是**网格自己的边界**
    // （叶子与梗在这里天然断开），每块三角形要么整个在内、要么整个在外，裁切是空操作；
    // 而「圆外」不是凸区域，硬塞进 Sutherland–Hodgman 反而会把跨越圆边的三角形
    // 接成错误的形状。
    if (ok && radial) {
      const d = Math.hypot(m.cx - radial.cx, m.cy - radial.cy)
      if (d < radial.lo || d > radial.hi) {
        ok = false
        radialCut += 1
      }
    }
    ;(ok ? picked : rest).push(t)
  }

  const pickedGeo = buildSubPart(inside.position, inside.normal, inside.uv, inside.indices, picked)
  let restGeo = buildSubPart(inside.position, inside.normal, inside.uv, inside.indices, rest)
  if (planes.length) {
    // ⚠️ 补集不能「把所有平面一起翻过来裁」—— 那样得到的是**对面那个盒子**（交集），
    // 会漏掉大部分面。正确做法是把补集拆成若干凸块：
    //   第 i 块 = 满足前 i 个平面、但落在第 i 个平面外侧
    // 这些块两两不重叠，合起来正好是「盒外」，配上「盒内」就补齐整张面，一个洞都不漏。
    for (let i = 0; i < planes.length; i++) {
      const piece = clipGeometry(position, normal, uv, indices, triangleIds, [
        ...planes.slice(0, i),
        { axis: planes[i].axis, dir: -planes[i].dir, value: planes[i].value },
      ])
      restGeo = concatParts(restGeo, piece)
    }
  }

  return { picked: pickedGeo, rest: restGeo, min, max, size, planes, triCount, radialCut: radial ? radialCut : 0 }
}

/**
 * 按「保留哪些原顶点」重新打包一块面。
 * 顶点做了压缩重排（只留用到的），索引同步重映射；UV/NORMAL 一起搬过去。
 */
function buildSubPart(position, normal, uv, indices, triangleIds) {
  const map = new Map()
  const outIndex = new Uint32Array(triangleIds.length * 3)
  let cursor = 0
  for (const t of triangleIds) {
    for (let k = 0; k < 3; k++) {
      const src = indices[t * 3 + k]
      let dst = map.get(src)
      if (dst === undefined) {
        dst = map.size
        map.set(src, dst)
      }
      outIndex[cursor++] = dst
    }
  }

  const count = map.size
  const outPosition = new Float32Array(count * 3)
  const outNormal = normal ? new Float32Array(count * 3) : null
  const outUv = uv ? new Float32Array(count * 2) : null
  for (const [src, dst] of map) {
    outPosition[dst * 3] = position[src * 3]
    outPosition[dst * 3 + 1] = position[src * 3 + 1]
    outPosition[dst * 3 + 2] = position[src * 3 + 2]
    if (outNormal && normal) {
      outNormal[dst * 3] = normal[src * 3]
      outNormal[dst * 3 + 1] = normal[src * 3 + 1]
      outNormal[dst * 3 + 2] = normal[src * 3 + 2]
    }
    if (outUv && uv) {
      outUv[dst * 2] = uv[src * 2]
      outUv[dst * 2 + 1] = uv[src * 2 + 1]
    }
  }

  return { position: outPosition, normal: outNormal, uv: outUv, indices: outIndex, vertices: count }
}

/**
 * 把「材质里那张 baseColor 贴图在三角形 UV 处的采样色落在指定范围」的面拆出来。
 *
 * 用途：`--extract-by-color "node_0=fan_face;min=205"`
 *
 * 为什么需要它：第四种情况 —— **模型自带烘焙贴图**（扫描件 / AI 上色件）。
 * 实测团扇 `fan_b.glb`：50000 面是**一个连通块**，而且整块都带 UV 和一张 4096² 的贴图集
 * （木纹、雕花边、白绢面全都烤在同一张图上）。这种模型里「白绢面」既不是独立零件、
 * 也不是一个朝向能圈出来的区域 —— 唯一的可靠特征是**「这块面在贴图里是白的」**。
 *
 * 判据要写成「**中性浅色**」而不是「白」：每个通道都亮（`min`）**且**通道差小（`tol`）。
 *   · 白绢（含被烘焙阴影压暗的那几层）：min 高、通道差小（实测 ≤ 16）；
 *   · 雕花边框与竹柄：暖色木头，通道差很大（实测 ≥ 40），min 再高也进不来。
 * 只用 `min>200` 会**只圈到白绢的外表面**（实测 7353 面）—— 白绢本身是**两层薄片**，
 * 被压暗的那几层 min 落在 150~200 之间，会留在扇框里；后果是**扇子背面看不到正面的图案**
 * （背面那层没被换 UV，还贴着原来的贴图集）。放宽成「min>150 且 tol≤16」一次圈到 9097 面，
 * 正好是**两个完整的圆盘**（前层 + 后层），背面才跟着一起上色。
 *
 * ⚠️ 采样点用**三角形 UV 的重心**。贴图集里各块之间是分开的 UV 岛，所以边界三角形
 * 不会骑在两种颜色中间 —— 分类天然是「按三角形」的，不会出现半块面。
 * ⚠️ 阈值要**逐点扫**（1 或 0.5 一档），并配一张**目视分类图**交叉验证。
 * **不要只看两三个阈值就断言「平台」** —— 实测 min 从 196 扫到 216 是**连续衰减**
 * （200→7353、205→1115、207→4），根本没有平台；当初就是只采了 200 与 210 两点，
 * 误判成「平台在 200~210」，结果只圈到 1115 面。
 */

const decodedImageCache = new Map()

/** 解码 GLB 里第 imageIndex 张内嵌图片（结果缓存 —— 分区和压缩两步都要用，别解两遍） */
function decodeImageAt(json, bin, imageIndex) {
  if (decodedImageCache.has(imageIndex)) return decodedImageCache.get(imageIndex)

  const image = json.images?.[imageIndex]
  if (!image) throw new Error(`贴图引用了不存在的图片 ${imageIndex}`)
  if (image.bufferView === undefined) {
    throw new Error(`图片 ${imageIndex} 用的是外部文件 uri（${image.uri}），请先把贴图内嵌进 GLB`)
  }
  const type = image.mimeType || 'image/png'
  if (!/png/i.test(type)) {
    throw new Error(`只能读 PNG，这张图片是 ${type}（先去别处转成 PNG 再导出）`)
  }
  const view = json.bufferViews[image.bufferView]
  const start = view.byteOffset ?? 0
  const decoded = decodePng(bin.subarray(start, start + view.byteLength))
  decodedImageCache.set(imageIndex, decoded)
  return decoded
}

/** 取某个材质 baseColorTexture 对应的图片并解码 */
function baseColorImageOf(json, bin, materialIndex) {
  const material = materialIndex === undefined ? null : json.materials?.[materialIndex]
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index
  if (textureIndex === undefined) return null
  const imageIndex = json.textures?.[textureIndex]?.source
  if (imageIndex === undefined) return null
  return decodeImageAt(json, bin, imageIndex)
}

function splitByTextureColor(position, uv, indices, triangleIds, spec, image) {
  const picked = []
  const rest = []
  const sample = (u, v) => {
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)))
    const y = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)))
    return (y * image.width + x) * 4
  }

  for (const t of triangleIds) {
    const a = indices[t * 3]
    const b = indices[t * 3 + 1]
    const c = indices[t * 3 + 2]
    const u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3
    const v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3
    const at = sample(u, v)
    const r = image.data[at]
    const g = image.data[at + 1]
    const bl = image.data[at + 2]
    const low = Math.min(r, g, bl)
    const high = Math.max(r, g, bl)
    const inside = low > spec.min && high <= spec.max && high - low <= spec.tol
    ;(inside ? picked : rest).push(t)
  }

  return { picked, rest }
}

/** 一块面的 XZ 包围盒中心，作为柱面展开 / 判内外时的轴心 */
function axisOf(position, indices, triangleIds) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const t of triangleIds) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      const x = position[v * 3]
      const z = position[v * 3 + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  return { axisX: (minX + maxX) / 2, axisZ: (minZ + maxZ) / 2, spanX: maxX - minX, spanZ: maxZ - minZ }
}

// --------------------------------------------------------------- UV 生成

/**
 * 生成 UV。返回 { uv, indices, vertices }：
 * 接缝处会把顶点**拆开**（同一个顶点在接缝两侧各留一份），
 * 否则跨越 0/1 的三角形会把整张贴图反向压缩成一条带，非常显眼。
 */
function buildUv({ position, index, projection, bounds }) {
  const vertexCount = position.length / 3
  const uv = new Float32Array(vertexCount * 2)
  const [min, max] = bounds
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const safe = (v) => (v === 0 ? 1 : v)
  // 柱面投影一定要绕「这个部位自己的轴」转，不能绕场景原点 ——
  // 模型在导出时常常整体平移过（Max 导出器会塞一层平移矩阵），
  // 绕原点转会让图案一侧被压扁、另一侧被拉长。用 XZ 包围盒中心当轴心。
  const axisX = (min[0] + max[0]) / 2
  const axisZ = (min[2] + max[2]) / 2

  const rawU = new Float32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    const x = position[i * 3]
    const y = position[i * 3 + 1]
    const z = position[i * 3 + 2]
    let u
    let v
    if (projection === 'cylinder-y') {
      // θ 从 +Z（正面）起算，所以图案中心正对相机；接缝落在 θ = ±π 也就是 -Z（背面）
      const theta = Math.atan2(x - axisX, z - axisZ)
      u = (theta + Math.PI) / (2 * Math.PI)
      v = 1 - (y - min[1]) / safe(size[1])
    } else if (projection === 'planar-x') {
      u = (z - min[2]) / safe(size[2])
      v = 1 - (y - min[1]) / safe(size[1])
    } else if (projection === 'planar-z-back') {
      // 「从背面看」的那块面：观察点在对侧的 -Z，X 轴在屏幕上左右相反，
      // u 不翻转的话图案会左右镜像（印章跑到另一边、文字是反的）。
      // v 不用动 —— 上下与站在前面还是后面无关。
      u = 1 - (x - min[0]) / safe(size[0])
      v = 1 - (y - min[1]) / safe(size[1])
    } else if (projection === 'planar-y') {
      u = (x - min[0]) / safe(size[0])
      v = 1 - (z - min[2]) / safe(size[2])
    } else {
      u = (x - min[0]) / safe(size[0])
      v = 1 - (y - min[1]) / safe(size[1])
    }
    rawU[i] = u
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }

  // 无索引：顶点一一对应，不用管接缝
  if (!index) return { uv, indices: null }

  const keyed = new Map()
  const outIndices = new Uint32Array(index.length)
  const extraUv = []
  const extraIndex = []

  const resolve = (vertexIndex, shift) => {
    if (shift === 0) return vertexIndex
    const key = `${vertexIndex}#1`
    const found = keyed.get(key)
    if (found !== undefined) return found
    const next = vertexCount + extraUv.length
    keyed.set(key, next)
    extraUv.push(uv[vertexIndex * 2] + 1) // 往右挪一整圈，Repeat 采样下与 0 相接
    extraIndex.push(vertexIndex)
    return next
  }

  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]
    const b = index[t + 1]
    const c = index[t + 2]
    const us = [rawU[a], rawU[b], rawU[c]]
    const spread = Math.max(...us) - Math.min(...us)
    // 跨越接缝的三角形：把 u 小的那几个 +1，让插值走「短边」而不是绕整圈反向
    const shift = spread > 0.5
    outIndices[t] = resolve(a, shift && us[0] < 0.5 ? 1 : 0)
    outIndices[t + 1] = resolve(b, shift && us[1] < 0.5 ? 1 : 0)
    outIndices[t + 2] = resolve(c, shift && us[2] < 0.5 ? 1 : 0)
  }

  if (extraUv.length === 0) return { uv, indices: outIndices }

  const mergedUv = new Float32Array((vertexCount + extraUv.length) * 2)
  mergedUv.set(uv)
  for (let i = 0; i < extraUv.length; i++) {
    const src = extraIndex[i]
    mergedUv[(vertexCount + i) * 2] = extraUv[i]
    mergedUv[(vertexCount + i) * 2 + 1] = uv[src * 2 + 1]
  }
  return { uv: mergedUv, indices: outIndices, duplicated: extraUv.length, duplicatedFrom: extraIndex }
}

// --------------------------------------------------------------- 写 GLB

function writeGlb(gltf, binary) {
  const jsonChunk = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPadded = Buffer.concat([jsonChunk, Buffer.alloc(pad4(jsonChunk.length), 0x20)])
  const binPadded = Buffer.concat([binary, Buffer.alloc(pad4(binary.length))])

  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded])
}

// --------------------------------------------------------------- 主流程

function main() {
  const argv = process.argv.slice(2)
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const positional = argv.filter((a) => !a.startsWith('--'))
  const outIndex = argv.indexOf('--out')

  const input = positional[0]
  if (!input) {
    console.error('用法：node scripts/fix-model.mjs <输入.glb> [--out <输出.glb>] [--force] [--dry]')
    console.error('      [--island-names <零件>=<名1>,<名2>] [--extract-inner <零件>=<新名>]')
    console.error('      [--extract-region <零件>=<新名>;axis=+z;cos=0.7;y=0~0.53]')
    console.error('      [--extract-by-color <零件>=<新名>;min=205;max=255;tol=255]')
    console.error('      [--uv-force <零件>[,<零件>...]] [--material <零件>=keep|clean]')
    console.error('      [--texture-size <像素>] [--rename <旧名>=<新名>]')
    process.exit(1)
  }
  const dry = flags.has('--dry')
  const force = flags.has('--force')
  const output = outIndex >= 0 ? argv[outIndex + 1] : input

  /** 收 --flag A=B 形式的参数（可重复给） */
  const pairsOf = (flag) => {
    const list = []
    argv.forEach((item, i) => {
      if (item !== flag) return
      const raw = argv[i + 1]
      if (!raw) throw new Error(`${flag} 后面要跟 <零件>=<新名字>`)
      const at = raw.indexOf('=')
      if (at <= 0) throw new Error(`${flag} 的写法是 <零件>=<新名字>，收到的是 "${raw}"`)
      list.push({ source: raw.slice(0, at).trim(), target: raw.slice(at + 1).trim() })
    })
    return list
  }
  // 一个零件可以有多个连通块，所以值是逗号分隔的名字列表（按「块从大到小」依次对应）
  const islandRules = pairsOf('--island-names').map((rule) => ({
    source: rule.source,
    names: rule.target.split(',').map((v) => v.trim()).filter(Boolean),
  }))
  const innerRules = pairsOf('--extract-inner')
  const renameRules = pairsOf('--rename')
  // `--extract-region "零件=新名;axis=+z;cos=0.7;y=0~0.53"`：分号后面是参数表
  const regionRules = pairsOf('--extract-region').map((rule) => {
    const [head, ...params] = rule.target.split(';')
    const spec = { axis: '+z', cos: 0.7, x: null, y: null, z: null, r: null, center: null }
    for (const item of params) {
      const at = item.indexOf('=')
      if (at <= 0) continue
      const key = item.slice(0, at).trim().toLowerCase()
      const raw = item.slice(at + 1).trim()
      if (key === 'axis') spec.axis = raw.toLowerCase()
      else if (key === 'cos') spec.cos = Number(raw)
      else if (key === 'x' || key === 'y' || key === 'z') spec[key] = parseRange(raw)
      // `r=0.30~1`：到 `center` 的**平面距离**（不是三维距离）。轴对齐的包围盒
      // 圈不出「扇环」这类区域 —— 折扇的扇面就是绕扇钉的一段环，只能用半径圈。
      else if (key === 'r') spec.r = parseRange(raw)
      else if (key === 'center') {
        const pair = raw.split(',').map((value) => Number(value.trim()))
        if (pair.length === 2 && pair.every(Number.isFinite)) spec.center = pair
      }
    }
    return { source: rule.source, target: head.trim(), spec }
  })

  // `--extract-by-color "零件=新名;min=205"`：按材质自带贴图的采样色分区
  const colorRules = pairsOf('--extract-by-color').map((rule) => {
    const [head, ...params] = rule.target.split(';')
    const spec = { min: 200, max: 255, tol: 255 }
    for (const item of params) {
      const at = item.indexOf('=')
      if (at <= 0) continue
      const key = item.slice(0, at).trim().toLowerCase()
      const raw = item.slice(at + 1).trim()
      if (key === 'min' || key === 'max' || key === 'tol') spec[key] = Number(raw)
    }
    return { source: rule.source, target: head.trim(), spec }
  })

  // `--uv-force "fan_face,fan_body"`：点名对某些零件强制重算 UV（默认是「已有就保留」）
  const forceUvParts = new Set(
    argv
      .flatMap((item, i) => (item === '--uv-force' && argv[i + 1] ? argv[i + 1].split(',') : []))
      .map((value) => value.trim())
      .filter(Boolean),
  )

  // `--material "fan_body=keep"`：每个零件的材质处理方式
  const MATERIAL_MODES = ['keep', 'clean', 'wood']
  const materialModes = new Map(
    pairsOf('--material').map((rule) => {
      const mode = rule.target.toLowerCase()
      if (!MATERIAL_MODES.includes(mode)) {
        throw new Error(
          `--material 只认 ${MATERIAL_MODES.join(' / ')}，收到 "${rule.target}"`
          + '（keep = 原样保留 / clean = 清掉贴图 / wood = 烤木色）',
        )
      }
      return [rule.source, mode]
    }),
  )

  const textureArg = argv.indexOf('--texture-size')
  const textureSize = textureArg >= 0 ? Number(argv[textureArg + 1]) || 0 : 0

  const source = parseGlb(fs.readFileSync(input))
  const json = source.json
  const bin = source.bin
  if (!bin) throw new Error('GLB 里没有 BIN chunk，无法处理几何数据')

  const instances = collectInstances(json)
  console.log(`\n输入  ${path.basename(input)}  ${(fs.statSync(input).size / 1024).toFixed(1)} KB`)
  console.log(`      共 ${instances.length} 个 mesh 实例\n`)

  const outBinaryParts = []
  let byteLength = 0
  const outBufferViews = []
  const outAccessors = []
  const outMeshes = []
  const outNodes = []
  const outMaterials = []

  const pushView = (typedArray, target) => {
    const padding = pad4(byteLength)
    if (padding) {
      outBinaryParts.push(Buffer.alloc(padding))
      byteLength += padding
    }
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
    const byteOffset = byteLength
    outBinaryParts.push(bytes)
    byteLength += bytes.byteLength
    outBufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target })
    return outBufferViews.length - 1
  }

  const report = []

  // ---------------------------------------------------------- 贴图搬运 / 压缩
  //
  // ⚠️ 这一步是后来补的，之前**漏了**：脚本只重建几何，`images` / `textures` / `samplers`
  // 全都没搬过去。对白模没影响（本来就没贴图），但「模型自带烘焙贴图」的模型（扫描件 /
  // AI 上色件）会被悄悄弄坏 —— 材质的 `baseColorTexture.index` 指向一张不存在的图片，
  // 网页端加载出来就是没有贴图的素模，而且**不报错**，很难发现。
  //
  // ⚠️ 「搬哪些贴图」必须等材质全部生成之后才能算 —— 见下方「贴图搬运 / 压缩」一节。
  // 拆分出来的零件名（bag_front / cup_inner…）是在 `instances.forEach` 里才产生的，
  // 这里还不存在，所以没法提前按名字预判。
  const outImages = []
  const outTextures = []
  const outSamplers = []

  /**
   * 把一个零件写成 glTF 的 accessor / material / mesh / node。
   * 拆分（--island-names / --extract-inner）之后，同一个输入零件会产出多个输出零件，
   * 所以这段抽出来复用。position / normal 会被「补 UV 时拆接缝点」这一步重新赋值，
   * 因此是参数而不是闭包变量。
   */
  const emitPart = (name, position, normal, srcUv, srcIndex, sourceMaterial, splitNote) => {
    let indices
    let uv
    const vertexCount = position.length / 3
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < vertexCount; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = position[i * 3 + axis]
        if (value < min[axis]) min[axis] = value
        if (value > max[axis]) max[axis] = value
      }
    }

    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const shape = size.map((v) => v.toFixed(3)).join(' × ')

    let uvNote
    // 「已有 UV 就原样保留」是默认策略 —— 用户在 Max 里做过 UVW 展开的不该被覆盖。
    // 但自带烘焙贴图的模型里，打印区那块必须**换成平面展开**（贴图集的 UV 撕不开、
    // 直接拿来贴图会四分之一角上一小块），所以给一个按零件点名的强制重算开关。
    const reproject = force || forceUvParts.has(name)
    if (srcUv && !reproject) {
      uv = new Float32Array(srcUv.length)
      uv.set(srcUv)
      indices = srcIndex ? Uint32Array.from(srcIndex) : null
      uvNote = '已有 UV，原样保留'
    } else {
      const projection = projectionFor(name, [min, max])
      const used = projection === 'auto' ? autoProjection(size) : projection
      const built = buildUv({
        position,
        index: srcIndex ? Uint32Array.from(srcIndex) : null,
        projection: used,
        bounds: [min, max],
      })
      uv = built.uv
      indices = built.indices
      uvNote = `补 UV（${used}）${srcUv ? '，覆盖原有 UV' : ''}`
      if (built.duplicated) uvNote += `，接缝拆点 +${built.duplicated}`

      // 拆点后顶点变多了，多出来的顶点坐标从被拆的那个顶点复制过来
      if (built.duplicatedFrom) {
        const base = vertexCount
        const grownPosition = new Float32Array(uv.length / 2 * 3)
        grownPosition.set(position)
        const grownNormal = normal ? new Float32Array(uv.length / 2 * 3) : null
        if (grownNormal) grownNormal.set(normal)
        built.duplicatedFrom.forEach((src, k) => {
          const dst = base + k
          grownPosition[dst * 3] = position[src * 3]
          grownPosition[dst * 3 + 1] = position[src * 3 + 1]
          grownPosition[dst * 3 + 2] = position[src * 3 + 2]
          if (grownNormal && normal) {
            grownNormal[dst * 3] = normal[src * 3]
            grownNormal[dst * 3 + 1] = normal[src * 3 + 1]
            grownNormal[dst * 3 + 2] = normal[src * 3 + 2]
          }
        })
        position = grownPosition
        if (grownNormal) normal = grownNormal
      }
    }

    if (!indices) {
      indices = new Uint32Array(position.length / 3)
      for (let i = 0; i < indices.length; i++) indices[i] = i
    }

    // 连通块体检：一个部位本该是一块连着的面。分出来好几块，通常意味着
    // 拆分时多选/漏选了面（实测：茶杯的杯底被一起选进了把手）。
    const allClusters = clusterize(position, indices)
    const weldedTotal = allClusters.reduce((sum, group) => sum + group.length, 0) || 1
    const clusters = allClusters
      .filter((group) => group.length >= weldedTotal * 0.08)
      .map((group) => {
        const cmin = [Infinity, Infinity, Infinity]
        const cmax = [-Infinity, -Infinity, -Infinity]
        for (const v of group) {
          for (let axis = 0; axis < 3; axis++) {
            const value = position[v * 3 + axis]
            if (value < cmin[axis]) cmin[axis] = value
            if (value > cmax[axis]) cmax[axis] = value
          }
        }
        const csize = cmax.map((v, k) => v - cmin[k])
        return {
          count: group.length,
          size: csize.map((v) => v.toFixed(3)).join(' × '),
          center: cmin.map((v, k) => (v + cmax[k]) / 2),
        }
      })

    // 索引的位宽：顶点数装得下就用 16 位。glTF 两种都合法，省下来的体积是实打实的
    // （团扇 5 万面：uint32 → uint16 少了约 300 KB，占整个文件的近 10%）。
    let indexData = indices
    let indexComponentType = 5125
    let maxIndex = 0
    for (let i = 0; i < indices.length; i++) if (indices[i] > maxIndex) maxIndex = indices[i]
    if (maxIndex < 65536) {
      indexData = Uint16Array.from(indices)
      indexComponentType = 5123
    }

    const positionView = pushView(position, 34962)
    const normalView = normal ? pushView(normal, 34962) : null
    const uvView = pushView(uv, 34962)
    const indexView = pushView(indexData, 34963)

    const accessorBase = outAccessors.length
    outAccessors.push(
      { bufferView: positionView, componentType: 5126, count: position.length / 3, type: 'VEC3', min, max },
    )
    const normalAccessor = normalView !== null ? outAccessors.length : -1
    if (normalView !== null) {
      outAccessors.push({ bufferView: normalView, componentType: 5126, count: normal.length / 3, type: 'VEC3' })
    }
    const uvAccessor = outAccessors.length
    outAccessors.push({ bufferView: uvView, componentType: 5126, count: uv.length / 2, type: 'VEC2' })
    const indexAccessor = outAccessors.length
    outAccessors.push({
      bufferView: indexView, componentType: indexComponentType, count: indices.length, type: 'SCALAR',
    })

    // 材质：按部位各给一个，并沿用部位名（部位识别也认 mesh 名，两边同名最好查）。
    //
    // 默认档（不写 --material）：颜色归白、金属度/粗糙度归到「瓷感」。
    //   归白是因为网页端会用调色板里的颜色覆盖 material.color；
    //   归金属度是因为 glTF 缺省 metallic = 1，会渲染成一坨发暗的金属块。
    //   釉面那种「亮」由网页端的「表面质感」档位随时切换，不写死在模型里。
    // keep：**原样保留**模型自带的材质 —— 烘焙贴图、metallic/roughness 因子一个都不动。
    //   给「扫描件 / AI 上色件」里那些不该被网页端碰的零件用（如团扇的木质扇框与竹柄）。
    //   `doubleSided` 也照原样，不强行改成 true。
    // clean：**清掉所有贴图**，只留白坯 + 瓷感数值。
    //   给「网页端自己要贴图 / 自己要上色」的零件用 —— 自带贴图（贴图集、法线图）留着的话
    //   会把用户上传的图案一起染上，而且法线图是按旧 UV 烘的，换成平面展开后完全对不上。
    // wood：**把「木色 + 木质数值」直接烤进 GLB**。
    //   给 AI 直接生成、一个贴图都没有的零件用（折扇的扇骨 / 扇柄就是这种：50000 面、
    //   单一灰材质、零贴图）。网页端的「表面质感」档位只改 metalness/roughness/clearcoat，
    //   **颜色走调色板** —— 而扇骨要和扇面（跟着用户选的底色走）分开，必须是固定的木色，
    //   所以只能烤进模型，再由 preset 的 `keepOriginalParts` 原样保留。
    //   这一档必须**和 `keepOriginalParts` 配对使用**：不保留的话网页端一上来就用调色板
    //   把颜色覆盖掉，木色白烤。
    //
    //   ⚠️ `baseColorFactor` 是**线性空间**，不是 sRGB 十六进制。想用 #A87B4F 这种木色，
    //   得先做 sRGB→线性（`srgbToLinear`），直接写 0.66/0.48/0.31 会渲染成一片惨白。
    const mode = materialModes.get(name) ?? 'default'
    const source = sourceMaterial ?? {}
    const materialIndex = outMaterials.length
    if (mode === 'keep') {
      outMaterials.push({ ...source, name })
    } else if (mode === 'clean') {
      outMaterials.push({
        name,
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.05, roughnessFactor: 0.65 },
        doubleSided: true,
      })
    } else if (mode === 'wood') {
      outMaterials.push({
        name,
        pbrMetallicRoughness: {
          baseColorFactor: WOOD_HEX.map((v) => srgbToLinear(v)).concat(1),
          // 木头不是金属；粗糙度 0.7 = 打磨过但没上亮漆的木头。
          //
          // ⚠️ 为什么不用更光的 0.4~0.5（「抛光竹骨」更真实）：本项目的影棚环境贴图
          //   相当强，而扇骨是**一堆薄片**、法向还都差不多，低粗糙度下它们会**同时**
          //   把环境里那块亮面反射进镜头 → 整簇扇骨发白，木色全被盖掉（实测过 0.48，
          //   渲染出来是一片灰白）。0.7 把高光摊开，底色才压得住。
          //   想要更亮的话调这个数之前先看 `docs/联调截图/fan_a-贴图验证-*.png`。
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
        doubleSided: true,
      })
    } else {
      outMaterials.push({
        ...source,
        name,
        pbrMetallicRoughness: {
          ...(source.pbrMetallicRoughness ?? {}),
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.65,
        },
        doubleSided: true,
      })
    }

    const attributes = { POSITION: accessorBase, TEXCOORD_0: uvAccessor }
    if (normalAccessor >= 0) attributes.NORMAL = normalAccessor

    outMeshes.push({
      name,
      primitives: [{ attributes, indices: indexAccessor, material: materialIndex, mode: 4 }],
    })
    outNodes.push({ mesh: outMeshes.length - 1, name })

    report.push({
      partName: name,
      vertices: position.length / 3,
      triangles: indices.length / 3,
      shape,
      uvNote,
      splitNote,
      clusters,
    })
  }

  instances.forEach((instance) => {
    const partName = instance.name
    const primitive = instance.mesh.primitives[0]
    if (instance.mesh.primitives.length > 1) {
      console.log(`  ! ${partName} 有 ${instance.mesh.primitives.length} 个 primitive，只处理第一个`)
    }

    const srcPosition = readAccessor(json, bin, primitive.attributes.POSITION)
    const srcIndex = primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices) : null
    const srcNormal = primitive.attributes.NORMAL !== undefined
      ? readAccessor(json, bin, primitive.attributes.NORMAL)
      : null
    const srcUv = primitive.attributes.TEXCOORD_0 !== undefined
      ? readAccessor(json, bin, primitive.attributes.TEXCOORD_0)
      : null

    const vertexCount = srcPosition.length / 3
    const position = new Float32Array(srcPosition.length)
    const normal = srcNormal ? new Float32Array(srcNormal.length) : null

    for (let i = 0; i < vertexCount; i++) {
      const p = transformPoint(instance.world, srcPosition[i * 3], srcPosition[i * 3 + 1], srcPosition[i * 3 + 2])
      for (let axis = 0; axis < 3; axis++) position[i * 3 + axis] = p[axis]
      if (normal) {
        const n = transformDirection(instance.world, srcNormal[i * 3], srcNormal[i * 3 + 1], srcNormal[i * 3 + 2])
        const len = Math.hypot(n[0], n[1], n[2]) || 1
        normal[i * 3] = n[0] / len
        normal[i * 3 + 1] = n[1] / len
        normal[i * 3 + 2] = n[2] / len
      }
    }

    const sourceMaterial = primitive.material !== undefined ? json.materials?.[primitive.material] : null
    // 拆分算法统一用「一定有索引」的三角形表；补 UV 那一步仍然按原始状态走
    const triIndex = srcIndex
      ? Uint32Array.from(srcIndex)
      : Uint32Array.from({ length: vertexCount }, (_, i) => i)
    const allTriangles = () => Array.from({ length: triIndex.length / 3 }, (_, t) => t)

    // ---------------------------------------------------------- 拆分
    let groups = [{ name: partName, triangleIds: null }]

    const islandRule = islandRules.find((rule) => rule.source === partName)
    if (islandRule) {
      const islands = groupTrianglesByIsland(position, triIndex)
      if (islands.length <= 1) {
        console.log(`  · ${partName}：只有一个连通块，--island-names 没有可拆的`)
      } else {
        if (islandRule.names.length < islands.length) {
          throw new Error(
            `${partName} 拆出 ${islands.length} 个连通块，但 --island-names 只给了 ${islandRule.names.length} 个名字`,
          )
        }
        const total = islands.reduce((sum, group) => sum + group.length, 0) || 1
        console.log(`  · ${partName}：按连通块拆成 ${islands.length} 块`)
        islands.forEach((group, i) => {
          console.log(
            `      ${i + 1}. ${String(group.length).padStart(6)} 面 (${((group.length / total) * 100).toFixed(1)}%)`
            + ` → ${islandRule.names[i]}`,
          )
        })
        groups = islands.map((triangleIds, i) => ({ name: islandRule.names[i], triangleIds }))
      }
    }

    // 按「材质自带贴图在本三角形 UV 处的颜色」拆出一块（自带烘焙贴图的模型用这个）
    for (const colorRule of colorRules) {
      const expanded = []
      for (const group of groups) {
        if (group.name !== colorRule.source) {
          expanded.push(group)
          continue
        }
        const image = baseColorImageOf(json, bin, primitive.material)
        if (!image) {
          throw new Error(
            `${group.name} 的材质没有 baseColor 贴图，--extract-by-color 无从下手`
            + `（这个开关是按贴图颜色认区域的，只适用于自带烘焙贴图的模型）`,
          )
        }
        if (!group.geometry && !srcUv) {
          throw new Error(`${group.name} 没有 UV 坐标，没法按贴图颜色分区`)
        }
        const source = group.geometry ?? { position, normal, uv: srcUv, indices: triIndex }
        const triangleIds = group.geometry
          ? Array.from({ length: group.geometry.indices.length / 3 }, (_, t) => t)
          : (group.triangleIds ?? allTriangles())

        const result = splitByTextureColor(
          source.position, source.uv, source.indices, triangleIds, colorRule.spec, image,
        )
        const total = triangleIds.length || 1
        const { min, max, tol } = colorRule.spec
        if (result.picked.length === 0 || result.rest.length === 0
          || result.picked.length < total * 0.02) {
          console.log(
            `  · ${group.name}：按「贴图色 每通道 >${min} 且 ≤${max}，最大通道差 ≤${tol}」只圈到 `
            + `${result.picked.length} 面 / 剩 ${result.rest.length} 面，`
            + `不构成一次有意义的拆分，原样保留`,
          )
          expanded.push({ name: group.name, triangleIds: group.geometry ? null : group.triangleIds, geometry: group.geometry })
          continue
        }
        console.log(
          `  · ${group.name}：按「贴图色 每通道 >${min} 且 ≤${max}${tol < 255 ? `，最大通道差 ≤${tol}` : ''}」圈出 `
          + `${result.picked.length} 面 (${((result.picked.length / total) * 100).toFixed(1)}%) → ${colorRule.target}，`
          + `${result.rest.length} 面留在 ${group.name}`,
        )
        console.log(`      贴图 ${image.width}×${image.height}；阈值要**逐点扫**并配目视分类图交叉验证，别只看两三个点就断言「平台」`)
        expanded.push({
          name: colorRule.target,
          geometry: buildSubPart(source.position, source.normal, source.uv, source.indices, result.picked),
        })
        expanded.push({
          name: group.name,
          geometry: buildSubPart(source.position, source.normal, source.uv, source.indices, result.rest),
        })
      }
      groups = expanded
    }

    const innerRule = innerRules.find((rule) => rule.source === partName)
    if (innerRule) {
      const expanded = []
      for (const group of groups) {
        if (group.name !== innerRule.source) {
          expanded.push(group)
          continue
        }
        const triangleIds = group.triangleIds ?? allTriangles()
        const axis = axisOf(position, triIndex, triangleIds)
        const result = splitInnerOuter(position, triIndex, triangleIds, axis)
        const total = triangleIds.length || 1
        if (result.inner.length === 0 || result.outer.length === 0 || result.inner.length < total * 0.02) {
          console.log(
            `  · ${innerRule.source}：按法向没拆出内壁（朝里 ${result.inner.length} 面 / 朝外 ${result.outer.length} 面，`
            + `估计内壁半径 ${result.innerRadius.toFixed(3)}），原样保留`,
          )
          expanded.push({ name: group.name, triangleIds: null })
          continue
        }
        console.log(
          `  · ${innerRule.source}：按法向拆出内壁 —— 朝里 ${result.inner.length} 面 → ${innerRule.target}，`
          + `朝外 ${result.outer.length} 面留在 ${group.name}（估计内壁半径 ${result.innerRadius.toFixed(3)}）`,
        )
        expanded.push({ name: innerRule.target, triangleIds: result.inner })
        expanded.push({ name: group.name, triangleIds: result.outer })
      }
      groups = expanded
    }

    // 按「朝向 + 包围盒范围」圈出一块（软体模型划可贴区用这个）
    for (const regionRule of regionRules) {
      const expanded = []
      for (const group of groups) {
        if (group.name !== regionRule.source) {
          expanded.push(group)
          continue
        }
        // 上一步可能已经把这块拆成了独立几何，拆区域时以它为准
        const source = group.geometry ?? { position, normal, uv: srcUv, indices: triIndex }
        const triangleIds = group.geometry
          ? Array.from({ length: group.geometry.indices.length / 3 }, (_, t) => t)
          : (group.triangleIds ?? allTriangles())
        const result = splitByRegion(
          source.position, source.normal, source.uv, source.indices, triangleIds, regionRule.spec,
        )
        const total = triangleIds.length || 1
        const { axis, cos } = regionRule.spec
        const ranges = ['x', 'y', 'z']
          .filter((k) => regionRule.spec[k])
          .map((k) => `${k}=${regionRule.spec[k].join('~')}`)
          .concat(regionRule.spec.r ? [`r=${regionRule.spec.r.join('~')}`] : [])
          .join(' ')
        if (result.picked.indices.length === 0 || result.rest.indices.length === 0
          || result.picked.indices.length / 3 < total * 0.02) {
          console.log(
            `  · ${group.name}：按「朝向 ${axis}(cos≥${cos}) ${ranges}」只圈到 `
            + `${result.picked.indices.length / 3} 面 / 剩 ${result.rest.indices.length / 3} 面，`
            + `不构成一次有意义的拆分，原样保留`,
          )
          expanded.push({ name: group.name, triangleIds: group.geometry ? null : group.triangleIds, geometry: group.geometry })
          continue
        }
        console.log(
          `  · ${group.name}：按「朝向 ${axis}(cos≥${cos})${ranges ? ` ${ranges}` : ''}」圈出 `
          + `${result.picked.indices.length / 3} 面 → ${regionRule.target}，`
          + `${result.rest.indices.length / 3} 面留在 ${group.name}`,
        )
        console.log(
          `      整块尺寸 ${result.size.map((v) => v.toFixed(3)).join(' × ')}`
          + `（x/y/z 的区间都是相对它自己的包围盒按比例计的）`
          + (result.planes.length ? `，按 ${result.planes.length} 个平面切开（边界是直线，不是锯齿）` : ''),
        )
        expanded.push({ name: regionRule.target, geometry: result.picked })
        expanded.push({ name: group.name, geometry: result.rest })
      }
      groups = expanded
    }

    // 改名（给「拆分剩下的那块」用：node_0 → bag_body）
    for (const group of groups) {
      const rule = renameRules.find((item) => item.source === group.name)
      if (rule) group.name = rule.target
    }

    // ---------------------------------------------------------- 写出去
    for (const group of groups) {
      if (group.geometry) {
        emitPart(
          group.name,
          group.geometry.position,
          group.geometry.normal,
          group.geometry.uv,
          group.geometry.indices,
          sourceMaterial,
          `从 ${partName} 拆出（${group.geometry.vertices} 顶点）`,
        )
      } else if (group.triangleIds === null) {
        emitPart(group.name, position, normal, srcUv, srcIndex, sourceMaterial)
      } else {
        const sub = buildSubPart(position, normal, srcUv, triIndex, group.triangleIds)
        emitPart(
          group.name,
          sub.position,
          sub.normal,
          sub.uv,
          sub.indices,
          sourceMaterial,
          `从 ${partName} 拆出（${sub.vertices} 顶点）`,
        )
      }
    }
  })

  // ---------------------------------------------------------- 贴图搬运 / 压缩
  //
  // ⚠️ 这一步是后来补的，之前**漏了**：脚本只重建几何，`images` / `textures` / `samplers`
  // 全都没搬过去。对白模没影响（本来就没贴图），但「模型自带烘焙贴图」的模型（扫描件 /
  // AI 上色件）会被悄悄弄坏 —— 材质的 `baseColorTexture.index` 指向一张不存在的图片，
  // 网页端加载出来就是没有贴图的素模，而且**不报错**，很难发现。
  //
  // ⚠️⚠️ 而「搬哪些」必须放在这里（材质全部生成之后）：只有扫描最终的 `outMaterials`，
  // 才知道哪些贴图真的还有引用者。零件全走 `clean` / `wood` 时（折扇扇面清掉自带烘焙图集、
  // 扇骨烤木色），源贴图集一个引用者都没有，照搬只会把文件撑大
  // （实测 `fan_a.glb` 被 3 张无人引用的烘焙图从 1.35 MB 撑到 **26.4 MB**）。
  // 拆分出来的零件名是在 `instances.forEach` 里才产生的，所以没法提前按名字预判。
  //
  // 搬运按**源下标升序**重排，`textures[].source` 与 `samplers[]` 的下标同步重映射，
  // 材质里那些 `{ index }` 最后统一改写。
  const textureRefHolders = []
  const collectTextureRefs = (node) => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue
      if (/Texture$/i.test(key)) {
        // `{ index, texCoord, extensions }` —— 贴图对象内部不会再有贴图，不用往下钻
        if (typeof value.index === 'number') textureRefHolders.push({ holder: value, oldIndex: value.index })
      } else if (!Array.isArray(value)) {
        collectTextureRefs(value)
      }
    }
  }
  outMaterials.forEach(collectTextureRefs)

  const usedTextureIndices = [...new Set(textureRefHolders.map((item) => item.oldIndex))]
    .sort((a, b) => a - b)
  const totalTextures = json.textures?.length ?? 0

  if (totalTextures > 0 && usedTextureIndices.length === 0) {
    console.log(`贴图：源文件 ${totalTextures} 张全都没有零件引用（都走 clean / wood），已丢弃\n`)
  } else if (usedTextureIndices.length < totalTextures) {
    console.log(
      `贴图：源文件 ${totalTextures} 张，其中 ${totalTextures - usedTextureIndices.length} 张没有零件引用，已丢弃`,
    )
  }

  const textureRemap = new Map()
  const imageRemap = new Map()
  const samplerRemap = new Map()

  if (usedTextureIndices.length > 0) {
    console.log('贴图')
    for (const oldTextureIndex of usedTextureIndices) {
      const texture = json.textures?.[oldTextureIndex]
      if (!texture) continue

      let newSampler
      if (texture.sampler !== undefined && json.samplers?.[texture.sampler]) {
        if (!samplerRemap.has(texture.sampler)) {
          samplerRemap.set(texture.sampler, outSamplers.length)
          outSamplers.push({ ...json.samplers[texture.sampler] })
        }
        newSampler = samplerRemap.get(texture.sampler)
      }

      let newSource
      if (texture.source !== undefined) {
        const oldImageIndex = texture.source
        if (!imageRemap.has(oldImageIndex)) {
          const image = json.images?.[oldImageIndex]
          if (!image) throw new Error(`贴图 ${oldTextureIndex} 指向不存在的图片 ${oldImageIndex}`)
          if (image.bufferView === undefined) {
            throw new Error(`图片 ${oldImageIndex} 用的是外部文件 uri（${image.uri}），请先把贴图内嵌进 GLB`)
          }
          const view = json.bufferViews[image.bufferView]
          const start = view.byteOffset ?? 0
          const original = bin.subarray(start, start + view.byteLength)
          let bytes = Buffer.from(original)
          const mimeType = image.mimeType || 'image/png'
          let note = `${(original.length / 1048576).toFixed(2)} MB`

          if (textureSize > 0 && /png/i.test(mimeType)) {
            const scaled = downscaleToAtMost(decodeImageAt(json, bin, oldImageIndex), textureSize)
            if (scaled.changed) {
              bytes = encodePng(scaled.image.width, scaled.image.height, scaled.image.data, { alpha: false })
              note += ` → ${scaled.image.width}×${scaled.image.height} ${(bytes.length / 1048576).toFixed(2)} MB`
                + `（1/${scaled.factor}，RGB 无 alpha）`
            }
          }

          imageRemap.set(oldImageIndex, outImages.length)
          outImages.push({ ...image, mimeType, bufferView: pushView(bytes, undefined) })
          console.log(`  ${String(oldImageIndex).padStart(2)}  ${note}`)
        }
        newSource = imageRemap.get(oldImageIndex)
      }

      textureRemap.set(oldTextureIndex, outTextures.length)
      outTextures.push({
        ...texture,
        ...(newSampler === undefined ? {} : { sampler: newSampler }),
        ...(newSource === undefined ? {} : { source: newSource }),
      })
    }
    console.log('')
  }

  // 材质里的 `{ index }` 原本指向**源文件**的 textures 下标，现在按新数组统一改写。
  // ⚠️ 用记下来的 oldIndex 而不是 holder.index —— `{...source}` 只做浅拷贝，
  // `baseColorTexture` 这类对象在多个零件之间是**共享同一个引用**的，
  // 直接读 holder.index 会在第二次改写时读到已经换掉的值。
  textureRefHolders.forEach(({ holder, oldIndex }) => {
    const mapped = textureRemap.get(oldIndex)
    if (mapped === undefined) throw new Error(`材质引用了贴图 ${oldIndex}，但它没被搬运（不该发生）`)
    holder.index = mapped
  })

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'wenchuang-fix-model',
      ...(json.asset?.copyright ? { copyright: json.asset.copyright } : {}),
    },
    scene: 0,
    scenes: [{ nodes: outNodes.map((_, i) => i) }],
    nodes: outNodes,
    meshes: outMeshes,
    materials: outMaterials,
    accessors: outAccessors,
    bufferViews: outBufferViews,
    buffers: [{ byteLength }],
    // 贴图相关的三个数组按原顺序 1:1 搬过来，材质里那些 index 才继续有效。
    // 空数组不写 —— 白模的 GLB 里多几个空数组只会让人以为它带贴图。
    ...(outImages.length ? { images: outImages } : {}),
    ...(outTextures.length ? { textures: outTextures } : {}),
    ...(outSamplers.length ? { samplers: outSamplers } : {}),
    // 材质 / 贴图上的扩展（KHR_texture_transform 之类）也是照搬的，声明得跟着走，
    // 否则读的人会以为文件没用到扩展。
    ...(json.extensionsUsed ? { extensionsUsed: json.extensionsUsed } : {}),
    ...(json.extensionsRequired ? { extensionsRequired: json.extensionsRequired } : {}),
  }

  const suspicious = []

  report.forEach((item) => {
    console.log(`  ${item.partName.padEnd(14)} ${String(item.triangles).padStart(7)} 面  ${item.shape.padEnd(22)} ${item.uvNote}`)
    if (item.splitNote) console.log(`                  ↳ ${item.splitNote}`)
    if (item.clusters.length > 1) {
      suspicious.push(item)
      console.log(`                  ⚠ 这个部位里有 ${item.clusters.length} 块互不相连的面：`)
      item.clusters.forEach((cluster, i) => {
        console.log(
          `                    ${i + 1}. ${String(cluster.count).padStart(6)} 点  尺寸 ${cluster.size}`
          + `  中心 (${cluster.center.map((v) => v.toFixed(3)).join(', ')})`,
        )
      })
    }
  })

  if (suspicious.length > 0) {
    console.log('\n⚠ 上面这些部位里有多块互不相连的面，典型症状：')
    console.log('  · 点 A 部位贴图，B 部位（多选进来的那块）也跟着变；')
    console.log('  · 补 UV 时包围盒被多出来的那块撑大，图案被挤到画面一角。')
    console.log('  修法（二选一）：')
    suspicious.forEach((item) => {
      console.log(`    · 自动拆：加参数 --island-names "${item.partName}=<名1>,<名2>,..."`
        + `（按上面 1./2. 的顺序逐个命名）`)
    })
    console.log('    · 或回 3ds Max 用「元素(Element)」层级选中整块断开的面 → 分离成独立对象，再导出一次。')
    console.log('  命名规范见 docs/模型拆分与命名规范.md。\n')
  }

  if (dry) {
    console.log('\n--dry：只体检，没有写文件。\n')
    return
  }

  const binary = Buffer.concat(outBinaryParts, byteLength)
  const buffer = writeGlb(gltf, binary)

  if (path.resolve(output) === path.resolve(input)) {
    const backup = input.replace(/\.glb$/i, '.raw.glb')
    if (!fs.existsSync(backup)) fs.copyFileSync(input, backup)
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, buffer)

  console.log(`\n输出  ${output}  ${(buffer.length / 1024).toFixed(1)} KB`)
  console.log('下一步：npm run models:verify  然后 npm run models:regions 核对零件名\n')
}

main()
