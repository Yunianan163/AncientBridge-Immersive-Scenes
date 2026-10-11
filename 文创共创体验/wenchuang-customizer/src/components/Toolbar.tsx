import { useState, useRef, useEffect } from 'react'
import { LightingPanel } from './LightingPanel'
import type { LightSettings } from '../three/lighting'

interface ToolbarProps {
  explodeViewEnabled: boolean
  onExplodeViewToggle: (enabled: boolean) => void
  autoRotateEnabled: boolean
  onAutoRotateToggle: (enabled: boolean) => void
  onResetColors: () => void
  modelName?: string
  backgroundColor: string
  onBackgroundColorChange: (color: string) => void
  selectionEnabled: boolean
  onSelectionToggle: (enabled: boolean) => void
  colorizeMode: boolean
  onColorizeToggle: (enabled: boolean) => void
  lights: LightSettings
  onLightsChange: (settings: LightSettings) => void
}

/**
 * 「画底」预设 —— 取的全是两桥现场的颜色：
 * 松墨（青绿山水的墨底，默认）、青石（两桥同为青石砌筑）、暮山（黔中峡谷的暮紫）、
 * 赭石（夯土崖壁）、黛瓦（江南屋面）、焦墨、宣纸 / 绢本（浅底，像把器物摆在册页上）。
 *
 * ⚠️ 默认画底必须出现在这张表里 —— Toolbar 是用「颜色值相等」来点亮当前选中的那格。
 * ⚠️ 这八格要整体保持**暖**：页面本身是宣纸底，画底一旦偏冷蓝，
 *    画心就会像在暖纸中间挖了个冷色的洞（原来的 #3f4a4c「墨青」就是这个毛病）。
 */
const BG_PRESETS: Array<{ color: string; label: string }> = [
  { color: '#34352d', label: '松墨' },
  { color: '#4e5350', label: '青石' },
  { color: '#4a4249', label: '暮山' },
  { color: '#5c4a3d', label: '赭石' },
  { color: '#454a51', label: '黛瓦' },
  { color: '#2b2721', label: '焦墨' },
  { color: '#ece3d0', label: '宣纸' },
  { color: '#e0d3b6', label: '绢本' },
]

/** 题签上的朱砂印：一横桥面之下，圆拱（世德桥）、方洞（永安桥）、尖拱（葛镜桥）并列 */
function SealMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8H21" strokeWidth="1.8" />
      <path d="M3 16a3.6 3.6 0 0 1 7.2 0" />
      <path d="M11.6 16V11.6h3.6V16" />
      <path d="M17 16l2-4.4 2 4.4" />
      <path d="M3 8V16M21 8V16" strokeOpacity="0.55" strokeWidth="1.2" />
    </svg>
  )
}

export function Toolbar({
  explodeViewEnabled,
  onExplodeViewToggle,
  autoRotateEnabled,
  onAutoRotateToggle,
  onResetColors,
  modelName,
  backgroundColor,
  onBackgroundColorChange,
  selectionEnabled,
  onSelectionToggle,
  colorizeMode,
  onColorizeToggle,
  lights,
  onLightsChange,
}: ToolbarProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const configMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (configMenuRef.current && !configMenuRef.current.contains(event.target as Node)) {
        setIsConfigOpen(false)
      }
    }
    if (isConfigOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isConfigOpen])

  return (
    <div className="toolbar">
      <div className="toolbar-content">
        <div className="toolbar-plaque">
          <span className="toolbar-seal" aria-hidden="true">
            <SealMark />
          </span>
          <h1>
            双桥记
            <span className="toolbar-title-sub">苏州钥匙桥 · 黔中葛镜桥</span>
            {modelName && <span className="toolbar-model-name">{modelName}</span>}
          </h1>
        </div>
      </div>
      <div className="toolbar-actions">
        <label className="toolbar-bg-picker" title="画底颜色">
          <span className="toolbar-bg-swatch" style={{ backgroundColor }} aria-hidden="true" />
          <input
            type="color"
            value={backgroundColor}
            onChange={(e) => onBackgroundColorChange(e.target.value)}
            aria-label="Background color"
          />
        </label>

        <button
          className={`config-button${selectionEnabled ? ' is-active' : ''}`}
          onClick={() => onSelectionToggle(!selectionEnabled)}
          aria-label={selectionEnabled ? 'Disable part selection' : 'Enable part selection'}
          aria-pressed={selectionEnabled}
          title={selectionEnabled ? '退出「移件」模式' : '移件：点零件后拖光标移动'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 9V5h4" />
            <path d="M15 5h4v4" />
            <path d="M19 15v4h-4" />
            <path d="M9 19H5v-4" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </button>

        <button
          className={`config-button${colorizeMode ? ' is-active' : ''}`}
          onClick={() => onColorizeToggle(!colorizeMode)}
          aria-label={colorizeMode ? 'Disable full color mode' : 'Enable full color mode'}
          aria-pressed={colorizeMode}
          title={colorizeMode ? '全彩模式：开（深色贴图也整体改色）' : '全彩模式：关（颜色与底纹相乘）'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C7 7 4 11 4 15a8 8 0 0 0 16 0c0-4-3-8-8-13z" />
          </svg>
        </button>

        <button
          className={`config-button${autoRotateEnabled ? ' is-active' : ''}`}
          onClick={() => onAutoRotateToggle(!autoRotateEnabled)}
          aria-label={autoRotateEnabled ? 'Disable auto rotate' : 'Enable auto rotate'}
          aria-pressed={autoRotateEnabled}
          title={autoRotateEnabled ? '停止自动旋转' : '开始自动旋转'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3.09-6.8" />
            <polyline points="21 3 21 8 16 8" />
          </svg>
        </button>

        <button
          className={`config-button${explodeViewEnabled ? ' is-active' : ''}`}
          onClick={() => onExplodeViewToggle(!explodeViewEnabled)}
          aria-label={explodeViewEnabled ? 'Disable explode view' : 'Enable explode view'}
          aria-pressed={explodeViewEnabled}
          title={explodeViewEnabled ? '关闭拆件视图' : '拆件视图：把器物拆开看结构'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        <LightingPanel settings={lights} onChange={onLightsChange} />

        <div className="config-menu-container" ref={configMenuRef}>
          <button
            className="config-button"
            onClick={() => setIsConfigOpen(o => !o)}
            aria-label="Configuration menu"
            title="配置"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.82,11.69,4.82,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
            </svg>
          </button>

          {isConfigOpen && (
            <div className="config-menu">
              <div className="config-menu-header">
                <h3>配置</h3>
              </div>
              <div className="config-options">
                <div className="bg-presets">
                  <span className="bg-presets-label">画底</span>
                  {BG_PRESETS.map(preset => (
                    <button
                      key={preset.color}
                      type="button"
                      className={`bg-preset${backgroundColor.toLowerCase() === preset.color.toLowerCase() ? ' is-active' : ''}`}
                      style={{ backgroundColor: preset.color }}
                      title={preset.label}
                      aria-label={`画底 ${preset.label}`}
                      onClick={() => onBackgroundColorChange(preset.color)}
                    />
                  ))}
                </div>
                <div className="config-option">
                  <button
                    className="config-reset-button"
                    onClick={onResetColors}
                    title="把颜色与质感恢复到该器物的默认值"
                  >
                    恢复本色
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
