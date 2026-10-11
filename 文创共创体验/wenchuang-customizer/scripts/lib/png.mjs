/**
 * 最小 PNG 编解码 —— 只覆盖「商品模型里嵌的那种贴图」，不引第三方依赖。
 *
 * 为什么需要它：模型自带烘焙贴图（扫描件 / AI 上色件）之后，脚本要能
 *   ① **按贴图颜色分区**（在三角形 UV 处采样 baseColor，认出「白布」「木纹」这类区域）
 *   ② **压缩体积**（4096² 的扫描贴图能到 30 MB+，网页端必须降采样重编码）
 * 两件事都得自己读 / 写 PNG。Node 只有 zlib，没有图像库，所以这里手写一份。
 *
 * 解码支持的范围（够用就好，超出范围会明确报错而不是悄悄解错）：
 *   位深 8、非隔行、颜色类型 0(灰) / 2(RGB) / 3(调色板) / 4(灰+Alpha) / 6(RGBA)。
 *   16 位、Adam7 隔行不支持 —— 真遇到就先去别处转一道。
 *
 * 编码固定输出 8 位 RGBA、filter 0（和 `make-pattern-texture.mjs` 原来那份一致）。
 */

import zlib from 'node:zlib'

// ------------------------------------------------------------------ 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/**
 * 编码成 PNG。
 * @param {number} width
 * @param {number} height
 * @param {Buffer|Uint8Array} rgba 长度是 width * height * 4（`alpha:false` 时也照收，只取前 3 个通道）
 * @param {{alpha?: boolean}} [options] `alpha:false` 写成颜色类型 2（RGB）—— 贴图都不用透明通道，
 *        丢掉那 1/4 的体积很划算（实测 1024² 的 baseColor：1.69 MB → 1.26 MB）。
 */
export function encodePng(width, height, rgba, options = {}) {
  const alpha = options.alpha !== false
  const outChannels = alpha ? 4 : 3
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)

  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * outChannels)
    if (alpha) {
      src.copy(row, 0, y * width * 4, (y + 1) * width * 4)
    } else {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4
        row[x * 3] = src[s]
        row[x * 3 + 1] = src[s + 1]
        row[x * 3 + 2] = src[s + 2]
      }
    }
    rows.push(row)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = outChannels === 4 ? 6 : 2 // RGBA / RGB
  const idat = zlib.deflateSync(encodeRows(rows, outChannels), { level: 9, memLevel: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------ 解码

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** 一行的字节数（不含 filter 字节） */
function rowBytes(width, channels, depth) {
  return Math.ceil((width * channels * depth) / 8)
}

/** Paeth 预测器（PNG 规范里的定义） */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * 逐行挑 filter：5 种各算一遍，取「滤完以后字节绝对值和最小」的那种。
 *
 * 为什么要挑：行内预测（Sub / Up / Paeth）能把照片那种平滑渐变压成大片 0 和 ±1，
 * zlib 一压就小很多；但不同的行适合不同的 filter，固定用一种会浪费不少体积。
 * 打分按 PNG 编码器通行做法 —— 把字节当**有符号**数取绝对值再求和，
 * 因为 -1 和 +1 都只占一个字节的熵，而 255 值 8 个有效位。
 */
function filterRow(row, prev, bpp, type, out, offset) {
  const stride = row.length
  for (let x = 0; x < stride; x++) {
    const raw = row[x]
    const left = x >= bpp ? row[x - bpp] : 0
    const up = prev ? prev[x] : 0
    const upLeft = prev && x >= bpp ? prev[x - bpp] : 0
    let value
    if (type === 0) value = raw
    else if (type === 1) value = raw - left
    else if (type === 2) value = raw - up
    else if (type === 3) value = raw - ((left + up) >> 1)
    else value = raw - paeth(left, up, upLeft)
    out[offset + x] = value & 0xff
  }
}

function scoreRow(buffer, offset, stride) {
  let score = 0
  for (let x = 0; x < stride; x++) {
    const v = buffer[offset + x]
    score += v < 128 ? v : 256 - v
  }
  return score
}

function encodeRows(rows, bpp) {
  const stride = rows[0].length
  const scratch = Buffer.alloc(stride * 5)
  const out = Buffer.alloc((stride + 1) * rows.length)
  for (let y = 0; y < rows.length; y++) {
    const prev = y > 0 ? rows[y - 1] : null
    let best = 0
    let bestScore = Infinity
    for (let type = 0; type < 5; type++) {
      filterRow(rows[y], prev, bpp, type, scratch, type * stride)
      const score = scoreRow(scratch, type * stride, stride)
      if (score < bestScore) {
        bestScore = score
        best = type
      }
    }
    out[y * (stride + 1)] = best
    scratch.copy(out, y * (stride + 1) + 1, best * stride, (best + 1) * stride)
  }
  return out
}

/**
 * 反 filter（就地改 data）。data 是「每行前面带 1 个 filter 字节」的原始 IDAT 输出。
 * 参考 PNG 规范 9.2：Sub / Up / Average / Paeth 都是「左 / 上 / 左上」的线性组合。
 */
function unfilter(data, height, stride, bpp) {
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = data[pos++]
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const raw = data[pos++]
      const left = x >= bpp ? row[x - bpp] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0
      let value
      switch (filter) {
        case 0: value = raw; break
        case 1: value = raw + left; break
        case 2: value = raw + up; break
        case 3: value = raw + ((left + up) >> 1); break
        case 4: value = raw + paeth(left, up, upLeft); break
        default: throw new Error(`不认识的 PNG filter 类型 ${filter}（第 ${y} 行）`)
      }
      row[x] = value & 0xff
    }
  }
  return out
}

/**
 * 解码 PNG → { width, height, data }，data 是 8 位 RGBA。
 * @param {Buffer|Uint8Array} input
 */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG（magic 对不上）')

  let offset = 8
  let header = null
  let palette = null
  let transparency = null
  const idat = []

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'PLTE') {
      palette = Buffer.from(body)
    } else if (type === 'tRNS') {
      transparency = Buffer.from(body)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length // 长度(4) + 类型(4) + 数据 + CRC(4)
  }

  if (!header) throw new Error('PNG 里没有 IHDR')
  const { width, height, depth, colorType, interlace } = header
  if (depth !== 8) throw new Error(`只支持 8 位 PNG，这张是 ${depth} 位`)
  if (interlace !== 0) throw new Error('不支持隔行（Adam7）PNG')
  const channels = CHANNELS_BY_COLOR_TYPE[colorType]
  if (!channels) throw new Error(`不支持的 PNG 颜色类型 ${colorType}`)
  if (colorType === 3 && !palette) throw new Error('调色板 PNG 缺少 PLTE')

  const stride = rowBytes(width, channels, depth)
  const raw = unfilter(zlib.inflateSync(Buffer.concat(idat)), height, stride, channels)

  const data = new Uint8Array(width * height * 4)
  for (let i = 0, count = width * height; i < count; i++) {
    const s = i * channels
    const d = i * 4
    if (colorType === 0) {
      data[d] = data[d + 1] = data[d + 2] = raw[s]
      data[d + 3] = 255
    } else if (colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = raw[s]
      data[d + 3] = raw[s + 1]
    } else if (colorType === 2) {
      data[d] = raw[s]
      data[d + 1] = raw[s + 1]
      data[d + 2] = raw[s + 2]
      data[d + 3] = 255
    } else if (colorType === 6) {
      data[d] = raw[s]
      data[d + 1] = raw[s + 1]
      data[d + 2] = raw[s + 2]
      data[d + 3] = raw[s + 3]
    } else {
      const p = raw[s] * 3
      data[d] = palette[p]
      data[d + 1] = palette[p + 1]
      data[d + 2] = palette[p + 2]
      data[d + 3] = transparency && raw[s] < transparency.length ? transparency[raw[s]] : 255
    }
  }

  return { width, height, data }
}

// ------------------------------------------------------------------ 缩放

/**
 * 整数倍盒式降采样（4×4 → 1 像素，逐通道取平均）。
 *
 * 为什么用盒式而不是双线性：贴图基本都是 4096 → 1024 / 2048 这种**整数倍**，
 * 盒式正好把每个目标像素对应的 N×N 源像素全平均一遍 —— 数学上就是理想的
 * 「面积平均」，不会像最近邻那样丢细节、也不会像双线性那样只采 4 个点。
 * 缩放走 RGB，alpha 保持不透明（贴图都不用透明通道）。
 *
 * @param {{width:number,height:number,data:Uint8Array}} image
 * @param {number} factor 必须是正整数，且能整除宽高
 */
export function downscaleBox(image, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('缩放倍数必须是正整数')
  const { width, height, data } = image
  if (width % factor !== 0 || height % factor !== 0) {
    throw new Error(`宽高 ${width}×${height} 不能被 ${factor} 整除，盒式降采样做不了`)
  }
  const outWidth = width / factor
  const outHeight = height / factor
  const out = new Uint8Array(outWidth * outHeight * 4)
  const area = factor * factor

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * width
        for (let dx = 0; dx < factor; dx++) {
          const s = (row + x * factor + dx) * 4
          r += data[s]
          g += data[s + 1]
          b += data[s + 2]
        }
      }
      const d = (y * outWidth + x) * 4
      out[d] = Math.round(r / area)
      out[d + 1] = Math.round(g / area)
      out[d + 2] = Math.round(b / area)
      out[d + 3] = 255
    }
  }

  return { width: outWidth, height: outHeight, data: out }
}

/** 取某个整数因子的降采样版本；给不了整数因子就返回原图（并说明原因） */
export function downscaleToAtMost(image, target) {
  const factor = Math.min(
    Math.floor(image.width / target),
    Math.floor(image.height / target),
  )
  if (factor < 2) return { image, factor: 1, changed: false }
  return { image: downscaleBox(image, factor), factor, changed: true }
}
