/**
 * 「影棚环境贴图」—— 纯代码搭一个产品摄影棚，烘成 IBL 环境贴图。
 *
 * 为什么不用现成的 HDRI 文件：
 *   底座原来用的是 drei 的 `<Environment preset="studio" />`，它要从 CDN 拉
 *   `studio_small_03_1k.hdr`。离线 / 弱网时拉不到 —— 这就是之前画面正中那条
 *   「环境贴图加载失败」红色提示的来源；而且它一旦失败，**商品就彻底没有反射**，
 *   陶瓷会看起来像一块哑光塑料。
 *
 *   这个文件用 PMREMGenerator 直接把一个自建的小场景烘成环境贴图：
 *   零外部资源、离线永远可用、不吃网络。顺带还能按商品需要调光位。
 *
 * 为什么陶瓷特别需要它：
 *   釉面的「亮」几乎全部来自**反射周围环境**，而不是来自几盏平行光。
 *   只给平行光的话，光滑表面上只会出现几个死板的小亮点。
 *   这里是按「柔光箱 + 竖条灯」布光 —— 竖条灯能在圆柱形的杯身上拉出一条
 *   细长的高光带，那是判断「这是瓷器不是塑料」最直接的一条视觉线索。
 */

import * as THREE from 'three'

/** 一块发光的柔光板（MeshBasicMaterial 不吃灯光，本身就是「发光体」） */
function addPanel(
  scene: THREE.Scene,
  options: { width: number; height: number; position: [number, number, number]; intensity: number },
) {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setScalar(options.intensity),
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width, options.height), material)
  mesh.position.set(...options.position)
  mesh.lookAt(0, 0, 0)
  scene.add(mesh)
  return mesh
}

/** 天顶→地平线→地面 的垂直渐变：给了商品一个自然的「上亮下暗」环境 */
function makeGradientSky(top: number, mid: number, bottom: number) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color().setScalar(top) },
      midColor: { value: new THREE.Color().setScalar(mid) },
      bottomColor: { value: new THREE.Color().setScalar(bottom) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 color = h >= 0.0
          ? mix(midColor, topColor, pow(h, 0.65))
          : mix(midColor, bottomColor, pow(-h, 0.45));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), material)
}

/**
 * 搭那个「摄影棚」。所有数值都只是亮度，单位无关紧要（环境贴图只记方向）。
 *
 * 亮度分配的原则：**背景要暗、灯要亮**。釉面的好看与否几乎全看这一点 ——
 * 环境光是个均匀亮面的话，整个杯子就变成一团平光灰；只有把柔光箱 / 竖条灯
 * 做得很亮、周围压暗，光滑表面才会反射出「细而亮」的高光带，
 * 一眼就能看出是上了釉的瓷器。所以下面灯的数值刻意是背景的十几倍。
 *
 * 光位说明（商品默认朝向 +Z，相机在 +Z 一侧）：
 *   · 顶部大柔光箱 —— 给杯口一圈和杯身顶部一条柔和的大面积高光
 *   · 左前 / 右前两根竖条灯 —— 杯身上那条细长高光带主要靠它
 *   · 背后一根竖条 —— 勾一圈轮廓光，把商品的边缘从背景里拉出来
 *   · 前下方一块大柔光板 —— 补亮杯身下半部，避免下缘死黑
 */
function buildStudioScene(): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene()
  const created: THREE.Object3D[] = []

  const sky = makeGradientSky(0.09, 0.018, 0.003)
  scene.add(sky)
  created.push(sky)

  created.push(addPanel(scene, { width: 5, height: 5, position: [0, 7, 0.5], intensity: 1.5 }))
  // 竖条灯要「细而亮」：灯越窄，反射到曲面上的高光带越锐利，越像上过釉的瓷器
  created.push(addPanel(scene, { width: 0.5, height: 6.5, position: [-5.2, 1.6, 4.2], intensity: 11 }))
  created.push(addPanel(scene, { width: 0.5, height: 5.5, position: [5.2, 1.8, 3.4], intensity: 3.6 }))
  created.push(addPanel(scene, { width: 0.6, height: 5.0, position: [-1.2, 2.4, -6.4], intensity: 4.0 }))
  created.push(addPanel(scene, { width: 7, height: 3, position: [0, -2.0, 5.6], intensity: 0.37 }))

  return {
    scene,
    dispose: () => {
      created.forEach((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      })
      scene.clear()
    },
  }
}

export interface StudioEnvironment {
  texture: THREE.Texture
  /** 用完（组件卸载 / 重建）必须调，否则显存里的 PMREM 缓存会一直堆着 */
  dispose: () => void
}

/**
 * 生成环境贴图。失败时返回 null —— 调用方会退回「只有灯光」的照明，
 * 而不是让整个 3D 场景报错白屏。
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): StudioEnvironment | null {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const studio = buildStudioScene()
  try {
    // sigma=0：柔光箱本身就是软的，不需要再加模糊；near/far 要包住半径 40 的天球
    const target = pmrem.fromScene(studio.scene, 0, 0.5, 120)
    const texture = target.texture
    return {
      texture,
      dispose: () => {
        target.dispose()
        pmrem.dispose()
        studio.dispose()
      },
    }
  } catch (error) {
    console.warn('[scene] 程序化环境贴图生成失败，退回纯灯光照明：', error)
    pmrem.dispose()
    studio.dispose()
    return null
  }
}
