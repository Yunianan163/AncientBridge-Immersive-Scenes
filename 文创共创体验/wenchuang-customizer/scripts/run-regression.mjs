/**
 * 一条命令复跑「全商品验证表」。
 *
 * 为什么需要它：`e2e:paint` / `check:export` / `e2e:finish` 各自只跑**一个**商品，
 * 平时改一个模型没问题；但一旦动了公共代码（贴图管线、finish 系统、导出前的洗色逻辑、
 * `regions.ts` 的匹配优先级），就必须**每个商品都过一遍**——手敲 15 条命令既慢又必漏。
 *
 * 怎么做：三个子脚本都支持 `--list`，把「自己支持哪些商品」以 JSON 打出来。
 * 本脚本先拉这三份清单，算出「哪个商品该跑哪几步」，再**串行**跑完，最后打一张汇总表。
 * 好处是商品清单只有一份（在各自的 CASES / SAMPLE_PARTS 里），加商品时不用改这里。
 *
 * ⚠️ 必须**串行**：`e2e-paint`(9335) 与 `e2e-finish`(9336) 都要开一个 headless Edge 占着
 *    同一个调试端口体系，并行会互相抢端口；而且三个脚本都要抢同一块 GPU/软渲染。
 *
 * 用法：
 *   npm run models:regress                      # 全表（实测全绿约 24 分钟）
 *   npm run models:regress -- --model holder_b  # 只跑一个商品
 *   npm run models:regress -- --only paint      # 只跑某一步（paint / export / finish）
 *   npm run models:regress -- --list            # 只打印「打算跑什么」，不开浏览器
 *   npm run models:regress -- --out docs/联调截图 # 截图直接落进仓库（默认落临时目录）
 *   npm run models:regress -- --json <path>      # 结果另存一份 JSON（`models:matrix` 画矩阵海报靠它）
 *                                                # ⚠️ Windows 下别写 `/tmp/x.json` —— 会被解析成 `D:\tmp\x.json`，
 *                                                #    用仓库内相对路径（如 `docs/联调截图/_tmp/x.json`）最稳
 *
 * 前置：**dev server 必须先起来**（`npm run dev`，5173）。脚本会先探一下端口，
 * 不通就直接报错退出，免得后面 15 条全红还看不出根因。
 *
 * 退出码：0 = 全绿；1 = 有断言失败；2 = 前置不满足（服务没起 / 子脚本清单拉不到）。
 *
 * 截图默认落 `%TEMP%/wb-regress-<时间戳>/`，跑完把路径打出来（失败时能翻图）。
 * 全绿且加了 `--clean` 才会自动删掉。
 */

import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const URL_ = argOf('--url', process.env.E2E_URL || 'http://localhost:5173/')
const ONLY = argOf('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const WANT_MODEL = argOf('--model', '')
const OUT_DIR = path.resolve(
  ROOT,
  argOf('--out', '') || path.join(os.tmpdir(), `wb-regress-${Date.now()}`),
)
const CLEAN = has('--clean')
/** 结果 JSON 的落点（`--json <path>`），给 `models:matrix` 消费 */
const JSON_PATH = argOf('--json', '') ? path.resolve(ROOT, argOf('--json', '')) : ''

// ------------------------------------------------------------------ 步骤登记表

/**
 * 每一步 = 一个子脚本。`id` 是 `--only` 的取值，`label` 是汇总表里的列名。
 * `scoped: false` 的是**前置步骤**：不针对某个商品，只跑一次（如模型自检）。
 */
const STEPS = [
  { id: 'paint', label: '按部位贴图', script: 'e2e-paint.mjs', scoped: true },
  { id: 'export', label: '导出 GLB', script: 'check-export.mjs', scoped: true },
  { id: 'finish', label: '表面质感', script: 'e2e-finish.mjs', scoped: true },
]
/** 前置项：跑在商品循环之前，失败就整体中止（配置错了后面全是噪声） */
const PREFLIGHT = [{ id: 'verify', label: '模型自检', script: 'verify-models.mjs' }]

const STEP_ORDER = [...PREFLIGHT.map((s) => s.id), ...STEPS.map((s) => s.id)]

// ------------------------------------------------------------------ 跑子进程

const run = (script, extraArgs, { stream = false } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('scripts', script), ...extraArgs], {
      cwd: ROOT,
      env: { ...process.env, E2E_OUT_DIR: OUT_DIR, E2E_URL: URL_ },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (b) => { out += b.toString() })
    child.stderr.on('data', (b) => { out += b.toString() })
    // `--list` / 冒烟用：想直接看子进程原始输出时打开
    if (stream) { child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr) }
    child.on('error', (e) => resolve({ code: -1, out: out + '\n' + e.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })

/** 拉某个子脚本的商品清单。拉不到就返回 null，调用方据此中止。 */
const listModels = async (script) => {
  const { code, out } = await run(script, ['--list'])
  if (code !== 0) return null
  // 子脚本除了 JSON 可能还打了别的日志，所以只挑出那行 JSON 数组
  const line = out.split(/\r?\n/).find((l) => /^\s*\[\s*\{/.test(l))
  if (!line) return null
  try { return JSON.parse(line) } catch { return null }
}

/**
 * 从子脚本输出里摘「n/m 通过」与以 ✗ 开头的失败项名。
 * 两个子脚本的汇总行写法不完全一样（`verify-models` 是「n/n 个模型通过自检」，
 * 三个 e2e 是「===== n/m 通过 =====」），所以按 patterns 依次试，谁先中算谁。
 */
const SUMMARY_PATTERNS = [
  /^=====\s*(\d+)\/(\d+)\s*通过\s*=====\s*$/m,
  /^(\d+)\/(\d+)\s*个模型通过自检\s*$/m,
]
/**
 * 同一条断言会以两种形态各出现一次 —— 断言失败时的**行内提示**（`✗ 名字   (原因)`）
 * 和跑完后的**结尾列表**（`✗ 名字`）。按「前缀互为对方」判同一条，留信息量更大的那条。
 */
const dedupeFails = (list) => {
  const out = []
  for (const f of list) {
    const i = out.findIndex((s) => s === f || s.startsWith(f) || f.startsWith(s))
    if (i < 0) { out.push(f); continue }
    if (f.length > out[i].length) out[i] = f
  }
  return out
}

const parseResult = (out) => {
  let m = null
  for (const p of SUMMARY_PATTERNS) { m = out.match(p); if (m) break }
  const fails = dedupeFails(
    out
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*[✗✘x]\s+(.+?)\s*$/)?.[1])
      .filter(Boolean),
  )
  return { pass: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null, fails }
}

// ------------------------------------------------------------------ 表格对齐

/**
 * 终端里的**显示宽度**：中日韩文字 / 全角符号占 2 格，其余占 1 格。
 * 直接拿 `str.length` 去 padEnd，中文列会越对齐越乱（每个汉字少算一格）。
 */
const dispWidth = (s) =>
  [...s].reduce(
    (n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1),
    0,
  )
const padTo = (s, w) => s + ' '.repeat(Math.max(0, w - dispWidth(s)))
/** 按显示宽度左对齐一列 */
const colWidth = (rows) => Math.max(0, ...rows.map(dispWidth))

// ------------------------------------------------------------------ 前置：探服务

const portOpen = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (v) => { try { s.destroy() } catch {} ; resolve(v) }
    s.setTimeout(1200)
    s.on('connect', () => done(true))
    s.on('timeout', () => done(false))
    s.on('error', () => done(false))
  })

const ensureServer = async () => {
  let u
  try { u = new URL(URL_) } catch { return console.error('--url 不是合法地址：', URL_), false }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  // ⚠️ `localhost` 要**两个回环都试**：vite 默认只绑 IPv6 的 `[::1]`，
  // 只探 127.0.0.1 会把「服务明明好着」误判成「没起」。
  const hosts = u.hostname === 'localhost' ? ['::1', '127.0.0.1'] : [u.hostname]
  const tries = await Promise.all(hosts.map((h) => portOpen(h, port)))
  if (tries.some(Boolean)) return true
  console.error(`\n✗ 连不上 ${URL_}（${u.hostname}:${port} 没有服务在听）`)
  console.error('  先起前端再跑回归：')
  console.error('    npm run dev        # 只起前端 5173（回归够用）')
  console.error('    npm run dev:all    # 前后端一起起（要验 AI 生图时用这个）')
  console.error('  如果服务在别的端口，用 --url 指定，或设 E2E_URL。\n')
  return false
}

// ------------------------------------------------------------------ 主流程

const main = async () => {
  // 1) 拉清单
  const lists = {}
  for (const s of STEPS) {
    const list = await listModels(s.script)
    if (!list) {
      console.error(`✗ 拉不到 ${s.script} 的商品清单（--list 没能输出 JSON）`)
      process.exit(2)
    }
    lists[s.id] = list
  }

  // 2) 合并成「商品 → 该跑哪几步」。顺序按第一个步骤（paint）的清单来，保持稳定可读。
  const models = lists.paint.map((m) => ({ id: m.id, label: m.label }))
  const stepsOf = new Map(
    models.map((m) => [m.id, STEPS.filter((s) => lists[s.id].some((x) => x.id === m.id))]),
  )
  // 只在别的清单里出现、paint 里没有的商品 —— 说明三个脚本的清单漂了，提醒一下
  for (const s of STEPS.slice(1)) {
    for (const x of lists[s.id]) {
      if (!models.some((m) => m.id === x.id)) {
        console.log(`⚠️ ${x.id} 出现在 ${s.script} 的清单里，但 e2e-paint 没有 —— 它不会被跑到`)
      }
    }
  }

  const selected = WANT_MODEL ? models.filter((m) => m.id === WANT_MODEL) : models
  if (selected.length === 0) {
    console.error(`不认识 --model ${WANT_MODEL}，可选：${models.map((m) => m.id).join(' / ')}`)
    process.exit(2)
  }
  const activeSteps = ONLY.length
    ? STEPS.filter((s) => ONLY.includes(s.id))
    : STEPS
  if (activeSteps.length === 0) {
    console.error(`不认识 --only ${ONLY.join(',')}，可选：${STEPS.map((s) => s.id).join(' / ')}`)
    process.exit(2)
  }
  const preflight = ONLY.length ? PREFLIGHT.filter((s) => ONLY.includes(s.id)) : PREFLIGHT

  const plan = selected.map((m) => ({
    ...m,
    steps: stepsOf.get(m.id).filter((s) => activeSteps.includes(s)),
  }))
  const browserRuns = plan.reduce((n, m) => n + m.steps.length, 0)

  console.log('====================================================')
  console.log('全商品回归验证')
  console.log('  地址：', URL_)
  console.log('  截图：', OUT_DIR)
  console.log('  前置：', preflight.map((s) => s.label).join('、') || '（无）')
  console.log('  计划：')
  const idW = colWidth(plan.map((m) => m.id))
  const labelW = colWidth(plan.map((m) => m.label))
  for (const m of plan) {
    console.log(`    ${padTo(m.id, idW)}  ${padTo(m.label, labelW)}  ${m.steps.map((s) => s.label).join(' → ')}`)
  }
  // 实测每一步约 1.7 分钟（导航 14s + 切模型 7s + 贴图/截图），粗估够用了
  console.log(`  共 ${browserRuns} 次浏览器会话（串行，预计 ${Math.round(browserRuns * 1.7)} 分钟上下）`)
  console.log('====================================================')

  if (has('--list')) { console.log('\n（--list：只看计划，未执行）'); return 0 }

  if (!(await ensureServer())) return 2
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const rows = []
  let hardFail = false

  // 3) 前置步骤（不针对商品）
  for (const s of preflight) {
    const t0 = Date.now()
    process.stdout.write(`\n▶ [前置] ${s.label} … `)
    const { code, out } = await run(s.script, [])
    const r = parseResult(out)
    const ok = code === 0
    console.log(ok ? `√${r.total ? ` ${r.pass}/${r.total}` : ''}` : '✗ 失败')
    if (!ok) {
      console.log(out.split(/\r?\n/).slice(-40).join('\n'))
      hardFail = true
      break
    }
    rows.push({ model: '（前置）', modelLabel: '（前置）', step: s.id, label: s.label, ok, pass: r.pass, total: r.total, fails: r.fails, ms: Date.now() - t0 })
  }

  // 4) 逐商品逐步骤
  if (!hardFail) {
    for (const m of plan) {
      console.log(`\n──────── ${m.label}（${m.id}）────────`)
      for (const s of m.steps) {
        const t0 = Date.now()
        process.stdout.write(`▶ ${s.label} … `)
        const { code, out } = await run(s.script, ['--model', m.id, '--prefix', `${m.id}-${s.id}`])
        const r = parseResult(out)
        const ok = code === 0
        // 有些步骤本来就不产生「n/m」计数（如 `e2e:finish` 是出对照图给人看的），
        // 那种情况只打 √，不要硬凑一个 `?/?` 显得像没测。
        const score = r.total ? ` ${r.pass}/${r.total}` : ''
        console.log(ok ? `√${score}  ${((Date.now() - t0) / 1000).toFixed(0)}s` : '✗ 失败')
        if (!ok) {
          if (r.fails.length) r.fails.forEach((f) => console.log('    ✗', f))
          else console.log(out.split(/\r?\n/).slice(-30).join('\n'))
        }
        rows.push({ model: m.id, modelLabel: m.label, step: s.id, label: `${m.label} · ${s.label}`, ok, pass: r.pass, total: r.total, fails: r.fails, ms: Date.now() - t0 })
        if (!ok) hardFail = true
      }
    }
  }

  // 5) 汇总表
  const labelW2 = colWidth(rows.map((r) => r.label))
  console.log('\n\n========== 汇总 ==========')
  for (const r of rows) {
    const mark = r.ok ? '√' : '✗'
    const score = r.total ? `${r.pass}/${r.total}` : '—'
    console.log(`${mark} ${padTo(r.label, labelW2)}  ${score.padStart(7)}  ${(r.ms / 1000).toFixed(0)}s`)
  }
  const bad = rows.filter((r) => !r.ok)
  console.log(`\n共 ${rows.length} 项，${rows.length - bad.length} 通过，${bad.length} 未通过`)
  console.log('截图：', OUT_DIR)

  // 结果落一份机器可读的 JSON —— `models:matrix` 靠它画「全商品验证矩阵」，
  // 这样那张海报不用再手搓一遍、也不会和真实断言结果脱节。
  if (JSON_PATH) {
    const payload = {
      generatedAt: new Date().toISOString(),
      url: URL_,
      outDir: OUT_DIR,
      ok: bad.length === 0 && !hardFail,
      models: plan.map((m) => ({ id: m.id, label: m.label, steps: m.steps.map((s) => s.id) })),
      rows,
    }
    fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true })
    fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2))
    console.log('结果 JSON：', JSON_PATH)
  }

  if (bad.length === 0 && CLEAN) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
    console.log('（--clean：已删掉截图目录）')
  } else if (bad.length === 0 && OUT_DIR.startsWith(os.tmpdir())) {
    console.log('（图在临时目录里，系统会自己收；想立刻删掉加 --clean）')
  }

  return hardFail ? 1 : 0
}

main()
  .then((code) => { process.exitCode = code })
  .catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
