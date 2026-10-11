import { Scene } from './components/Scene'
import { StudioDock } from './components/StudioDock'
import { BridgeBackdrop } from './components/BridgeBackdrop'
import { TextureStudioProvider } from './state/textureStudio'
import './App.css'
import './studio.css'
// 古风主题层必须放在最后 —— 它靠层叠顺序覆盖上面两个底座文件里的暗色玻璃配色。
// 详见 theme.css 顶部的「双桥记」主题说明。
import './theme.css'

export default function App() {
  return (
    <TextureStudioProvider>
      {/* 古风装饰层（双桥 + 葛镜桥的长卷 / 回纹角饰 / 题跋）：纯视觉，不接交互 */}
      <BridgeBackdrop />
      {/* 左侧原有的拾色器 / 模型切换 与右侧的 AI 定制工作台并列显示，两套机制互不影响 */}
      <Scene />
      <StudioDock />
    </TextureStudioProvider>
  )
}
