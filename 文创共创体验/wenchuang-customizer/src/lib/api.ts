/**
 * 前端调用后端（server/index.js）的地址工具。
 *
 * 开发时默认走 vite 代理：前端请求 /api 与 /generated，由 vite 转发到 http://localhost:3001，
 * 这样图片和页面同源，WebGL 画布不会被跨域污染（导出截图 / GLB 需要）。
 * 如果前后端分离部署，配 VITE_API_BASE=https://your-api-host 即可。
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export const apiUrl = (path: string) => `${API_BASE}${path}`

/** 后端返回的图片地址是相对路径时，补上 API 前缀 */
export const resolveAssetUrl = (url: string) =>
  url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:') ? url : `${API_BASE}${url}`

// ---------------------------------------------------------------- AI 生图（火山方舟 Seedream）

/** 生图接口的统一返回：url 是同源可读的落盘地址，sourceUrl 是上游原始地址 */
export interface GenerateResult {
  url: string
  prompt: string
  sourceUrl: string
  /** 是否成功落盘到后端本地（落盘后走同源地址，canvas 不会被跨域污染） */
  cached: boolean
}

/** 统一的 POST，错误信息直接取后端给的中文提示 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `请求失败（HTTP ${response.status}）`)
  }
  return data as T
}

/** 文生图：给一句话出一张图。对应后端 `POST /api/generate` */
export function generateImage(prompt: string): Promise<GenerateResult> {
  return postJson<GenerateResult>('/api/generate', { prompt })
}

/**
 * 图生图（AI 二次创作）：拿一张已有图片当参考，按 prompt 改造出新图。
 * 对应后端 `POST /api/redraw`。
 *
 * `image` 可以传素材库里的相对地址（如 `/scene-shots/xxx.png`，后端会读盘转 Base64
 * 再发给方舟），也可以传真网图片地址。本机路径不能直接给方舟 —— 云端取不到 localhost。
 */
export function redrawImage(params: { prompt: string; image: string }): Promise<GenerateResult> {
  return postJson<GenerateResult>('/api/redraw', params)
}

// ---------------------------------------------------------------- 场景截图素材库

/**
 * 场景页（苏州双桥 8082 / 贵州葛镜桥 8123）点截图后把画面 POST 到文创后端，
 * 落盘在 server/public/scene-shots/。这里是它的一条目录项。
 */
export interface SceneSnapshot {
  id: string
  /** 形如 /scene-shots/suzhou-20261009….png，展示前要用 resolveAssetUrl 补前缀 */
  url: string
  /** 场景中文名，如「苏州双桥」 */
  sceneName: string
  createdAt: string
  bytes: number | null
  width: number | null
  height: number | null
  note?: string
}

/** 拉素材库列表（新的在前） */
export async function listSceneSnapshots(params?: { scene?: string; limit?: number }): Promise<SceneSnapshot[]> {
  const query = new URLSearchParams()
  if (params?.scene) query.set('scene', params.scene)
  if (params?.limit) query.set('limit', String(params.limit))
  const queryString = query.toString()

  const response = await fetch(apiUrl(`/api/scene-snapshots${queryString ? `?${queryString}` : ''}`))
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `加载素材库失败（HTTP ${response.status}）`)
  }
  return (data.snapshots ?? []) as SceneSnapshot[]
}

/** 从素材库删掉一张截图 */
export async function deleteSceneSnapshot(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/scene-snapshots/${encodeURIComponent(id)}`), { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `删除失败（HTTP ${response.status}）`)
  }
}
