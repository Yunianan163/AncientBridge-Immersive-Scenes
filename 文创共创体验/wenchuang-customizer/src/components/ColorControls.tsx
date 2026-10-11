import { useState, useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { MaterialConfig } from '../data/modelPresets'
import { FINISHES, finishSpec, type FinishId } from '../three/finish'

export type DynamicColors = Record<string, string>

interface ColorControlsProps {
  materials: MaterialConfig[]
  onChange: (colors: DynamicColors) => void
  initialColors?: DynamicColors
  onClose?: () => void
  selectionEnabled?: boolean
  selectedPartId?: string | null
  onSelectPart?: (id: string | null) => void
  /** 当前表面质感档位 */
  finish?: FinishId
  /** 传了才显示「表面质感」一节（没声明 finish 的商品不显示） */
  onFinishChange?: (id: FinishId) => void
  /** 「器物」切换栏 —— 由 Scene 注入，渲染在面板标题下方（合并自原来的浮动面板） */
  modelSlot?: ReactNode
}

export function ColorControls({ materials, onChange, initialColors, onClose, selectionEnabled = false, selectedPartId = null, onSelectPart, finish, onFinishChange, modelSlot }: ColorControlsProps) {
  // Memoize initial colors to prevent unnecessary recalculations
  const initialColorsState = useMemo(() => {
    const colors: DynamicColors = {}
    materials.forEach(material => {
      colors[material.id] = initialColors?.[material.id] || material.defaultColor
    })
    return colors
  }, [materials, initialColors])

  const [colors, setColors] = useState<DynamicColors>(initialColorsState)

  // Update colors when materials change
  useEffect(() => {
    setColors(initialColorsState)
  }, [initialColorsState])
  // Notify parent of color changes with debouncing to prevent rapid updates
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Only call onChange if colors have actually changed from initial state
      const hasChanged = Object.keys(colors).some(key => 
        colors[key] !== initialColorsState[key]
      )
      
      if (hasChanged || Object.keys(colors).length > 0) {
        onChange(colors)
      }
    }, 16) // ~60fps debouncing to prevent rapid fire updates

    return () => clearTimeout(timeoutId)
  }, [colors]) // Remove onChange from dependencies to prevent infinite loop
  const handleColorChange = useCallback((materialId: string, color: string) => {
    setColors(prevColors => ({
      ...prevColors,
      [materialId]: color
    }))
  }, [])

  return (
    <div className="color-controls">
      <div className="color-controls-header">
        <h3 className="color-controls-title">配色</h3>
        {onClose && (
          <button
            type="button"
            className="color-controls-close"
            onClick={onClose}
            aria-label="Close color controls"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {modelSlot}
      <div className="color-controls-grid">
        {materials.map((material) => {
          const isSelected = selectionEnabled && selectedPartId === material.id
          const classes = [
            'control-group',
            selectionEnabled ? 'is-selectable' : '',
            isSelected ? 'is-selected' : '',
          ].filter(Boolean).join(' ')
          return (
            <div
              key={material.id}
              className={classes}
              onClick={selectionEnabled ? () => onSelectPart?.(isSelected ? null : material.id) : undefined}
            >
              <label>
                <span className="material-name">{material.name}</span>
                <span className="material-description">{material.description}</span>
              </label>
              <input
                type="color"
                value={colors[material.id] || material.defaultColor}
                onChange={(e) => handleColorChange(material.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )
        })}
      </div>

      {onFinishChange && (
        <div className="finish-controls">
          <div className="finish-controls-head">
            <span className="finish-controls-label">表面质感</span>
            <span className="finish-controls-value">{finishSpec(finish)?.name}</span>
          </div>
          <div className="finish-chips" role="group" aria-label="表面质感">
            {FINISHES.map(spec => (
              <button
                key={spec.id}
                type="button"
                className={`finish-chip${finish === spec.id ? ' is-active' : ''}`}
                aria-pressed={finish === spec.id}
                title={spec.hint}
                onClick={() => onFinishChange(spec.id)}
              >
                {spec.name}
              </button>
            ))}
          </div>
          <p className="finish-hint">{finishSpec(finish)?.hint}</p>
        </div>
      )}
    </div>
  )
}
