/**
 * 商品展示的灯光与曝光参数。
 *
 * 底座的原始光照是按 PS5 手柄调的（深色外壳 + 高金属度），那套参数放在文创商品上会**严重过曝**：
 * 白瓷「花瓶·细颈」实测商品像素平均亮度 234/255、46% 的像素超过 240、18.6% 直接顶到 250 以上
 * —— 也就是近一半表面已经没有任何细节了。
 *
 * 叠加来源有四处，所以这里四档都单独抽出来，方便按商品材质调：
 *   1. toneMappingExposure —— R3F 默认 ACESFilmic + 曝光 1.0，全局乘数，最直观
 *   2. Environment(studio) 环境贴图 —— HDRI 当 IBL，对陶瓷/釉面这种光滑介电质贡献极大
 *   3. 主光（右上前方平行光）
 *   4. 补光（左后平行光）+ 无方向环境光
 *
 * 默认值已经压到白模不过曝（详见 README「灯光与曝光」一节的实测数据）。
 */

export interface LightSettings {
  /** 整体曝光，写进 renderer.toneMappingExposure */
  exposure: number
  /** 环境贴图强度，写进 Environment 的 environmentIntensity */
  environment: number
  /** 主光强度（右上平行光） */
  key: number
  /** 补光强度（左后平行光） */
  fill: number
  /** 无方向环境光强度 */
  ambient: number
}

/** 偏「产品摄影」的默认档：明亮但不丢细节，白模也不会顶到纯白 */
export const DEFAULT_LIGHTS: LightSettings = {
  exposure: 0.85,
  environment: 1,
  key: 0.4,
  fill: 0.18,
  ambient: 0.04,
}

export interface LightSliderSpec {
  key: keyof LightSettings
  label: string
  hint: string
  min: number
  max: number
  step: number
}

export const LIGHT_SLIDERS: LightSliderSpec[] = [
  { key: 'exposure', label: '整体曝光', hint: 'renderer.toneMappingExposure —— 觉得整体偏亮/偏暗先动这一档', min: 0.2, max: 1.6, step: 0.01 },
  { key: 'environment', label: '环境反光', hint: '影棚环境贴图的强度 —— 陶瓷釉面、金属感商品主要靠它；调高会同时让表面更「亮面」', min: 0, max: 2, step: 0.01 },
  { key: 'key', label: '主光', hint: '右上前方的主平行光', min: 0, max: 2, step: 0.01 },
  { key: 'fill', label: '补光', hint: '左后方的辅助平行光，压暗部', min: 0, max: 1.5, step: 0.01 },
  { key: 'ambient', label: '环境光', hint: '无方向的底光，避免背面全黑', min: 0, max: 1, step: 0.01 },
]

/** 与默认档比较，判断用户是否改过（用于决定「恢复默认」按钮是否高亮） */
export const isDefaultLights = (settings: LightSettings): boolean =>
  LIGHT_SLIDERS.every(({ key }) => Math.abs(settings[key] - DEFAULT_LIGHTS[key]) < 1e-6)
