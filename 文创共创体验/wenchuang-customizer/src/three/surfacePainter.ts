/**
 * 贴图「点击选面」相关的纯逻辑工具。
 *
 * 关键点：混元 3D 生成的模型 mesh 名不固定，不能靠材质名找贴图区，
 * 所以这里全部围绕「射线命中哪个 mesh / 哪个面」来工作，不依赖任何命名约定。
 */

import * as THREE from 'three'
import { applyColorize } from './colorize'

/** 商品模型根节点统一挂这个 name，射线检测时据此把辅助物件（坐标轴、Gizmo）排除掉 */
export const PRODUCT_ROOT_NAME = 'product-root'

export interface UvAdjust {
  offsetX: number
  offsetY: number
  repeatX: number
  repeatY: number
  rotation: number
}

export const DEFAULT_UV: UvAdjust = {
  offsetX: 0,
  offsetY: 0,
  repeatX: 1,
  repeatY: 1,
  rotation: 0,
}

type MaterialLike = THREE.Material & { map?: THREE.Texture | null }

export function materialListOf(mesh: THREE.Mesh): THREE.Material[] {
  if (Array.isArray(mesh.material)) return mesh.material
  return mesh.material ? [mesh.material] : []
}

/** 模型是否带 UV 坐标——没有 UV 就没法贴图（需要回混元重跑 UV 展开） */
export function hasUvAttribute(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined
  return Boolean(geometry?.attributes?.uv)
}

/**
 * 同一个材质实例是否还被「本次贴图范围之外」的 mesh 用着。
 *
 * 为什么要排除本次范围：一次贴图会同时写好几个零件（一个部位可能拆成多个 mesh）。
 * 这些零件之间共用材质是可以的（反正贴的都是同一张图），
 * 但只要外面还有别人在用，就必须 clone，否则会连带改掉不该改的面。
 */
export function isMaterialSharedOutside(
  root: THREE.Object3D,
  inside: Set<THREE.Mesh>,
  material: THREE.Material,
): boolean {
  const stack: THREE.Object3D[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as THREE.Object3D
    if (!inside.has(node as THREE.Mesh) && (node as THREE.Mesh).isMesh) {
      if (materialListOf(node as THREE.Mesh).includes(material)) return true
    }
    for (const child of node.children) stack.push(child)
  }
  return false
}

/** 一次贴图要写的位置 */
export interface PaintTarget {
  mesh: THREE.Mesh
  /** 命中面在这个 mesh 的材质数组里的下标；单材质传 0 */
  materialIndex: number
}

export interface PreparedTarget {
  mesh: THREE.Mesh
  /** 实际写入 map 的材质 */
  material: THREE.Material & { map?: THREE.Texture | null }
  /** 克隆前的原材质，「移除贴图」时重建全彩补丁要用 */
  originalMaterial: THREE.Material
  /** 是否因为与范围外的网格共用材质而克隆过 */
  cloned: boolean
  /** 克隆时的 mesh.material 旧值，「移除贴图」时整体换回来；未克隆为 null */
  previousMaterial: THREE.Material | THREE.Material[] | null
}

/**
 * 把「要贴哪些位置」翻译成「具体写哪个材质实例」。
 *
 * 规则：材质只被本次范围使用 → 直接写上去（不 clone，省一份内存）；
 *       还被范围外的网格共用 → clone 一份再写，避免误伤别的面。
 * 同一个原材质只 clone 一次，多个零件共用同一份克隆体，保证它们永远长一样。
 */
export function preparePaintTargets(root: THREE.Object3D, targets: PaintTarget[]): PreparedTarget[] {
  const inside = new Set(targets.map((target) => target.mesh))
  const clones = new Map<THREE.Material, THREE.Material>()

  const cloneOf = (material: THREE.Material): THREE.Material => {
    const cached = clones.get(material)
    if (cached) return cached
    const clone = material.clone() as MaterialLike
    // material.clone() 会深拷贝 userData，但不会拷贝 onBeforeCompile 这类实例方法。
    // 底座的「全彩模式」是靠 userData.__colorize 做幂等判断的，这里先把标记清掉，
    // 等贴图挂上之后再让 applyColorize 重新注入 shader 补丁。
    clone.userData.__colorize = undefined
    clone.needsUpdate = true
    clones.set(material, clone)
    return clone
  }

  return targets.map((target) => {
    const list = materialListOf(target.mesh)
    if (list.length === 0) throw new Error('该部件没有可用材质')

    const isArray = Array.isArray(target.mesh.material)
    const slot = isArray ? Math.min(Math.max(target.materialIndex, 0), list.length - 1) : 0
    const originalMaterial = list[slot]

    if (!isMaterialSharedOutside(root, inside, originalMaterial)) {
      return {
        mesh: target.mesh,
        material: originalMaterial as MaterialLike,
        originalMaterial,
        cloned: false,
        previousMaterial: null,
      }
    }

    const replacement = cloneOf(originalMaterial)
    const previousMaterial = target.mesh.material
    if (isArray) {
      // 只替换命中的那一格，同一数组里没被选中的材质保持原样
      const next = [...list]
      next[slot] = replacement
      target.mesh.material = next
    } else {
      target.mesh.material = replacement
    }

    return {
      mesh: target.mesh,
      material: replacement as MaterialLike,
      originalMaterial,
      cloned: true,
      previousMaterial,
    }
  })
}

/** 克隆材质的 shader 补丁复刻：处理完 map 之后调用 */
export function reviveColorizePatch(clone: THREE.Material, original: THREE.Material) {
  const wasOn = (original.userData as Record<string, unknown> | undefined)?.__colorize === true
  if (wasOn) applyColorize(clone, true)
}

export function previousColorizeState(material: THREE.Material): boolean {
  return (material.userData as Record<string, unknown> | undefined)?.__colorize === true
}

/** 加载贴图，统一走 GLTF 的贴图约定（sRGB + flipY = false） */
export function loadTexture(url: string, anisotropy = 1): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  return new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        // 与 GLTF 内嵌贴图保持一致，否则图案会上下颠倒
        texture.flipY = false
        texture.anisotropy = anisotropy
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.center.set(0.5, 0.5)
        texture.needsUpdate = true
        resolve(texture)
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error('贴图加载失败')),
    )
  })
}

/** 把偏移 / 重复 / 旋转实时写回贴图（所见即所得） */
export function applyUvToTexture(texture: THREE.Texture, uv: UvAdjust) {
  texture.center.set(0.5, 0.5)
  texture.offset.set(uv.offsetX, uv.offsetY)
  texture.repeat.set(uv.repeatX, uv.repeatY)
  texture.rotation = uv.rotation
  texture.needsUpdate = true
}

/**
 * 「不含任何 UI 状态」的材质颜色，存在 material.userData 上。
 *
 * 底座的交互会把「悬停加亮（×1.2）」和「选中高亮（偏向 #ffeb3b + 橙色自发光）」
 * 直接写进 material.color / material.emissive —— 这是屏幕上的显示状态，
 * 不该被当成商品本来的颜色。导出 GLB 前要按这个值还原，否则
 * `baseColorFactor` 会带着 1.2 倍亮度、`emissiveFactor` 会带着一层橙色写进文件。
 */
export const CLEAN_COLOR_KEY = '__cleanColor'

/**
 * 「不含任何 UI 状态」的材质颜色，**线性浮点三通道**版本（可选）。
 *
 * 为什么 hex 之外还要存一份浮点：`Color.getHex()` 是 8 位的，材质自带的颜色
 * （例如 glTF 里的 `baseColorFactor = [0.8, 0.8, 0.8]`）走一遍 hex 往返会变成
 * `0.7991…` —— 肉眼看不出来，但「**保留原材质**」这件事最好做到分毫不差
 * （团扇的木质扇框就属于这一类：模型自带 0.8 底色，网页端不该让它变）。
 * 只有需要精确保留的材质才写这个键；调色板来的颜色本来就是 8 位 hex，不需要它。
 */
export const CLEAN_COLOR_RGB_KEY = '__cleanColorRgb'

type TintableMaterial = THREE.Material & {
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
}

/**
 * 导出前把 UI 状态从材质上洗掉，返回一个「还原」函数。
 *
 * 用法：
 *   const restore = stripUiTint(root)
 *   try { await exportAsync(root) } finally { restore() }
 */
export function stripUiTint(root: THREE.Object3D): () => void {
  const backups: Array<{
    material: TintableMaterial
    color: number | null
    emissive: number | null
    emissiveIntensity: number | null
  }> = []
  const seen = new Set<THREE.Material>()

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of materialListOf(mesh)) {
      if (seen.has(material)) continue
      seen.add(material)

      const m = material as TintableMaterial
      backups.push({
        material: m,
        color: m.color ? m.color.getHex() : null,
        emissive: m.emissive ? m.emissive.getHex() : null,
        emissiveIntensity: m.emissiveIntensity ?? null,
      })

      const clean = m.userData?.[CLEAN_COLOR_KEY]
      const cleanRgb = m.userData?.[CLEAN_COLOR_RGB_KEY]
      // 有线性浮点那份就用它（分毫不差）；否则退回 8 位 hex
      if (m.color && Array.isArray(cleanRgb)) m.color.fromArray(cleanRgb as number[])
      else if (m.color && typeof clean === 'number') m.color.setHex(clean)
      if (m.emissive) m.emissive.setHex(0x000000)
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 1
    }
  })

  return () => {
    for (const item of backups) {
      if (item.color !== null) item.material.color?.setHex(item.color)
      if (item.emissive !== null) item.material.emissive?.setHex(item.emissive)
      if (item.emissiveIntensity !== null) item.material.emissiveIntensity = item.emissiveIntensity
    }
  }
}
