# 项目长期约定

> `wenchuang-customizer/`（React 19 + R3F + TS）；拆装/UV/材质的坑在 skill **`gltf-region-naming`**，这里只记约定。

## 部位命名与匹配

- **两层别混**：`SurfacePicker` 管「点中哪个 mesh 的哪个面」，`regions.ts` 用**对象名/材质名**判部位。**改名只改 `modelPresets.ts` 的 `regions` 表。**
- 命名 `<前缀>_<部位>`，带/不带前缀**双别名**；四级匹配：完全一致 → 去 `_1/_2` → 去分隔符 → 分词包含。`paintable:false`=保留；`optional:true`=可缺。⚠️ `regions.ts` **零相对依赖**。
- **可贴｜保留**：茶杯 `cup_body`+`cup_handle`｜`cup_inner`+`cup_bottom`；花瓶 `vase_side`｜`vase_inner`+`vase_bottom`；笔筒 `holder_side`｜`holder_inner`+`holder_bottom`；帆布包 `bag_front`+`bag_back`｜`bag_body`；团扇 `fan_face`｜`fan_body`（直筒杯把手 `optional`）。折扇已下架（模型留 `_备份/`）。
- **9 个正式模型，无占位**。软体**圈/摘/硬切**（直筒杯 `cos=-1` 成纯高度切刀）、扫描件 `fan_b` **按贴图颜色认**（⚠️**多刀连锁**）。细节见 skill。**文档↔配置表↔模型名必须一致。**

## 别改回去

- **每部位各贴一张图已成立**：`paint()` 每次 `loadTexture()` **新建实例**压 `liveStackRef`，**别做单例**。
- **导出 GLB 前必须洗 UI 状态**：`buildGlb` 在 `parse` 前 `stripUiTint`，干净色记 `userData.__cleanColor`。**高亮一律走 `userData`，别动 `material.color`**。保留原材质部位用线性 `__cleanColorRgb`（`0.8` 走 `getHex()` 会变 0.7991，**首读 `clone()`**）。
- **`keepOriginalParts`/`partFinishes`**：前者=该部位**不套 finish、材质实例都不换**（团扇木框）；后者=按部位覆盖 finish（团扇扇面）。两者都**不写顶层 `finish`**。⚠️ 零贴图零件的固定色只能**烤进 GLB**（`--material X=wood`，`baseColorFactor` 是**线性空间**）→ **烤色必须配 `keepOriginalParts`**。
- ⚠️ three 每帧覆盖 `material.envMapIntensity`（`envMap===null`）→ **贴图必须挂 `material.envMap`**。**Canvas 内外只能靠 props**；图片走后端**相对路径**+vite 代理保同源。
- 新增 CSS 类名前**先 grep `src/`**。

## preset 与质感

- preset 统一 `colorMode:'body'`、一条 `print_area`、`explodeMap:{}`、模型放 `public/models/products/`。
- **质感 = finish 八档**（`finish.ts`）：茶杯/花瓶/笔筒 `glaze`、直筒杯 `plastic`、帆布包 `fabric`、团扇 `silk`（`paper` 档无人用）。白瓷与塑料都靠 clearcoat，差别在**高光形状**；**纸质 vs 哑光陶土只差粗糙度分不出来**，靠程序生成的纸纤维法线图（**确定性伪随机**，不能用 `Math.random()`）。
  ⚠️ **`sheen > 0` 必须给 `sheenColor`**（默认纯黑、被当系数）；`Texture.repeat` 是**实例属性**，纹理贴图**按 repeat 分开缓存**。**加档位同步 `e2e-finish.mjs` 写死的 `labels`**。
- **灯光曝光可调、默认档按白瓷标定**（`three/lighting.ts`）；发白发暗**先调它，别动 `Scene.tsx` 写死的数字**。

## 界面与尺寸

- **「器物」并进左栏「配色」顶部**（2026-10-09，原为画布左上浮层）：`ColorControls` 的 `modelSlot` 插槽。⚠️ `.model-selector`/`.model-dropdown` 类名**别改**（e2e 靠它切商品/隐藏面板）。
- **商品初始大小按「相机投影」归一**：`meshUtils.ts` 的 `computeScreenFit`，`PRODUCT_SCREEN_HEIGHT = 0.4`（画布高 40%）。⚠️ 相机与归一化**共用 `SCENE_CAMERA`**。别退回「世界最长边归一」（立方体因透视偏大、薄片偏小，实测差 **1.36×**）。

## 智能推荐（图 → 商品适配度）

- **纯前端、离线、不碰后端**：`lib/modelCompat.ts`（`COMPAT_CONFIG` 配置区 + `PROFILE_TO_PRESET` + `recommendModels()`）+ `lib/promptGenerator.ts` + `components/RecommendPanel.tsx`。挂在**左栏「器物」段内**（`modelSlot`）。
- **`modelProfiles.json` 是需求文档原样落地**（`src/data/`，`resolveJsonModule`）；9 条 id 与 preset 靠 `PROFILE_TO_PRESET` 对，**对不上静默丢**。
- ⚠️ **两个判据别照文档改回去**：① 留白是**单向**的（够就满分，不够才扣）—— 对称判据会让 9 模型全 0 分；② `edgeSimilarity` **直接取源图首末列**（文档的「缩到 64 宽取边列」量不出区别：0.83 vs 0.80 → 改后 **1.00 vs 0.44**）。
- ⚠️ **理由用带符号显著度** `(维度分−0.5)×权重`：进推荐（≥60）取最大、不进取最负 —— 否则理由与排名打架。
- ⚠️ **`.recommend-*` / `.prompt-modal` 是对外接口**（验收脚本靠它定位）；`.prompt-modal` **z-index 必须 1200**（面板层是 1000~1030）+ **必须 `createPortal` 到 body**。
- **异常只降级**：`recommendModels()` 全包 `try/catch`，失败返 `null` → 提示一行，**绝不阻塞手动贴图**。密度/色数超标**只降排序不禁止贴图**。
- DEV 钩子 `window.__compat` / `window.__prompt`（生产摇掉）；验收脚本 `docs/联调截图/_tmp/recommend-check.mjs`。

## 「双桥记」古风主题

- **视觉全在 `src/theme.css`**（`App.tsx` **最后 import**）；`BridgeBackdrop`/`BridgeNotes` 纯视觉不接交互；规范见 `docs/双桥记主题规范.md`。
- ⚠️ 长卷 viewBox 1200×200 在 1440 宽只露 x≈294~846 → 两桥压 **x 320~820 / y≥62** + `slice`，**改面板宽度必重截图**；`--scene-ink` 删了长卷消失；字体只用系统宋/楷；`aria-label`/`.studio-region-chip`/`.finish-chip` 别动。

## 目录与源文件

- **`文创商品模型/` 是 `models:fix` 的输入目录，不是运行时资源**。网页加载的是 `public/models/products/*.glb`（处理版），两边**同名不同字节**（`bag_a` 1.40→1.75 MB、`fan_b` 36.0→3.34 MB）。判「某模型有没有用上」要查 `modelPresets.ts` + `public/models/products/`，**别只看这个目录**。
- **`.max`/`.fbx`/`.fbm` 源文件在兄弟目录** `D:\2026数媒大赛古桥项目\文创商品店模型\`（2026-10-09 迁出）。
- **`文创商品模型/_备份/`** 存下架件（折扇 fan_a ×4）与换版件（mug_a ×4）—— **别清**，这是回滚路径。
- **`dist/` 是构建产物**（在 `.gitignore` 里）：`dist/models/products/` 与 `public/models/products/` **逐字节相同** —— 改完 `public` 要同步 `dist` 或重建；判「某文件有没有用」**永远只查 `public/`**，`dist` 跟着走。
- ⚠️ **本机删除走回收站**：`fs.rmSync` 被垫片（`CODEBUDDY_SAFE_DELETE_ENABLED=1`）改道进 `D:\$Recycle.Bin\<SID>\$R*`，**不是永久删除**；`rm -f` 才是硬删。取证/还原用 `docs/联调截图/_tmp/recycle-peek.py`（或 skill `windows-recycle-peek`）。

## 命令与环境

- **一键启动**：根目录 **`一键启动网页.bat`**（UTF-8 无 BOM + CRLF，首行 `chcp 65001`）。前端 **5173**、预览 **4173**（vite 只绑 `::1`）。
- `e2e:*` 认 `E2E_URL`/`E2E_OUT_DIR`；`models:regress` 串行 + `--json`，`models:matrix` 靠它重画海报。
- ⚠️ 本机坑：① `node` 经 Git Bash 传 `/c/...` 变 `D:\c\...`，写 `C:/...`；② `build` 撞沙箱垫片 → 加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`；③ 临时文件写 `docs/联调截图/_tmp/`；④ **孤儿模型已清零**（`magnet_a/b.glb` 2026-10-09 删，`make-placeholder-models.mjs` 里的生成项同步清掉）—— `models:verify` 的孤儿清单现在为空。
