/**
 * 图片 → 商品 适配度评分引擎（纯前端，不依赖后端、不联网）
 *
 * 做什么：拿一张已经选定 / 已生成的图片，算出它贴到 9 个商品上各自的适配度（0~100），
 *        排序取前 3 推荐，并给每个商品一句「为什么」（见 reasons）。
 *
 * 三层结构：
 *   1. extractImageFeatures(url) —— 把图绘到离屏 canvas 上，用像素算出 5 个本地特征；
 *   2. scoreModels(features)     —— 按「几何 50% + 风格 30% + 图案类型 20% − 禁忌扣分」打分；
 *   3. recommendModels(url)       —— 上面两步串起来，给 UI 直接消费。
 *
 * ⚠️ 三条硬性约束（需求文档里写死的，改代码前先看这里）：
 *   · **所有阈值 / 权重 / 文案模板都集中在下面的 COMPAT_CONFIG 区**，不散落在逻辑里；
 *   · **风格适配只做软推荐** —— 密度、色数超标只降排序并在理由里说明，绝不禁止用户贴图；
 *   · **任何异常都要降级** —— 图片加载失败 / 画布读不到像素，都不能抛给用户，返回 null 让 UI 自己收摊。
 *
 * 图片必须与页面同源，否则 canvas 被跨域污染、getImageData 会抛 SecurityError。
 * 本项目所有图片来源都是同源的（AI 生图与场景截图走后端相对路径 + vite 代理；
 * 本地上传是 blob: URL），所以这里不需要 crossOrigin 兜底 —— 详见 src/lib/api.ts 顶部说明。
 */

import modelProfilesJson from '../data/modelProfiles.json'
import { MODEL_PRESETS } from '../data/modelPresets'

// ================================ 配置区 ================================

/** 文档规定的模型特征表，原样保存在 src/data/modelProfiles.json */
export interface ModelProfile {
  id: string
  name: string
  uvType: 'cylinder' | 'faces' | 'flat' | 'radial'
  targetRatio: number
  seamSensitive: boolean
  safeZone: { top: number; bottom: number }
  patternType: 'centered' | 'seamless' | 'radial' | 'any'
  forbidden: string[]
  decorationNorm: 'minimal' | 'moderate' | 'rich'
  maxColorCount: number
  patternDensityLimit: number
}

export const COMPAT_CONFIG = {
  /** 特征提取时的采样尺寸（越小越快，越大越准） */
  sample: {
    /** 密度 / 色数 / 留白用的正方形采样边长 */
    square: 64,
    /** 左右边缘比对时纵向重采样的行数 */
    edgeRows: 64,
    /** 上下留白带各占整图高度的比例 */
    bandRatio: 0.15,
  },

  /** 各判据阈值 */
  thresholds: {
    /** 灰度相邻像素差分超过它才算「有线」 */
    densityDiff: 20,
    /** 与背景色的 L1 距离低于它算「留白」 */
    blankBgDistance: 60,
    /** 各通道都高于它算「接近白」，也算留白 */
    blankWhiteChannel: 235,
    /** RGB 各量化到这个级数（>>3 得 0~31） */
    colorQuantLevels: 32,
    /** 占比低于它的颜色当作杂色丢掉 */
    colorMinShare: 0.01,
    /** 量化后 L1 距离低于它的两种颜色合并成一种 */
    colorMergeDistance: 6,
  },

  /** 各维度权重 —— 几何 50% / 风格 30% / 图案类型 20% */
  weights: {
    ratio: 0.2,
    seam: 0.15,
    blank: 0.15,
    density: 0.15,
    color: 0.15,
    pattern: 0.2,
  },

  /** 评分曲线参数 */
  curves: {
    /** 宽高比差到这个倍数（比值）时该维度归零 */
    ratioTolerance: 3,
    /**
     * 留白**不足**时，缺口到多少算全扣光（见 blankScore 的说明：够用就满分，不对称）。
     * ⚠️ 别为了「多留点白也扣分」把它改回对称匹配 —— 实测那样会让这一维在所有常见图上恒为 0。
     */
    blankTolerance: 0.3,
    /** 色数超出上限后，涨到多少个颜色归零 */
    colorCeil: 24,
    /** centered 类：中心区比边缘区密多少算「有明确中心主体」 */
    centeredGain: 3,
    /** patternType 拿不到判据时的中性分 */
    patternNeutral: {
      centered: 0.5,
      seamless: 0.5,
      radial: 0.5,
      any: 0.6,
    } as Record<ModelProfile['patternType'], number>,
    /**
     * 推荐理由并列时先说什么。
     * 六个维度的显著度常有并列（比如「密度、色数、留白」同时满分），
     * 这里定死一个顺序，免得理由随代码改动跳来跳去。
     * 顺序的用意：留白 > 密度 > 色数 是**本模型最特有的要求**，
     * 先说这三项，用户才知道「为什么是它」而不是「为什么是谁都行」。
     */
    reasonPriority: ['blank', 'density', 'color', 'seam', 'ratio', 'pattern'] as const,
  },

  /** 哪些 uvType 用「左右边缘相似度」当无缝分；其余的（faces / flat）按文档直接给满分 */
  seamScoredUvTypes: ['cylinder', 'radial'] as string[],

  /** 禁忌扣分：语义分析可用时，每命中一个 forbidden 扣多少 */
  penalty: {
    perForbidden: 10,
    /** 禁忌扣分上限（文档：最多扣 20） */
    max: 20,
  },

  /** 推荐位数量 */
  topN: 3,
  /** 适配度低于它就不进推荐位，折叠到「其他可选模型」区 */
  recommendThreshold: 60,

  /** 文案模板 —— 措辞全在这里改，别写进逻辑分支 */
  copy: {
    densityHigh: (value: string, limit: string, better: string) =>
      `图案密度 ${value}，超出本模型惯例上限 ${limit}，更适合「${better}」`,
    densityFit: (value: string, limit: string) =>
      `图案密度 ${value}，在本模型惯例上限 ${limit} 以内，铺满不留空`,
    colorHigh: (value: string, max: string, better: string) =>
      `用色 ${value} 种，超出本模型惯例上限 ${max} 色，减到 ${max} 色以内更稳，或改用「${better}」`,
    colorFit: (value: string, max: string) => `用色 ${value} 种，在本模型 ${max} 色以内，配色不会糊成一片`,
    blankEnough: (value: string, need: string) => `上下留白充足（${value}），正合本模型 ${need} 的留白要求`,
    blankShort: (value: string, need: string) => `上下留白只有 ${value}，本模型需要 ${need}，主体容易顶到口沿`,
    edgeSeamless: (value: string) => `左右边缘连续度 ${value}，环绕贴接不会有接缝`,
    edgeSeam: (value: string) => `左右边缘连续度只有 ${value}，环绕之后背面会留一道竖缝`,
    ratioFit: (target: string) => `构图宽高比与器物 ${target}:1 的比例吻合`,
    ratioOff: (target: string) => `构图宽高比与本模型 ${target}:1 的比例有差距`,
    patternCentered: () => '主体居中明确，正好落在器物的正面视觉中心',
    patternSeamless: (value: string) => `纹样边缘可衔接（${value}），适合整圈铺开`,
    patternRadial: () => '团扇形构图，任何方向都不算错，按综合分数排序',
    patternFallback: () => '本模型对构图不挑，综合构图与风格适配度最高',
    generic: () => '综合构图与风格适配度最高',
  },
}

// ============================ 文档 id → 项目 preset id ============================

/**
 * 需求文档里的模型 id 是按「形状」起的（vase_belly / cup_classic …），
 * 项目里 9 个商品的 preset id 是 `mug_a` / `vase_b` 这种带变体后缀的。
 * 文档要求 modelProfiles.json「必须原样使用」，所以不往 json 里塞字段，
 * 而是在这里维护一张映射表。
 *
 * ⚠️ 加商品 / 换商品时，这张表和 modelProfiles.json 要一起看：
 *    · 表里的 key 必须在 json 里存在，value 必须在 MODEL_PRESETS 里存在；
 *    · 对不上的条目会被静默跳过（`listProfiles()` 里过滤），商品不会凭空少一个推荐位，
 *      但也不会报错 —— 所以改完建议核一遍映射结果：
 *      开发模式下 `window.__compat.listProfiles()` 会打印实际生效的 9 条。
 */
export const PROFILE_TO_PRESET: Record<string, string> = {
  vase_belly: 'vase_a',
  vase_slim: 'vase_b',
  cup_classic: 'mug_a',
  cup_straight: 'mug_b',
  penholder_round: 'holder_a',
  penholder_square: 'holder_b',
  bag_onepiece: 'bag_a',
  bag_tote: 'bag_b',
  fan_tuanshan: 'fan_b',
}

/** 一条「特征表 + 项目商品」合并后的记录，UI 直接用它 */
export interface ModelProfileEntry extends ModelProfile {
  /** 项目里的 preset id（用于切商品） */
  presetId: string
  /** 商品中文名，取项目里的写法（与 json 里的 name 一致，以项目为准） */
  presetName: string
  /** 商品自带的部位说明，显示在推荐卡下面 */
  presetDescription: string
}

/** 把 json 里的 9 条与项目里的 9 个商品对上；对不上的丢弃 */
export function listProfiles(): ModelProfileEntry[] {
  const raw = (modelProfilesJson as { models: ModelProfile[] }).models ?? []
  const entries: ModelProfileEntry[] = []
  for (const profile of raw) {
    const presetId = PROFILE_TO_PRESET[profile.id]
    if (!presetId) continue
    const preset = MODEL_PRESETS.find((item) => item.id === presetId)
    if (!preset) continue
    entries.push({
      ...profile,
      presetId,
      presetName: preset.name,
      presetDescription: preset.description,
    })
  }
  return entries
}

// ================================ 特征 ================================

export interface ImageFeatures {
  /** 宽 / 高 */
  aspectRatio: number
  /** 左右边缘无缝适配度，1 = 可无缝环绕 */
  edgeSimilarity: number
  /** 上下各 15% 横带区域的留白率，取上下平均 */
  blankRatio: number
  /** 缩到 64×64 灰度后，相邻像素差分超阈值的像素占比 */
  patternDensity: number
  /** 量化到 32 级并合并相近色后的有效色数 */
  colorCount: number
  /** —— 以下三项是内部派生量，文档没要求，但判「有没有明确中心主体」要用 —— */
  centerDensity: number
  edgeDensity: number
  /** 图片四角均值取出来的背景色 */
  background: [number, number, number]
  /** —— 语义项：纯规则模式下恒为 null（文档允许的降级），接上多模态 API 后再填 —— */
  hasFace: boolean | null
  hasText: boolean | null
  styleDesc: string | null
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const round2 = (value: number) => Math.round(value * 100) / 100

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('浏览器没能创建离屏画布')
  return ctx
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // 同源图不需要 crossOrigin；带上它在个别浏览器反而会和缓存较劲，所以不加。
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = url
  })
}

/** 把图绘进 width × height 的离屏 canvas，返回像素数据 */
function pixelsOf(image: HTMLImageElement, width: number, height: number): Uint8ClampedArray {
  const ctx = makeCanvas(width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

/** 四角各取一小块求均值，当作这张图的「背景色」 */
function backgroundOf(data: Uint8ClampedArray, size: number, patch: number): [number, number, number] {
  const sum = [0, 0, 0]
  let count = 0
  const starts = [
    [0, 0],
    [size - patch, 0],
    [0, size - patch],
    [size - patch, size - patch],
  ]
  for (const [sx, sy] of starts) {
    for (let y = sy; y < sy + patch; y += 1) {
      for (let x = sx; x < sx + patch; x += 1) {
        const i = (y * size + x) * 4
        sum[0] += data[i]
        sum[1] += data[i + 1]
        sum[2] += data[i + 2]
        count += 1
      }
    }
  }
  return [sum[0] / count, sum[1] / count, sum[2] / count]
}

/** 灰度值 */
const gray = (data: Uint8ClampedArray, index: number) =>
  0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]

/**
 * 在给定区域内数「相邻像素差分超阈值」的比例。
 * box 用比例给，便于同一份代码量全图 / 中心区 / 边缘环。
 */
function densityIn(
  data: Uint8ClampedArray,
  size: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  diffThreshold: number,
): number {
  const x0 = Math.floor(box.x0 * size)
  const y0 = Math.floor(box.y0 * size)
  const x1 = Math.min(size - 1, Math.ceil(box.x1 * size))
  const y1 = Math.min(size - 1, Math.ceil(box.y1 * size))
  let hits = 0
  let total = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * size + x) * 4
      const g = gray(data, i)
      if (x < x1) {
        total += 1
        if (Math.abs(g - gray(data, i + 4)) > diffThreshold) hits += 1
      }
      if (y < y1) {
        total += 1
        if (Math.abs(g - gray(data, i + size * 4)) > diffThreshold) hits += 1
      }
    }
  }
  return total === 0 ? 0 : hits / total
}

/** 提取一张图的全部本地特征；失败时抛错，由调用方决定怎么降级 */
export async function extractImageFeatures(url: string): Promise<ImageFeatures> {
  const { sample, thresholds } = COMPAT_CONFIG
  const image = await loadImage(url)
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  if (!naturalWidth || !naturalHeight) throw new Error('图片尺寸为 0，无法分析')

  const size = sample.square
  const square = pixelsOf(image, size, size)
  const background = backgroundOf(square, size, Math.max(2, Math.round(size / 8)))

  // —— 留白：上下各 15% 横带里「接近背景色或接近白」的像素占比，取平均 ——
  const bandRows = Math.max(1, Math.round(size * sample.bandRatio))
  const bands = [
    { from: 0, to: bandRows },
    { from: size - bandRows, to: size },
  ]
  let blankSum = 0
  for (const band of bands) {
    let blank = 0
    let total = 0
    for (let y = band.from; y < band.to; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4
        const r = square[i]
        const g = square[i + 1]
        const b = square[i + 2]
        const nearBg =
          Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) <=
          thresholds.blankBgDistance
        const nearWhite =
          r >= thresholds.blankWhiteChannel &&
          g >= thresholds.blankWhiteChannel &&
          b >= thresholds.blankWhiteChannel
        if (nearBg || nearWhite) blank += 1
        total += 1
      }
    }
    blankSum += total === 0 ? 0 : blank / total
  }
  const blankRatio = blankSum / bands.length

  // —— 图案密度：全图 / 中心区 / 边缘环 ——
  const patternDensity = densityIn(square, size, { x0: 0, y0: 0, x1: 1, y1: 1 }, thresholds.densityDiff)
  const centerDensity = densityIn(square, size, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, thresholds.densityDiff)
  // 边缘环：用「全图减去中心区」近似 —— 这里量的是四周边带
  const ringHits = densityIn(square, size, { x0: 0, y0: 0, x1: 1, y1: 0.25 }, thresholds.densityDiff)
    + densityIn(square, size, { x0: 0, y0: 0.75, x1: 1, y1: 1 }, thresholds.densityDiff)
    + densityIn(square, size, { x0: 0, y0: 0.25, x1: 0.25, y1: 0.75 }, thresholds.densityDiff)
    + densityIn(square, size, { x0: 0.75, y0: 0.25, x1: 1, y1: 0.75 }, thresholds.densityDiff)
  const edgeDensity = ringHits / 4

  // —— 左右边缘相似度 ——
  // 把**源图最左一列**和**最右一列**各自纵向重采样到 edgeRows 行，逐行比 RGB。
  //
  // ⚠️ 这里**故意没有**按需求文档写的「缩放到 64 宽再取最左列与最右列」做，原因实测：
  //    横向缩到 64 宽时，最左列其实是源图前 ~W/64 像素的平均值（4000px 宽的图就是前 62px）。
  //    对一幅横向连续渐变的纹样，「最左列均值」与「最右列均值」天然差着这一段梯度 ——
  //    哪怕纹样首尾严格衔接，也只会量出 0.83 的相似度，和真正断掉的图（0.80）几乎分不出来。
  //    直接取源图两端的真实像素列，就没有这层横向糊化，连续与断开能拉开明显差距。
  const edgeRows = Math.max(1, Math.min(sample.edgeRows, naturalHeight))
  const edgeCtx = makeCanvas(2, edgeRows)
  edgeCtx.imageSmoothingEnabled = true
  edgeCtx.imageSmoothingQuality = 'high'
  edgeCtx.drawImage(image, 0, 0, 1, naturalHeight, 0, 0, 1, edgeRows)
  if (naturalWidth > 1) {
    edgeCtx.drawImage(image, naturalWidth - 1, 0, 1, naturalHeight, 1, 0, 1, edgeRows)
  }
  const edgePixels = edgeCtx.getImageData(0, 0, 2, edgeRows).data
  let diffSum = 0
  for (let y = 0; y < edgeRows; y += 1) {
    const left = y * 2 * 4
    const right = (y * 2 + 1) * 4
    diffSum +=
      (Math.abs(edgePixels[left] - edgePixels[right]) +
        Math.abs(edgePixels[left + 1] - edgePixels[right + 1]) +
        Math.abs(edgePixels[left + 2] - edgePixels[right + 2])) /
      3
  }
  const edgeSimilarity = clamp01(1 - diffSum / edgeRows / 255)

  // —— 有效色数：量化到 32 级 → 丢杂色 → 合并相近色 ——
  const levels = thresholds.colorQuantLevels
  const bucket = 256 / levels
  const histogram = new Map<string, number>()
  const total = size * size
  for (let p = 0; p < total; p += 1) {
    const i = p * 4
    const key = `${Math.floor(square[i] / bucket)},${Math.floor(square[i + 1] / bucket)},${Math.floor(square[i + 2] / bucket)}`
    histogram.set(key, (histogram.get(key) ?? 0) + 1)
  }
  const kept = [...histogram.entries()]
    .filter(([, count]) => count / total >= thresholds.colorMinShare)
    .map(([key, count]) => ({ rgb: key.split(',').map(Number), count }))
    .sort((a, b) => b.count - a.count)
  const clusters: number[][] = []
  for (const item of kept) {
    const near = clusters.find(
      (center) =>
        Math.abs(center[0] - item.rgb[0]) + Math.abs(center[1] - item.rgb[1]) + Math.abs(center[2] - item.rgb[2]) <=
        thresholds.colorMergeDistance,
    )
    if (!near) clusters.push(item.rgb)
  }

  return {
    aspectRatio: round2(naturalWidth / naturalHeight),
    edgeSimilarity: round2(edgeSimilarity),
    blankRatio: round2(blankRatio),
    patternDensity: round2(patternDensity),
    colorCount: Math.max(1, clusters.length),
    centerDensity: round2(centerDensity),
    edgeDensity: round2(edgeDensity),
    background: [Math.round(background[0]), Math.round(background[1]), Math.round(background[2])],
    // 纯规则模式：三项语义特征没有来源，一律 null（文档允许的降级，不报错、不阻塞）
    hasFace: null,
    hasText: null,
    styleDesc: null,
  }
}

// ================================ 评分 ================================

export interface ScoreBreakdown {
  /** 宽高比匹配（权重 0.20） */
  ratio: number
  /** 无缝适配（权重 0.15） */
  seam: number
  /** 留白分布（权重 0.15） */
  blank: number
  /** 图案密度（权重 0.15） */
  density: number
  /** 色数（权重 0.15） */
  color: number
  /** 图案类型匹配（权重 0.20） */
  pattern: number
  /** 禁忌扣分（0~20，只在语义分析可用时才可能非 0） */
  penalty: number
}

/** 图片与目标模型之间的差距，供 promptGenerator 选指令模板 */
export interface CompatibilityGaps {
  ratio: { mismatch: boolean; imageRatio: number; targetRatio: number }
  /** 横图贴到 radial / 竖构图模型上 */
  radialRecompose: boolean
  /** 非无缝图贴到 cylinder 类模型上 */
  seam: { needed: boolean; similarity: number }
  density: { over: boolean; value: number; limit: number }
  color: { over: boolean; value: number; max: number }
  blank: { short: boolean; value: number; need: number }
}

/** 一条推荐理由 —— 文档要求「从扣分/得分最高的一项生成」 */
export interface ReasonEntry {
  kind: 'density' | 'color' | 'blank' | 'seam' | 'ratio' | 'pattern'
  /** 该维度与中性的偏离量，用来挑「最显著的一项」 */
  salience: number
  text: string
}

export interface ModelScore extends ModelProfileEntry {
  score: number
  breakdown: ScoreBreakdown
  gaps: CompatibilityGaps
  reasons: ReasonEntry[]
  /** 排序后给 UI 显示的那一句 */
  topReason: string
}

const pct = (value: number) => `${Math.round(value * 100)}%`

function ratioScore(imageRatio: number, targetRatio: number): number {
  const distance = Math.abs(Math.log(imageRatio / targetRatio))
  return clamp01(1 - distance / Math.log(COMPAT_CONFIG.curves.ratioTolerance))
}

/**
 * 留白分布分。
 *
 * ⚠️ 这里**不是对称判据** —— 这是实测踩出来的结论，别想当然改回去：
 * `blankRatio` 量的是「上下各 15% 那两条带子里有多少是背景」，
 * 只要主体居中、四周留了边，这个数就趋近 1.0；而 9 个模型的 safeZone 需求只有 0.10~0.35。
 * 最初按「匹配度」对称判（|blankRatio − need| / tolerance），实测**所有模型在常见图上全得 0 分**，
 * 15% 的权重直接作废。所以改成：**留白够（≥ 需求）就满分，不够才按缺口扣**。
 * 于是「留白不足」只在主体顶到上下边沿时才冒出来，正好是它该出现的时候。
 */
function blankScore(blankRatio: number, profile: ModelProfile): number {
  const need = profile.safeZone.top + profile.safeZone.bottom
  if (blankRatio >= need) return 1
  return clamp01(1 - (need - blankRatio) / COMPAT_CONFIG.curves.blankTolerance)
}

function densityScore(value: number, limit: number): number {
  if (value <= limit) return 1
  return clamp01(1 - (value - limit) / Math.max(1e-6, 1 - limit))
}

function colorScore(value: number, max: number): number {
  if (value <= max) return 1
  const ceil = COMPAT_CONFIG.curves.colorCeil
  return clamp01(1 - (value - max) / Math.max(1e-6, Math.max(ceil, max + 1) - max))
}

function patternScore(features: ImageFeatures, profile: ModelProfile): number {
  const neutral = COMPAT_CONFIG.curves.patternNeutral[profile.patternType]
  switch (profile.patternType) {
    case 'centered': {
      // 中心区比四周密 → 认为有明确中心主体
      const contrast = features.centerDensity - features.edgeDensity
      return clamp01(neutral + contrast * COMPAT_CONFIG.curves.centeredGain)
    }
    case 'seamless':
      return features.edgeSimilarity
    case 'radial':
      // 文档明说：radial 类给中性分，纯规则判不了
      return neutral
    case 'any':
      return neutral
    default:
      return neutral
  }
}

/** 禁忌扣分 —— 语义分析不可用时恒为 0（文档：可选降级项） */
function penaltyOf(features: ImageFeatures, profile: ModelProfile): number {
  if (profile.forbidden.length === 0) return 0
  if (features.hasFace === null && features.hasText === null && features.styleDesc === null) return 0
  let hits = 0
  // 语义可用时：横向人脸 / 横向文字 这类判据由 styleDesc 关键词承载
  const style = features.styleDesc ?? ''
  for (const rule of profile.forbidden) {
    if (rule.includes('人脸') && features.hasFace && /横/.test(style)) hits += 1
    else if (rule.includes('文字') && features.hasText && /横/.test(style)) hits += 1
    else if (rule.includes('密集') && features.patternDensity > profile.patternDensityLimit) hits += 1
    else if (rule.includes('横') && features.aspectRatio > 2) hits += 1
  }
  return Math.min(COMPAT_CONFIG.penalty.max, hits * COMPAT_CONFIG.penalty.perForbidden)
}

/**
 * 给 9 个商品打分并排序（高到低）。
 * `loosestName` 是密度上限最宽的那个商品名 —— 用于「更适合『XX』」这类文案，
 * 在 recommendModels 里算一次传进来，避免每个商品都重算。
 */
export function scoreModels(features: ImageFeatures, loosestName = '帆布包·托特'): ModelScore[] {
  const { weights, copy } = COMPAT_CONFIG
  const profiles = listProfiles()
  // 9 个模型里对留白要求最高的那一档（花瓶·细颈 0.25+0.1=0.35）。
  // 用来给「留白满足」的正面理由加权：同样满足留白，满足了最严的那档更值得说 ——
  // 否则 9 个模型全都会说「留白充足」，理由就没了区分度。
  const maxBlankNeed = profiles.reduce(
    (best, item) => Math.max(best, item.safeZone.top + item.safeZone.bottom),
    0,
  )
  const scored = profiles.map<ModelScore>((profile) => {
    const ratio = ratioScore(features.aspectRatio, profile.targetRatio)
    const seam = COMPAT_CONFIG.seamScoredUvTypes.includes(profile.uvType) ? features.edgeSimilarity : 1
    const blank = blankScore(features.blankRatio, profile)
    const density = densityScore(features.patternDensity, profile.patternDensityLimit)
    const color = colorScore(features.colorCount, profile.maxColorCount)
    const pattern = patternScore(features, profile)
    const penalty = penaltyOf(features, profile)

    const raw =
      ratio * weights.ratio +
      seam * weights.seam +
      blank * weights.blank +
      density * weights.density +
      color * weights.color +
      pattern * weights.pattern
    const score = Math.max(0, Math.min(100, Math.round(raw * 100 - penalty)))

    const gaps: CompatibilityGaps = {
      ratio: {
        mismatch: ratio < 0.6,
        imageRatio: features.aspectRatio,
        targetRatio: profile.targetRatio,
      },
      radialRecompose: profile.uvType === 'radial' && features.aspectRatio > 1.3,
      seam: {
        needed: profile.uvType === 'cylinder' && features.edgeSimilarity < 0.6,
        similarity: features.edgeSimilarity,
      },
      density: { over: features.patternDensity > profile.patternDensityLimit, value: features.patternDensity, limit: profile.patternDensityLimit },
      color: { over: features.colorCount > profile.maxColorCount, value: features.colorCount, max: profile.maxColorCount },
      blank: {
        short: features.blankRatio < profile.safeZone.top + profile.safeZone.bottom,
        value: features.blankRatio,
        need: profile.safeZone.top + profile.safeZone.bottom,
      },
    }

    // —— 理由 ——
    // 每个维度算一个**带符号**的显著度：正数 = 这一项在给这个模型加分，负数 = 这一项在扣分。
    // 最后按「这个模型到底推不推荐」挑标题：
    //   · 推荐它（≥ recommendThreshold）→ 说最大的那个**加分项**，用户才知道「它凭什么」；
    //   · 不推荐 → 说最大的那个**扣分项**，用户才知道「差在哪」。
    // 这样理由永远不会说反 —— 不会给排第一的模型写「边缘不连续」当标题。
    // 并列时按 curves.reasonPriority 定序，免得措辞随内部改动乱跳。
    const reasons: ReasonEntry[] = []
    const add = (kind: ReasonEntry['kind'], dimScore: number, text: string) => {
      reasons.push({ kind, salience: (dimScore - 0.5) * weights[kind], text })
    }

    add(
      'density',
      density,
      gaps.density.over
        ? copy.densityHigh(pct(features.patternDensity), pct(profile.patternDensityLimit), loosestName)
        : copy.densityFit(pct(features.patternDensity), pct(profile.patternDensityLimit)),
    )
    add(
      'color',
      color,
      gaps.color.over
        ? copy.colorHigh(String(features.colorCount), String(profile.maxColorCount), loosestName)
        : copy.colorFit(String(features.colorCount), String(profile.maxColorCount)),
    )
    // 留白单独处理：不足时按缺口扣，满足时按「这个模型的要求有多严」给正分
    reasons.push(
      gaps.blank.short
        ? {
            kind: 'blank',
            salience: -(1 - blank) * weights.blank,
            text: copy.blankShort(pct(features.blankRatio), pct(gaps.blank.need)),
          }
        : {
            kind: 'blank',
            salience: maxBlankNeed > 0 ? (gaps.blank.need / maxBlankNeed) * weights.blank : 0,
            text: copy.blankEnough(pct(features.blankRatio), pct(gaps.blank.need)),
          },
    )
    if (COMPAT_CONFIG.seamScoredUvTypes.includes(profile.uvType)) {
      add(
        'seam',
        seam,
        gaps.seam.needed
          ? copy.edgeSeam(pct(features.edgeSimilarity))
          : copy.edgeSeamless(pct(features.edgeSimilarity)),
      )
    }
    add(
      'ratio',
      ratio,
      gaps.ratio.mismatch ? copy.ratioOff(String(profile.targetRatio)) : copy.ratioFit(String(profile.targetRatio)),
    )

    // 图案类型：radial / any 纯规则判不出来 —— 给中性分，且不参与选标题
    if (profile.patternType === 'radial') {
      reasons.push({ kind: 'pattern', salience: 0, text: copy.patternRadial() })
    } else if (profile.patternType === 'any') {
      reasons.push({ kind: 'pattern', salience: 0, text: copy.patternFallback() })
    } else {
      add(
        'pattern',
        pattern,
        profile.patternType === 'seamless'
          ? copy.patternSeamless(pct(features.edgeSimilarity))
          : pattern >= 0.6
            ? copy.patternCentered()
            : copy.generic(),
      )
    }

    const rankOf = (kind: ReasonEntry['kind']) => COMPAT_CONFIG.curves.reasonPriority.indexOf(kind)
    const ordered = [...reasons].sort((a, b) => b.salience - a.salience || rankOf(a.kind) - rankOf(b.kind))
    const recommended = score >= COMPAT_CONFIG.recommendThreshold
    const headline: ReasonEntry | undefined = recommended ? ordered[0] : ordered[ordered.length - 1]
    const strong = headline ? (recommended ? headline.salience > 0.01 : headline.salience < -0.01) : false

    return {
      ...profile,
      score,
      breakdown: { ratio, seam, blank, density, color, pattern, penalty },
      gaps,
      reasons,
      topReason: strong && headline ? headline.text : copy.generic(),
    }
  })

  return scored.sort((a, b) => b.score - a.score)
}

export interface Recommendation {
  features: ImageFeatures
  /** 按分数从高到低的全量 9 条 */
  all: ModelScore[]
  /** 推荐位（≥ recommendThreshold 的前 topN 个） */
  top: ModelScore[]
  /** 折叠在「其他可选模型」里的那些 */
  rest: ModelScore[]
}

/**
 * 顶层入口：给一张图，返回推荐结果。
 * 任何异常（图片加载失败、跨域污染、画布不可用）都返回 null —— 调用方只需要「有结果就显示、没有就收摊」，
 * 不会因为分析失败打断用户的贴图流程（硬性约束 2）。
 */
export async function recommendModels(url: string): Promise<Recommendation | null> {
  try {
    const features = await extractImageFeatures(url)
    const loosest = listProfiles().reduce(
      (best, item) => (item.patternDensityLimit > best.patternDensityLimit ? item : best),
      listProfiles()[0],
    )
    const all = scoreModels(features, loosest?.presetName ?? '帆布包·托特')
    const top = all.slice(0, COMPAT_CONFIG.topN)
    const recommended = top.filter((item) => item.score >= COMPAT_CONFIG.recommendThreshold)
    return {
      features,
      all,
      // 若前三名全都低于阈值（图片确实很挑），仍然给前 3 兜底，只是理由会说清楚差距
      top: recommended.length > 0 ? recommended : top,
      rest: all.filter((item) => !(recommended.length > 0 ? recommended : top).includes(item)),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 开发期调试钩子
/**
 * 和 `Scene.tsx` 里那个 `window.__scene` 一个路子：只在 dev 下挂，
 * 生产构建里 `import.meta.env.DEV === false`，这段会被摇掉。
 *
 * 干什么用：
 *   · 端到端脚本 / 控制台里可以直接对任意图片 URL 跑一遍评分，而不用真的走一遍上传；
 *   · 调阈值时能当场看到 6 个维度的原始分，不用靠「看起来变了」猜。
 *
 * 例：
 *   const r = await window.__compat.recommendModels('/scene-shots/gejin-….png')
 *   r.features, r.all.map(m => [m.presetName, m.score])
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__compat = {
    COMPAT_CONFIG,
    PROFILE_TO_PRESET,
    listProfiles,
    extractImageFeatures,
    scoreModels,
    recommendModels,
  }
}
