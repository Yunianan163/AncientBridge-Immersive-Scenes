import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PRODUCT_ROOT_NAME } from '../three/surfacePainter'
import type { PaintHit, StudioStatus, ThreeRefs } from '../state/textureStudio'

interface SurfacePickerProps {
  /** 当前工作台状态；只有 awaiting-pick 时才响应点击 */
  status: StudioStatus
  /** 命中某个面之后，把图写进去（由 textureStudio 提供） */
  commitPaint: (hit: PaintHit) => Promise<boolean>
  onError: (message: string) => void
  registerThree: (refs: Partial<ThreeRefs>) => void
}

/**
 * Canvas 内的「点击选面」执行者。
 *
 * 为什么不用外部 Context：react-three-fiber 的 <Canvas> 会另起一棵渲染树，
 * 外部 Provider 不一定能穿透进去。所以这里需要的回调全部通过 props 显式传递，
 * 不依赖任何 context 穿透行为，逻辑最稳。
 *
 * 机制说明：这里只负责「屏幕上这一点，打到了哪个 mesh 的哪个面」，
 * 至于这个面属于哪个「部位」（该不该贴、贴完覆盖哪些零件）由
 * state/textureStudio.tsx + three/regions.ts 按模型里的对象名/材质名决定。
 */
export function SurfacePicker({ status, commitPaint, onError, registerThree }: SurfacePickerProps) {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)

  // 把 three 上下文交给 Canvas 外的面板使用（导出 GLB / 截图）
  useEffect(() => {
    registerThree({ scene, camera, gl })
  }, [registerThree, scene, camera, gl])

  const statusRef = useRef(status)
  statusRef.current = status
  const commitRef = useRef(commitPaint)
  commitRef.current = commitPaint
  const errorRef = useRef(onError)
  errorRef.current = onError

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0

    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX
      downY = event.clientY
    }

    const onPointerUp = (event: PointerEvent) => {
      if (statusRef.current !== 'awaiting-pick') return
      if (event.button !== 0) return
      // 拖着转视角不算点击
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return

      const rect = el.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, camera)

      // 只在商品模型范围内检测，避免命中坐标轴 / 选中 Gizmo 等辅助物件
      const root = scene.getObjectByName(PRODUCT_ROOT_NAME) ?? scene
      const hits = raycaster.intersectObjects([root], true)
      const hit = hits.find((item) => (item.object as THREE.Mesh).isMesh)

      if (!hit) {
        errorRef.current('没点到商品表面，请把鼠标对准商品再点一次')
        return
      }

      const clickedMesh = hit.object as THREE.Mesh
      void commitRef.current({
        mesh: clickedMesh,
        faceIndex: hit.faceIndex ?? -1,
        materialIndex: hit.face?.materialIndex ?? 0,
      })
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
    }
  }, [gl, camera, scene])

  // 待贴图状态下把光标换成十字，提示现在可以点表面
  useEffect(() => {
    const el = gl.domElement
    if (status !== 'awaiting-pick') return undefined
    const previous = el.style.cursor
    el.style.cursor = 'crosshair'
    return () => {
      el.style.cursor = previous
    }
  }, [gl, status])

  return null
}
