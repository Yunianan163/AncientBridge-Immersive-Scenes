import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LIGHTS, LIGHT_SLIDERS, isDefaultLights, type LightSettings } from '../three/lighting'

interface LightingPanelProps {
  settings: LightSettings
  onChange: (settings: LightSettings) => void
}

/**
 * 工具栏上的「灯光与曝光」弹出面板。
 *
 * 底座的默认光照是按深色手柄调的，白瓷/浅色布料的文创商品直接用会过曝，
 * 而且不同商品的材质（哑光布 vs 釉面陶瓷）需要不同档位，所以做成可调，
 * 默认值取自 `DEFAULT_LIGHTS`（已按白模不过曝标定）。
 */
export function LightingPanel({ settings, onChange }: LightingPanelProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dirty = !isDefaultLights(settings)

  // 点外面 / 按 Esc 关掉，和底座 Configuration 菜单的行为保持一致
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="config-menu-container" ref={containerRef}>
      <button
        type="button"
        className={`config-button${dirty ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="灯光与曝光"
        aria-expanded={open}
        title="灯光与曝光"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </button>

      {open && (
        <div className="config-menu lighting-menu">
          <div className="config-menu-header">
            <h3>灯光与曝光</h3>
          </div>

          <div className="lighting-rows">
            {LIGHT_SLIDERS.map(({ key, label, hint, min, max, step }) => (
              <label className="studio-slider lighting-slider" key={key} title={hint}>
                <span className="studio-slider-head">
                  <span className="studio-slider-label">{label}</span>
                  <span className="studio-slider-value">{settings[key].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={settings[key]}
                  aria-label={label}
                  onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            className="lighting-reset"
            onClick={() => onChange(DEFAULT_LIGHTS)}
            disabled={!dirty}
          >
            {dirty ? '恢复默认灯光' : '当前已是默认灯光'}
          </button>
        </div>
      )}
    </div>
  )
}
