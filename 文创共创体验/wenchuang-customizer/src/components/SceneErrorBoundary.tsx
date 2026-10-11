import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Html } from '@react-three/drei'

interface Props {
  children: ReactNode
  /** 出错时的中文说明，例如「环境贴图」「商品模型」 */
  label: string
  /** 可选的排查建议 */
  hint?: string
}

interface State {
  error: Error | null
}

/**
 * Canvas 内的错误隔离。
 *
 * 两个现实场景：
 *   1. 离线 / 弱网时 drei 的 <Environment preset> 要拉 CDN 上的 HDRI，拉不到会抛错；
 *   2. 商品 GLB 还没放进来（或路径写错）时 useGLTF 会 404 抛错。
 * 没有隔离的话这两种情况会把整个 Three 场景一起干掉，页面只剩白屏。
 * 这里把出错的子树单独接住，用 3D 空间里的提示条告诉用户哪儿出了问题，其余部分照常渲染。
 */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[scene] ${this.props.label} 渲染失败：`, error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <Html center>
        <div className="scene-error-badge">
          <strong>{this.props.label}加载失败</strong>
          <span>{error.message}</span>
          {this.props.hint && <span className="scene-error-hint">{this.props.hint}</span>}
        </div>
      </Html>
    )
  }
}
