/**
 * 贴图工作台的共享状态。
 *
 * 为什么用 context：AI 生图面板 / 上传面板 / 参数调节面板都在 Canvas 外，
 * 而真正执行「点击选面贴图」的组件必须在 Canvas 内（要拿 camera / scene / gl）。
 * 两边通过这个 context 交换「待贴的图」和「已贴到哪个部位」。
 *
 * 贴图落点有两层信息：
 *   - 点中了哪个 mesh 的哪个面（Raycaster 给的原始信息）
 *   - 这个 mesh 属于哪个「部位」（three/regions.ts 按名字匹配出来的）
 * 有部位就整块部位一起贴（点杯身→只贴杯身），没有配置命名表就退化成只贴点中的那个 mesh。
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type * as THREE from 'three'
import {
  DEFAULT_UV,
  PRODUCT_ROOT_NAME,
  applyUvToTexture,
  hasUvAttribute,
  loadTexture,
  preparePaintTargets,
  reviveColorizePatch,
} from '../three/surfacePainter'
import type { PaintTarget, PreparedTarget, UvAdjust } from '../three/surfacePainter'
import {
  buildRegionIndex,
  isPaintable,
  paintableRegions,
  regionById,
  regionOfMesh,
} from '../three/regions'
import type { RegionConfig, RegionIndex } from '../three/regions'

/** ai = AI 生图；upload = 本地文件；scene = 场景截图素材库（见 components/SceneShotPanel.tsx） */
export type TextureSource = 'ai' | 'upload' | 'scene'

/** idle → 空闲；awaiting-pick → 已备好图，等用户点商品表面；pasting → 正在把贴图写进去；applied → 已贴上 */
export type StudioStatus = 'idle' | 'awaiting-pick' | 'pasting' | 'applied'

export interface PendingTexture {
  url: string
  source: TextureSource
  prompt?: string
}

export interface PaintedSurface {
  /** 贴的是哪个部位（配置里的 id / 中文名） */
  regionId?: string
  regionName?: string
  /** 本次一共写了几个零件（一个部位可能由多个 mesh 组成） */
  meshCount: number
  meshUuid: string
  meshName: string
  faceIndex: number
  materialSlot: number
  source: TextureSource
  imageUrl: string
  prompt?: string
  /** 是否因为与其他面共用材质而克隆过材质 */
  clonedMaterial: boolean
  /** 点中的部位没写进命名表，退化成「只贴所选表面」 */
  unlisted: boolean
}

/** 面板上统一的「贴到哪儿了」文案 */
// eslint-disable-next-line react-refresh/only-export-components
export function surfaceLabel(surface: PaintedSurface | null): string {
  if (!surface) return ''
  if (surface.regionName) {
    return surface.meshCount > 1 ? `${surface.regionName}（${surface.meshCount} 个零件）` : surface.regionName
  }
  return surface.meshName
}

/** Raycaster 命中信息 */
export interface PaintHit {
  mesh: THREE.Mesh
  faceIndex: number
  materialIndex: number
}

export interface ProductInfo {
  id: string
  name: string
  path: string
  /** 该商品的部位命名表；为空表示模型还没按部位拆分 */
  regions?: RegionConfig[]
}

export interface ThreeRefs {
  scene: THREE.Scene | null
  camera: THREE.Camera | null
  gl: THREE.WebGLRenderer | null
}

/** 一次成功贴图留下的记录，用于「移除贴图」逐次回滚 */
interface LivePaint {
  surface: PaintedSurface
  targets: PreparedTarget[]
  /** 同一部位共用一张贴图实例，滑块改它一处即可全部生效 */
  texture: THREE.Texture
  uv: UvAdjust
}

interface StudioContextValue {
  status: StudioStatus
  pending: PendingTexture | null
  painted: PaintedSurface | null
  product: ProductInfo | null
  uv: UvAdjust
  error: string | null
  notice: string | null
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  setProduct: (product: ProductInfo | null) => void
  /** 备好一张图，进入「请点击商品要贴图的面」状态 */
  arm: (url: string, source: TextureSource, prompt?: string) => void
  /** 放弃本次待贴的图 */
  cancel: () => void
  /** 真正把待贴的图写到命中的位置（会自动扩展到整个部位） */
  commitPaint: (hit: PaintHit) => Promise<boolean>
  /** 直接在面板上点部位名贴图，不用在模型上找 */
  paintRegion: (regionId: string) => Promise<boolean>
  /** 移除最近贴的一处贴图，还原成模型自带外观 */
  clearTexture: () => void
  setUv: (patch: Partial<UvAdjust>) => void
  resetUv: () => void
  registerThree: (refs: Partial<ThreeRefs>) => void
  three: { current: ThreeRefs }
  /**
   * 「智能推荐」里的改造提示词投递位。
   * 推荐面板在左侧「配色」栏里，AI 生图输入框在右侧工作台，两者是兄弟节点、拿不到对方的 props，
   * 所以借这个 context 传一手：推荐面板 set，AiPanel 读走后立刻清空。
   */
  promptDraft: string | null
  setPromptDraft: (text: string | null) => void
}

const noop = () => {}

const StudioContext = createContext<StudioContextValue>({
  status: 'idle',
  pending: null,
  painted: null,
  product: null,
  uv: DEFAULT_UV,
  error: null,
  notice: null,
  busy: false,
  setBusy: noop,
  setError: noop,
  setNotice: noop,
  setProduct: noop,
  arm: noop,
  cancel: noop,
  commitPaint: async () => false,
  paintRegion: async () => false,
  clearTexture: noop,
  setUv: noop,
  resetUv: noop,
  registerThree: noop,
  three: { current: { scene: null, camera: null, gl: null } },
  promptDraft: null,
  setPromptDraft: noop,
})

export function TextureStudioProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudioStatus>('idle')
  const [pending, setPending] = useState<PendingTexture | null>(null)
  const [painted, setPainted] = useState<PaintedSurface | null>(null)
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [uv, setUvState] = useState<UvAdjust>(DEFAULT_UV)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promptDraft, setPromptDraft] = useState<string | null>(null)

  const three = useRef<ThreeRefs>({ scene: null, camera: null, gl: null })
  const pendingRef = useRef<PendingTexture | null>(null)
  const productRef = useRef<ProductInfo | null>(null)
  const uvRef = useRef<UvAdjust>(DEFAULT_UV)
  const liveStackRef = useRef<LivePaint[]>([])

  const registerThree = useCallback((refs: Partial<ThreeRefs>) => {
    three.current = { ...three.current, ...refs }
  }, [])

  const updateProduct = useCallback((next: ProductInfo | null) => {
    productRef.current = next
    setProduct(next)
  }, [])

  const arm = useCallback((url: string, source: TextureSource, prompt?: string) => {
    const next: PendingTexture = { url, source, prompt }
    pendingRef.current = next
    setPending(next)
    setError(null)
    setNotice(null)
    // 换图时把调节参数归零，避免上一张的 repeat/rotation 影响到新图
    uvRef.current = DEFAULT_UV
    setUvState(DEFAULT_UV)
    setStatus('awaiting-pick')
  }, [])

  const cancel = useCallback(() => {
    pendingRef.current = null
    setPending(null)
    setNotice(null)
    setStatus(liveStackRef.current.length > 0 ? 'applied' : 'idle')
  }, [])

  /** 当前场景里的「商品根节点」+ 部位索引 */
  const productContext = useCallback((): { root: THREE.Object3D; index: RegionIndex } | null => {
    const scene = three.current.scene
    if (!scene) return null
    const root = scene.getObjectByName(PRODUCT_ROOT_NAME) ?? scene
    return { root, index: buildRegionIndex(root, productRef.current?.regions) }
  }, [])

  /** 真正写入贴图：一次可以写多个零件，共用同一张贴图实例 */
  const paint = useCallback(
    async (
      root: THREE.Object3D,
      targets: PaintTarget[],
      meta: { faceIndex: number; materialIndex: number; region?: RegionConfig; unlisted: boolean; highlightUuid: string },
    ): Promise<boolean> => {
      const active = pendingRef.current
      if (!active) {
        setError('请先生成或上传一张图片')
        return false
      }
      if (targets.length === 0) {
        setError('没找到可以贴图的位置')
        return false
      }

      const usable = targets.filter((target) => hasUvAttribute(target.mesh))
      if (usable.length === 0) {
        setError('这个部位没有 UV 坐标，无法贴图。请在 3ds Max 里给该部位做一次 UVW 展开，再重新导出 GLB。')
        return false
      }

      setStatus('pasting')
      setError(null)

      try {
        const prepared = preparePaintTargets(root, usable)
        const anisotropy = three.current.gl?.capabilities.getMaxAnisotropy() ?? 1
        const texture = await loadTexture(active.url, anisotropy)
        applyUvToTexture(texture, uvRef.current)

        for (const item of prepared) {
          item.material.map = texture
          item.material.needsUpdate = true
          // 克隆出来的材质丢了 onBeforeCompile，需要按原状态把底座的全彩补丁重新挂上
          if (item.cloned) reviveColorizePatch(item.material, item.originalMaterial)
        }

        const surface: PaintedSurface = {
          regionId: meta.region?.id,
          regionName: meta.region?.name,
          meshCount: prepared.length,
          meshUuid: meta.highlightUuid,
          meshName: usable[0].mesh.name || `未命名零件 ${usable[0].mesh.uuid.slice(0, 6)}`,
          faceIndex: meta.faceIndex,
          materialSlot: meta.materialIndex,
          source: active.source,
          imageUrl: active.url,
          prompt: active.prompt,
          clonedMaterial: prepared.some((item) => item.cloned),
          unlisted: meta.unlisted,
        }

        liveStackRef.current.push({ surface, targets: prepared, texture, uv: { ...uvRef.current } })
        setPainted(surface)

        pendingRef.current = null
        setPending(null)
        setStatus('applied')

        const skipped = targets.length - usable.length
        const base = meta.region
          ? `已贴到「${meta.region.name}」${prepared.length > 1 ? `（${prepared.length} 个零件）` : ''}`
          : `已贴到「${surface.meshName}」`
        const tail = meta.unlisted ? '，该部位未写进命名表，已按所选表面处理' : skipped > 0 ? `，${skipped} 个零件没有 UV 已跳过` : ''
        setNotice(base + tail)
        return true
      } catch (err) {
        setStatus('awaiting-pick')
        setError(err instanceof Error ? err.message : '贴图失败')
        return false
      }
    },
    [],
  )

  const commitPaint = useCallback(
    async (hit: PaintHit): Promise<boolean> => {
      const context = productContext()
      if (!context) {
        setError('3D 场景还没准备好，请稍后重试')
        return false
      }

      const regionHit = regionOfMesh(context.index, hit.mesh)

      if (regionHit) {
        if (!isPaintable(regionHit.region)) {
          const names = paintableRegions(productRef.current?.regions)
            .map((region) => region.name)
            .join('、')
          setError(`「${regionHit.region.name}」是保留部位，不支持贴图。可以贴的部位：${names || '暂无'}`)
          return false
        }
        return paint(
          context.root,
          regionHit.meshes.map((mesh) => ({
            mesh,
            materialIndex: mesh === hit.mesh ? hit.materialIndex : 0,
          })),
          {
            faceIndex: hit.faceIndex,
            materialIndex: hit.materialIndex,
            region: regionHit.region,
            unlisted: false,
            highlightUuid: hit.mesh.uuid,
          },
        )
      }

      // 命名表里没有这个零件：要么模型还没按部位拆，要么名字和配置对不上。
      // 都退化成「只贴点中的那个表面」，并且明确告诉用户，不悄悄改变结果。
      return paint(context.root, [{ mesh: hit.mesh, materialIndex: hit.materialIndex }], {
        faceIndex: hit.faceIndex,
        materialIndex: hit.materialIndex,
        unlisted: (productRef.current?.regions?.length ?? 0) > 0,
        highlightUuid: hit.mesh.uuid,
      })
    },
    [paint, productContext],
  )

  const paintRegion = useCallback(
    async (regionId: string): Promise<boolean> => {
      const context = productContext()
      if (!context) {
        setError('3D 场景还没准备好，请稍后重试')
        return false
      }
      const regionHit = regionById(context.index, regionId)
      if (!regionHit) {
        setError('模型里没找到这个部位。请确认 GLB 里的对象名/材质名和标注规范一致。')
        return false
      }
      if (!isPaintable(regionHit.region)) {
        setError(`「${regionHit.region.name}」是保留部位，不支持贴图`)
        return false
      }
      // 已经贴过一处时，允许用同一张图接着贴别的部位。
      // 否则用户想「杯身和把手印同一个图案」就得重新上传一次，很别扭。
      if (!pendingRef.current) {
        const last = liveStackRef.current[liveStackRef.current.length - 1]
        if (last) {
          pendingRef.current = {
            url: last.surface.imageUrl,
            source: last.surface.source,
            prompt: last.surface.prompt,
          }
        }
      }
      return paint(
        context.root,
        regionHit.meshes.map((mesh) => ({ mesh, materialIndex: 0 })),
        {
          faceIndex: -1,
          materialIndex: 0,
          region: regionHit.region,
          unlisted: false,
          highlightUuid: regionHit.meshes[0].uuid,
        },
      )
    },
    [paint, productContext],
  )

  const clearTexture = useCallback(() => {
    const last = liveStackRef.current.pop()
    if (last) {
      for (const item of last.targets) {
        if (item.cloned && item.previousMaterial) {
          // 克隆过的材质整体换回原对象
          item.mesh.material = item.previousMaterial
        } else {
          item.material.map = null
          item.material.needsUpdate = true
        }
      }
      last.texture.dispose()
    }

    const rest = liveStackRef.current[liveStackRef.current.length - 1]
    setPainted(rest?.surface ?? null)
    uvRef.current = rest?.uv ?? DEFAULT_UV
    setUvState(rest?.uv ?? DEFAULT_UV)
    setStatus(rest ? 'applied' : 'idle')
    setNotice(last ? '已撤掉最近贴的一处贴图' : '当前没有贴图')
  }, [])

  const setUv = useCallback((patch: Partial<UvAdjust>) => {
    const next: UvAdjust = { ...uvRef.current, ...patch }
    uvRef.current = next
    const current = liveStackRef.current[liveStackRef.current.length - 1]
    if (current) {
      applyUvToTexture(current.texture, next)
      current.uv = { ...next }
    }
    setUvState(next)
  }, [])

  const resetUv = useCallback(() => {
    uvRef.current = DEFAULT_UV
    const current = liveStackRef.current[liveStackRef.current.length - 1]
    if (current) {
      applyUvToTexture(current.texture, DEFAULT_UV)
      current.uv = { ...DEFAULT_UV }
    }
    setUvState(DEFAULT_UV)
  }, [])

  const value = useMemo<StudioContextValue>(
    () => ({
      status,
      pending,
      painted,
      product,
      uv,
      error,
      notice,
      busy,
      setBusy,
      setError,
      setNotice,
      setProduct: updateProduct,
      arm,
      cancel,
      commitPaint,
      paintRegion,
      clearTexture,
      setUv,
      resetUv,
      registerThree,
      three,
      promptDraft,
      setPromptDraft,
    }),
    [
      status,
      pending,
      painted,
      product,
      uv,
      error,
      notice,
      busy,
      promptDraft,
      updateProduct,
      arm,
      cancel,
      commitPaint,
      paintRegion,
      clearTexture,
      setUv,
      resetUv,
      registerThree,
    ],
  )

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTextureStudio() {
  return useContext(StudioContext)
}
