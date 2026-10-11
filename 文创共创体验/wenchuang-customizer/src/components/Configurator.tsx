import type * as THREE from 'three'
import type { ModelPreset } from '../data/modelPresets'
import type { DynamicColors } from './ColorControls'
import type { FinishId } from '../three/finish'
import { BodyTintedConfigurator } from './configurators/BodyTintedConfigurator'
import { PerMaterialConfigurator } from './configurators/PerMaterialConfigurator'
import { FBXConfigurator } from './configurators/FBXConfigurator'

interface ConfiguratorProps {
  colors?: DynamicColors
  modelPreset: ModelPreset
  explodeAmount?: number
  selectionEnabled?: boolean
  onDraggingChange?: (dragging: boolean) => void
  selectedPartId?: string | null
  onSelectedPartChange?: (id: string | null) => void
  colorizeMode?: boolean
  /** 表面质感档位（陶瓷釉面等）；不传 = 不动模型自带材质 */
  finish?: FinishId
  /** 由 Scene 烘好并下发的环境贴图；挂在 material.envMap 上才拿得到 per-material 的 envMapIntensity */
  envMap?: THREE.Texture | null
  /** 「环境反光」滑块的当前值，会乘进每个材质的 envMapIntensity */
  envIntensity?: number
}

// Dispatches to a concrete renderer based on loader + colorMode. Each
// renderer owns its own material/explode/selection mechanics.
export function Configurator({
  colors = {},
  modelPreset,
  explodeAmount = 0,
  selectionEnabled = false,
  onDraggingChange,
  selectedPartId = null,
  onSelectedPartChange,
  colorizeMode = false,
  finish,
  envMap = null,
  envIntensity = 1,
}: ConfiguratorProps) {
  if (modelPreset.loader === 'fbx') {
    return <FBXConfigurator colors={colors} modelPreset={modelPreset} explodeAmount={explodeAmount} />
  }

  const colorMode = modelPreset.colorMode ?? 'per-material'
  if (colorMode === 'body' || colorMode === 'per-node') {
    return (
      <BodyTintedConfigurator
        colors={colors}
        modelPreset={modelPreset}
        explodeAmount={explodeAmount}
        selectionEnabled={selectionEnabled}
        onDraggingChange={onDraggingChange}
        selectedPartId={selectedPartId}
        onSelectedPartChange={onSelectedPartChange}
        colorizeMode={colorizeMode}
        finish={finish}
        envMap={envMap}
        envIntensity={envIntensity}
      />
    )
  }

  return (
    <PerMaterialConfigurator
      colors={colors}
      modelPreset={modelPreset}
      explodeAmount={explodeAmount}
      selectionEnabled={selectionEnabled}
      onDraggingChange={onDraggingChange}
      selectedPartId={selectedPartId}
      onSelectedPartChange={onSelectedPartChange}
      colorizeMode={colorizeMode}
    />
  )
}
