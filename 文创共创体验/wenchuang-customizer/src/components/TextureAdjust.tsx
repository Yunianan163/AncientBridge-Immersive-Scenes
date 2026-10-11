import { surfaceLabel, useTextureStudio } from '../state/textureStudio'
import type { TextureSource } from '../state/textureStudio'

const RAD = 180 / Math.PI

/** 待贴图来源的中文名。三条入口都要有：AI 生图 / 本地上传 / 场景截图 */
const SOURCE_LABEL: Record<TextureSource, string> = {
  ai: 'AI 生图',
  upload: '本地上传',
  scene: '场景截图',
}

interface SliderProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}

function Slider({ label, hint, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <div className="studio-slider">
      <div className="studio-slider-head">
        <span className="studio-slider-label">{label}</span>
        <span className="studio-slider-value">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        title={hint}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

/**
 * 贴图参数实时调节。
 * 每次改动都会 texture.center.set(0.5,0.5) + 写回 offset / repeat / rotation，
 * 并置 texture.needsUpdate = true，直接作用在当前已贴图的那个部位上，所见即所得。
 */
export function TextureAdjust() {
  const { painted, uv, setUv, resetUv, clearTexture } = useTextureStudio()

  if (!painted) {
    return (
      <section className="studio-card">
        <div className="studio-card-head">
          <h3>④ 贴图微调</h3>
        </div>
        <p className="studio-empty">还没有贴图。先在 ① 生成、② 上传，或从 ③ 场景截图里挑一张，然后在商品上点一下要贴的部位。</p>
      </section>
    )
  }

  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <h3>④ 贴图微调</h3>
        <span
          className="studio-card-tag"
          title={painted.regionName ? `模型零件：${painted.meshName}` : painted.meshUuid}
        >
          {painted.faceIndex >= 0 ? `面 #${painted.faceIndex}` : '整块部位'}
        </span>
      </div>

      <div className="studio-target">
        <img src={painted.imageUrl} alt="当前贴图" />
        <div>
          <div className="studio-target-name">{surfaceLabel(painted)}</div>
          <div className="studio-target-meta">
            {/* ⚠️ TextureSource 是 'ai' | 'upload' | 'scene' 三值（scene 于 2026-10-09 加入），
                不能再写成二分 —— 否则场景截图会被显示成「本地上传」。 */}
            来源：{SOURCE_LABEL[painted.source] ?? '本地上传'}
            {painted.prompt ? ` · ${painted.prompt}` : ''}
          </div>
          {painted.unlisted && (
            <div className="studio-target-meta is-warn">
              该部位未写进命名表，只贴了所选表面
            </div>
          )}
        </div>
      </div>

      <Slider
        label="左右偏移"
        hint="texture.offset.x"
        value={uv.offsetX}
        min={-1}
        max={1}
        step={0.005}
        onChange={(value) => setUv({ offsetX: value })}
      />
      <Slider
        label="上下偏移"
        hint="texture.offset.y"
        value={uv.offsetY}
        min={-1}
        max={1}
        step={0.005}
        onChange={(value) => setUv({ offsetY: value })}
      />
      <Slider
        label="横向平铺"
        hint="texture.repeat.x"
        value={uv.repeatX}
        min={0.1}
        max={6}
        step={0.01}
        onChange={(value) => setUv({ repeatX: value })}
      />
      <Slider
        label="纵向平铺"
        hint="texture.repeat.y"
        value={uv.repeatY}
        min={0.1}
        max={6}
        step={0.01}
        onChange={(value) => setUv({ repeatY: value })}
      />
      <Slider
        label="旋转"
        hint="texture.rotation"
        value={uv.rotation * RAD}
        min={0}
        max={360}
        step={1}
        format={(value) => `${Math.round(value)}°`}
        onChange={(value) => setUv({ rotation: value / RAD })}
      />

      <div className="studio-row">
        <button type="button" className="studio-ghost" onClick={resetUv}>
          重置参数
        </button>
        <button type="button" className="studio-ghost is-danger" onClick={clearTexture}>
          移除贴图
        </button>
      </div>
    </section>
  )
}
