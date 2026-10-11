import { useState, useCallback } from 'react'

export interface ExplodeControlsProps {
  onExplodeChange: (explodeAmount: number) => void
  initialExplode?: number
}

const PRESETS: Array<{ value: number; label: string; title: string }> = [
  { value: 0.25, label: '25%',  title: '略拆' },
  { value: 0.5,  label: '50%',  title: '拆一半' },
  { value: 0.75, label: '75%',  title: '拆大半' },
  { value: 1.0,  label: '100%', title: '全拆' },
]

export function ExplodeControls({ onExplodeChange, initialExplode = 0 }: ExplodeControlsProps) {
  const [explodeAmount, setExplodeAmount] = useState(initialExplode)

  const setAmount = useCallback((value: number) => {
    setExplodeAmount(value)
    onExplodeChange(value)
  }, [onExplodeChange])

  const handleSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(parseFloat(event.target.value))
  }, [setAmount])

  return (
    <div className="explode-controls">
      <div className="explode-controls-header">
        <h3>拆件视图</h3>
        <button className="reset-button" onClick={() => setAmount(0)} title="合回原样">
          合拢
        </button>
      </div>

      <div className="explode-slider-container">
        <label htmlFor="explode-slider" className="explode-label">
          拆件幅度：{Math.round(explodeAmount * 100)}%
        </label>
        <input
          id="explode-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={explodeAmount}
          onChange={handleSliderChange}
          className="explode-slider"
        />
        <div className="explode-range-labels">
          <span>合拢</span>
          <span>全拆</span>
        </div>
      </div>
      <div className="explode-description">
        拖动滑块可把器物的零件分开，看清内部结构
      </div>
      <div className="explode-presets">
        {PRESETS.map(p => (
          <button
            key={p.value}
            className="preset-button"
            onClick={() => setAmount(p.value)}
            title={p.title}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
