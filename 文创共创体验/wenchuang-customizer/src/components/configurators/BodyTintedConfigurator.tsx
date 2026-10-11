import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Color, Group, Vector3 } from 'three'
import type * as THREE from 'three'
import { useGLTF, Text } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ModelPreset } from '../../data/modelPresets'
import type { DynamicColors } from '../ColorControls'
import { upgradeMeshTextures } from '../../three/textures'
import { collectMeshes, computeScreenFit, computeRadialDirections } from '../../three/meshUtils'
import { applyColorizeToMesh } from '../../three/colorize'
import { buildRegionIndex } from '../../three/regions'
import { useMeshSelection } from '../../hooks/useMeshSelection'
import { SelectionGizmo } from '../SelectionGizmo'
import { CLEAN_COLOR_KEY, CLEAN_COLOR_RGB_KEY, PRODUCT_ROOT_NAME } from '../../three/surfacePainter'
import { applyEnvironment, applyFinish, ensurePhysicalMaterial, type FinishId } from '../../three/finish'

type MeshInfo = { cfgId?: string; basePos: Vector3; dir: Vector3 }

interface Props {
  colors: DynamicColors
  modelPreset: ModelPreset
  explodeAmount: number
  selectionEnabled: boolean
  onDraggingChange?: (dragging: boolean) => void
  selectedPartId: string | null
  onSelectedPartChange?: (id: string | null) => void
  colorizeMode?: boolean
  /** 表面质感档位；不传就不动模型自带材质（底座示例模型保持原样） */
  finish?: FinishId
  /** 影棚环境贴图（挂在 material.envMap 上） */
  envMap?: THREE.Texture | null
  /** 「环境反光」滑块值，乘进每个材质的 envMapIntensity */
  envIntensity?: number
}

// Renderer for single-tint (body) and per-node-tinted GLB models. Auto-fits
// the bounding box, recenters, and explodes sub-meshes radially from the
// model center. Keeps each mesh's original material so embedded textures are
// preserved; tints via material.color.
export function BodyTintedConfigurator({
  colors,
  modelPreset,
  explodeAmount,
  selectionEnabled,
  onDraggingChange,
  selectedPartId,
  onSelectedPartChange,
  colorizeMode = false,
  finish,
  envMap = null,
  envIntensity = 1,
}: Props) {
  const modelPath = import.meta.env.BASE_URL + modelPreset.path
  const { scene: source } = useGLTF(modelPath)
  const scene = useMemo(() => source.clone(true), [source])

  const group = useRef<Group>(null)
  const manualOffsetsRef = useRef<Map<string, Vector3>>(new Map())
  const gl = useThree(state => state.gl)
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])

  const colorMode = modelPreset.colorMode ?? 'body'

  // 部位索引：回答「这个 mesh 属于哪个部位」。有它才能做到「按部位保留原材质 /
  // 按部位给不同质感」—— 团扇的白绢面走绢丝、木质扇框竹柄原样不动。
  const regionIndex = useMemo(
    () => buildRegionIndex(scene, modelPreset.regions),
    [scene, modelPreset.regions],
  )
  const keepOriginal = useMemo(
    () => new Set(modelPreset.keepOriginalParts ?? []),
    [modelPreset.keepOriginalParts],
  )

  const { autoFitScale, modelCenter, byUuid } = useMemo(() => {
    // 「按屏幕投影高度归一」而不是「按世界坐标最长边」—— 保证换商品时
    // 屏幕上看到的大小一致（详见 computeScreenFit 的注释）。
    const { fit, center, radius } = computeScreenFit(scene)
    const meshes = collectMeshes(scene)
    const radial = computeRadialDirections(meshes, center, radius)

    const idSet = new Set(modelPreset.materials.map(m => m.id))
    const findAncestorId = (obj: THREE.Object3D): string | undefined => {
      let cursor: THREE.Object3D | null = obj
      while (cursor) {
        if (idSet.has(cursor.name)) return cursor.name
        cursor = cursor.parent
      }
      return undefined
    }

    // 「保留原材质」的部位单独拿一份材质克隆体：万一它和别的部位共用一个材质实例，
    // 悬停加亮 / 选中高亮的写色不会串到别的部位上。同一个原材质只克隆一次，可重复使用。
    const keepClones = new Map<THREE.Material, THREE.Material>()
    const cloneForKeep = (material: THREE.Material): THREE.Material => {
      const cached = keepClones.get(material)
      if (cached) return cached
      const next = material.clone()
      next.userData.__colorize = undefined
      next.needsUpdate = true
      keepClones.set(material, next)
      return next
    }

    const map = new Map<string, MeshInfo>()
    meshes.forEach(mesh => {
      const cfgId = colorMode === 'per-node' ? findAncestorId(mesh) : modelPreset.materials[0]?.id

      // Clone material per mesh for per-node mode so tinting doesn't bleed
      // across meshes that share a source material.
      if (colorMode === 'per-node') {
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => m.clone())
        else if (mesh.material) mesh.material = mesh.material.clone()
      }

      const regionId = regionIndex.byMesh.get(mesh.uuid)?.region.id
      if (regionId && keepOriginal.has(regionId)) {
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(cloneForKeep)
        else if (mesh.material) mesh.material = cloneForKeep(mesh.material)
      }

      upgradeMeshTextures(mesh, maxAnisotropy)

      map.set(mesh.uuid, {
        cfgId,
        basePos: mesh.position.clone(),
        dir: radial.get(mesh.uuid) ?? new Vector3(),
      })
    })

    return { autoFitScale: fit, modelCenter: center, byUuid: map }
  }, [scene, modelPreset, colorMode, maxAnisotropy, regionIndex, keepOriginal])

  const resetMesh = useCallback((mesh: THREE.Object3D, info: MeshInfo) => {
    manualOffsetsRef.current.delete(mesh.uuid)
    const scaled = info.dir.clone().multiplyScalar(explodeAmount)
    mesh.position.copy(info.basePos).add(scaled)
  }, [explodeAmount])

  const commitDrag = useCallback((mesh: THREE.Object3D, info: MeshInfo) => {
    const scaled = info.dir.clone().multiplyScalar(explodeAmount)
    const manual = mesh.position.clone().sub(info.basePos).sub(scaled)
    manualOffsetsRef.current.set(mesh.uuid, manual)
  }, [explodeAmount])

  const { hovered, selectedUuid, selectedObject, groupHandlers, transformHandlers } =
    useMeshSelection<MeshInfo>({
      scene,
      byUuid,
      selectionEnabled,
      selectedPartId,
      onSelectedPartChange,
      onDraggingChange,
      onResetMesh: resetMesh,
      onCommitDrag: commitDrag,
    })

  useEffect(() => {
    scene.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const info = byUuid.get(mesh.uuid)
      if (!info) return

      const isSelected = mesh.uuid === selectedUuid

      mesh.castShadow = false
      mesh.receiveShadow = false

      // 这块面属于哪个部位 → 决定它该用哪一档质感。
      //   · 列在 keepOriginalParts 里（团扇的木质扇框与竹柄）：**什么都不动**，
      //     不套 finish、不套调色板、不套 colorize，模型自带的贴图 / 金属度 / 粗糙度原样；
      //   · partFinishes 里点名了就用那一档（团扇的白绢面 = 绢丝）；
      //   · 其余走全局的 finish。
      const regionId = regionIndex.byMesh.get(mesh.uuid)?.region.id
      const preserveMaterial = Boolean(regionId && keepOriginal.has(regionId))
      const meshFinish = regionId
        ? (modelPreset.partFinishes?.[regionId] ?? finish)
        : finish

      const cfg = modelPreset.materials.find(m => m.id === info.cfgId)
      const hex = cfg ? (colors[cfg.id] || cfg.defaultColor) : '#ffffff'

      const applyToMat = (mat: THREE.Material | null | undefined) => {
        const m = mat as THREE.MeshPhysicalMaterial | null
        if (!m || !m.color) return

        // cleanColor 是商品本来的颜色（用户在拾色器里选的），不含悬停加亮与选中高亮。
        // 记下来给导出用：否则 1.2 倍悬停亮度和选中的橙色自发光会被写进 GLB。
        //
        // 保留原材质的部位，「本来的颜色」就是**模型自己带的那个颜色**。
        // 第一次读到就记下来，后面每次重跑都从 userData 读 ——
        // 否则会把上一次写进去的 1.2 倍悬停亮度当成原色记下来，越悬停越亮。
        // ⚠️ 第一次读必须用 `m.color.clone()`（保持线性浮点），**不能走 `getHex()`**：
        // hex 是 8 位的，模型自带的 0.8 走一遍会变成 0.7991，「原样保留」就不成立了
        // （实测导出的 baseColorFactor 从 [0.8,0.8,0.8,1] 变成 [0.7991,…]）。
        let cleanColor: Color
        if (preserveMaterial) {
          const recordedRgb = m.userData[CLEAN_COLOR_RGB_KEY]
          cleanColor = Array.isArray(recordedRgb)
            ? new Color().fromArray(recordedRgb as number[])
            : m.color.clone()
          m.userData[CLEAN_COLOR_RGB_KEY] = cleanColor.toArray()
          // 这份 8 位 hex 也照旧记着：`stripUiTint` 拿它当「没有浮点那份」时的兜底
          m.userData[CLEAN_COLOR_KEY] = cleanColor.getHex()
        } else {
          cleanColor = new Color(hex)
          m.userData[CLEAN_COLOR_KEY] = cleanColor.getHex()
        }

        if (!preserveMaterial) {
          // 表面质感：陶瓷釉面靠 clearcoat（一层透明釉）做出「坯体哑光 + 表面锐利高光」的双层观感。
          // 团扇的白绢面走 partFinishes 指定的「绢丝」——细密织纹 + 一层柔和丝光。
          if (meshFinish) applyFinish(m, meshFinish)
          // 环境反射强度。必须挂在 material.envMap 上才生效 ——
          // 只设 scene.environment 的话，渲染器每帧都会拿 scene.environmentIntensity
          // 覆盖掉这里的 envMapIntensity（three 的行为，详见 three/finish.ts）。
          applyEnvironment(m, envMap, envIntensity, meshFinish)
        }

        const finalColor = cleanColor.clone()
        if (hovered) finalColor.multiplyScalar(1.2)
        if (isSelected) finalColor.lerp(new Color('#ffeb3b'), 0.35)

        m.color.copy(finalColor)
        if (m.emissive) {
          if (isSelected) {
            m.emissive.setHex(0xffaa00)
            if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.35
          } else {
            m.emissive.setHex(0x000000)
            if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0
          }
        }
        m.needsUpdate = true
      }

      if (preserveMaterial) {
        // 保留原材质：连材质实例都不换（`ensurePhysicalMaterial` 会把 Standard 升级成
        // Physical，那就等于改了模型自带的材质），只在原实例上写悬停/选中的颜色。
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        list.forEach(applyToMat)
      } else {
        // applyFinish 可能把材质换成 MeshPhysicalMaterial（MeshStandardMaterial 没有
        // clearcoat 字段），换完必须写回 mesh.material，否则下一帧又拿到旧实例。
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const upgraded = list.map(mat => (meshFinish ? ensurePhysicalMaterial(mat) : mat))
        if (upgraded.some((mat, i) => mat !== list[i])) {
          mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0]
        }
        upgraded.forEach(applyToMat)
      }

      // 全彩模式下保留原材质的部位不注入补丁 —— 用户要的是「木质原样」，
      // 把它刷成彩虹色就违背需求了。
      if (!preserveMaterial) applyColorizeToMesh(mesh, colorizeMode)

      // TransformControls drives the selected mesh's position directly — don't fight it.
      if (!isSelected) {
        const manual = manualOffsetsRef.current.get(mesh.uuid)
        const scaled = info.dir.clone().multiplyScalar(explodeAmount)
        mesh.position.copy(info.basePos).add(scaled)
        if (manual) mesh.position.add(manual)
      }
    })
  }, [
    scene, hovered, colors, modelPreset, explodeAmount, byUuid, selectedUuid,
    colorizeMode, finish, envMap, envIntensity, regionIndex, keepOriginal,
  ])

  if (!scene) {
    return (
      <group ref={group}>
        <mesh><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="orange" /></mesh>
        <Text position={[0, 1.5, 0]} fontSize={0.2} color="orange">Loading model...</Text>
      </group>
    )
  }

  const presetScale = modelPreset.scale ?? [1, 1, 1]
  const finalScale: [number, number, number] = [
    presetScale[0] * autoFitScale,
    presetScale[1] * autoFitScale,
    presetScale[2] * autoFitScale,
  ]

  return (
    <>
      <group
        ref={group}
        name={PRODUCT_ROOT_NAME}
        {...groupHandlers}
        rotation={modelPreset.rotation ?? [0, 0, 0]}
        scale={finalScale}
        position={modelPreset.position ?? [0, 0, 0]}
      >
        <group position={[-modelCenter.x, -modelCenter.y, -modelCenter.z]}>
          <primitive object={scene} />
        </group>
      </group>
      <SelectionGizmo object={selectedObject} enabled={selectionEnabled} {...transformHandlers} />
    </>
  )
}
