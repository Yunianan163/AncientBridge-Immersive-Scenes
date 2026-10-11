/**
 * 重画「全商品验证矩阵」海报（`docs/联调截图/55-全商品验证矩阵.png`）。
 *
 * 为什么要有它：这张海报是给比赛材料用的「一页总览」，之前是**手搓一次性的 PIL 脚本**画出来的 ——
 * 脚本没留下来，等于**永远改不了**。现在商品一多、断言一改，那张图就会悄悄变成错的。
 * 所以把它变成可复现的：数据全部来自真实跑出来的结果，不手填任何一个数字。
 *
 * 数据来源两条：
 *   ① `models:regress --json` 的产物 → 三个 e2e 列（paint / export / finish）的通过项数；
 *   ② `models:verify` 的输出 → 自检列（每个模型的「部位精确匹配数 / 部位总数」）。
 *
 * 用法：
 *   npm run models:matrix                    # 先跑一遍全表回归再画（约 25 分钟），并更新数据存档
 *   npm run models:matrix -- --from <json>    # 不重跑，拿上次的 regress JSON 直接画
 *   npm run models:matrix -- --out <png>      # 换海报输出路径
 *   npm run models:matrix -- --data-out <json> # 换数据存档路径
 *
 * 数据存档（默认 `docs/联调截图/55-验证矩阵数据.json`）是海报的**依据**：
 * 只跑回归时会自动覆盖它；用 `--from` 时不动它（那本来就是它的来源）。
 * 实测「存档 → 重画」逐字节一致，所以海报上的数字是可复核的。
 *
 * 出图交给 `scripts/make-matrix.py`（PIL，托管 Python 3.13 自带）。配色 / 栅格
 * 是从原图上量出来的（底色 #18181A、表头带 #222226、蓝字 #78B4FA、绿字 #6ED296），
 * 量到的列心 x = 415 / 600 / 790 / 965，所以观感跟原来那张一致。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const FROM = argOf('--from', '')
const OUT_PNG = path.resolve(ROOT, argOf('--out', path.join('docs', '联调截图', '55-全商品验证矩阵.png')))
/** 回归数据的存档落点。跑全表时会自动更新它 —— 海报的数字要能追溯，档案就不能是手存的。 */
const DATA_OUT = path.resolve(
  ROOT,
  argOf('--data-out', path.join('docs', '联调截图', '55-验证矩阵数据.json')),
)

/** 托管 Python（带 PIL）；没有 MSYH 就用系统字体。可用 `WB_PY` 覆盖。 */
const PY_CANDIDATES = [
  process.env.WB_PY,
  'C:/Users/32686/.workbuddy/binaries/python/versions/3.13.12/python.exe',
].filter(Boolean)

const runNode = (script, extra, { stdio = 'inherit' } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('scripts', script), ...extra], {
      cwd: ROOT, stdio, env: process.env,
    })
    let out = ''
    if (stdio === 'pipe') {
      child.stdout.on('data', (b) => { out += b.toString() })
      child.stderr.on('data', (b) => { out += b.toString() })
    }
    child.on('error', () => resolve({ code: -1, out }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })

// ------------------------------------------------------------------ 解析 models:verify

/**
 * `verify-models.mjs` 每个模型打一个块：
 *   正常  holder_b.glb  mesh=3  带UV=3/3  1464.1 KB
 *         零件：holder_inner, holder_bottom, holder_side
 *         部位  筒身外壁（可贴） ← holder_side  1 个零件  [精确匹配]
 * 这里只关心「部位 精确匹配数 / 部位总数」，以及有没有 缺部位 / 未归类零件。
 */
const parseVerify = (out) => {
  const models = []
  let cur = null
  for (const line of out.split(/\r?\n/)) {
    const head = line.match(/^(正常|无UV|损坏|缺失|跳过)\s+(\S+?\.glb)\s*(.*)$/)
    if (head) {
      cur = { status: head[1], file: head[2], id: head[2].replace(/\.glb$/i, ''), regions: 0, exact: 0, issues: [] }
      const mesh = head[3].match(/mesh=(\d+)/)
      const uv = head[3].match(/带UV=(\d+)\/(\d+)/)
      cur.mesh = mesh ? Number(mesh[1]) : null
      cur.uv = uv ? `${uv[1]}/${uv[2]}` : null
      models.push(cur)
      continue
    }
    if (!cur) continue
    if (/^\s+部位\s+/.test(line)) {
      cur.regions += 1
      if (/\[精确匹配\]/.test(line)) cur.exact += 1
      continue
    }
    if (/^\s+(缺部位|未归类零件|注意)[:：]/.test(line)) cur.issues.push(line.trim())
  }
  const total = out.match(/^(\d+)\/(\d+)\s*个模型通过自检\s*$/m)
  return { models, pass: total ? Number(total[1]) : null, all: total ? Number(total[2]) : models.length }
}

/** 自检列怎么写：优先报「部位精确匹配数」，没有部位表就退回报 UV */
const verifyCell = (m) => {
  if (!m) return '—'
  if (m.status !== '正常') return `× ${m.status}`
  if (m.regions > 0) {
    const mark = m.exact === m.regions && m.issues.length === 0 ? '√' : '×'
    return `${mark} ${m.exact}/${m.regions} 部位`
  }
  if (m.uv) return `√ ${m.uv} UV`
  return '√'
}

// ------------------------------------------------------------------ 找 Python

const findPython = async () => {
  for (const p of PY_CANDIDATES) {
    if (!fs.existsSync(p)) continue
    // 光有 python 不够，还得有 PIL（系统 `py -3` 就没有）
    const probe = await new Promise((resolve) => {
      const c = spawn(p, ['-c', 'import PIL; print(PIL.__version__)'], { stdio: 'pipe' })
      let o = ''
      c.stdout.on('data', (b) => { o += b.toString() })
      c.on('error', () => resolve(null))
      c.on('close', (code) => resolve(code === 0 ? o.trim() : null))
    })
    if (probe) return { exe: p, pil: probe }
  }
  return null
}

// ------------------------------------------------------------------ 主流程

const main = async () => {
  // 1) 拿回归结果
  let regress
  if (FROM) {
    const p = path.resolve(ROOT, FROM)
    if (!fs.existsSync(p)) { console.error('找不到 --from 的文件：', p); return 2 }
    regress = JSON.parse(fs.readFileSync(p, 'utf8'))
    console.log('用已有的回归结果：', p)
  } else {
    const tmp = path.join(os.tmpdir(), `wb-regress-${Date.now()}.json`)
    console.log('先跑一遍全表回归（约 25 分钟）……\n')
    const { code } = await runNode('run-regression.mjs', ['--json', tmp])
    if (code !== 0) { console.error('\n✗ 回归没全绿，不画海报（退出码', code, '）'); return code }
    regress = JSON.parse(fs.readFileSync(tmp, 'utf8'))
    // 数据存档跟着一起更新 —— 手存一份、下次跑完不更新，那份档案迟早跟海报对不上。
    fs.mkdirSync(path.dirname(DATA_OUT), { recursive: true })
    fs.writeFileSync(DATA_OUT, JSON.stringify(regress, null, 2))
    console.log('数据存档：', DATA_OUT)
  }

  // 2) 拿自检结果（很快，不开浏览器）
  const { out: verifyOut } = await runNode('verify-models.mjs', [], { stdio: 'pipe' })
  const verify = parseVerify(verifyOut)
  const byId = new Map(verify.models.map((m) => [m.id, m]))

  // 3) 拼矩阵行 —— 正式模型按回归计划顺序；其余预设在下面单独一行
  const rows = []
  for (const m of regress.models) {
    const cell = (step) => {
      const r = regress.rows.find((x) => x.model === m.id && x.step === step)
      if (!r) return '—'
      if (!r.ok) return '×'
      return r.total ? `√ ${r.pass}/${r.total}` : '√'
    }
    rows.push({
      label: `${m.label.replace(/（.*?）$/, '')}  ${m.id}`,
      cells: [verifyCell(byId.get(m.id)), cell('paint'), cell('export'), cell('finish')],
      dim: false,
    })
  }
  // 「其余占位模型」—— 只在**真的有**占位预设时才出一行。
  // ⚠️ 别写成 `rest.length > 0 && rest.every(...)`：全商品都是正式模型时（rest 为空）
  //    这个式子恒为 false，会画出一行「其余 0 个占位模型 ✗ 有问题」的假警报
  //    （2026-10-08 下架折扇后 rest 从 0 变 0 才露出来；`✗` 那个字形字体也渲染不出，是个方框）。
  const rest = verify.models.filter((m) => !regress.models.some((r) => r.id === m.id))
  if (rest.length > 0) {
    const restOk = rest.every((m) => m.status === '正常' && m.issues.length === 0)
    rows.push({
      label: `其余 ${rest.length} 个占位模型`,
      cells: [restOk ? '√ 全部通过' : '× 有问题', '—', '—', '—'],
      dim: true,
    })
  }

  // 4) 副标题 / 脚注（数字全是算出来的，没有一个是手填的）
  const enabled = regress.rows.filter((r) => r.ok).length
  const when = new Date(regress.generatedAt)
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const payload = {
    title: '文创商品定制器 · 全商品验证矩阵',
    subtitle: `${verify.pass ?? '?'}/${verify.all} 模型通过结构自检 · ${regress.models.length} 个正式模型各跑完整断言链`
      + `（paint / export / finish）· ${enabled}/${regress.rows.length} 项全绿 · 生成于 ${stamp}`,
    head: ['商品 / 模型', 'models:verify', 'e2e:paint', 'check:export', 'e2e:finish'],
    rows,
    notes: [
      'models:verify  存在 / 可解析 / 带 UV / 零件名与部位表逐条 精确匹配，零告警',
      'e2e:paint  真实浏览器里上传图 → 点部位 → 读回材质：可贴部位贴上、保留部位保持干净、颜色无高亮污染',
      'check:export  解析下载的 GLB：底色干净、无自发光、只有可贴部位带 baseColorTexture、釉面带 KHR_materials_clearcoat',
      'e2e:finish  5 档表面质感逐个切换生效（断言五档材质指纹互不相同），默认档与商品配置逐项相等',
      '另：e2e:paint 支持 E2E_URL，可把同一套断言压到生产构建（4173）上冒烟',
    ],
  }

  // 5) 出图
  const py = await findPython()
  if (!py) {
    console.error('找不到带 PIL 的 Python。装了的话用 `WB_PY=<python 路径> npm run models:matrix` 指定。')
    return 2
  }
  const dataPath = path.join(os.tmpdir(), `wb-matrix-${Date.now()}.json`)
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2))
  fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true })

  const code = await new Promise((resolve) => {
    const c = spawn(py.exe, [path.join('scripts', 'make-matrix.py'), dataPath, OUT_PNG], {
      cwd: ROOT, stdio: 'inherit',
    })
    c.on('error', () => resolve(-1))
    c.on('close', (c) => resolve(c ?? -1))
  })
  if (code !== 0) return code

  console.log(`\n海报已重画：${OUT_PNG}`)
  console.log(`（PIL ${py.pil} · 数据源：${FROM ? '--from ' + FROM : '本次全表回归'}）`)
  return 0
}

main()
  .then((code) => { process.exitCode = code })
  .catch((e) => { console.error('失败：', e.message); process.exitCode = 1 })
