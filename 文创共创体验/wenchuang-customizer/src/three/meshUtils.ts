import { Box3, PerspectiveCamera, Vector3 } from 'three'
import type * as THREE from 'three'

/**
 * 场景相机参数 —— **归一化和相机必须共用这一份**。
 *
 * 归一化（`computeScreenFit`）要按「相机看到的画面」算尺寸，所以它得知道相机在哪。
 * 以前这两处各写各的（Scene.tsx 里 `camera={{ position: [0, 0.35, 2.6], fov: 45 }}`、
 * meshUtils 里另一套隐含假设），一旦有人调了相机而忘了调归一化，所有商品的大小就会集体跑偏。
 * 现在两边都读这个常量：**改相机就改这里**。
 */
export const SCENE_CAMERA = {
  fov: 45,
  position: [0, 0.35, 2.6] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
}

/**
 * 商品在画布上应占的高度比例（0~1）。
 *
 * 按天航 2026-10-09 给的参考截图标定：截图里笔筒约占画布高的 40%。
 * 改这个数 = 所有商品的初始大小一起变。
 */
export const PRODUCT_SCREEN_HEIGHT = 0.4

export function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = []
  root.traverse(child => {
    if ((child as THREE.Mesh).isMesh) list.push(child as THREE.Mesh)
  })
  return list
}

/**
 * 按「相机里看到的高度」归一化 —— 让每个商品在屏幕上占同样大。
 *
 * 为什么不能沿用 `computeAutoFit`（按世界坐标最长边归一）：
 * 透视相机下，**有深度的模型会被放大**。笔筒是立方体（z 方向也接近 1.2），
 * 前表面离相机更近，实测占画布高 **67%**；团扇是薄片（z≈0.08），只占 **55%**。
 * 最长边明明都归到 1.2 了，屏幕上却差了 1.36 倍 —— 这就是「换个商品大小就跳」的根因。
 *
 * 这里改成：把模型**居中摆到原点后**的包围盒 8 个角点，用场景相机投影到 NDC，
 * 迭代求出「投影高度 = targetHeight」的缩放。透视下投影非线性，所以迭代几轮收敛。
 *
 * `radius` 仍是世界坐标下的包围球半径（爆炸视图的位移量用它，与缩放无关）。
 */
export function computeScreenFit(
  scene: THREE.Object3D,
  targetHeight = PRODUCT_SCREEN_HEIGHT,
) {
  scene.updateMatrixWorld(true)
  const worldBox = new Box3().setFromObject(scene)
  const size = new Vector3()
  worldBox.getSize(size)
  const center = new Vector3()
  worldBox.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const radius = maxDim * 0.5

  // 参考相机：和真实相机同参数，aspect 取 1（投影高度只取决于垂直 fov，与宽高比无关）
  const camera = new PerspectiveCamera(SCENE_CAMERA.fov, 1, 0.01, 500)
  camera.position.set(SCENE_CAMERA.position[0], SCENE_CAMERA.position[1], SCENE_CAMERA.position[2])
  camera.lookAt(SCENE_CAMERA.target[0], SCENE_CAMERA.target[1], SCENE_CAMERA.target[2])
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()

  // 模型渲染时会被摆到原点居中（`position={[-center…]}`），所以角点也先减掉中心
  const corners: Vector3[] = []
  for (let i = 0; i < 8; i += 1) {
    corners.push(new Vector3(
      (i & 1 ? worldBox.max.x : worldBox.min.x) - center.x,
      (i & 2 ? worldBox.max.y : worldBox.min.y) - center.y,
      (i & 4 ? worldBox.max.z : worldBox.min.z) - center.z,
    ))
  }

  /** 按给定缩放投影，返回占视口高度的比例（NDC 全高为 2） */
  const measure = (scale: number) => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const corner of corners) {
      const p = corner.clone().multiplyScalar(scale).project(camera)
      if (p.y < lo) lo = p.y
      if (p.y > hi) hi = p.y
    }
    return (hi - lo) / 2
  }

  let fit = targetHeight / Math.max(measure(1), 1e-6)
  for (let i = 0; i < 4; i += 1) {
    const current = measure(fit)
    if (current < 1e-6) break
    fit *= targetHeight / current
  }

  return { fit, center, radius, size, screenHeight: measure(fit) }
}

// Computes a scale factor that normalizes the model to `targetSize` regardless
// of export units, plus its world-space center and radius.
// 保留给底座示例模型（FBX / per-material 那几件）；正式商品走 `computeScreenFit`。
export function computeAutoFit(scene: THREE.Object3D, targetSize = 1.2) {
  scene.updateMatrixWorld(true)
  const worldBox = new Box3().setFromObject(scene)
  const size = new Vector3()
  worldBox.getSize(size)
  const center = new Vector3()
  worldBox.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const fit = targetSize / maxDim
  const radius = maxDim * 0.5
  return { fit, center, radius, size }
}

// Radial direction per mesh, sized to `radius`. Meshes coincident with the
// model center get a spiral fallback so a single-mesh model still visibly
// explodes.
export function computeRadialDirections(
  meshes: THREE.Mesh[],
  center: Vector3,
  radius: number,
): Map<string, Vector3> {
  const out = new Map<string, Vector3>()
  meshes.forEach((mesh, idx) => {
    const meshBox = new Box3().setFromObject(mesh)
    const meshCenter = new Vector3()
    meshBox.getCenter(meshCenter)
    const dir = meshCenter.clone().sub(center)
    if (dir.lengthSq() < 1e-6) {
      const angle = (idx / Math.max(1, meshes.length)) * Math.PI * 2
      dir.set(Math.cos(angle), 0.3, Math.sin(angle))
    }
    dir.normalize().multiplyScalar(radius)
    out.set(mesh.uuid, dir)
  })
  return out
}
