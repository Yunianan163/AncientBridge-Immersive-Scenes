# 项目长期记忆 —— 古桥数字场景（项目网页）

> ⚠️ **葛镜桥三维重建专属**记忆（坐标系链条、2DGS 网格产物、WSL 运维）
> 在 `贵州葛镜桥/.workbuddy/memory/MEMORY.md`，不在这里重复。

## 服务与端口（`启动全部场景.bat`）

| 服务 | 端口 | 入口 |
| --- | --- | --- |
| 场景选择页面 | 8080 | `场景选择页面/serve.js` |
| 苏州双桥 | 8082 | `苏州双桥/server.js`（裸 http + WebSocket，**不是 express**） |
| 贵州葛镜桥 | 8123 | `贵州葛镜桥/tools/serve.py` |
| 文创共创体验 · 前端 | 5173 | `文创共创体验/wenchuang-customizer`（vite，只绑 IPv6 `::1`） |
| 文创共创体验 · 后端 | 3001 | `wenchuang-customizer/server/index.js` |

- 三个场景各自是**独立静态服务**，互看不到对方磁盘 —— 共享数据必须走 HTTP 汇总到一个后端。
- **场景截图素材库统一挂在文创后端 3001**，不另起服务。

## 场景截图链路（2026-10-09 搭建并验证）

```
场景页右上角 📷
  → viewer.captureFrame() / unity-canvas.toDataURL()
  → POST http://127.0.0.1:3001/api/scene-snapshots      （苏州双桥走别名 /api/screenshots/upload）
  → 落盘 wenchuang-customizer/server/public/scene-shots/<id>.png + <id>.json
  → 静态路径 /scene-shots/<id>.png（vite 代理必须放行！）
  → 文创端 src/components/SceneShotPanel.tsx → arm(url,'scene') → 在商品上点面贴图
```

- `TextureSource` 已扩为 `'ai' | 'upload' | 'scene'`；面板：① AI 生图 / ② 上传 / ③ 场景截图 / ④ 贴图微调 / ⑤ 导出下单。
- **AI 图生图（Seedream）留了扩展位**：在 `SceneShotPanel.tsx` 加按钮，把 `shot.url` 当参考图送图像编辑接口（硅基流动 `Qwen/Qwen-Image-Edit` 同一端点 + `image` 字段），拿回新图再 `arm(newUrl,'scene')`，下游零改动。

## 两个必须记住的坑

- **葛镜桥 WebGLRenderer 没开 `preserveDrawingBuffer`**（Three.js 默认）→ `canvas.toDataURL()` 拿到空缓冲（全 0）。必须同一次调用里先 `renderer.render()` 补一帧再读 —— 见 `js/viewer.js` 的 `captureFrame()`（还会临时降 `pixelRatio` 到 1）。
- **苏州双桥 Unity 已开** `preserveDrawingBuffer`（`index.html` 的 `webglContextAttributes`），canvas 可直接读。
- **vite 代理漏配 `/scene-shots`** → 「素材库里图片全是裂的」而后端正常；排查先看 `vite.config.ts` 的 proxy。

## 改完代码后：什么会自愈、什么必须重启

- **前端（vite 5173）**：改源码有 HMR；改 `vite.config.ts` 会自己重启 dev server。
- **后端 `server/index.js`（3001）**：Node 只在**启动时**加载模块，改完不重启＝旧代码。`scripts/dev-all.mjs` 没 watch。
- ⚠️ **`启动全部场景.bat` 按端口跳过**：只看 5173 是否被占，被占就跳过整个文创块（前后端一起跳）。改完后端 → 双击 bat **什么都不会发生**。✅ 正确重启：「4_文创共创体验_5173」窗口 `Ctrl+C`（连带收掉前后端两个子进程）再双击 bat。
- **判服务是不是旧代码**：比「进程启动时间」和「源文件 mtime」。取 PID `Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3001`；启动时间 `Get-CimInstance Win32_Process -Filter "ProcessId=<PID>"`（⚠️ PowerShell 工具输出被吞，要 `| Set-Content $env:TEMP\x.txt` 再 Read 读）。
- 返回 `{"error":"接口不存在"}`（后端兜底 404）**经 5173** ⇒ vite 代理通、问题在后端进程；返回 HTML 才是代理没配。
- vite 只绑 IPv6 回环：探 5173 用 `::1`，连 `127.0.0.1` 会 10061 假失败。

## 无头 e2e 约定

- 项目既有约定**用真 GPU 无头**，别默认加 `--enable-unsafe-swiftshader`：葛镜桥的天空/水面反射在软渲染下要渲两遍会冻结 rAF。
- 但**纯机制验证**（自己 new viewer、不加载 248MB 模型）用 swiftshader 反而更稳更快。判断依据是「这一步要不要真渲染重模型」。
- 几百 MB 的模型（`scene.ply` / Unity `WebGL.data.gz`）**别在无头里等加载完**：用 `Network.setBlockedURLs` 掐掉。
- **无头测音频/手势**：`element.click()` 不是真实手势，audio.play() 被自动播放策略拦 —— 要用 `Input.dispatchMouseEvent`；必要时加 `--autoplay-policy=no-user-gesture-required` 兜底。

## 美术主题约定（2026-10-09 两页古风化后定案）

**主题 = 一层 CSS，只改一个文件**：文创页 `src/theme.css`（在 `App.tsx` **最后** import，靠层叠覆盖底座）；选择页 `index.html` 内联 `<style>`。**底座正文一行不改**，只加文件头注释指路。

**主色板取「两桥公共语汇」**（明万历 · 青石 · 题刻）→ 绢/墨/朱砂/青石/水色/赭金。江南 vs 黔中差异只放进装饰层。

| 变量 | 值 | 含义 / 谁在用 |
| --- | --- | --- |
| `--water` | `#5b8a91` | 苏州双桥辨识色（青碧）。⚠️ 以 `src/theme.css:53` 为准（本表此前误记为 `#5a08c`/`#5aa08c`） |
| `--ochre` | `#96702c` | 贵州葛镜桥辨识色（赭金） |
| `--paper-lift` | `rgba(253,248,237,.42)` | 暖裱纸白，顶替底座 `rgba(255,255,255,α)` |
| `--scene-bg` | `#e0d3b6` | 绢本画底值。⚠️ **纯文档变量**（全项目只有 `theme.css:89` 这一处声明，无任何 `var(--scene-bg)` 消费方）—— 它的作用是「和另外两处保持同色的记录」，不是生效来源 |

⚠️ **画底默认值有三处必须逐字同色**：① `Scene.tsx` 的 `useState('#e0d3b6')` ② `Toolbar.tsx` 的 `BG_PRESETS` 里「绢本」③ `--scene-bg`。

⚠️ **画布铺满视口，画底色以 8% 透光染遍整页**：换画底 = 换整页纸色（面板纸位移 ≈ 画底位移 ×0.08），是「面板跟着变暗」的解释。

**改主题后的验证链**：`tsc --noEmit` → `E2E_URL=http://localhost:5173/ node scripts/e2e-shot.mjs <名> --wait 15000` → 用 `%TEMP%/wb-theme-verify/sample.py` 按归一化坐标采样出改前/改后色值对照表。判断稳定性**同参数连拍两张比逐像素**。

## 场景选择页的结构约定

**`场景选择页面/index.html` 是单文件**（CSS+JS 全在里面，2300+ 行）。再加 3D 内容前建议先拆 `app.js` / `theme.css`。

**「可飞入节点」三个**：`suzhou` / `gejin`（地图经纬度，走 `toWorld`）+ `wenchuang`（地图东侧「文创坊」，钉世界坐标 `SHOP.x = 1.46`，**不走 toWorld**）。四套链路共用：飞行 `flyTo(tgt, dist, opts)` / 拾取 `pick()` / 标签 `updateLabels()` / 服务探测 `checkServices()`。

**视图切换靠归一化参数 `viewK`（0=地图，1=文创坊）**，`applyViewK(k)`：地图 `scale=(1-k)^1.15` + `y=-0.72k`；商铺 `scale=easeOutBack(k)` + `y=-0.26(1-k)`。别用入场+退场两套动画（反向点打架）；别改材质透明度做转场（地图几百个材质，缩放 group 零改动）。`scale` 最小值给 `0.0008`，**绝不给 0**（矩阵退化）。

**`SHOP.azim=0` / `phi=1.10` 锁死**：`azim=0` 锁正脸；`phi` 压到 0.94 屋檐会盖住匾额（判据 `y_p+(z_e−z_p)·tanθ ≤ y_e`），正解是出挑收到 0.005 并让匾额略微探出屋顶前缘。

**模型尺寸与零件**（修屋顶变形后定案，改前先看）：
- **`CylinderGeometry` 四棱锥底面是菱形，`rotateY(π/4)` 后才轴对齐正方**。拉成「面宽≠进深」必须 `rotateY` 和 `scale` 都烘进 geometry —— 写成 `mesh.rotation.y=π/4; mesh.scale.x=1.24` 是错的（`T·R·S` 里 scale 先生效 → 斜菱形，屋顶被拧）。✅ `g.rotateY(π/4); g.scale(ROOF_HX,1,ROOF_HZ)`。判据：底面四角每个都 `|x|=HX 且 |z|=HZ`。
- 现取值：`ROOF_HX 0.137 / ROOF_HZ 0.110 / ROOF_H 0.084`；屋身 `0.235×0.118×0.175`；檐口板半深 `0.106`，匾额贴 `z=0.114`。
- **别用 emissive 把灯点亮**（平贴色片）：灯笼 `emissiveIntensity` 保持 0.2~0.5 + 细吊线（半径 0.0007）。
- `__scene3d.shopRefs` 暴露 `roof/sign/lamps/doors/poster` 供 e2e 量几何。⚠️ 底面封盖会多一个 `(0,0)` 心点，数「四角」要滤掉。

**进文创坊只有一条路**：右上角 `.wcard` 门帖**已删**（连带 `#hud-right` / CSS / `setWenLed()` 引用），入口是 **右侧换卷箭头 `#nav-view` → 商店视图 → 点题匾 `#shop-pin`**（键盘 `3` 也可）。地图视图不能一步直达文创页（预期行为）。`.shop-pin-led` 是文创服务状态唯一指示。⚠️ `@keyframes pulse` 是 `.wcard-led` 与 `.shop-pin-led` **共用**，删 wcard 那段时它必须留下。删 HUD 元素要清三处（HTML/CSS含媒体查询覆写/JS getElementById）+ e2e 加「该元素不该存在」的反向断言。

**⚠️ 飞行动画必须每帧 `lookAt(target)`**：`tick()` 飞行分支 lerp `position`/`target` 后**必须紧跟 `camera.lookAt(controls.target);`**。唯一会 lookAt 的是 `controls.update()`，飞行时被禁用（`controls.enabled=false`）—— 不补这句，相机整段保持上一视图朝向，结束帧才被拽正 = 「跳一下」。城市飞行没暴露是因为刻意保留方位角、首尾朝向近同。终点帧朝向恰好等于 controls.update() 结果，controls 恢复时不再动。**判据**（做成 e2e 断言）：相机 forward 与 position→target 夹角全程 <1°（bug 复现 18.63°，修复 0.0000°）。**两个方向都要验**（`sampleSwitch(startAtShop)` 跑 false/true 各 3 条）；回程「动画中」判定用 `Math.abs(k-from)>1e-4`（回程首帧 k=1，写 `k>1e-4` 整段采不到）。

**进店动画「开门+推进同时 → 到门面即跳」（v3 定稿，点题匾起 ≈1.36s）**：
- 门是**可旋转件**：每扇挂 pivot 上，pivot 钉**外侧门框**（`HINGE_X=DOOR_HW=0.047`），门 mesh 在 pivot 内偏移 `−sx·0.023`。**右门 +θ 向外、左门 −θ 向外**。
- **屋身非实心**：正脸拆成「门楣+左右墩」（外观与整墙零差别），门洞后围暗色内腔（后壁 z=0.020、侧壁 ±0.044、顶 0.103、地板 0.029，进深 ≈0.068）+ 腔内暖灯（**挂左后角偏离中轴** —— 灯在中轴会被穿门末帧顶成一组正圆橙光）。⚠️ 实心墙拆洞后**必须补背封板**（z≈-0.0845，M.wall），否则从背后看穿堂。
- 时序：`startDoorAnim(flyDur-20)`（开门）与 `flyTo`（抵近）**同时且同时结束**；fly then 接 `startDoorPush`（push 700ms，**easeOutCubic 起步即最快**）；**veil/跳转按 z 阈值提前**：`camera.z < faceZ+0.30` → veil，260ms 后跳转（全程 ≈1.36s）。⚠️ open 段**只转门不动 target**（target 由并行 flyState 管，两边同改打架）。⚠️ v3 进店飞行焦点是**门心** `(SHOP.x,0.0665,SHOP.z)` + `phi 1.45`（俯角 ≈7° 平视大门），**不是** `shopFocus()`（y=0.135）/`SHOP.phi=1.10`（切场观看语义，别混）。⚠️「停顿感」两来源：openDur<flyDur 静止空档（v3 已对齐）+ push 用 easeInOutCubic 起步极缓（v3 已改 easeOut）—— 别改回去。
- 复位：`closeShopDoors()` 挂 `resetView()` 和 `__scene3d.showMap()`，不复位下次进场门已开。
- e2e 门断言：点题匾后 `sleep(420)` 查 `shopRefs.doors` 的 `pivot.rotation.y`，**|θ|>45° 且左−θ/右+θ**（实测 ±96.9°），再等跳转（≈1.36s）。推近断言（dryRun 段）用 `shopOffset(0.0665)` 验「门心落画面正中」+ `target.y≈0.0665`。
- **门洞内腔后壁挂「文创页海报」**（`shopRefs.poster`）：`assets/wenchuang-preview.png`（`tools/shot-wenchuang.mjs` 抓 5173 整页，URL 必须 `http://[::1]:5173/`）+ `MeshBasicMaterial`（腔内无光照，Standard 会黑掉）。⚠️ **TextureLoader 对 404 静默失败** → e2e 有 `map.image.width>0` 断言兜底。⚠️ poster 的 `const` 写内腔裸块里、块外 `shopRefs` 引用 = ReferenceError **整页白屏** —— 块外声明 `let poster=null`，块内只赋值。5173 大改版后重跑 `shot-wenchuang.mjs` 刷新快照。

**这个页面的 e2e**：`node 场景选择页面/tools/e2e_shop.mjs`（无头 Edge，**49 项断言**，跳转验证放最后）。⚠️ 不加 swiftshader（真 GPU 无头就能拿 WebGL 上下文，加了和用户看到的不是同一渲染结果）。⚠️ 断言前分别等三件事：`__scene3d` 挂上 / `#nav-view.on` / `#boot.gone`，再 `sleep(1400)`；只等 `__scene3d` 会打在载入层那一帧。

**动画「有没有跳」的验证工具（`场景选择页面/tools/`）**：

| 工具 | 用途 | 关键注意 |
| --- | --- | --- |
| `probe-frames.mjs` | CDP `startScreencast` 录真实合成帧 | 必须 **JPEG + ≤1280 宽**；PNG 编码 2530×1345 占满主线程，连点箭头都超时 |
| `analyze-frames.py` | 帧差找**孤立尖峰**，`--mp4` 可吃录屏 | 判据「前后邻帧都近乎静止、只有自己很大」，不是最大差值 |
| `track-landmark.py` | 朱砂地标追踪（灯笼/签条/印都是朱砂） | 位置取**就近延续**那块；取两块中点或最大块会换身份造假位移 |
| `probe-switch2.mjs` | 逐帧投影采样（相机全状态+焦点屏幕坐标） | 屏幕外 2000+px 透视畸变极大，要限制在画面内 |

- ⚠️ **绝对位移阈值不能**判「跳」：中段本最快（峰值 ~13px/帧），用「孤立尖峰倍率 = 该帧位移 ÷ 左右 ±5 帧中位数」。正常 1~2×，bug 复现 707×。
- ⚠️ **动画结束后不能停采**：这处 bug 跳变**恰好落在 `viewK=1` 那一帧**，滤掉就漏。
- ⚠️ **断言要用 bug 复现验它有没有牙**：把 `camera.lookAt` 注释掉跑一遍，确认两条断言都变红（18.63° / 707×）才敢说有效。

## 文创共创体验 · 功能变更

- **智能推荐面板已删（2026-10-09）**：`Scene.tsx` 删了 import RecommendPanel / `setPromptDraft` 解构 / `<RecommendPanel>` JSX 三处。`RecommendPanel.tsx` / theme.css 的 `recommend-*`+`prompt-modal` CSS / `lib/modelCompat.ts`+`promptGenerator.ts` **留作 dead code 未删**（vite 不打包无引用模块，不影响运行；要彻底清理可一并删）。
- ⚠️ 删组件时连带删从 store 解构的 prop（如 `setPromptDraft`），否则 tsc noUnusedLocals 可能报；但 store 里的 setter 留着（别处可能用）。
- 验证工具 `tools/verify-no-recommend.mjs`（无头 CDP 查 `.recommend-panel` DOM 不存在 + ModelSelector 仍在）。

## 葛镜桥 · 背景音乐（2026-10-09 加）

- 曲目 `music/徐梦圆-CHINA-孤舟_624237536.mp3`（8.5MB；serve.py 正确处理中文文件名 —— 测可达性要 URL-encode，裸中文 HEAD 会被 http.client 的 ascii 编码拒）。
- `index.html` 加 `<button class="musicbtn">`（截图钮下方）+ `<audio id="bgm" loop preload>`；末尾 inline `import('./js/music.js').then(({initMusic})=>initMusic())`，不动 main.js。
- `js/music.js`：点击切 play/pause，图标变（▶/‖‖），volume 0.5、loop；`play()` 的 Promise 接住 reject（自动播放被拦按钮不卡）。
- `css/style.css` 的 `.musicbtn` z-index **60**（高于 loadmask 50）—— 让用户**加载时就能点音乐**（音乐不依赖模型）。
- 验证工具 `tools/verify-music.mjs`（无头 CDP 真实手势 + 掐 ply + 隐藏 loadmask）。
