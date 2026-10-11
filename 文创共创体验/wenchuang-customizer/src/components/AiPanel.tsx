import { useEffect, useRef, useState } from 'react'
import { generateImage, redrawImage, resolveAssetUrl } from '../lib/api'
import { fileToReferenceImage } from '../lib/referenceImage'
import { surfaceLabel, useTextureStudio } from '../state/textureStudio'
import { RegionPicker } from './RegionPicker'

/** 文生图：古桥 / 传统文化方向的常用提示词，一点就用，省得用户空想 */
const TEXT_PRESETS = [
  '古桥石拱纹样，水墨线描，单色',
  '青花瓷缠枝莲纹，白底蓝花',
  '敦煌飞天飘带纹，暖金配色',
  '写意山水云雾，淡青灰',
  '苗银几何纹，对称回纹',
]

/** 图生图：这里要的是「怎么改」而不是「画什么」，所以给的是改法 */
const IMAGE_PRESETS = [
  '改成雪夜，水墨淡彩',
  '换成青花瓷配色，白底蓝花',
  '改成黄昏暖光，电影感',
  '转为工笔重彩风格',
  '背景换成江南烟雨',
]

/** 文生图 = 只给文字；图生图 = 给一张参考图 + 改造描述 */
type AiMode = 'text' | 'image'

/** 已选好的参考图（压过的 data URL + 展示用信息） */
interface Reference {
  url: string
  name: string
  width: number
  height: number
}

/**
 * AI 生图面板（核心）。两种模式共用一个卡片：
 *
 *   文生图：输入文字 → POST /api/generate           → 拿回图片 URL
 *   图生图：上传参考图 + 改造描述 → POST /api/redraw → 拿回图片 URL
 *
 * 两条路拿到图之后完全并轨：arm(url, 'ai', prompt) → 状态变 awaiting-pick →
 * 用户在 3D 商品上点一下，SurfacePicker 用 Raycaster 把图贴到那个面。
 *
 * 接口封装在 lib/api.ts（generateImage / redrawImage），
 * 本地图片的压缩在 lib/referenceImage.ts。
 */
export function AiPanel() {
  const { arm, cancel, status, pending, painted, busy, setBusy, promptDraft, setPromptDraft } = useTextureStudio()
  const [mode, setMode] = useState<AiMode>('text')
  const [prompt, setPrompt] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  // 生图本身的失败提示留在本卡片内；贴图阶段的报错（没点到面 / 没有 UV）由工作台顶部统一展示
  const [genError, setGenError] = useState<string | null>(null)

  // 图生图：参考图本身 + 「正在读文件」的过渡态（大图压缩需要一点时间）
  const [reference, setReference] = useState<Reference | null>(null)
  const [readingRef, setReadingRef] = useState(false)

  const cardRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 「智能推荐」的「去 AI 生图」把提示词投递到这里：
  // 切回文生图模式 → 填进输入框 → 清掉投递位（不清的话下次进页面会盖掉用户正在写的内容）
  // → 滚过来并聚焦。
  useEffect(() => {
    if (!promptDraft) return
    setMode('text')
    setPrompt(promptDraft)
    setGenError(null)
    setPromptDraft(null)
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    inputRef.current?.focus()
  }, [promptDraft, setPromptDraft])

  const waitingForPick = status === 'awaiting-pick' && pending?.source === 'ai'

  /** 切模式时把上一次的生成结果清掉 —— 否则会让人误以为那是新模式产出的 */
  const switchMode = (next: AiMode) => {
    if (next === mode) return
    setMode(next)
    setPreview(null)
    setGenError(null)
  }

  const handleReferenceFile = async (file: File | null | undefined) => {
    if (!file) return
    setReadingRef(true)
    setGenError(null)
    try {
      const ref = await fileToReferenceImage(file)
      setReference({ url: ref.dataUrl, name: ref.name, width: ref.width, height: ref.height })
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '图片读取失败，请换一张试试')
    } finally {
      setReadingRef(false)
    }
  }

  const handleGenerate = async () => {
    const text = prompt.trim()
    if (!text) {
      setGenError(mode === 'text' ? '请先输入想要生成的图案描述' : '请先写下想怎么改造这张参考图')
      return
    }
    if (mode === 'image' && !reference) {
      setGenError('请先上传一张参考图')
      return
    }
    if (busy || readingRef) return

    setBusy(true)
    setGenError(null)
    try {
      // 两条路的返回结构一致，后端都做了「落盘到本地再返回同源地址」
      const data =
        mode === 'text'
          ? await generateImage(text)
          : await redrawImage({ prompt: text, image: reference!.url })

      const url = resolveAssetUrl(String(data.url))
      setPreview(url)
      arm(url, 'ai', text)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="studio-card" ref={cardRef}>
      <div className="studio-card-head">
        <h3>① AI 生图</h3>
        <span className="studio-card-tag">Seedream 5.0 Flash</span>
      </div>

      <div className="studio-modes" role="tablist" aria-label="生成方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'text'}
          className={`studio-mode${mode === 'text' ? ' is-active' : ''}`}
          onClick={() => switchMode('text')}
          disabled={busy}
        >
          文生图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'image'}
          className={`studio-mode${mode === 'image' ? ' is-active' : ''}`}
          onClick={() => switchMode('image')}
          disabled={busy}
        >
          图生图
        </button>
      </div>

      {mode === 'image' && (
        <>
          <label
            className="studio-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleReferenceFile(event.dataTransfer.files?.[0])
            }}
          >
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                void handleReferenceFile(event.target.files?.[0])
                // 清空 value，否则连续选同一个文件不会触发 onChange
                event.target.value = ''
              }}
            />
            <span>
              {readingRef
                ? '正在处理图片…'
                : reference
                  ? `参考图：${reference.name}（点击可更换）`
                  : '点击上传参考图，或把图片拖进来'}
            </span>
          </label>

          {reference && (
            <div className="studio-preview">
              <img src={reference.url} alt="图生图的参考图" />
              <span className="studio-preview-tag">
                参考图 {reference.width}×{reference.height}
              </span>
            </div>
          )}
        </>
      )}

      <textarea
        ref={inputRef}
        className="studio-input"
        rows={3}
        placeholder={
          mode === 'text'
            ? '描述你想要的图案，比如：古桥石拱纹样，水墨线描，单色'
            : '描述想怎么改造这张参考图，比如：改成雪夜，水墨淡彩'
        }
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={busy}
      />

      <div className="studio-chips">
        {(mode === 'text' ? TEXT_PRESETS : IMAGE_PRESETS).map((preset) => (
          <button
            key={preset}
            type="button"
            className="studio-chip"
            onClick={() => setPrompt(preset)}
            disabled={busy}
          >
            {preset}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="studio-primary"
        onClick={handleGenerate}
        disabled={busy || readingRef}
      >
        {busy ? '生成中…' : mode === 'text' ? 'AI 生图' : 'AI 图生图'}
      </button>

      {preview && (
        <div className="studio-preview">
          <img src={preview} alt="生成的图案" />
          {mode === 'image' && <span className="studio-preview-tag">生成结果</span>}
          {painted?.source === 'ai' && status === 'applied' && (
            <span className="studio-preview-badge">已贴到 {surfaceLabel(painted)}</span>
          )}
        </div>
      )}

      {waitingForPick && (
        <div className="studio-hint">
          <span className="studio-hint-dot" />
          <span>请点击商品要贴图的面</span>
          <button type="button" className="studio-hint-cancel" onClick={cancel}>
            取消
          </button>
        </div>
      )}

      <RegionPicker source="ai" />

      {genError && (
        <div className="studio-error">
          <span>{genError}</span>
          <button type="button" onClick={() => setGenError(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
    </section>
  )
}
