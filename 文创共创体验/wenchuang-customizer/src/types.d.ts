declare module '*.css' {
  const css: { [key: string]: string }
  export default css
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}

declare module '*.jpeg' {
  const content: string
  export default content
}

// Vite environment variables
interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly VITE_BASE_PATH?: string
  /** 后端（server/index.js）地址；留空则走 vite 代理到 http://localhost:3001 */
  readonly VITE_API_BASE?: string
  /** 是否开发模式（vite 内置）。用来挂只给端到端脚本用的调试钩子 */
  readonly DEV: boolean
  readonly PROD: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
