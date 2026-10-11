import type { DynamicColors } from './ColorControls'
import { MODEL_PRESETS } from '../data/modelPresets'

interface ModelSelectorProps {
  currentColors?: DynamicColors
  currentModelId: string
  onModelChange: (modelId: string) => void
}

/**
 * 「器物」切换 —— 左侧「配色」面板里的第一段。
 *
 * 它原本是画布左上角一块**独立浮动面板**（`position: fixed`），2026-10-09 并进了配色面板：
 * 「先定器物、再定配色」是一条自然的顺序，分成两块反而挡着模型。
 *
 * ⚠️ 类名 `.model-selector` / `.model-dropdown` / `.model-display` 都**不能改**：
 * e2e 脚本靠 `.model-dropdown` 切换商品、截图脚本靠 `.model-selector` 隐藏面板。
 */
export function ModelSelector({ currentColors = {}, currentModelId, onModelChange }: ModelSelectorProps) {
  const currentModel = MODEL_PRESETS.find(m => m.id === currentModelId) ?? MODEL_PRESETS[0]

  return (
    <div className="model-selector">
      <div className="model-selector-header">
        <h3>器物</h3>
      </div>
      <select
        className="model-dropdown"
        value={currentModel.id}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {MODEL_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      <div className="model-display">
        <div className="model-info">
          <div className="model-name">{currentModel.name}</div>
          <div className="model-description">{currentModel.description}</div>
        </div>
        <div className="color-preview">
          {currentModel.materials.map((material) => (
            <div
              key={material.id}
              className="color-dot"
              style={{ backgroundColor: currentColors[material.id] || material.defaultColor }}
              title={material.name}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
