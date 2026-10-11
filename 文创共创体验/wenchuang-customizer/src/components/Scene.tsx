import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, SoftShadows, Html } from '@react-three/drei'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { Configurator } from './Configurator.tsx'
import { ColorControls, type DynamicColors } from './ColorControls.tsx'
import { ModelSelector } from './ModelSelector.tsx'
import { MODEL_PRESETS, type ModelPreset } from '../data/modelPresets'
import { ExplodeControls } from './ExplodeControls.tsx'
import { Toolbar } from './Toolbar.tsx'
import { SurfacePicker } from './SurfacePicker.tsx'
import { SceneErrorBoundary } from './SceneErrorBoundary.tsx'
import { useTextureStudio } from '../state/textureStudio'
import { DEFAULT_LIGHTS, type LightSettings } from '../three/lighting'
import type { FinishId } from '../three/finish'
import { createStudioEnvironment, type StudioEnvironment as StudioEnv } from '../three/studioEnv'
import { SCENE_CAMERA } from '../three/meshUtils'

function LoadingFallback() {
  return (
    <Html center>
      <div className="model-spinner" role="status" aria-label="Loading model" />
    </Html>
  )
}

function Shadows() {
  return <SoftShadows size={25} samples={20} focus={0.5} />
}

/**
 * 程序化影棚环境贴图（IBL）。
 *
 * 这里**故意不用** drei 的 `<Environment preset="studio" />` —— 那个要从 CDN 拉
 * `studio_small_03_1k.hdr`，离线就拉不到，画面正中会弹一条「环境贴图加载失败」的红色提示，
 * 而且商品会彻底失去反射（陶瓷看着像哑光塑料）。
 * 现在环境贴图是代码现搭现烘的（three/studioEnv.ts），零外部资源、离线永远可用。
 *
 * 烘好的贴图会通过 onReady 上报给外部，再当作 prop 下发到 Configurator：
 * 因为只有挂在 material.envMap 上，`material.envMapIntensity` 才不会被
 * `scene.environmentIntensity` 覆盖掉（详见 three/finish.ts 的注释）。
 */
function StudioEnvironment({
  intensity,
  onReady,
}: {
  intensity: number
  onReady: (map: THREE.Texture | null) => void
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const [studio, setStudio] = useState<StudioEnv | null>(null)

  useEffect(() => {
    const created = createStudioEnvironment(gl)
    setStudio(created)
    return () => created?.dispose()
  }, [gl])

  useEffect(() => {
    const map = studio?.texture ?? null
    scene.environment = map
    onReady(map)
    return () => {
      if (scene.environment === map) scene.environment = null
      onReady(null)
    }
  }, [scene, studio, onReady])

  useEffect(() => {
    scene.environmentIntensity = intensity
  }, [scene, intensity])

  return null
}

/**
 * 灯光与曝光。曝光不在 React 的 props 体系里（它挂在 WebGLRenderer 上），
 * 所以这里用 useThree 拿 renderer 手动写。灯光强度本身照常走 props。
 */
function LightRig({ settings }: { settings: LightSettings }) {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    gl.toneMappingExposure = settings.exposure
  }, [gl, settings.exposure])

  return (
    <>
      <ambientLight intensity={settings.ambient} />
      <directionalLight position={[5, 5, 5]} intensity={settings.key} castShadow shadow-mapSize={2048} />
      <directionalLight position={[-5, 5, -5]} intensity={settings.fill} castShadow />
    </>
  )
}

const buildDefaultColors = (preset: ModelPreset): DynamicColors => {
  const out: DynamicColors = {}
  preset.materials.forEach(m => { out[m.id] = m.defaultColor })
  return out
}

export function Scene() {
  const [currentModelId, setCurrentModelId] = useState<string>(MODEL_PRESETS[0].id)
  const currentModel = useMemo(
    () => MODEL_PRESETS.find(m => m.id === currentModelId) ?? MODEL_PRESETS[0],
    [currentModelId]
  )

  const [colorsByModel, setColorsByModel] = useState<Record<string, DynamicColors>>(() => {
    const init: Record<string, DynamicColors> = {}
    MODEL_PRESETS.forEach(p => { init[p.id] = buildDefaultColors(p) })
    return init
  })

  const colors = colorsByModel[currentModel.id] ?? buildDefaultColors(currentModel)

  // 表面质感（陶瓷釉面 / 哑光 / 金属…）也是按商品各记一份，切商品不会串。
  // 只给「配置里声明了 finish 的商品」开放选择 —— 底座那几个示例配置保持原样不动。
  const [finishesByModel, setFinishesByModel] = useState<Record<string, FinishId | undefined>>(() => {
    const init: Record<string, FinishId | undefined> = {}
    MODEL_PRESETS.forEach(p => { init[p.id] = p.finish })
    return init
  })
  const finish = finishesByModel[currentModel.id] ?? currentModel.finish

  const [explodeAmount, setExplodeAmount] = useState(0)
  const [explodeViewEnabled, setExplodeViewEnabled] = useState(false)
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true)
  // 画底默认「绢本」—— 见 theme.css 的双桥记主题；可在工具栏的「配置 → 画底」里换。
  // 为什么默认是浅绢而不是深墨：中区的长卷白描（BridgeBackdrop 里画的那些桥）
  // 是靠 --scene-ink 明暗翻转的**单色线描**，压在深画底上几乎看不见；
  // 换成浅绢之后它才真正读得出来，整页也就连成"一张裱好的卷册"。
  // 深色画底（松墨 / 焦墨）更适合想看白瓷反差的场合，仍保留在预设里。
  // ⚠️ 这个值必须与 Toolbar 的 BG_PRESETS 里某一格**完全一致**，否则那格预设点不亮。
  const [backgroundColor, setBackgroundColor] = useState('#e0d3b6')
  const [lights, setLights] = useState<LightSettings>(DEFAULT_LIGHTS)
  const [selectionEnabled, setSelectionEnabled] = useState(false)
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [orbitEnabled, setOrbitEnabled] = useState(true)
  const [colorizeMode, setColorizeMode] = useState(false)
  // 影棚环境贴图烘好后由 Canvas 内上报到这儿，再当 prop 下发回 Canvas 里的 Configurator。
  // 走 props 是因为 <Canvas> 会另起一棵渲染树，外部 context 不保证穿透。
  const [envMap, setEnvMap] = useState<THREE.Texture | null>(null)
  const handleEnvReady = useCallback((map: THREE.Texture | null) => setEnvMap(map), [])
  const [colorPanelOpen, setColorPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 768px)').matches
  })

  const handleColorChange = useCallback((newColors: DynamicColors) => {
    setColorsByModel(prev => ({ ...prev, [currentModel.id]: newColors }))
  }, [currentModel.id])

  const handleExplodeViewToggle = useCallback((enabled: boolean) => {
    setExplodeViewEnabled(enabled)
    if (!enabled) setExplodeAmount(0)
  }, [])

  const handleResetColors = useCallback(() => {
    setColorsByModel(prev => ({ ...prev, [currentModel.id]: buildDefaultColors(currentModel) }))
    setFinishesByModel(prev => ({ ...prev, [currentModel.id]: currentModel.finish }))
  }, [currentModel])

  const handleFinishChange = useCallback((next: FinishId) => {
    setFinishesByModel(prev => ({ ...prev, [currentModel.id]: next }))
  }, [currentModel.id])

  const handleModelChange = useCallback((modelId: string) => {
    setCurrentModelId(modelId)
    setExplodeAmount(0)
  }, [])

  const handleSelectionToggle = useCallback((enabled: boolean) => {
    setSelectionEnabled(enabled)
    setAutoRotateEnabled(!enabled)
    setSelectedPartId(null)
  }, [])

  const handleDraggingChange = useCallback((dragging: boolean) => {
    setOrbitEnabled(!dragging)
  }, [])

  // 贴图工作台：把当前商品信息同步出去，给右侧面板显示 / 下单用。
  // 这里拿到的是「Canvas 外部」的真实 context，需要下发给 Canvas 内部的组件（用 props 传）。
  const {
    setProduct,
    status: studioStatus,
    commitPaint,
    setError: setStudioError,
    registerThree,
  } = useTextureStudio()
  const awaitingPick = studioStatus === 'awaiting-pick'

  // 画底的明暗决定古风装饰层的墨色：深底用「淡墨」（浅色线），浅底用「浓墨」（深色线）。
  // 写进 :root 的自定义属性，让 Canvas 之外那层 BridgeBackdrop 也能读到
  // —— 它是 App 的兄弟节点，拿不到这里的 props。
  // 没有这一步的话，用户在「配置 → 画底」里挑到宣纸/绢本，底部那条长卷就会整个消失。
  useEffect(() => {
    const match = /^#?([0-9a-f]{6})$/i.exec(backgroundColor.trim())
    let ink = '#d3c7ab'
    if (match) {
      const n = Number.parseInt(match[1], 16)
      const r = (n >> 16) & 255
      const g = (n >> 8) & 255
      const b = n & 255
      // 相对亮度（Rec. 709）
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      ink = luminance > 0.55 ? '#4a4436' : '#d3c7ab'
    }
    document.documentElement.style.setProperty('--scene-ink', ink)
    return () => { document.documentElement.style.removeProperty('--scene-ink') }
  }, [backgroundColor])

  useEffect(() => {
    setProduct({
      id: currentModel.id,
      name: currentModel.name,
      path: currentModel.path,
      regions: currentModel.regions,
    })
  }, [setProduct, currentModel.id, currentModel.name, currentModel.path, currentModel.regions])

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Toolbar
        explodeViewEnabled={explodeViewEnabled}
        onExplodeViewToggle={handleExplodeViewToggle}
        autoRotateEnabled={autoRotateEnabled}
        onAutoRotateToggle={setAutoRotateEnabled}
        onResetColors={handleResetColors}
        modelName={currentModel.name}
        backgroundColor={backgroundColor}
        onBackgroundColorChange={setBackgroundColor}
        selectionEnabled={selectionEnabled}
        onSelectionToggle={handleSelectionToggle}
        colorizeMode={colorizeMode}
        onColorizeToggle={setColorizeMode}
        lights={lights}
        onLightsChange={setLights}
      />
      <Canvas
        shadows
        // 相机参数同时被「商品屏幕尺寸归一化」使用（three/meshUtils.ts 的 SCENE_CAMERA）——
        // 改这里或改那里都会让所有商品的大小一起变，所以两边读的是同一个常量。
        camera={{ position: SCENE_CAMERA.position, fov: SCENE_CAMERA.fov }}
        onCreated={({ gl, scene }) => {
          gl.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
          // 开发期调试钩子：端到端脚本 / 浏览器控制台可以直接拿到整个 three 场景，
          // 用来核对材质参数（metalness / roughness / clearcoat / envMapIntensity）。
          // 生产构建里 import.meta.env.DEV 为 false，这段会被摇掉。
          if (import.meta.env.DEV) {
            ;(window as unknown as Record<string, unknown>).__scene = scene
          }
        }}
        gl={{
          antialias: true,
          alpha: false,
          depth: true,
          preserveDrawingBuffer: true,
        }}
      >
        <color attach="background" args={[backgroundColor]} />
        {/* 环境贴图是代码现烘的（three/studioEnv.ts），不拉网络资源，离线也不会再出提示条 */}
        <StudioEnvironment intensity={lights.environment} onReady={handleEnvReady} />
        <Shadows />
        {/* 灯光强度与曝光都由「灯光与曝光」面板控制，默认值已按白模不过曝标定 */}
        <LightRig settings={lights} />
        <SceneErrorBoundary
          label="商品模型"
          hint="把混元导出的同名 GLB 放进 public/models/products/ 后刷新即可"
        >
          <Suspense fallback={<LoadingFallback />}>
            <Configurator
              key={currentModel.id}
              colors={colors}
              modelPreset={currentModel}
              explodeAmount={explodeAmount}
              selectionEnabled={selectionEnabled}
              onDraggingChange={handleDraggingChange}
              selectedPartId={selectedPartId}
              onSelectedPartChange={setSelectedPartId}
              colorizeMode={colorizeMode}
              finish={finish}
              envMap={envMap}
              envIntensity={lights.environment}
            />
          </Suspense>
        </SceneErrorBoundary>
        {/* 点击选面贴图：只有它必须活在 Canvas 里，才能拿到 camera / scene / gl 做 Raycaster 检测 */}
        <SurfacePicker
          status={studioStatus}
          commitPaint={commitPaint}
          onError={setStudioError}
          registerThree={registerThree}
        />
        <OrbitControls
          enabled={orbitEnabled}
          autoRotate={autoRotateEnabled && orbitEnabled && !awaitingPick}
          autoRotateSpeed={1.0}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 1.2}
          minDistance={1.0}
          maxDistance={8}
          enableDamping
          dampingFactor={0.05}
          mouseButtons={selectionEnabled
            ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        />
      </Canvas>

      {explodeViewEnabled && (
        <ExplodeControls
          onExplodeChange={setExplodeAmount}
          initialExplode={explodeAmount}
        />
      )}
      <button
        type="button"
        className={`color-controls-toggle${colorPanelOpen ? ' is-open' : ''}`}
        onClick={() => setColorPanelOpen(o => !o)}
        aria-label={colorPanelOpen ? 'Hide color controls' : 'Show color controls'}
        aria-expanded={colorPanelOpen}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.37-.6-.37-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4A1.5 1.5 0 1 1 9.5 5a1.5 1.5 0 0 1 0 3zm5 0A1.5 1.5 0 1 1 14.5 5a1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
        </svg>
      </button>
      {colorPanelOpen && (
        <ColorControls
          key={currentModel.id}
          materials={currentModel.materials}
          onChange={handleColorChange}
          initialColors={colors}
          onClose={() => setColorPanelOpen(false)}
          selectionEnabled={selectionEnabled}
          selectedPartId={selectedPartId}
          onSelectPart={setSelectedPartId}
          finish={finish}
          onFinishChange={currentModel.finish ? handleFinishChange : undefined}
          // 「器物」并进配色面板的第一段：先定器物、再定配色。
          // 以前它是画布左上角的独立浮层，正好挡在模型前面。
          modelSlot={
            <>
              <ModelSelector
                currentColors={colors}
                currentModelId={currentModel.id}
                onModelChange={handleModelChange}
              />
            </>
          }
        />
      )}
    </div>
  )
}
