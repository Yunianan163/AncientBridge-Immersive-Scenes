/**
 * 生成一张「古桥」示例纹样 PNG（纯代码画，不需要任何外部素材 / 不联网）。
 *
 * 用途：给 `docs/测试贴图.png` 之外的**效果图**提供一张像样的图案 ——
 * 棋盘测试图是用来核对 UV 方向与拉伸的（坐标纸），不适合拿给人看成品。
 * 跑 e2e 出成品图时用环境变量换掉上传图：
 *
 *   node scripts/make-pattern-texture.mjs                       # → docs/纹样示例.png
 *   E2E_UPLOAD=docs/纹样示例.png node scripts/e2e-paint.mjs --model bag_a --prefix 32-bag成品
 *
 * 画法：900×900 的 Float32 画布 + 逐形状「解析判定 + 3×3 超采样」上色
 * （每个形状只在它自己的包围盒里遍历，所以 40 多个形状也能秒出）。
 * PNG 编码用 `scripts/lib/png.mjs`（Node 自带 zlib 手写，不引第三方依赖）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './lib/png.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.OUT || path.join(ROOT, 'docs', '纹样示例.png')

// ------------------------------------------------------------------ PNG 编码

// 编解码统一放在 scripts/lib/png.mjs（fix-model.mjs 压缩内嵌贴图时也要用，别各写一份）
// ------------------------------------------------------------------ 画布

const S = 900
const px = new Float32Array(S * S * 3)

/**
 * 色板：`PALETTE=blue`（默认，青花蓝）或 `PALETTE=red`（朱砂红）。
 * 出「正反两面各贴一张不同图」的对照图时，用两个色板各生成一张 ——
 * 颜色差得开，一眼就能看出两面确实是两张不同的贴图。
 */
const PALETTES = {
  blue: { paper: [243, 239, 229], ink: [42, 62, 104], inkSoft: [124, 146, 178], cinnabar: [178, 74, 58] },
  red: { paper: [246, 238, 226], ink: [146, 52, 40], inkSoft: [201, 140, 118], cinnabar: [122, 46, 40] },
}
const PALETTE = PALETTES[(process.env.PALETTE || 'blue').trim()] || PALETTES.blue

const PAPER = PALETTE.paper
const INK = PALETTE.ink
const INK_SOFT = PALETTE.inkSoft
const CINNABAR = PALETTE.cinnabar
function fill(color) {
  for (let i = 0; i < S * S; i++) {
    px[i * 3] = color[0]
    px[i * 3 + 1] = color[1]
    px[i * 3 + 2] = color[2]
  }
}

/** 用「判定函数 + 包围盒」画一个形状，3×3 超采样做抗锯齿 */
function paint(test, color, bbox, { ss = 3, alpha = 1 } = {}) {
  const [bx0, by0, bx1, by1] = bbox
  const x0 = Math.max(0, Math.floor(bx0))
  const y0 = Math.max(0, Math.floor(by0))
  const x1 = Math.min(S, Math.ceil(bx1))
  const y1 = Math.min(S, Math.ceil(by1))
  const inv = 1 / (ss * ss)
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) {
      let hit = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          if (test(cx + (sx + 0.5) / ss, cy + (sy + 0.5) / ss)) hit++
        }
      }
      if (!hit) continue
      const a = hit * inv * alpha
      const i = (cy * S + cx) * 3
      px[i] += (color[0] - px[i]) * a
      px[i + 1] += (color[1] - px[i + 1]) * a
      px[i + 2] += (color[2] - px[i + 2]) * a
    }
  }
}

// ------------------------------------------------------------------ 基本图元

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

const rectOutline = (x0, y0, x1, y1, t) => (x, y) =>
  (x >= x0 && x <= x1 && y >= y0 && y <= y1) &&
  !(x >= x0 + t && x <= x1 - t && y >= y0 + t && y <= y1 - t)

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

const ring = (cx, cy, r, t) => (x, y) => {
  const d = Math.hypot(x - cx, y - cy)
  return d <= r && d >= r - t
}

function segment(x1, y1, x2, y2, t) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy || 1
  const half = t / 2
  return (x, y) => {
    let u = ((x - x1) * dx + (y - y1) * dy) / len2
    u = u < 0 ? 0 : u > 1 ? 1 : u
    return Math.hypot(x - (x1 + dx * u), y - (y1 + dy * u)) <= half
  }
}

function polyline(points, t) {
  const segs = []
  for (let i = 0; i + 1 < points.length; i++) {
    segs.push(segment(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], t))
  }
  const test = (x, y) => segs.some((s) => s(x, y))
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { test, bbox: [Math.min(...xs) - t, Math.min(...ys) - t, Math.max(...xs) + t, Math.max(...ys) + t] }
}

/** 横荡的水波线：中心线 y = base + amp·sin(x/λ + φ) */
function wave(base, amp, lambda, phase, t) {
  return (x, y) => Math.abs(y - (base + amp * Math.sin(x / lambda + phase))) <= t / 2
}

// ------------------------------------------------------------------ 回纹边框

/** 一个回纹单元的折线（局部 0~1 坐标） */
const MEANDER = [
  [0.08, 0.94], [0.08, 0.08], [0.94, 0.08], [0.94, 0.94],
  [0.38, 0.94], [0.38, 0.38], [0.66, 0.38], [0.66, 0.68],
]

/**
 * ⚠️ 回纹是**沿边**铺的，不是沿带宽铺的 —— 单位格子的大小由边长决定，
 * 带宽只决定格子的「厚度方向」。（第一版把 cells 当成带宽方向的分格数，
 * 900px 的边被切成 9 段带宽 4px 的小格，整条边框退化成几个小短棍。）
 */
function drawMeanderBand(inner, outer, thickness, cells) {
  const bandW = outer - inner
  const from = inner + bandW
  const step = (S - 2 * from) / cells
  const unit = step * 0.9
  const pad = (step - unit) / 2
  const along = (p, u) => p + pad + u * unit
  for (let i = 0; i < cells; i++) {
    const p = from + i * step
    const variants = [
      MEANDER.map(([u, v]) => [along(p, u), inner + v * bandW]), // 上
      MEANDER.map(([u, v]) => [along(p, u), S - inner - v * bandW]), // 下
      MEANDER.map(([u, v]) => [inner + v * bandW, along(p, u)]), // 左
      MEANDER.map(([u, v]) => [S - inner - v * bandW, along(p, u)]), // 右
    ]
    for (const points of variants) {
      const { test, bbox } = polyline(points, thickness)
      paint(test, INK, bbox, { alpha: 0.9 })
    }
  }
  // 四个角上放「回」字套方，把四条边接起来
  for (const [cx, cy] of [[from - bandW, from - bandW], [S - from, from - bandW], [from - bandW, S - from], [S - from, S - from]]) {
    for (let k = 0; k < 3; k++) {
      const t = k * bandW * 0.19
      paint(
        rectOutline(cx + t, cy + t, cx + bandW - t, cy + bandW - t, thickness),
        INK,
        [cx - thickness, cy - thickness, cx + bandW + thickness, cy + bandW + thickness],
        { alpha: 0.9 },
      )
    }
  }
}

// ------------------------------------------------------------------ 开始画

fill(PAPER)

const M = 46
const BAND = 62

// 外框双线
paint(rectOutline(M, M, S - M, S - M, 5), INK, [M - 6, M - 6, S - M + 6, S - M + 6], { alpha: 0.85 })
paint(
  rectOutline(M + BAND, M + BAND, S - M - BAND, S - M - BAND, 4),
  INK,
  [M + BAND - 5, M + BAND - 5, S - M - BAND + 5, S - M - BAND + 5],
  { alpha: 0.8 },
)
drawMeanderBand(M + 14, M + BAND - 12, 5, 13)

// ---- 飞鸟（人字形两笔）
function bird(cx, cy, s, t) {
  const { test, bbox } = polyline(
    [[cx - s, cy - s * 0.35], [cx, cy + s * 0.28], [cx + s, cy - s * 0.35]],
    t,
  )
  paint(test, INK, bbox, { alpha: 0.62 })
}
bird(0.335 * S, 0.285 * S, 0.020 * S, 3.2)
bird(0.402 * S, 0.240 * S, 0.015 * S, 2.8)
bird(0.462 * S, 0.300 * S, 0.017 * S, 3.0)
bird(0.298 * S, 0.352 * S, 0.013 * S, 2.6)

// ---- 远山（淡墨两座）
const horizon = 0.665 * S
const hill = (cx, w, h) => (x, y) => {
  const u = (x - cx) / w
  if (u <= -1 || u >= 1) return false
  const top = horizon - h * Math.sqrt(1 - u * u)
  return y >= top && y <= horizon
}
paint(hill(0.30 * S, 0.30 * S, 0.175 * S), INK_SOFT, [0, horizon - 0.2 * S, 0.62 * S, horizon], { alpha: 0.32, ss: 2 })
paint(hill(0.70 * S, 0.34 * S, 0.13 * S), INK_SOFT, [0.34 * S, horizon - 0.16 * S, S, horizon], { alpha: 0.24, ss: 2 })

// ---- 月（留白 + 淡青边）
paint(disc(0.705 * S, 0.185 * S, 0.062 * S), INK_SOFT, [0.62 * S, 0.10 * S, 0.79 * S, 0.27 * S], { alpha: 0.12, ss: 2 })
paint(ring(0.705 * S, 0.185 * S, 0.062 * S, 3.4), INK, [0.62 * S, 0.10 * S, 0.79 * S, 0.27 * S], { alpha: 0.5 })

// ---- 云纹（三条同心弧 + 小勾）
function cloud(cx, cy, r, t) {
  const arcs = [
    (x, y) => y <= cy && Math.hypot(x - cx, y - cy) <= r && Math.hypot(x - cx, y - cy) >= r - t,
    (x, y) => x >= cx && Math.hypot(x - cx, y - cy) <= r * 0.66 && Math.hypot(x - cx, y - cy) >= r * 0.66 - t,
    (x, y) => y >= cy && Math.hypot(x - cx, y - cy) <= r * 0.36 && Math.hypot(x - cx, y - cy) >= r * 0.36 - t,
  ]
  const test = (x, y) => arcs.some((f) => f(x, y))
  paint(test, INK, [cx - r - t, cy - r - t, cx + r + t, cy + r + t], { alpha: 0.55 })
}
cloud(0.245 * S, 0.175 * S, 0.052 * S, 3.2)
cloud(0.40 * S, 0.115 * S, 0.032 * S, 2.6)
cloud(0.845 * S, 0.335 * S, 0.026 * S, 2.4)

// ---- 石拱桥
const WATER = 0.735 * S
const R = 0.072 * S
const DECK_T = 0.034 * S
const RAIL_H = 0.032 * S
const DECK_TOP = WATER - R - DECK_T
const SPAN = R * 2.55
const CX = 0.5 * S
const arches = [CX - SPAN, CX, CX + SPAN]
const BX0 = arches[0] - R - 0.014 * S
const BX1 = arches[2] + R + 0.014 * S

const archOpen = (x, y) => y <= WATER && arches.some((cx) => (x - cx) ** 2 + (y - WATER) ** 2 <= R * R)

// 桥体（桥面 + 桥墩），拱洞是挖空的
paint(
  (x, y) => x >= BX0 && x <= BX1 && y >= DECK_TOP && y <= WATER && !archOpen(x, y),
  INK,
  [BX0, DECK_TOP, BX1, WATER],
  { alpha: 0.95 },
)

// 拱圈上线（浅色描一道，让拱形更清楚）
for (const cx of arches) {
  paint(
    (x, y) => y <= WATER && Math.abs(Math.hypot(x - cx, y - WATER) - R) <= 2.6,
    PAPER,
    [cx - R - 4, WATER - R - 4, cx + R + 4, WATER + 4],
    { alpha: 0.55 },
  )
}

// 栏杆：立柱 + 压顶横杆
for (let x = BX0 + 0.012 * S; x <= BX1 - 0.012 * S; x += 0.026 * S) {
  const post = segment(x, DECK_TOP, x, DECK_TOP - RAIL_H, 4.2)
  paint(post, INK, [x - 4, DECK_TOP - RAIL_H - 4, x + 4, DECK_TOP + 4], { alpha: 0.9 })
}
paint(
  rect(BX0 - 0.008 * S, DECK_TOP - RAIL_H - 4.5, BX1 + 0.008 * S, DECK_TOP - RAIL_H + 4.5),
  INK,
  [BX0 - 0.012 * S, DECK_TOP - RAIL_H - 8, BX1 + 0.012 * S, DECK_TOP - RAIL_H + 8],
  { alpha: 0.9 },
)

// 桥面底线
paint(rect(BX0, DECK_TOP, BX1, DECK_TOP + 4.5), INK, [BX0, DECK_TOP - 2, BX1, DECK_TOP + 7], { alpha: 0.9 })

// ---- 水纹
const waterWaves = [
  [WATER + 0.030 * S, 5.5, 0.115 * S, 0.0, 3.4],
  [WATER + 0.058 * S, 4.0, 0.085 * S, 1.7, 3.0],
  [WATER + 0.086 * S, 6.5, 0.140 * S, 3.1, 3.4],
  [WATER + 0.114 * S, 3.5, 0.070 * S, 0.6, 2.8],
]
waterWaves.forEach(([base, amp, lambda, phase, t], i) => {
  paint(wave(base, amp, lambda, phase, t), INK, [M + BAND, base - amp - t, S - M - BAND, base + amp + t], {
    alpha: 0.72 - i * 0.12,
  })
})

// 桥下倒影：三段短横线
for (const cx of arches) {
  for (let k = 0; k < 3; k++) {
    const y = WATER + 0.026 * S + k * 0.024 * S
    const w = (R * 1.15 - k * 0.14 * R) * 0.5
    paint(rect(cx - w, y, cx + w, y + 2.8), INK, [cx - w, y - 2, cx + w, y + 5], { alpha: 0.22 })
  }
}

// ---- 朱砂印（右下）
const sx0 = 0.735 * S
const sy0 = 0.755 * S
const sw = 0.115 * S
paint(rect(sx0, sy0, sx0 + sw, sy0 + sw), CINNABAR, [sx0, sy0, sx0 + sw, sy0 + sw], { alpha: 0.13 })
paint(rectOutline(sx0, sy0, sx0 + sw, sy0 + sw, 6), CINNABAR, [sx0 - 7, sy0 - 7, sx0 + sw + 7, sy0 + sw + 7], { alpha: 0.92 })
// 印面：一个「桥」字意思的抽象结构 —— 两横 + 拱 + 一竖
const seal = [
  [[0.22, 0.26], [0.78, 0.26]],
  [[0.30, 0.46], [0.70, 0.46]],
  [[0.30, 0.46], [0.40, 0.72], [0.60, 0.72], [0.70, 0.46]],
  [[0.50, 0.26], [0.50, 0.80]],
  [[0.22, 0.80], [0.78, 0.80]],
]
for (const points of seal) {
  const { test, bbox } = polyline(points.map(([u, v]) => [sx0 + u * sw, sy0 + v * sw]), 5.2)
  paint(test, CINNABAR, bbox, { alpha: 0.92 })
}

// ------------------------------------------------------------------ 输出

const rgba = Buffer.alloc(S * S * 4)
for (let i = 0; i < S * S; i++) {
  rgba[i * 4] = Math.max(0, Math.min(255, Math.round(px[i * 3])))
  rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(px[i * 3 + 1])))
  rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(px[i * 3 + 2])))
  rgba[i * 4 + 3] = 255
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, encodePng(S, S, rgba))
console.log(`已生成 ${path.relative(ROOT, OUT)}  ${S}×${S}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`)
