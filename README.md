# 古桥数字场景 · AncientBridge Immersive Scenes

以**苏州双桥**和**贵州葛镜桥**为对象的三维数字重建与沉浸式交互展陈。四个模块由一个入口页统一调度：Unity WebGL 场景、3DGS 点云重建漫游、AI 文创定制、实时语音导览。

面向教学与研究展示，非商业产品。

---

## 场景一览

| 模块 | 形态 | 技术栈 | 端口 |
| --- | --- | --- | --- |
| **场景选择页面** | 聚合入口，轮询探测各服务健康状态，可独立降级 | 原生 JS + Node 静态服务 | `8080`（被占用时自动递增） |
| **苏州双桥** | Unity WebGL 三维场景：四季切换、无人机视角、机器人导览、实时语音对话 | Unity WebGL / Node / WebSocket | `8082`（HTTP + WS 同端口） |
| **贵州葛镜桥** | 3DGS(2DGS) 重建点云漫游，含语音导览与工具链 | three.js / Python 静态服务 | `8123` |
| **文创共创体验** | 文字生图 → 点击选面贴图到 3D 商品 → 旋转预览 → 导出下单 | React 19 + three.js + Vite / Express | `5173`（前端）、`3001`（后端） |

四个场景是**各自独立的静态服务**，互不可见对方磁盘。需要跨场景的数据统一走 HTTP 汇总到 `3001` 后端。

---

## 目录结构

```
项目网页/
├── 启动全部场景.bat          一键启动器（探测 Node / Python / 依赖）
├── 场景选择页面/             聚合入口，serve.js 监听 8080
│   ├── index.html
│   ├── serve.js
│   └── data/                 场景元数据
├── 苏州双桥/                  Unity WebGL 场景
│   ├── index.html
│   ├── server.js             静态服务 + WebSocket + 语音代理（8082）
│   ├── main.js               页面主逻辑、四季、BGM、Unity 消息桥
│   ├── Build/                Unity 构建产物
│   ├── UnityScripts/         C# 源码（含 WebSocketClient.cs）
│   ├── RealtimeDialog-Web/   网页端实时语音对接
│   └── .env.example          语音凭据模板
├── 贵州葛镜桥/                3DGS 重建点云漫游
│   ├── index.html
│   ├── js/                   ui.js / config.js 等
│   ├── models/               重建产物（scene.ply 走 Git LFS）
│   ├── tools/serve.py        静态服务（8123）
│   └── README.md             该模块的详细说明与操作表
├── 文创共创体验/
│   ├── wenchuang-customizer/ React + Vite 前端，内含 server/ Express 后端
│   └── 文创商品模型/           GLB 商品模型与区域定义
└── 项目现状体检报告.md        全量体检、修复记录与遗留问题（强烈建议先读）
```

---

## 快速开始

### 一键启动（推荐）

双击根目录的 `启动全部场景.bat`。启动器会依次探测 Node.js 与 Python（PATH → 常见安装目录 → 内置运行时），检查依赖，然后拉起全部四个服务，约 10 秒后自动打开 `http://localhost:8080/`。

### 分模块启动

```bash
# 场景选择页面 → http://127.0.0.1:8080
node 场景选择页面/serve.js

# 苏州双桥 → http://127.0.0.1:8082
node 苏州双桥/server.js

# 贵州葛镜桥 → http://127.0.0.1:8123
python 贵州葛镜桥/tools/serve.py

# 文创共创体验 · 前端 5173 + 后端 3001
cd 文创共创体验/wenchuang-customizer
npm install
npm run dev:all
```

### 环境要求

- **Node.js** ≥ 18（文创前端用 Vite 7 / React 19，需要较新运行时）
- **Python** 3.8+（仅葛镜桥的静态服务与工具链需要）
- **Git LFS**（克隆时需要，场景数据与点云模型走 LFS 托管）
- **浏览器** 支持 WebGL 2 的桌面版 Chrome / Edge。移动端未适配。

---

## 语音服务配置

苏州双桥的实时语音对话走**火山引擎（豆包）实时对话式 AI**。凭据通过环境变量读取，优先级为「进程环境变量 > 同目录 `.env` > 空」。

```bash
cd 苏州双桥
cp .env.example .env
# 填入以下三项，取自火山引擎控制台「语音技术 > 实时对话式 AI」
#   VOICE_APP_ID
#   VOICE_ACCESS_TOKEN
#   VOICE_APP_KEY
```

**未配置时不会崩**：服务正常启动，`/voice-proxy` 返回 `{"code":"VOICE_NOT_CONFIGURED"}`，页面其余功能全部可用。

> ⚠️ **安全约定**：凭据只允许留在服务端。`RealtimeDialog-Web/config.js` 会被浏览器直接下载，把凭据写进那里等于向所有访客公开。历史上本项目曾把凭据硬编码在源码中，现已全部外置 —— **如果你使用过早期版本，请在火山引擎控制台轮换 App / Access Token / App Key。**

---

## 📦 大体积资源（Git LFS）

两个关键体积文件超过 GitHub 单文件 100 MB 上限，已通过 **Git LFS** 托管，克隆后可完整运行：

| 文件 | 体积 | 用途 |
| --- | --- | --- |
| `苏州双桥/Build/WebGL.data.gz` | 286 MB | Unity 场景数据，缺失则三维场景加载不出来 |
| `贵州葛镜桥/models/scene.ply` | 248 MB | 3DGS 重建点云，缺失则葛镜桥页面没有模型 |

其余 `Build/` 下的 `WebGL.loader.js`、`WebGL.wasm.gz`、`WebGL.framework.js.gz` 是普通文件（合计约 9.7 MB）。

### 克隆方式

**请先安装 Git LFS**，否则这两个文件会是指针（几十字节的文本），场景打不开：

```bash
git lfs install          # 每台机器只需一次
git clone https://github.com/Yunianan163/AncientBridge-Immersive-Scenes.git
```

如果已经克隆完才想起安装 LFS，补拉即可：

```bash
git lfs install
git lfs pull
```

> 两个文件合计约 534 MB。仓库的 LFS 存储与下载流量受 GitHub 账号额度限制，频繁克隆可能触发配额。


---

## 已知限制

- **苏州双桥的 Unity 构建比 C# 源码旧。** `robotListenNod` / `robotAfterUserNod` 两条消息在活的构建里没有处理分支，导致机器人「倾听点头」「回应点头」两个动画不触发。修复需要把 `UnityScripts/` 重新打进 Unity 工程构建，或反过来删掉网页侧的调用。
- **移动端未适配**，触控交互与部分布局不保证可用。
- **部分工具脚本沿用早期机器的绝对路径**（`E:\葛镜桥高斯\...` 等），脱离原始数据后无法运行，属于已知的历史遗留。
- 项目文档密度较高，但部分文档存在滞后。以代码和《项目现状体检报告》为准。

---

## 文档

- **[项目现状体检报告.md](项目现状体检报告.md)** —— 全量文件体检、逐模块审计结论、修复进度与遗留问题清单。想快速理解这个项目踩过哪些坑，先读这份。
- **[贵州葛镜桥/README.md](贵州葛镜桥/README.md)** —— 该场景的目录说明、操作表、坐标系与重建流水线细节。

---

## 素材与版权

- 三维模型、摄影测量重建产物、音乐、图片等素材的版权归各自原作者所有，本项目仅用于教学与研究展示，**未经授权请勿商用**。
- 代码部分可自由参考学习。如需转载素材，请自行确认授权。
