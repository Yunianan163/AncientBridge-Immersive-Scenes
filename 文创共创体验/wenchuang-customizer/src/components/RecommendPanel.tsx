import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { COMPAT_CONFIG, recommendModels } from '../lib/modelCompat'
import type { ModelScore, Recommendation } from '../lib/modelCompat'
import { generatePrompt, promptIntro, promptSummary } from '../lib/promptGenerator'
import type { PromptResult } from '../lib/promptGenerator'
import { useTextureStudio } from '../state/textureStudio'

/**
 * 「智能推荐」—— 左侧「配色」面板里，「器物」那一段的最后一块。
 *
 * 干什么：用户手上有了一张图（AI 生成 / 本地上传 / 场景截图），这张图到底该贴到 9 个器物里的哪一个？
 *        这里把图绘到离屏 canvas 上算几个本地特征，给出 3 个推荐 + 每个的适配理由；
 *        不合适的那些折叠在「其他可选模型」里，并可以「生成改造提示词」去 AI 生图重画一张。
 *
 * 三个设计上的决定，改代码前先看一眼：
 *   1. **面板挂在「器物」段内**（跟商品下拉框挨着）—— 「选哪个器物」和「该选哪个器物」本来就是一件事，
 *      点「使用此模型」当场就切，反馈最近。为此它必须能被 `onModelChange` 驱动。
 *   2. **不用「点击分析」按钮** —— 图一变就自动算（需求文档要求的触发时机）。分析全在本地像素上做，
 *      不联网、不花钱，所以随便算。
 *   3. **分析结果按图片 URL 缓存**（模块级 Map）—— 因为 `ColorControls` 带 `key={currentModel.id}`，
 *      每次切商品整个面板会重新挂载，不缓存的话切一次就要重算一次。
 *
 * ⚠️ 硬性约束：任何分析失败都只是「不显示推荐」，绝不拦着用户贴图。
 */

interface RecommendPanelProps {
  /** 当前商品 preset id */
  currentModelId: string
  /** 切换商品 —— 就是 Scene.tsx 里那个 handleModelChange */
  onModelChange: (modelId: string) => void
  /** 「去 AI 工坊生成」：把提示词丢给右侧 ① AI 生图的输入框 */
  onSendToAi: (prompt: string) => void
}

// —— 模块级缓存：同一个图片 URL 只分析一次（切商品会重新挂载本组件，靠它兜住） ——
const analysisCache = new Map<string, Recommendation | null>()
const inflight = new Map<string, Promise<Recommendation | null>>()

function analyze(url: string): Promise<Recommendation | null> {
  if (analysisCache.has(url)) return Promise.resolve(analysisCache.get(url) ?? null)
  const running = inflight.get(url)
  if (running) return running
  const task = recommendModels(url).then((result) => {
    analysisCache.set(url, result)
    inflight.delete(url)
    return result
  })
  inflight.set(url, task)
  return task
}

/** 每个 id 对应一个墨线小图标，代替商品缩略图（项目里没有缩略图资源，也不值得为此加一堆二进制） */
function ModelGlyph({ profileId }: { profileId: string }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (profileId) {
    case 'cup_classic':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 8h11v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
          <path d="M15 10.5h1.8a2.2 2.2 0 0 1 0 4.4H15" />
        </svg>
      )
    case 'cup_straight':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 5h11l-.9 13.2a2 2 0 0 1-2 1.8h-5.2a2 2 0 0 1-2-1.8z" />
          <path d="M6.4 9h10.2" />
        </svg>
      )
    case 'vase_belly':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M10 3h4l-.6 2.2c2.3 1.6 3.6 4 3.6 6.8a5 5 0 0 1-10 0c0-2.8 1.3-5.2 3.6-6.8z" />
          <path d="M9.6 20h4.8" />
        </svg>
      )
    case 'vase_slim':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M10.4 3h3.2l-.4 3.4c1.9 1.5 3 3.6 3 6.4a4.6 4.6 0 0 1-9.2 0c0-2.8 1.1-4.9 3-6.4z" />
          <path d="M10 20h4" />
        </svg>
      )
    case 'penholder_round':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 6.6v11.2c0 1.1 2.7 2 6 2s6-.9 6-2V6.6" />
          <ellipse cx="12" cy="6.6" rx="6" ry="2" />
        </svg>
      )
    case 'penholder_square':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 6.6h12v11.2H6z" />
          <path d="M6 9.2h12" />
        </svg>
      )
    case 'bag_onepiece':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4.6 8.5h14.8l-1 11.5H5.6z" />
          <path d="M9 8.5a3 3 0 0 1 6 0" />
        </svg>
      )
    case 'bag_tote':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 7h16l-1.2 13H5.2z" />
          <path d="M8.4 7a3.6 3.6 0 0 1 7.2 0" />
          <path d="M7.4 11.5h9.2" />
        </svg>
      )
    case 'fan_tuanshan':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="10.5" r="6.6" />
          <path d="M12 17.1V21" />
        </svg>
      )
    default:
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      )
  }
}

/** 适配度进度条 */
function ScoreBar({ score }: { score: number }) {
  // 中国习惯：好 = 朱红，差 = 墨灰。三档换色，别用红绿（红在这儿是「好」）
  const tone = score >= COMPAT_CONFIG.recommendThreshold ? 'is-good' : score >= 40 ? 'is-mid' : 'is-low'
  return (
    <div className={`recommend-bar ${tone}`} role="img" aria-label={`适配度 ${score} 分`}>
      <span className="recommend-bar-fill" style={{ width: `${Math.max(2, score)}%` }} />
    </div>
  )
}

export function RecommendPanel({ currentModelId, onModelChange, onSendToAi }: RecommendPanelProps) {
  const { pending, painted, product } = useTextureStudio()

  // 当前该分析哪张图：正在等贴图的优先，其次是已经贴上的那张
  const imageUrl = pending?.url ?? painted?.imageUrl ?? null

  const [result, setResult] = useState<Recommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [dialog, setDialog] = useState<{ score: ModelScore; prompt: PromptResult } | null>(null)
  const [copied, setCopied] = useState(false)
  // 左栏只有 280px 宽，推荐列表挺占地方的，给个收起开关
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!imageUrl) {
      setResult(null)
      setFailed(false)
      return undefined
    }

    let alive = true
    const cached = analysisCache.get(imageUrl)
    if (cached !== undefined) {
      setResult(cached)
      setFailed(cached === null)
      return undefined
    }

    setLoading(true)
    setFailed(false)
    analyze(imageUrl)
      .then((next) => {
        if (!alive) return
        setResult(next)
        setFailed(next === null)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setResult(null)
        setFailed(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [imageUrl])

  // 换商品时（ColorControls 带 key 会整块重挂载）把弹框关掉，避免残留
  useEffect(() => {
    setDialog(null)
    setCopied(false)
  }, [currentModelId])

  // Esc 关弹框 —— 里面是个只读文本框，用户很容易顺手去按 Esc
  useEffect(() => {
    if (!dialog) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

  const features = result?.features ?? null
  const top = result?.top ?? []

  const featureChips = useMemo(() => {
    if (!features) return []
    return [
      { label: '宽高比', value: `${features.aspectRatio}:1` },
      { label: '密度', value: features.patternDensity.toFixed(2) },
      { label: '色数', value: `${features.colorCount}` },
      { label: '边缘', value: features.edgeSimilarity.toFixed(2) },
      { label: '留白', value: features.blankRatio.toFixed(2) },
    ]
  }, [features])

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // 剪贴板被拒（非 https / 权限）时退回老办法，仍然失败就提示用户手动选
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      setCopied(ok)
    }
  }, [])

  /** 「生成改造提示词」—— 只看这一条，不需要重新分析 */
  const openPrompt = useCallback(
    (score: ModelScore) => {
      if (!features) return
      setDialog({ score, prompt: generatePrompt(score, features) })
      setCopied(false)
    },
    [features],
  )

  return (
    <div className="recommend-panel">
      <div className="recommend-head">
        <h3>智能推荐</h3>
        {features && <span className="recommend-badge">按当前图片</span>}
        <button
          type="button"
          className="recommend-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          {!imageUrl && (
            <p className="recommend-hint">
              在右侧「① AI 生图」或「② 上传图片」里拿到一张图后，这里会算出它最适合贴在哪个器物上。
            </p>
          )}

          {imageUrl && loading && <p className="recommend-hint">正在分析这张图…</p>}

          {imageUrl && failed && (
            <p className="recommend-hint">
              这张图分析不了（可能是格式或跨域问题），不影响正常贴图，直接点「可贴图部位」即可。
            </p>
          )}

          {imageUrl && features && !loading && (
            <>
          <div className="recommend-chips">
            {featureChips.map((chip) => (
              <span key={chip.label} className="recommend-chip" title={`${chip.label} ${chip.value}`}>
                {chip.label} <b>{chip.value}</b>
              </span>
            ))}
          </div>

          <ul className="recommend-list">
            {top.map((item, index) => {
              const active = item.presetId === currentModelId
              return (
                <li key={item.id} className={`recommend-card${active ? ' is-active' : ''}`}>
                  <div className="recommend-card-top">
                    <span className="recommend-rank">{index + 1}</span>
                    <span className="recommend-glyph">
                      <ModelGlyph profileId={item.id} />
                    </span>
                    <span className="recommend-name">{item.presetName}</span>
                    <span className="recommend-score">{item.score}</span>
                  </div>
                  <ScoreBar score={item.score} />
                  <p className="recommend-reason">{item.topReason}</p>
                  <div className="recommend-actions">
                    <button
                      type="button"
                      className="recommend-use"
                      disabled={active}
                      onClick={() => onModelChange(item.presetId)}
                    >
                      {active ? '当前器物' : '使用此模型'}
                    </button>
                    <button type="button" className="recommend-ghost" onClick={() => openPrompt(item)}>
                      生成改造提示词
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          {result && result.rest.length > 0 && (
            <details className="recommend-rest">
              <summary>其他可选模型（{result.rest.length}）</summary>
              <ul>
                {result.rest.map((item) => (
                  <li key={item.id} className={item.presetId === currentModelId ? 'is-active' : ''}>
                    <span className="recommend-rest-name">{item.presetName}</span>
                    <span className="recommend-rest-score">{item.score}</span>
                    <button type="button" onClick={() => onModelChange(item.presetId)}>
                      用它
                    </button>
                    <button type="button" className="recommend-ghost" onClick={() => openPrompt(item)}>
                      改造提示词
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {product && painted && painted.source && (
            <p className="recommend-foot">
              已贴到「{painted.regionName || painted.meshName}」；换器物不会丢掉这张图，切完再点「可贴图部位」即可。
            </p>
          )}
            </>
          )}
        </>
      )}

      {dialog &&
        createPortal(
          <div className="prompt-modal" role="dialog" aria-modal="true" aria-label="改造提示词">
            <div className="prompt-modal-card">
              <div className="prompt-modal-head">
                <h4>改造提示词</h4>
                <button type="button" aria-label="关闭" onClick={() => setDialog(null)}>
                  ×
                </button>
              </div>

              <p className="prompt-modal-intro">{promptIntro(dialog.score, dialog.prompt)}</p>

              {dialog.prompt.tags.length > 0 && (
                <div className="prompt-modal-tags">
                  {dialog.prompt.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}

              <textarea className="prompt-modal-text" readOnly rows={6} value={dialog.prompt.text} />

              <p className="prompt-modal-summary">{promptSummary(dialog.prompt)}</p>

              <div className="prompt-modal-actions">
                <button type="button" className="prompt-modal-copy" onClick={() => void handleCopy(dialog.prompt.text)}>
                  {copied ? '已复制' : '一键复制'}
                </button>
                <button
                  type="button"
                  className="prompt-modal-go"
                  onClick={() => {
                    onSendToAi(dialog.prompt.text)
                    setDialog(null)
                  }}
                >
                  去 AI 生图
                </button>
              </div>

              <p className="prompt-modal-note">
                提示词只是建议 —— 密度、色数超出只影响排序，不会拦住你直接贴图。
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
