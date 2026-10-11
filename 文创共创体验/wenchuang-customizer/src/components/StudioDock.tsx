import { useEffect, useState } from 'react'
import { AiPanel } from './AiPanel'
import { UploadPanel } from './UploadPanel'
import { SceneShotPanel } from './SceneShotPanel'
import { TextureAdjust } from './TextureAdjust'
import { ExportPanel } from './ExportPanel'
import { BridgeNotes } from './BridgeNotes'
import { useTextureStudio } from '../state/textureStudio'

/**
 * 右侧「文创定制工作台」：把 AI 生图 / 上传图片 / 贴图微调 / 导出下单 四块串成一条流水线。
 * 与左侧原有的拾色器（Colors 面板）并列显示，两套机制互不影响。
 */
export function StudioDock() {
  const { notice, setNotice, pending, status, product, error, setError } = useTextureStudio()
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 1100px)').matches
  })

  // 面板展开时给 body 挂个标记，让「爆炸视图」面板往左让位，避免两个面板叠在一起
  useEffect(() => {
    document.body.classList.toggle('studio-dock-open', open)
    return () => document.body.classList.remove('studio-dock-open')
  }, [open])

  // 提示条 4 秒后自动淡出
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])

  return (
    <>
      <button
        type="button"
        className={`studio-dock-toggle${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? '收起文创定制工作台' : '展开文创定制工作台'}
        aria-expanded={open}
        title={open ? '收起文创定制工作台' : '展开文创定制工作台'}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
          <path d="M17 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </svg>
      </button>

      {open && (
        <aside className="studio-dock" aria-label="文创 AI 定制工作台">
          <header className="studio-dock-head">
            <div>
              <h2>双桥记 · 文创定制</h2>
              <p>
                {product ? `当前商品：${product.name}` : '正在加载商品…'}
                {pending && status === 'awaiting-pick' ? ' · 等待点击贴图面' : ''}
              </p>
            </div>
            <button
              type="button"
              className="studio-dock-close"
              onClick={() => setOpen(false)}
              aria-label="收起工作台"
            >
              ×
            </button>
          </header>

          {notice && (
            <div className="studio-notice">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
                ×
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

          <div className="studio-dock-body">
            <AiPanel />
            <UploadPanel />
            {/* 场景截图（苏州双桥 / 葛镜桥右上角 📷）→ 素材库 → 点一张贴到商品 */}
            <SceneShotPanel />
            <TextureAdjust />
            <ExportPanel />
            <BridgeNotes />
          </div>
        </aside>
      )}
    </>
  )
}
