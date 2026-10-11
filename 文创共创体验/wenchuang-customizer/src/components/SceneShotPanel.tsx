import { useCallback, useEffect, useState } from 'react'
import { deleteSceneSnapshot, listSceneSnapshots, redrawImage, resolveAssetUrl } from '../lib/api'
import type { SceneSnapshot } from '../lib/api'
import { surfaceLabel, useTextureStudio } from '../state/textureStudio'
import { RegionPicker } from './RegionPicker'

/** 面板里最多列多少张：这里只用来挑图，不是相册，不必全摊开 */
const MAX_SHOWN = 24
/** 静默轮询间隔 —— 截完图切回文创页面，图大约这么久内自己冒出来 */
const POLL_MS = 6000

/**
 * 场景截图素材库。
 *
 * 在苏州双桥 / 贵州葛镜桥场景里点右上角的 📷，画面就 POST 到文创后端，
 * 落进 server/public/scene-shots/。这里把它们列出来，点一下即走和 AI 生图、
 * 上传图片**完全相同**的那条链路：arm() → 状态变 awaiting-pick → 在商品上点面贴图。
 * 所以「场景截图能不能贴到商品上」不取决于这个面板，取决于 arm 那套早已跑通的机制，
 * 本面板只负责「把图递进去」。
 *
 * 刷新靠轮询而不是事件：两个场景（8082 / 8123）和文创（5173）是不同端口，
 * localStorage 与 BroadcastChannel 都按 origin 隔离，收不到对方写的消息。
 * 只在页面可见时拉，避免后台标签页空转。
 *
 * 「AI 二次创作」（图生图）已接入火山方舟 Seedream：每张素材卡左下角有个 AI 按钮，
 * 点开写下改造描述，就基于这张截图再生成一张新图；新图回来后同样走 arm(url, 'scene')，
 * 和直接点素材图贴图完全同一条下游链路，所以贴图那一侧一行都没改。
 * 接口见 lib/api.ts 的 redrawImage()，服务端见 server/index.js 的 POST /api/redraw。
 */
export function SceneShotPanel() {
  const { arm, cancel, status, pending, painted } = useTextureStudio()
  const [shots, setShots] = useState<SceneSnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  // ------------------------------------------------ AI 二次创作（图生图）
  /** 当前选中的参考图；非空即展开编辑区 */
  const [redrawTarget, setRedrawTarget] = useState<SceneSnapshot | null>(null)
  const [redrawPrompt, setRedrawPrompt] = useState('')
  const [redrawing, setRedrawing] = useState(false)
  const [redrawUrl, setRedrawUrl] = useState<string | null>(null)
  const [redrawError, setRedrawError] = useState<string | null>(null)

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      setShots(await listSceneSnapshots({ limit: MAX_SHOWN }))
      setError(null)
    } catch (err) {
      // 静默轮询失败不打扰用户 —— 后端没起时，不该每 6 秒弹一次一样的错
      if (!silent) setError(err instanceof Error ? err.message : '加载素材库失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load, reloadTick])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const openRedraw = (shot: SceneSnapshot) => {
    setRedrawTarget(shot)
    setRedrawPrompt('')
    setRedrawUrl(null)
    setRedrawError(null)
  }

  const closeRedraw = () => {
    setRedrawTarget(null)
    setRedrawUrl(null)
    setRedrawError(null)
  }

  const remove = async (id: string) => {
    try {
      await deleteSceneSnapshot(id)
      setShots((prev) => prev.filter((shot) => shot.id !== id))
      // 正拿它当参考图创作时被删掉了，顺手把编辑区也收起来，避免指向一张不存在的图
      if (redrawTarget?.id === id) closeRedraw()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  /**
   * 把这张截图当参考图，交给后端 /api/redraw 走 Seedream 图生图。
   *
   * 这里传的是素材库的**相对地址**（`/scene-shots/xxx.png`），不是拼好前缀的完整 URL：
   * 方舟是云端服务，取不到本机的 localhost 地址，所以后端会在服务端读盘转成 Base64
   * 再发给方舟（见 server/index.js 的 resolveReferenceImage）。
   */
  const handleRedraw = async () => {
    if (!redrawTarget) return
    const text = redrawPrompt.trim()
    if (!text) {
      setRedrawError('请先写下想怎么改造这张图')
      return
    }
    if (redrawing) return

    setRedrawing(true)
    setRedrawError(null)
    try {
      const result = await redrawImage({ prompt: text, image: redrawTarget.url })
      const url = resolveAssetUrl(String(result.url))
      setRedrawUrl(url)
      // 拿到新图就 arm —— 之后「在商品上点面贴图」的流程和直接点素材图完全一样
      arm(url, 'scene', text)
    } catch (err) {
      setRedrawError(err instanceof Error ? err.message : '二次创作失败，请重试')
    } finally {
      setRedrawing(false)
    }
  }

  const waitingForShot = status === 'awaiting-pick' && pending?.source === 'scene'
  const paintedFromShot = status === 'applied' && painted?.source === 'scene'

  /** 素材卡按来源场景着色（苏州 → 青碧，葛镜 → 赭金），只挂一个数据属性，
   *  具体颜色写在 theme.css 里 —— 以后调主题不用动这个组件。 */
  const sceneKey = (name: string) =>
    name.includes('苏州') ? 'suzhou' : name.includes('葛镜') ? 'gejin' : 'other'

  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <h3>③ 场景截图</h3>
        <span className="studio-card-tag">{shots.length > 0 ? `${shots.length} 张` : '素材库'}</span>
      </div>

      <p className="studio-empty">
        在苏州双桥 / 葛镜桥场景里点右上角的 📷，画面会自动出现在这里；点一张即可贴到商品上，
        点卡片左下角的 AI 按钮还能以它为参考图再创作一张。
      </p>

      {shots.length > 0 ? (
        <div className="studio-snaps">
          {shots.map((shot) => {
            const url = resolveAssetUrl(shot.url)
            const active = pending?.source === 'scene' && pending.url === url
            return (
              <div
                key={shot.id}
                className={`studio-snap${active ? ' is-active' : ''}`}
                data-scene={sceneKey(shot.sceneName)}
              >
                <button
                  type="button"
                  className="studio-snap-pick"
                  onClick={() => arm(url, 'scene', `${shot.sceneName} 场景截图`)}
                  title={`${shot.sceneName}${shot.width ? ` · ${shot.width}×${shot.height}` : ''}，点一下贴到商品`}
                >
                  <img src={url} alt={`${shot.sceneName} 截图`} loading="lazy" />
                  <span className="studio-snap-scene">{shot.sceneName}</span>
                </button>
                <button
                  type="button"
                  className="studio-snap-ai"
                  onClick={() => openRedraw(shot)}
                  aria-label={`以「${shot.sceneName}」这张截图为参考做 AI 二次创作`}
                  title="AI 二次创作：以这张图为参考再生成一张"
                >
                  AI
                </button>
                <button
                  type="button"
                  className="studio-snap-del"
                  onClick={() => void remove(shot.id)}
                  aria-label={`从素材库删除这张 ${shot.sceneName} 截图`}
                  title="从素材库删除"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="studio-snaps-empty">素材库还是空的</p>
      )}

      {redrawTarget && (
        <div className="studio-redraw">
          <div className="studio-redraw-head">
            <img src={resolveAssetUrl(redrawTarget.url)} alt="参考图" />
            <div className="studio-redraw-meta">
              <strong>AI 二次创作</strong>
              <span>参考图：{redrawTarget.sceneName} 截图</span>
            </div>
            <button
              type="button"
              className="studio-redraw-close"
              onClick={closeRedraw}
              aria-label="收起二次创作"
              title="收起"
            >
              ×
            </button>
          </div>

          <textarea
            className="studio-input"
            rows={2}
            placeholder="想怎么改造？比如：把这座桥改成雪夜，水墨淡彩"
            value={redrawPrompt}
            onChange={(event) => setRedrawPrompt(event.target.value)}
            disabled={redrawing}
          />

          <div className="studio-row">
            <button
              type="button"
              className="studio-primary"
              onClick={() => void handleRedraw()}
              disabled={redrawing}
            >
              {redrawing ? '生成中…' : '生成新图案'}
            </button>
          </div>

          {redrawUrl && (
            <div className="studio-preview">
              <img src={redrawUrl} alt="二次创作结果" />
            </div>
          )}

          {redrawError && (
            <div className="studio-error">
              <span>{redrawError}</span>
              <button type="button" onClick={() => setRedrawError(null)} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {paintedFromShot && painted && (
        <div className="studio-preview">
          <img src={painted.imageUrl} alt="已贴的场景截图" />
          <span className="studio-preview-badge">已贴到 {surfaceLabel(painted)}</span>
        </div>
      )}

      <div className="studio-row">
        <button
          type="button"
          className="studio-ghost"
          onClick={() => setReloadTick((value) => value + 1)}
          disabled={loading}
        >
          {loading ? '刷新中…' : '刷新素材库'}
        </button>
      </div>

      {waitingForShot && (
        <div className="studio-hint">
          <span className="studio-hint-dot" />
          <span>请点击商品要贴图的面</span>
          <button type="button" className="studio-hint-cancel" onClick={cancel}>
            取消
          </button>
        </div>
      )}

      {error && (
        <div className="studio-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      <RegionPicker source="scene" />
    </section>
  )
}
