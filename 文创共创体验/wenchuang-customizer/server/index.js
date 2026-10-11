/**
 * 文创商品 AI 定制 —— 后端服务
 *
 * 职责：
 *   1. POST /api/generate  文字生图：转发到火山方舟 Seedream，并把图片落盘到本地，
 *                          返回同源可读的图片地址（避免浏览器跨域污染画布）。
 *   2. POST /api/redraw    图生图：拿一张已有图片（场景截图 / AI 出图）当参考再创作，
 *                          同样落盘到本地。前端接入点见 src/components/SceneShotPanel.tsx。
 *   3. POST /api/order     接收前端导出的 GLB + 截图 + 用户信息，存到 ./orders/<orderId>/。
 *
 * 启动：node server/index.js   （或 npm run server）
 * 依赖：express + cors + dotenv，HTTP 请求全部走 Node 18+ 内置 fetch，无需额外装包。
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

// .env 放在项目根目录（与 package.json 同级）
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') })

const PORT = Number(process.env.PORT || 3001)
const ARK_API_KEY = process.env.ARK_API_KEY
const ARK_ENDPOINT = process.env.ARK_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
/**
 * 火山方舟的模型 ID。
 *
 * ⚠️ 必须用**带版本号的完整 ID**。不带后缀的 `doubao-seedream-5-0` 是滚动别名，
 *    它指向的 `doubao-seedream-5-0-260128` 已进入退役（Retiring）状态，
 *    直调会报 `OperationDenied.ModelRetiring`；带日期的 `-flash-260915` 才是在售版本。
 */
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seedream-5-0-flash-260915'
/** Seedream 的尺寸档位：文案档 `2K` / `4K`，或具体像素如 `2048x2048` */
const ARK_SIZE = process.env.ARK_SIZE || '2K'
/** 是否给生成图打「AI 生成」水印。默认开：贴到商品上是展示图，带水印更稳妥 */
const ARK_WATERMARK = String(process.env.ARK_WATERMARK ?? 'true').toLowerCase() !== 'false'
/**
 * 输出侧内容 / 版权审核被拦时，自动重试的次数（0 = 不重试，默认 1）。
 *
 * 这一侧的判定带随机性：同一份 prompt 与同一张参考图，换个时刻往往就过了。
 * 不自动重试的话用户会以为功能坏了 —— 但每次重试都真实计费，所以留了开关。
 */
const ARK_POLICY_RETRY = Math.max(0, Number(process.env.ARK_POLICY_RETRY ?? 1) || 0)

// 生成图落盘目录（作为静态资源对外暴露，前端可直接当贴图用）
const GEN_DIR = path.join(__dirname, 'public', 'generated')
// 场景截图素材库：苏州双桥 / 贵州葛镜桥 的截图都汇总到这里，文创页面按它列图。
// 接口见下方 /api/scene-snapshots，前端面板见 src/components/SceneShotPanel.tsx。
const SCENE_SHOTS_DIR = path.join(__dirname, 'public', 'scene-shots')
// 订单落盘目录：./orders/
const ORDERS_DIR = path.join(PROJECT_ROOT, 'orders')

fs.mkdirSync(GEN_DIR, { recursive: true })
fs.mkdirSync(SCENE_SHOTS_DIR, { recursive: true })
fs.mkdirSync(ORDERS_DIR, { recursive: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '96mb' }))
app.use('/generated', express.static(GEN_DIR, { maxAge: '7d' }))
app.use('/scene-shots', express.static(SCENE_SHOTS_DIR, { maxAge: '7d' }))

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

const log = (...args) => console.log('[wc-server]', ...args)
const warn = (...args) => console.warn('[wc-server]', ...args)

/**
 * 把远程图片下载到本地 GEN_DIR，返回 { path, url }；url 是相对路径，
 * 前端自己决定要不要拼 API 前缀，这样走 vite 代理时天然同源。
 */
async function cacheImage(sourceUrl, kind = 'ai') {
  const ext0 = extensionFromUrl(sourceUrl)
  const file = `${kind}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext0}`

  try {
    if (sourceUrl.startsWith('data:')) {
      const [meta, payload] = sourceUrl.split(',')
      const mime = meta.slice(5).split(';')[0]
      const ext = EXT_BY_TYPE[mime] || ext0
      const name = file.replace(/\.[^.]+$/, ext)
      await fsp.writeFile(path.join(GEN_DIR, name), Buffer.from(payload, 'base64'))
      return { path: path.join(GEN_DIR, name), url: `/generated/${name}` }
    }

    const resp = await fetch(sourceUrl)
    if (!resp.ok) throw new Error(`下载图片失败：HTTP ${resp.status}`)
    const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0]
    const ext = EXT_BY_TYPE[mime] || ext0
    const name = file.replace(/\.[^.]+$/, ext)
    const buf = Buffer.from(await resp.arrayBuffer())
    await fsp.writeFile(path.join(GEN_DIR, name), buf)
    return { path: path.join(GEN_DIR, name), url: `/generated/${name}` }
  } catch (err) {
    warn('图片本地缓存失败，回退为直连上游地址：', err.message)
    return null
  }
}

function extensionFromUrl(url) {
  try {
    const clean = url.split('?')[0].split('#')[0]
    const ext = path.extname(new URL(clean, 'https://example.com').pathname).toLowerCase()
    if (EXT_BY_TYPE[`image/${ext.slice(1)}`]) return ext
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext
  } catch {
    /* ignore */
  }
  return '.png'
}

// ---------------------------------------------------------------- 健康检查

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: 'volcengine-ark',
    model: ARK_MODEL,
    size: ARK_SIZE,
    watermark: ARK_WATERMARK,
    apiKeyConfigured: Boolean(ARK_API_KEY),
  })
})

// ---------------------------------------------------------------- AI 生图（火山方舟 Seedream）

/** 未配密钥时给出「照着做就行」的提示 —— .env 的层级最容易找错，所以连路径一起说清楚 */
function requireArkKey(res) {
  if (ARK_API_KEY) return true
  // ⚠️ `.env` 要放在 **wenchuang-customizer/**（也就是 server/ 的上一层），
  // 不是仓库根目录 —— dotenv 读的是 `path.resolve(__dirname, '..')/.env`。
  res.status(503).json({
    error:
      '未配置 ARK_API_KEY：在 wenchuang-customizer/ 下执行 `cp .env.example .env`，' +
      '把 ARK_API_KEY 填成火山方舟的密钥，然后重启 `npm run server`',
  })
  return false
}

/**
 * 把方舟的错误码翻译成「用户能照着做」的中文。
 *
 * 这几个错都**不是重试能解决的**（尤其 SetLimitExceeded 是账号级额度熔断，不是并发限流），
 * 所以必须把「去哪儿、改什么」写进提示，否则前端只会弹一句看不懂的英文。
 */
function describeArkError(status, payload) {
  const code = payload?.error?.code || ''
  const raw = payload?.error?.message || payload?.message || `上游接口返回 HTTP ${status}`

  if (code === 'SetLimitExceeded') {
    return (
      `账号的「安心体验模式」额度已用满，模型 ${ARK_MODEL} 被官方熔断（属账号级额度限制，非并发限流，重试无效）。` +
      '请到火山方舟控制台 → 模型开通，调整该模型的安心体验模式限额，或关闭它改为按量付费，然后重试。'
    )
  }
  if (code === 'OperationDenied.ModelRetiring') {
    return (
      `模型 ${ARK_MODEL} 正在退役，已被官方拒绝调用。` +
      '请在 .env 里把 ARK_MODEL 换成方舟控制台在售的 Seedream 模型 ID（形如 doubao-seedream-5-0-flash-260915）。'
    )
  }
  if (code === 'ModelNotOpen' || /has not activated/i.test(raw)) {
    return `账号尚未开通模型 ${ARK_MODEL}。请到火山方舟控制台 → 模型开通，先开通该模型再重试。`
  }
  if (status === 401 || code === 'AuthenticationError') {
    return 'ARK_API_KEY 无效或已过期，请检查 .env 里的密钥。'
  }

  // 内容审核：方舟把「被拦的是哪一侧」编进了 code
  // （InputText / InputImage / OutputImage + `.PolicyViolation` 之类的子原因）。
  // 这里必须分开说 —— 输入侧重试无效、只能换素材；输出侧带随机性、值得再试。
  if (/^InputTextSensitiveContentDetected/i.test(code)) {
    return (
      '方舟判定**你写的描述**里含违规或受版权保护的词，已拦下（重试无效）。' +
      '请把描述里可能受保护的作品名 / 角色名 / 品牌名去掉，换更泛化的说法再试。'
    )
  }
  if (/^InputImageSensitiveContentDetected/i.test(code)) {
    return (
      '方舟判定**上传的参考图**可能涉及版权风险，已拦下（重试无效）。' +
      '请更换参考图，避开知名角色、品牌 logo、名画、影视截图等受保护内容。'
    )
  }
  if (/^Output(Image|Text)SensitiveContentDetected/i.test(code)) {
    const why = /copyright/i.test(raw) ? '可能涉及版权风险' : '触发了内容安全策略'
    return (
      `方舟判定这次**生成的图**${why}，把结果拦下了。` +
      '这是输出侧审核，不是密钥 / 额度 / 代码的问题，而且**带随机性 —— 同样的输入换个时刻往往就过了**。' +
      '如果连续几次都被拦，说明参考图里的受保护元素太明显：换一张参考图，' +
      '或把描述写得更泛化（少提具体作品名、角色名、品牌）再试。'
    )
  }

  // 兜底：至少让用户知道这是「上游拒绝」，而不是本地坏了
  return `方舟拒绝了这次请求：${raw}`
}

/**
 * 发一次生图请求。失败时把 `code` 一并带回来，好让上层判断值不值得重试。
 *
 * 文生图与图生图是**同一个端点**，差别只在请求体带不带 `image`：
 *   文生图  { model, prompt, response_format, size, stream, watermark }
 *   图生图  在此基础上多一个 `image`（参考图 URL 或 Base64）
 */
async function postArkOnce({ prompt, image }) {
  const body = {
    model: ARK_MODEL,
    prompt,
    response_format: 'url',
    size: ARK_SIZE,
    stream: false,
    watermark: ARK_WATERMARK,
  }
  // 只有图生图才带 image：文生图带空值会被上游当成非法参考图直接报错
  if (image) body.image = image

  const resp = await fetch(ARK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })

  const payload = await resp.json().catch(() => null)
  const code = payload?.error?.code || ''

  if (!resp.ok || payload?.error) {
    warn('方舟返回错误：', JSON.stringify(payload?.error ?? payload)?.slice(0, 500))
    return { error: describeArkError(resp.status, payload), code }
  }

  // 方舟是 OpenAI 兼容风格：图在 data[0].url；images[0] 留作兜底
  const first = payload?.data?.[0] || payload?.images?.[0] || null
  const remoteUrl = first?.url || null
  const b64 = first?.b64_json || null
  const sourceUrl = remoteUrl || (b64 ? `data:image/png;base64,${b64}` : null)

  if (!sourceUrl) return { error: '上游未返回图片，请稍后重试', code: '' }
  return { sourceUrl }
}

/**
 * 调火山方舟 Seedream 生图，必要时自动重试。
 *
 * **只对「输出侧审核」这类随机拒绝重试**：参数错、额度熔断、模型退役、版权词
 * 这些再试一百次也是同样的结果，重试只会让用户白等半分钟。
 */
async function requestArkImage({ prompt, image }) {
  let lastError = '生成失败'

  for (let attempt = 0; attempt <= ARK_POLICY_RETRY; attempt++) {
    const result = await postArkOnce({ prompt, image })
    if (!result.error) return { sourceUrl: result.sourceUrl }

    lastError = result.error

    const worthRetry = /^Output(Image|Text)SensitiveContentDetected/i.test(result.code)
    if (!worthRetry || attempt === ARK_POLICY_RETRY) break

    warn(`输出侧审核拦截（${result.code}），自动重试第 ${attempt + 1} 次…`)
  }

  return { error: lastError }
}

// ------------------------------------------------ 图生图：把本机参考图转成 Base64

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

const isLoopbackHost = (host) => /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(host)

/**
 * URL 路径 → 磁盘路径。
 *
 * 只放行 `/scene-shots/` 与 `/generated/` 这两个已挂载为静态目录的前缀，其余一律拒掉：
 * 入参来自请求体，不设白名单就等于对外开了任意文件读取。
 * 文件名再过一道 `path.basename`，把 `../` 这类拼路径的写法吃掉。
 */
function localPathFromUrl(urlPath) {
  let pathname = String(urlPath)
  try {
    pathname = new URL(urlPath, 'http://localhost').pathname
  } catch {
    /* 解析不了就按原字符串处理，下面照样会被前缀白名单挡住 */
  }

  const mounts = [
    ['/scene-shots/', SCENE_SHOTS_DIR],
    ['/generated/', GEN_DIR],
  ]
  for (const [prefix, dir] of mounts) {
    if (!pathname.startsWith(prefix)) continue
    const name = path.basename(pathname.slice(prefix.length))
    if (!name || name.startsWith('.')) return { error: '非法的参考图路径' }
    return { file: path.join(dir, name) }
  }

  return { error: `不支持的参考图路径：${pathname}（只支持 /scene-shots/ 与 /generated/ 下的图片）` }
}

/** 参考图体积上限：方舟对输入图有大小限制，超了会被上游打回，这里提前挡住并给一句人话 */
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

/**
 * 把前端传来的参考图整理成方舟读得到的形式。
 *
 * 支持三种来源：
 *   1. `data:image/…;base64,…` —— 浏览器本地选的文件（AiPanel 的「图生图」上传），原样透传
 *   2. 公网 http(s) 地址 —— 方舟能自己下载，原样透传
 *   3. `/scene-shots/…`、`/generated/…` —— 落在**本机磁盘**上，方舟取不到 localhost，读盘转 Base64
 *
 * 第 3 条是这个函数存在的理由：场景截图和 AI 出图都存在本机，
 * 直传相对路径方舟必然抓不到。
 */
async function resolveReferenceImage(image) {
  const value = String(image ?? '').trim()
  if (!value) return { error: '缺少参考图（image 不能为空）' }

  // ① 浏览器上传的本地文件：本来就是 Base64 data URL，长度能直接推算解码后的字节数
  if (/^data:/i.test(value)) {
    const comma = value.indexOf(',')
    const payloadLength = comma >= 0 ? value.length - comma - 1 : value.length
    // base64 每 4 个字符对应 3 字节，所以 3/4 就是解码后的字节上限
    if (payloadLength * 0.75 > MAX_REFERENCE_BYTES) {
      return { error: `参考图太大了（上限 ${MAX_REFERENCE_BYTES / 1024 / 1024}MB），请换一张小一点的图` }
    }
    return { source: value }
  }

  // ② 公网地址 / ③ 本机静态目录
  let pathname = value
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      // 公网图方舟能自己下载，直接把 URL 给它
      if (!isLoopbackHost(parsed.host)) return { source: value }
      // 指向本机的地址（vite 代理 / 本机预览）方舟同样访问不到，退回去读磁盘
      pathname = parsed.pathname + parsed.search
    } catch {
      return { error: '参考图地址格式不正确' }
    }
  }

  const resolved = localPathFromUrl(pathname)
  if (resolved.error) return { error: resolved.error }

  try {
    const buf = await fsp.readFile(resolved.file)
    if (buf.length > MAX_REFERENCE_BYTES) {
      return { error: `参考图太大了（上限 ${MAX_REFERENCE_BYTES / 1024 / 1024}MB）` }
    }
    const mime = MIME_BY_EXT[path.extname(resolved.file).toLowerCase()] || 'image/png'
    return { source: `data:${mime};base64,${buf.toString('base64')}` }
  } catch {
    return { error: `读不到参考图文件：${path.basename(resolved.file)}` }
  }
}

// ---------------------------------------------------------------- 生图路由

/**
 * 生图的公共收尾：调方舟 → 落盘到本地 → 返回同源地址。
 * 文生图 / 图生图只差一个 image 参数，落盘、缓存与响应结构完全一致，所以合并到一处。
 */
async function generateAndCache({ prompt, image }) {
  const result = await requestArkImage({ prompt, image })
  if (result.error) return { error: result.error }

  // 落盘到本地：前端用同源地址当贴图，canvas 不会被跨域污染（导出截图/GLB 需要）
  const cached = await cacheImage(result.sourceUrl, 'ai')
  return { url: cached?.url || result.sourceUrl, sourceUrl: result.sourceUrl, cached: Boolean(cached) }
}

/**
 * 文生图。前端 AiPanel.tsx 调用，请求体 `{ prompt }`。
 * 对应方舟「文生图」示例：只给 prompt，不给 image。
 */
app.post('/api/generate', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''

  if (!prompt) {
    return res.status(400).json({ error: '请输入要生成的图案描述（prompt 不能为空）' })
  }
  if (!requireArkKey(res)) return

  try {
    const result = await generateAndCache({ prompt })
    if (result.error) {
      warn('文生图失败：', result.error)
      return res.status(502).json({ error: result.error })
    }

    log('文生图成功：', result.url)
    res.json({
      url: result.url,
      prompt,
      // 兼容字段：部分调用方可能想要原始上游地址
      sourceUrl: result.sourceUrl,
      cached: result.cached,
    })
  } catch (err) {
    const message = err?.name === 'TimeoutError' ? '生成超时，请重试' : err?.message || '生成失败'
    warn('文生图异常：', message)
    res.status(500).json({ error: message })
  }
})

/**
 * 图生图。两个前端入口共用同一个接口：
 *   AiPanel.tsx 的「图生图」模式 —— 用户上传本地图片，image 是 Base64 data URL
 *   SceneShotPanel.tsx 的「AI 二次创作」 —— image 是素材库里的 /scene-shots/xxx.png
 *
 * 请求体 `{ prompt, image }`，image 支持三种写法，服务端统一成方舟读得到的形式：
 *   data:image/…;base64,…   浏览器上传的本地文件（原样透传）
 *   https://…/xxx.png       任意公网图（原样透传给方舟）
 *   /scene-shots/…、/generated/…    本机磁盘上的图（读盘转 Base64）
 *
 * 拿回新图后前端 arm() 一下就能贴到商品上，下游贴图链路一行都不用改。
 */
app.post('/api/redraw', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''

  if (!prompt) {
    return res.status(400).json({ error: '请输入想怎么改造这张图（prompt 不能为空）' })
  }
  if (!requireArkKey(res)) return

  try {
    const reference = await resolveReferenceImage(req.body?.image)
    if (reference.error) {
      return res.status(400).json({ error: reference.error })
    }

    const result = await generateAndCache({ prompt, image: reference.source })
    if (result.error) {
      warn('图生图失败：', result.error)
      return res.status(502).json({ error: result.error })
    }

    log('图生图成功：', result.url)
    res.json({
      url: result.url,
      prompt,
      sourceUrl: result.sourceUrl,
      cached: result.cached,
    })
  } catch (err) {
    const message = err?.name === 'TimeoutError' ? '生成超时，请重试' : err?.message || '生成失败'
    warn('图生图异常：', message)
    res.status(500).json({ error: message })
  }
})

// ---------------------------------------------------------------- 场景截图素材库

/**
 * 三个场景各自是独立的静态服务（苏州双桥 8082 / 贵州葛镜桥 8123），谁也看不到
 * 对方磁盘上的文件；文创页面又只认 3001。所以让场景页把截图 POST 到这里汇总，
 * 文创页面再 GET 出来挑图 —— 跨端口不存在共享目录的问题，也和 AI 生图/下单同源。
 *
 * 落盘约定（两两成对，便于删除与读取）：
 *   server/public/scene-shots/<id>.png    截图本体，由 /scene-shots 静态暴露
 *   server/public/scene-shots/<id>.json   侧车元数据（场景名 / 尺寸 / 时间 / 字节数）
 * <id> 形如 suzhou-20261009123456-a1b2c3。
 *
 * ⚠️ 有意不维护单一的 index.json：那需要「读—改—写」整个文件，进程中途挂掉
 *    会丢掉全部索引。侧车 json 即使写坏了也只影响那一张图。
 */

/** 场景名 → 文件名前缀。没登记的场景走 slugify，保证文件名安全、可读。 */
const SCENE_SLUGS = {
  苏州双桥: 'suzhou',
  贵州葛镜桥: 'gejin',
}

/** 只保留字母/数字/下划线/连字符/中文，其余（尤其点号）一律换成连字符 */
function sceneSlug(name) {
  const raw = String(name || '').trim()
  if (SCENE_SLUGS[raw]) return SCENE_SLUGS[raw]
  const safe = raw.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'scene'
}

/**
 * 从图片字节流里读宽高。前端只传 dataURL，不带尺寸字段，
 * 与其让三个场景各自改一遍上传代码，不如后端解析文件头（读不出就返回 null）。
 */
function imageSize(buf) {
  // PNG：IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
  if (buf.length >= 24 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG：逐段跳到 SOFn，那里存着高度/宽度
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      const len = buf.readUInt16BE(off + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
      }
      off += 2 + len
    }
  }
  return null
}

const metaPath = (id) => path.join(SCENE_SHOTS_DIR, id + '.json')

/**
 * id 会被直接拼进文件路径，必须挡住 `../` 一类越界写法。
 *
 * 放行「字母 / 数字 / 下划线 / 连字符 / 中文」，**刻意不含点号**：
 * 这样 `xxx.png` 这种带扩展名的写法会被明确拒成 400，
 * 而不是被当成另一个 id、静默返回 success 却一张图都没删掉。
 */
const isSafeId = (id) =>
  typeof id === 'string' && id.length > 0 && id.length < 128 && /^[\w\u4e00-\u9fa5-]+$/.test(id)

async function listSnapshots() {
  const entries = await fsp.readdir(SCENE_SHOTS_DIR, { withFileTypes: true })
  const items = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const id = entry.name.slice(0, -4)

    let meta = null
    try {
      meta = JSON.parse(await fsp.readFile(metaPath(id), 'utf8'))
    } catch {
      // 侧车丢了（手工删过、或写到一半断电）：退回文件名推场景名，总比整张图看不见好
      meta = { id, sceneName: id.split('-')[0] || '未知场景', createdAt: '', bytes: null, width: null, height: null }
    }

    items.push({ ...meta, id, url: `/scene-shots/${entry.name}` })
  }
  // 新的排前面
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/**
 * 场景页截图后 POST 到这里：{ image: dataURL, scene_name: '苏州双桥' }。
 *
 * 两个路径都收，同一个处理函数：
 *   /api/scene-snapshots     —— 本项目现在的规范路径
 *   /api/screenshots/upload  —— 苏州双桥页面里早先写死的地址，留作别名，
 *                               这样那边一个字符都不用改，日后也不会因为漏改而静默 404
 */
app.post(['/api/scene-snapshots', '/api/screenshots/upload'], async (req, res) => {
  try {
    const body = req.body || {}
    const buffer = decodePayload(body.image ?? body.imageBase64 ?? body.screenshot)

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: '缺少截图数据（image 不能为空）' })
    }

    const sceneName = String(body.scene_name || body.sceneName || body.scene || '未命名场景').trim()
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const id = `${sceneSlug(sceneName)}-${stamp}-${crypto.randomBytes(3).toString('hex')}`

    await fsp.writeFile(path.join(SCENE_SHOTS_DIR, id + '.png'), buffer)

    const size = imageSize(buffer)
    const snapshot = {
      id,
      sceneName,
      source: String(body.source || 'scene'),
      note: body.note ? String(body.note) : '',
      createdAt: new Date().toISOString(),
      bytes: buffer.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      url: `/scene-shots/${id}.png`,
    }
    await fsp.writeFile(metaPath(id), JSON.stringify(snapshot, null, 2), 'utf8')

    log(`截图入库：${id}（${sceneName}，${buffer.length} B）`)
    res.json({ success: true, snapshot })
  } catch (err) {
    warn('截图入库失败：', err)
    res.status(500).json({ error: err?.message || '截图保存失败' })
  }
})

/** 列出素材库，支持 ?scene=苏州双桥 & limit=20 过滤 */
app.get('/api/scene-snapshots', async (req, res) => {
  try {
    let snapshots = await listSnapshots()

    const scene = req.query?.scene ? String(req.query.scene) : ''
    if (scene) snapshots = snapshots.filter((item) => item.sceneName === scene)

    const limit = Number(req.query?.limit)
    if (Number.isFinite(limit) && limit > 0) snapshots = snapshots.slice(0, limit)

    res.json({ success: true, count: snapshots.length, snapshots })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** 删掉某张截图（图与侧车一起删）。用 unlink 而非 rm —— 只删文件，不递归。 */
app.delete('/api/scene-snapshots/:id', async (req, res) => {
  const id = req.params.id
  if (!isSafeId(id)) return res.status(400).json({ error: '非法的截图 id' })

  try {
    await fsp.unlink(path.join(SCENE_SHOTS_DIR, id + '.png')).catch(() => {})
    await fsp.unlink(metaPath(id)).catch(() => {})
    log('截图已删除：', id)
    res.json({ success: true, id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------- 下单

/** 把 dataURL 或裸 base64 解码成 Buffer */
function decodePayload(input) {
  if (typeof input !== 'string' || !input) return null
  const match = input.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (match) return Buffer.from(match[3], 'base64')
  return Buffer.from(input, 'base64')
}

app.post('/api/order', async (req, res) => {
  try {
    const body = req.body || {}
    const orderId =
      'WC' +
      new Date().toISOString().slice(2, 10).replace(/-/g, '') +
      '-' +
      crypto.randomBytes(3).toString('hex').toUpperCase()

    const dir = path.join(ORDERS_DIR, orderId)
    await fsp.mkdir(dir, { recursive: true })

    const files = []

    const glb = decodePayload(body.glb?.base64 || body.glbBase64 || body.glb)
    if (glb && glb.length > 0) {
      const name = sanitizeFilename(body.glb?.filename || 'model.glb', '.glb')
      await fsp.writeFile(path.join(dir, name), glb)
      files.push({ kind: 'model', name, bytes: glb.length })
    }

    const shot = decodePayload(body.screenshot || body.screenshotBase64)
    if (shot && shot.length > 0) {
      const name = 'preview.png'
      await fsp.writeFile(path.join(dir, name), shot)
      files.push({ kind: 'screenshot', name, bytes: shot.length })
    }

    if (!files.length) {
      return res.status(400).json({ error: '订单缺少模型或截图数据' })
    }

    const order = {
      orderId,
      createdAt: new Date().toISOString(),
      product: {
        id: body.product?.id ?? null,
        name: body.product?.name ?? null,
        path: body.product?.path ?? null,
      },
      texture: {
        source: body.texture?.source ?? null,
        prompt: body.texture?.prompt ?? null,
        imageUrl: body.texture?.imageUrl ?? null,
        targetMesh: body.texture?.targetMesh ?? null,
        uv: body.texture?.uv ?? null,
      },
      user: {
        name: body.user?.name ?? '',
        phone: body.user?.phone ?? '',
        address: body.user?.address ?? '',
        remark: body.user?.remark ?? '',
      },
      files,
    }

    await fsp.writeFile(path.join(dir, 'order.json'), JSON.stringify(order, null, 2), 'utf8')

    log('订单已保存：', path.relative(PROJECT_ROOT, dir))
    res.json({ orderId, dir: path.relative(PROJECT_ROOT, dir), files })
  } catch (err) {
    warn('下单失败：', err)
    res.status(500).json({ error: err?.message || '订单保存失败' })
  }
})

/** 列出已保存的订单（本地调试用） */
app.get('/api/orders', async (_req, res) => {
  try {
    const entries = await fsp.readdir(ORDERS_DIR, { withFileTypes: true })
    const orders = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()
    res.json({ count: orders.length, orders })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function sanitizeFilename(name, fallbackExt) {
  const base = String(name).replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '')
  if (!base) return `model${fallbackExt}`
  return path.extname(base) ? base : base + fallbackExt
}

// ---------------------------------------------------------------- 兜底

app.use((_req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// 任何未捕获的异常/拒绝都不应该把进程搞崩
app.use((err, _req, res, _next) => {
  warn('未处理的服务端错误：', err)
  if (!res.headersSent) res.status(500).json({ error: err?.message || '服务器内部错误' })
})

process.on('unhandledRejection', (reason) => warn('unhandledRejection：', reason))
process.on('uncaughtException', (err) => warn('uncaughtException：', err))

app.listen(PORT, () => {
  log(`服务已启动：http://localhost:${PORT}`)
  log(`生图模型：${ARK_MODEL}  尺寸：${ARK_SIZE}  水印：${ARK_WATERMARK ? '开' : '关'}`)
  log(`ARK_API_KEY：${ARK_API_KEY ? '已配置' : '未配置（请创建 .env）'}`)
  log(`生成图目录：${path.relative(PROJECT_ROOT, GEN_DIR)}`)
  log(`订单目录：${path.relative(PROJECT_ROOT, ORDERS_DIR)}`)
})
