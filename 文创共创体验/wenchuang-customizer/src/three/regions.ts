/**
 * 「部位区域」识别 —— 把模型里拆好的零件，映射成配置表里的中文部位。
 *
 * 为什么需要它：
 *   早期模型是整块一个 mesh（混元 3D 直接导出），点哪儿都只能贴整块。
 *   正式模型会在 3ds Max 里按部位拆分并命名，这时我们需要两件事：
 *     1) 「点杯身 → 只贴杯身，不碰把手」；
 *     2) 把英文/编号的部位名翻成中文显示给用户看。
 *
 * GLB 里只有两种名字能活下来（这是整套匹配机制的基础）：
 *   ① 节点名 / mesh 名 —— 在 Max 里「分离成独立对象」时用这个（推荐做法）；
 *   ② 材质名          —— 用「多维子材质」时用这个。GLTFLoader 会把一个多 primitive 的 mesh
 *                       拆成 Group + N 个 Mesh，mesh 名会被加上 _1/_2 后缀（见 GLTFLoader
 *                       createUniqueName），但 material.name 原样保留。
 *   所以这里两个名字都查，谁先命中算谁。
 *
 * 匹配优先级（数字越小越可信）：
 *   1 - 完全一致
 *   2 - 去掉 GLTFLoader 补的 _1/_2 后缀后一致
 *   3 - 去掉全部分隔符后一致（配置写 cup_body，模型叫 CupBody / cup body / cup-body 也能命中）
 *   4 - 部位名出现在名字的分词里（配置写 cup_body，模型叫 mug_a_body 也能命中）
 *
 * 为什么 3 要排在 4 前面：3 是「整体相同、只是分隔符写法不同」，可信度高于
 * 4 的「只是恰好包含这个词」。两者都能兜底，但排序保证最贴近的那个先被选中。
 *
 * 匹配是「按区域取全场最高置信度」的：如果某个区域能以优先级 1 命中，就不会再因为
 * 优先级 3 把别的零件也吞进来。这样既宽容又不会误伤。
 */

import * as THREE from 'three'

/**
 * 取一个 mesh 的材质数组。
 *
 * 这里刻意不 import ./surfacePainter —— regions.ts 保持「零相对依赖」，
 * 这样 scripts/verify-models.mjs 才能用 Node 自带的类型擦除直接 import 它，
 * 让命令行自检和网页端跑的是同一份匹配逻辑。（不写扩展名的相对导入 Node 解析不了）
 */
function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  if (Array.isArray(mesh.material)) return mesh.material
  return mesh.material ? [mesh.material] : []
}

/** 一个「部位」的配置：模型里的哪个名字，对应面板上的哪个中文名，允不允许贴图 */
export interface RegionConfig {
  /** 稳定标识，用来记录「当前贴的是哪个部位」 */
  id: string
  /** 中文显示名，直接给用户看 */
  name: string
  /** 在 GLB 里出现的名字（对象名或材质名），可写多个别名 */
  match: string[]
  /** 是否允许贴图。省略或 true = 可贴；false = 点了会提示这是保留部位 */
  paintable?: boolean
  /**
   * 可选部位：模型里没有它也不算问题。
   *
   * 用来兼容「不同人拆的粗细不一样」——比如茶杯，有人只拆「杯体 + 把手」，
   * 有人会把杯口内壁也单独拆出来。配置里两种都写着，缺的那个标成 optional，
   * 自检时就不会报「缺部位」来吓人。
   */
  optional?: boolean
  /** 该部位的整体配色（预留给「按部位改色」用） */
  defaultColor?: string
}

export interface RegionHit {
  region: RegionConfig
  /** 该部位在场景里对应的所有 mesh */
  meshes: THREE.Mesh[]
  /** 命中的置信度（1 最可信） */
  level: number
  /** 具体是哪个名字命中的，排查用 */
  key: string
}

export interface RegionIndex {
  hits: RegionHit[]
  /** mesh.uuid → 它属于哪个部位 */
  byMesh: Map<string, RegionHit>
}

export function isPaintable(region: RegionConfig): boolean {
  return region.paintable !== false
}

/**
 * 名字归一化：转小写，把非字母数字的字符压成下划线。
 * 用 \p{L}\p{N} 而不是 [a-z0-9]，是为了让中文部位名也能匹配上
 * （Max 里直接给对象起中文名的人不少，得容得下）。
 */
export function normalizeName(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
}

const UNIQ_SUFFIX = /_(\d+)$/

/** 去掉全部分隔符：cup_body / CupBody / cup-body 都压成 cupbody */
const flatten = (value: string) => value.replace(/_/g, '')

/** 一个 mesh 可能被匹配的名字：自己的名字 + 所有材质的名字 */
function candidateNames(mesh: THREE.Mesh): string[] {
  const out: string[] = []
  const push = (value: string | undefined) => {
    if (value && !out.includes(value)) out.push(value)
  }
  push(mesh.name)
  for (const material of materialsOf(mesh)) push(material.name)
  return out
}

function levelOf(entry: string, candidate: string): number {
  const want = normalizeName(entry)
  const got = normalizeName(candidate)
  if (!want || !got) return 0
  if (want === got) return 1
  const stripped = got.replace(UNIQ_SUFFIX, '')
  if (stripped !== got && want === stripped) return 2
  if (flatten(stripped) === flatten(want)) return 3
  if (stripped.split('_').includes(want)) return 4
  return 0
}

function meshesUnder(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh)
  })
  return out
}

export function buildRegionIndex(root: THREE.Object3D, regions: RegionConfig[] | undefined): RegionIndex {
  const hits: RegionHit[] = []
  const byMesh = new Map<string, RegionHit>()
  if (!regions || regions.length === 0) return { hits, byMesh }

  const meshes = meshesUnder(root)

  for (const region of regions) {
    const levels = new Map<THREE.Mesh, { level: number; key: string }>()

    for (const mesh of meshes) {
      let best: { level: number; key: string } | null = null
      for (const candidate of candidateNames(mesh)) {
        for (const entry of region.match) {
          const level = levelOf(entry, candidate)
          if (level > 0 && (best === null || level < best.level)) best = { level, key: candidate }
        }
      }
      if (best) levels.set(mesh, best)
    }

    if (levels.size === 0) continue

    const minLevel = Math.min(...[...levels.values()].map((value) => value.level))
    const winners = [...levels.entries()].filter(([, value]) => value.level === minLevel)

    const hit: RegionHit = {
      region,
      meshes: winners.map(([mesh]) => mesh),
      level: minLevel,
      key: winners[0][1].key,
    }
    hits.push(hit)
    // 一个 mesh 只归属第一个命中的部位，避免两个区域抢同一块面
    for (const [mesh] of winners) if (!byMesh.has(mesh.uuid)) byMesh.set(mesh.uuid, hit)
  }

  return { hits, byMesh }
}

export function regionOfMesh(index: RegionIndex, mesh: THREE.Mesh): RegionHit | null {
  return index.byMesh.get(mesh.uuid) ?? null
}

export function regionById(index: RegionIndex, id: string): RegionHit | null {
  return index.hits.find((hit) => hit.region.id === id) ?? null
}

export function paintableRegions(regions: RegionConfig[] | undefined): RegionConfig[] {
  return (regions ?? []).filter(isPaintable)
}

/** 「命名自检」报告：给面板用，也是排查「导出的名字和配置对不上」的最快手段 */
export interface RegionReport {
  /** 配置上了、模型里也找到了的部位 */
  matched: RegionHit[]
  /** 配置里有、但模型里找不到的部位（多半是名字不一致）。不含标了 optional 的 */
  missing: RegionConfig[]
  /** 标了 optional、模型里确实没有的部位：属于正常情况，不算问题 */
  absentOptional: RegionConfig[]
  /** 模型里存在、但没被任何部位收编的零件名（说明配置漏了） */
  unassignedParts: string[]
}

export function inspectRegions(root: THREE.Object3D, regions: RegionConfig[] | undefined): RegionReport {
  const index = buildRegionIndex(root, regions)
  const matchedIds = new Set(index.hits.map((hit) => hit.region.id))

  const missing = (regions ?? []).filter(
    (region) => !matchedIds.has(region.id) && region.optional !== true,
  )
  const absentOptional = (regions ?? []).filter(
    (region) => !matchedIds.has(region.id) && region.optional === true,
  )

  const unassignedParts: string[] = []
  for (const mesh of meshesUnder(root)) {
    if (index.byMesh.has(mesh.uuid)) continue
    const label = mesh.name || materialsOf(mesh)[0]?.name || '(未命名)'
    if (!unassignedParts.includes(label)) unassignedParts.push(label)
  }

  return { matched: index.hits, missing, absentOptional, unassignedParts }
}
