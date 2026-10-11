/**
 * 「表面质感」—— 商品的物理材质档位。
 *
 * 为什么单独抽一层：
 *   GLB 里每个材质只有 metallic / roughness 两个数字，而「陶瓷」和「塑料」的区别
 *   不只是这两个数字 —— 真瓷器的观感来自**两层反射**：
 *     ① 底下那层是高粗糙的瓷胎（漫反射为主）；
 *     ② 上面那层是烧出来的釉，非常光滑，会给出一个又小又亮的锐利高光。
 *   MeshStandardMaterial 只有一层，做不出这种「双层」；要用 MeshPhysicalMaterial
 *   的 **clearcoat（清漆层）** 才能表达。所以这里负责把材质升级成 Physical，
 *   再按档位写参数。
 *
 * 另一件必须知道的事：**没有环境贴图（IBL）就没有釉面**。
 *   釉面/金属的高光几乎全部来自反射周围环境，只靠几盏平行光只会得到一小点死板的高光。
 *   所以这套档位和 `three/studioEnv.ts` 是配套的：那个负责给"该反射什么"，
 *   这个决定"反射得多亮"。
 *
 * 想加新档位：往 FINISHES 里加一条即可，UI 会自动多一个按钮，不用改别的代码。
 */

import * as THREE from 'three'

export type FinishId = 'glaze' | 'plastic' | 'matte' | 'satin' | 'metal' | 'fabric' | 'silk' | 'paper'

export interface FinishSpec {
  id: FinishId
  /** 面板上的按钮文字 */
  name: string
  /** 鼠标悬停的说明 */
  hint: string
  metalness: number
  roughness: number
  /** 清漆层强度（0 = 不要这一层）。釉面靠它做出「一层透明釉」 */
  clearcoat: number
  clearcoatRoughness: number
  /** 环境贴图强度：釉面 / 金属主要靠它出效果 */
  envMapIntensity: number
  /** 布料绒面光泽（只有帆布 / 绢丝用） */
  sheen: number
  sheenRoughness: number
  /**
   * 绒面光泽的**颜色**。
   *
   * ⚠️ 只要 `sheen > 0` 就必须显式给 —— three 的 `MeshPhysicalMaterial.sheenColor`
   * **默认是纯黑**（实测 r177：`new MeshPhysicalMaterial().sheenColor.getHexString()` = `'000000'`），
   * 而着色器里绒光是拿它当系数乘上去的，黑色绒面 = **完全没有绒光**。
   * 也就是说「只把 sheen 设成 1」在渲染里和导出的 GLB（`sheenColorFactor: [0,0,0]`）里都是零效果。
   * 这个坑实测踩过：帆布那档从一开始就只写了 `sheen: 1`，绒光一直是空的。
   */
  sheenColor?: string
  /** 程序生成的织纹法线贴图（只有布料用）。scale 是凹凸强弱，repeat 是一个 UV 里铺几块纹样 */
  weave?: { scale: number; repeat: number }
  /**
   * 程序生成的**纸纤维**法线贴图（只有纸质用）。语义和 `weave` 一样：
   * scale 是凹凸强弱、repeat 是一个 UV 里铺几块。
   *
   * 为什么纸质也必须给一张纹理，不能只靠 roughness：
   *   「哑光陶土」那一档的 roughness 是 0.92、纸质是 0.8 —— 单看数字几乎分不开，
   *   摆在一起只会觉得「两个都是灰扑扑的哑光面」。纸之所以是纸，肉眼认的是**纤维**：
   *   一层极细的、大体顺着一个方向的绒毛，在斜光下把高光打散成一层薄雾。
   *   这层纹理就是纸和陶土的分界线。
   */
  paper?: { scale: number; repeat: number }
}

export const FINISHES: FinishSpec[] = [
  {
    id: 'glaze',
    name: '陶瓷釉面',
    hint: '白瓷 / 青瓷那种上了一层釉的效果：坯体偏哑光，表面另有一层很锐利的高光',
    metalness: 0,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1,
    sheen: 0,
    sheenRoughness: 0,
  },
  {
    id: 'plastic',
    name: '塑料',
    hint: '注塑塑料（PP / ABS 那种）：本体半光，表面另有一层油亮的光泽，高光比陶瓷散、比半哑光集中',
    // 塑料和陶瓷的差别**不在「亮不亮」而在高光的形状**：
    //   · 陶瓷釉面是烧出来的玻璃质，高光是镜面级的（clearcoat 1 + ccRough 0.05）→ 又小又锐；
    //   · 注塑塑料的模具面是抛光的，只到「油亮」（clearcoat 0.6 + ccRough 0.18）→ 一片柔和的亮带；
    //   · 半哑光则是薄漆层（clearcoat 0.35 + ccRough 0.28）→ 更弱更散。
    // 三档必须都能一眼分辨，所以这里刻意把本体 roughness 放到 0.4（比釉面粗、比半哑光细）。
    metalness: 0,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.9,
    sheen: 0,
    sheenRoughness: 0,
  },
  {
    id: 'matte',
    name: '哑光陶土',
    hint: '素坯 / 粗陶：几乎不反光，有点颗粒感',
    metalness: 0,
    roughness: 0.92,
    clearcoat: 0,
    clearcoatRoughness: 0,
    envMapIntensity: 0.45,
    sheen: 0,
    sheenRoughness: 0,
  },
  {
    id: 'satin',
    name: '半哑光',
    hint: '哑光漆面：有一层柔和的反光，不刺眼',
    metalness: 0,
    roughness: 0.56,
    clearcoat: 0.35,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.75,
    sheen: 0,
    sheenRoughness: 0,
  },
  {
    id: 'metal',
    name: '金属',
    hint: '金属徽章 / 五金件：几乎全靠反射周围环境出效果',
    metalness: 1,
    roughness: 0.28,
    clearcoat: 0,
    clearcoatRoughness: 0,
    envMapIntensity: 1.1,
    sheen: 0,
    sheenRoughness: 0,
  },
  {
    id: 'fabric',
    name: '帆布',
    hint: '布料：高粗糙 + 一层绒面光泽 + 织纹凹凸，适合帆布包',
    metalness: 0,
    roughness: 0.95,
    clearcoat: 0,
    clearcoatRoughness: 0,
    envMapIntensity: 0.55,
    sheen: 1,
    sheenRoughness: 0.85,
    sheenColor: '#ffffff',
    weave: { scale: 0.8, repeat: 8 },
  },
  {
    id: 'silk',
    name: '绢丝',
    hint: '绢/绸：织纹比帆布细密得多，几乎平的，但有一层柔和的丝光沿着光的方向滑',
    metalness: 0,
    roughness: 0.62,
    clearcoat: 0,
    clearcoatRoughness: 0,
    envMapIntensity: 0.5,
    // 丝光来自纤维的定向反射：sheen 调高、sheenRoughness 调低（比帆布那档「光」得多）
    sheen: 1,
    sheenRoughness: 0.3,
    sheenColor: '#ffffff',
    // 一个 UV 里铺 22 根线（帆布是 8 根），凹凸只有帆布的一半 —— 绢面看着是平的，只留一点细纹
    weave: { scale: 0.35, repeat: 22 },
  },
  {
    id: 'paper',
    name: '纸质',
    hint: '宣纸 / 卡纸：几乎不反光，表面有一层极细的纤维纹，比陶土轻、比陶土白',
    metalness: 0,
    // 纸比陶土（0.92）「平」一档：纸浆压出来还是有轻微的定向反光，
    // 但不能低到发油。0.8 落在「哑光但不死板」上。
    roughness: 0.8,
    clearcoat: 0,
    clearcoatRoughness: 0,
    // 要比陶土（0.45）高一档：那层纤维白雾是**环境光打出来的**，
    // 给低了纸会塌成一片脏灰，反而更像素坯。
    envMapIntensity: 0.6,
    // 纸不用布料的 sheen（那是给绒面织物的）—— 纸的柔光是「纤维把高光打散」，
    // 靠下面的纸纹法线贴图表达更准，硬加 sheen 会把它推成一块布。
    sheen: 0,
    sheenRoughness: 0,
    // repeat 9：扇面 UV 是平面投影、一张图铺满扇面，一格纹样在扇面上约 10cm ——
    // 这个尺度下纤维刚好看得出来又不成噪点。scale 只给 0.3：纸的凹凸极浅，
    // 给到帆布那个 0.8 会变成粗麻布。
    paper: { scale: 0.3, repeat: 9 },
  },
]

// --------------------------------------------------------------- 程序生成织纹

/**
 * 一张「平纹织物」的织纹**法线贴图**，给帆布 / 绢丝档的 `normalMap` 用。
 *
 * 为什么不放一张贴图素材：不需要用户提供任何文件、也不依赖 CDN，
 * 离线永远能用（和 `studioEnv.ts` 的程序化影棚同一个思路）。
 *
 * 纹样：一个瓦片里 8×8 根线，**经纬交替压在上面**（这正是平纹布的织法），
 * 每根线的截面用余弦做成一根凸起的筋；再把高度场转成切线空间法线。
 *
 * 为什么用 normalMap 而不是 bumpMap：
 *   ① bump 的强度取决于**屏幕空间**的 UV 导数 —— 相机一拉远，织纹就自己消失了；
 *      法线贴图是模型空间的，远近都一致。
 *   ② 导出 GLB 时 `bumpMap` 只能写成非标准的 `EXT_materials_bump`，别的软件读不了；
 *      `normalMap` 是 glTF 核心的 `normalTexture`，到处都认。
 *
 * ⚠️ 瓦片的**像素**只有一份（织法都一样），但 **Texture 实例要按 `repeat` 分开缓存**：
 * `repeat` 是贴在 Texture 上的，而同一个模型里可能同时有两种布的档位
 * （团扇是绢丝、包包是帆布）。共用一个 Texture 实例的话，后设的那档会把前面的
 * repeat 改掉 —— 表现为「细纹突然变粗/变细」，而且切换顺序不同结果还不一样。
 */
const WEAVE_SIZE = 128 // 一个瓦片 8 根线 → 每根线 16 像素
const WEAVE_THREADS = 8

let weavePixels: Uint8Array | null = null

function weaveNormalPixels(): Uint8Array {
  if (weavePixels) return weavePixels

  const SIZE = WEAVE_SIZE
  const PITCH = SIZE / WEAVE_THREADS

  const height = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tx = Math.floor(x / PITCH)
      const ty = Math.floor(y / PITCH)
      const weftOnTop = (tx + ty) % 2 === 0
      const warpBump = Math.cos(((x % PITCH) / PITCH - 0.5) * Math.PI)
      const weftBump = Math.cos(((y % PITCH) / PITCH - 0.5) * Math.PI)
      height[y * SIZE + x] = Math.max(0, weftOnTop ? weftBump : warpBump)
    }
  }

  // 高度场 → 法线：中心差分，索引环绕取模，这样瓦片四边能无缝接上
  const data = new Uint8Array(SIZE * SIZE * 4)
  const STEEP = 2.4
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const left = height[y * SIZE + ((x - 1 + SIZE) % SIZE)]
      const right = height[y * SIZE + ((x + 1) % SIZE)]
      const down = height[((y - 1 + SIZE) % SIZE) * SIZE + x]
      const up = height[((y + 1) % SIZE) * SIZE + x]
      const nx = -(right - left) * STEEP
      const ny = -(up - down) * STEEP
      const length = Math.hypot(nx, ny, 1)
      const i = (y * SIZE + x) * 4
      data[i] = Math.round((nx / length * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }

  weavePixels = data
  return data
}

/** repeat → Texture。同一个 repeat 复用一张，不同 repeat 各一张（别让它们抢 repeat） */
const weaveTextures = new Map<number, THREE.Texture>()

function weaveNormalMap(repeat: number): THREE.Texture {
  const cached = weaveTextures.get(repeat)
  if (cached) return cached

  const texture = new THREE.DataTexture(weaveNormalPixels(), WEAVE_SIZE, WEAVE_SIZE, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // DataTexture 默认是最邻近采样 + 不生成 mipmap，远处会闪成噪声，必须改掉
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.repeat.set(repeat, repeat)
  texture.needsUpdate = true
  weaveTextures.set(repeat, texture)
  return texture
}

/**
 * 挂上「程序生成的表面法线贴图」—— 织纹（帆布 / 绢丝）或纸纤维（纸质）。
 *
 * ⚠️ `normalMap` 上的 `repeat` 是**Texture 自己的属性**，所以这里要按 repeat 取
 * 对应的那张 Texture（`weaveNormalMap` / `paperNormalMap` 内部各自按 repeat 缓存），
 * 不能拿一张全局共用的去改 repeat —— 同一场景里有两种布就会互相改。
 *
 * 没有纹理的档位（釉面 / 金属 / 哑光 / 陶土）要把 `normalMap` 清掉：
 * 否则从「帆布」切到「陶瓷」时，包包上会留着一层布的织纹。
 */
function applySurfaceNormal(material: Physical, spec: FinishSpec): void {
  if (spec.weave) {
    material.normalMap = weaveNormalMap(spec.weave.repeat)
    material.normalScale.set(spec.weave.scale, spec.weave.scale)
    return
  }
  if (spec.paper) {
    material.normalMap = paperNormalMap(spec.paper.repeat)
    material.normalScale.set(spec.paper.scale, spec.paper.scale)
    return
  }
  if (material.normalMap) material.normalMap = null
}

// --------------------------------------------------------------- 程序生成纸纤维

/**
 * 纸的**纤维法线贴图**，给纸质档的 `normalMap` 用。和织纹一样是纯程序生成的：
 * 不依赖任何贴图素材、不联网，离线永远能用。
 *
 * 纹样由三部分叠出来（这是纸在斜光下的真实构成）：
 *   ① **纤维**：几百根细长的「毛」，方向集中在一个方向附近（纸浆抄出来时纤维大体躺平），
 *      两端渐细 —— 用一条带横向衰减的余弦脊表达，不是 1 像素的硬线
 *      （1 像素的脊在远处会闪成噪点，而且放大看像划痕）；
 *   ② **浆块**：两三个八度的平滑值噪声，做出纸面「厚薄不匀」的大起伏；
 *   ③ **毛糙**：极细的逐像素随机，只占一点点振幅。
 *
 * ⚠️ 用**确定性伪随机**（mulberry32 + 固定种子）：同一份代码永远生成同一张纸纹。
 *    用 `Math.random()` 的话每次刷新页面纸纹都在变，截图对比就没法做了。
 */
const PAPER_SIZE = 256

let paperPixels: Uint8Array | null = null

/** 确定性伪随机数发生器（mulberry32）—— 固定种子 → 每次都一样 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 双线性插值的平滑值噪声，格点环绕取模 → 瓦片四边能接上 */
function valueNoise(size: number, cells: number, rnd: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd()
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const fy = (y / size) * cells
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const x1 = (x0 + 1) % cells
      const y1 = (y0 + 1) % cells
      const a = lattice[(y0 % cells) * cells + (x0 % cells)]
      const b = lattice[(y0 % cells) * cells + x1]
      const c = lattice[y1 * cells + (x0 % cells)]
      const d = lattice[y1 * cells + x1]
      out[y * size + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty
    }
  }
  return out
}

function paperNormalPixels(): Uint8Array {
  if (paperPixels) return paperPixels

  const SIZE = PAPER_SIZE
  const rnd = mulberry32(0x5f3a91)
  const height = new Float32Array(SIZE * SIZE)
  const wrap = (v: number) => ((v % SIZE) + SIZE) % SIZE

  // ① 浆块：两个八度，大起伏 + 中起伏
  const coarse = valueNoise(SIZE, 8, rnd)
  const medium = valueNoise(SIZE, 24, rnd)
  for (let i = 0; i < height.length; i++) height[i] = coarse[i] * 1.0 + medium[i] * 0.45

  // ② 纤维：600 根，方向集中在水平附近（±16°）
  const FIBERS = 600
  const SPREAD = 0.28 // 弧度，约 ±16°
  for (let i = 0; i < FIBERS; i++) {
    const angle = (rnd() - 0.5) * SPREAD
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    // 法线方向（把纤维「摊开」成一条有宽度的脊）
    const nx = -dirY
    const ny = dirX
    const px = rnd() * SIZE
    const py = rnd() * SIZE
    const length = SIZE * (0.25 + rnd() * 0.55)
    const amp = 0.5 + rnd() * 0.5
    const steps = Math.ceil(length)
    for (let s = 0; s < steps; s++) {
      const taper = Math.sin((s / steps) * Math.PI) // 两端渐细
      if (taper <= 0) continue
      const cx = px + dirX * s
      const cy = py + dirY * s
      // 横向铺 3 个像素、高斯衰减 —— 单像素的硬脊放大像划痕、缩小像噪点
      for (let o = -1; o <= 1; o++) {
        const weight = Math.exp(-(o * o) / 1.6)
        const ix = wrap(Math.round(cx + nx * o))
        const iy = wrap(Math.round(cy + ny * o))
        height[iy * SIZE + ix] += amp * taper * weight * 0.55
      }
    }
  }

  // ③ 毛糙：极细的逐像素随机
  for (let i = 0; i < height.length; i++) height[i] += rnd() * 0.12

  // 高度场 → 法线（中心差分 + 环绕取模）
  // STEEP 比织纹的 2.4 小得多：纸的凹凸是「极浅的一层雾」，坡度过大会变成砂纸。
  const data = new Uint8Array(SIZE * SIZE * 4)
  const STEEP = 1.1
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const left = height[y * SIZE + wrap(x - 1)]
      const right = height[y * SIZE + wrap(x + 1)]
      const down = height[wrap(y - 1) * SIZE + x]
      const up = height[wrap(y + 1) * SIZE + x]
      const nx = -(right - left) * STEEP
      const ny = -(up - down) * STEEP
      const length = Math.hypot(nx, ny, 1)
      const i = (y * SIZE + x) * 4
      data[i] = Math.round((nx / length * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }

  paperPixels = data
  return data
}

/** 同 weaveNormalMap：按 repeat 分开缓存，别让两种 repeat 抢同一张 Texture */
const paperTextures = new Map<number, THREE.Texture>()

function paperNormalMap(repeat: number): THREE.Texture {
  const cached = paperTextures.get(repeat)
  if (cached) return cached

  const texture = new THREE.DataTexture(paperNormalPixels(), PAPER_SIZE, PAPER_SIZE, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.repeat.set(repeat, repeat)
  texture.needsUpdate = true
  paperTextures.set(repeat, texture)
  return texture
}

const BY_ID = new Map(FINISHES.map((finish) => [finish.id, finish]))

export function finishSpec(id: FinishId | undefined): FinishSpec | null {
  if (!id) return null
  return BY_ID.get(id) ?? FINISHES[0]
}

type Physical = THREE.MeshPhysicalMaterial

/**
 * 把任意材质升级成 MeshPhysicalMaterial（clearcoat / sheen 只有它有）。
 *
 * 这里刻意**不用** `new MeshPhysicalMaterial().copy(source)`：MeshPhysicalMaterial.copy
 * 会去读 source.clearcoat 之类的字段，而 MeshStandardMaterial 上没有这些字段，
 * 结果会把 clearcoat 写成 undefined。改成直接调 MeshStandardMaterial.prototype.copy，
 * 只复制标准材质那一层的属性，Physical 自己的字段保持构造函数给的 0。
 */
export function ensurePhysicalMaterial(material: THREE.Material): Physical {
  if ((material as Physical).isMeshPhysicalMaterial) return material as Physical

  const next = new THREE.MeshPhysicalMaterial()
  THREE.MeshStandardMaterial.prototype.copy.call(next, material as THREE.MeshStandardMaterial)
  // MeshStandardMaterial.copy 会把 defines 重置成 { STANDARD: '' }，
  // 少了 PHYSICAL 着色器就不会编译 clearcoat，必须补回来。
  next.defines = { STANDARD: '', PHYSICAL: '' }
  // 换过实例之后 onBeforeCompile 是新的空函数，但 userData 是被深拷贝过来的，
  // 「全彩补丁已挂」的标记得清掉，否则 applyColorize 会以为已经挂过而跳过注入。
  next.userData.__colorize = undefined
  next.needsUpdate = true
  return next
}

/**
 * 把档位写进材质；返回是否发生了「换了材质实例」这件事。
 *
 * envMapIntensity 这里只写「这一档相对该有多反光」，真正的绝对值由
 * 「环境反光」滑块决定（`applyEnvironment` 里乘上去）—— 这样滑块和档位互不打架。
 */
export function applyFinish(material: THREE.Material, id: FinishId | undefined): boolean {
  const spec = finishSpec(id)
  if (!spec) return false

  const physical = ensurePhysicalMaterial(material)
  const swapped = physical !== material

  physical.metalness = spec.metalness
  physical.roughness = spec.roughness
  physical.clearcoat = spec.clearcoat
  physical.clearcoatRoughness = spec.clearcoatRoughness
  physical.sheen = spec.sheen
  physical.sheenRoughness = spec.sheenRoughness
  // ⚠️ 必须同时给 sheenColor：three 里它默认是**纯黑**，而着色器是拿它当绒光的系数，
  //    所以「只把 sheen 设成 1」等于没有绒光（渲染、导出两头都是零效果）。
  if (physical.sheen > 0) physical.sheenColor.set(spec.sheenColor ?? '#ffffff')
  applySurfaceNormal(physical, spec)
  physical.needsUpdate = true

  return swapped
}

/**
 * 把环境贴图挂到材质上，并按「档位权重 × 滑块」算出强度。
 *
 * 注意一个 three 的坑：如果只设 `scene.environment`、材质的 `envMap` 为 null，
 * 那么渲染器每一帧都会用 `scene.environmentIntensity` **覆盖**掉
 * `material.envMapIntensity`（见 WebGLRenderer 里那行
 * `m_uniforms.envMapIntensity.value = scene.environmentIntensity`）。
 * 也就是说「按档位给不同的反射强度」在 scene.environment 这条路下是做不到的，
 * 必须把贴图挂到材质自己的 envMap 上。
 */
export function applyEnvironment(
  material: THREE.Material,
  envMap: THREE.Texture | null,
  envIntensity: number,
  finishId: FinishId | undefined,
): void {
  const standard = material as THREE.MeshStandardMaterial
  if (!standard.isMeshStandardMaterial) return

  if (envMap) standard.envMap = envMap
  const weight = finishSpec(finishId)?.envMapIntensity ?? 1
  standard.envMapIntensity = weight * envIntensity
  standard.needsUpdate = true
}
