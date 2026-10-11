import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const apiTarget = env.VITE_API_TARGET || 'http://localhost:3001'

  // 后端（server/index.js）默认跑在 3001。
  // 开发时把 /api 与这两个静态目录代理过去，让前后端同源：
  //   - 少一层 CORS
  //   - AI 生成的贴图 / 场景截图不会被浏览器判定为跨域，canvas 不会被污染
  //     （截图、GLB 导出都依赖这一点）
  //
  // ⚠️ 这份代理**预览（npm run preview）也要用同一份**：
  // 前端 `apiUrl()` 默认返回同源相对路径（`VITE_API_BASE` 为空），
  // 只配 `server.proxy` 的话，`npm run preview` 起生产构建时 `/api/*` 会直接 404
  // —— 表现成「AI 生图失败」「下单失败」，很容易误判成构建坏了。
  //
  // ⚠️ `/scene-shots` 别漏：那是场景截图素材库（苏州双桥 / 葛镜桥右上角 📷 存过来的图）。
  // 前端拿到的缩略图地址和贴图地址都是 `/scene-shots/xxx.png`，漏了这条就是 404 ——
  // 表现成「素材库里图片全是裂的」+「点选后贴图失败」，而后端其实一切正常。
  const proxy = {
    '/api': { target: apiTarget, changeOrigin: false },
    '/generated': { target: apiTarget, changeOrigin: false },
    '/scene-shots': { target: apiTarget, changeOrigin: false },
  }

  return {
    plugins: [react()],
    // Use environment variable for base path, default to root
    base: env.VITE_BASE_PATH || '/',
    resolve: {
      alias: {
        '@': '/src'
      }
    },
    server: { proxy },
    preview: { proxy, port: 4173 },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          // ⚠️ 不要写成 `manualChunks: { vendor: ['react','react-dom'] }` 那种**按包名**的形式。
          // 本项目用的是 automatic JSX runtime，代码里 import 的是 `react/jsx-runtime` /
          // `react-dom/client` 这些**子路径**，按包名精确匹配一个模块都匹配不到 ——
          // 结果会产出一个 **0 字节的 vendor chunk**（构建时打印「Generated an empty chunk: "vendor"」），
          // react 反而被并进了 three 那个 chunk。改成按**路径**匹配才分得对。
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            const pkg = id.replace(/\\/g, '/').split('/node_modules/').pop() ?? ''
            // React 运行时（含 jsx-runtime / react-dom/client）+ 调度器
            if (/^(react|react-dom|scheduler)\//.test(pkg)) return 'vendor'
            // 3D 栈：three 本体与整个 @react-three 生态
            if (/^(three|@react-three)\//.test(pkg)) return 'three'
            return undefined
          },
        }
      }
    }
  }
})
