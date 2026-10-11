import type { RegionConfig } from '../three/regions'
import type { FinishId } from '../three/finish'

export interface MaterialConfig {
  id: string
  name: string
  description: string
  defaultColor: string
}

export interface ModelTextures {
  baseColor?: string
  normal?: string
  roughness?: string
  metallic?: string
}

export interface ModelPreset {
  id: string
  name: string
  path: string
  loader: 'gltf' | 'fbx'
  colorMode?: 'per-material' | 'body' | 'per-node'
  description: string
  materials: MaterialConfig[]
  /**
   * 部位命名表：模型里拆好的零件 → 面板上显示的中文部位。
   * 有它才能做到「点杯身只贴杯身，不碰把手」，并支持在面板上直接点部位名贴图。
   * 留空 / 不写 = 模型没按部位拆，退化成「点哪儿贴哪儿（只贴命中的那个 mesh）」。
   * 命名规则见 public/models/products/README.md。
   */
  regions?: RegionConfig[]
  textures?: ModelTextures
  /**
   * 表面质感档位（陶瓷釉面 / 哑光陶土 / 半哑光 / 金属 / 帆布 / 绢丝）。
   * 决定材质的 metalness / roughness / clearcoat / sheen —— 详见 three/finish.ts。
   * 不写 = 不动模型自带材质（底座那几个示例配置就是这样，保持原样），
   * 而且**面板上不出现质感选择器**（见 Scene.tsx 的 onFinishChange 传参）。
   */
  finish?: FinishId
  /**
   * 这些部位**保留模型自带的材质**：不套 `finish`、不套调色板颜色、贴图一个都不动。
   * 值写 `regions` 里的部位 id。
   *
   * 给「模型自带烘焙贴图」的商品用 —— 团扇的木质扇框与竹柄就是这样：那套木纹 / 雕花
   * 贴图是模型自带的（`--material <零件>=keep` 原样烤进 GLB），网页端一旦按调色板改颜色
   * 或者套上「帆布」质感，木头的观感就没了。
   */
  keepOriginalParts?: string[]
  /**
   * 按部位覆盖 `finish`（键是 `regions` 里的部位 id）；没写的部位用 preset 的 `finish`。
   *
   * 给「同一个商品上不同部位材质不一样」用 —— 团扇是**白绢面 + 木质扇框**，
   * 一个 `finish` 盖不住：绢面要「绢丝」，扇框又必须原样（所以扇框走 `keepOriginalParts`）。
   */
  partFinishes?: Record<string, FinishId>
  scale?: [number, number, number]
  rotation?: [number, number, number]
  position?: [number, number, number]
  // Per-material explode vectors. When present, configurators use these fixed
  // directions instead of the radial fallback derived from mesh centers.
  explodeMap?: Record<string, [number, number, number]>
}

/**
 * 底座自带的 4 个示例配置（Aline / Umber ×2 / PS5 DualSense）。
 *
 * 它们的模型文件合计约 70 MB，体积较大（本项目所在网络拉取不稳定，git clone 多次失败），
 * 因此没有放进 MODEL_PRESETS —— 避免下拉框里出现「点了就 404」的选项。
 * 如果你把底座仓库的 public/models/ 一起拷了进来，把文件末尾的 MODEL_PRESETS 改成
 *   export const MODEL_PRESETS: ModelPreset[] = [...LEGACY_PRESETS, ...WENCHUANG_PRESETS]
 * 就能让它们重新出现在模型下拉框里。
 */
export const LEGACY_PRESETS: ModelPreset[] = [
  {
    id: 'umber-alternate',
    name: 'Umber (alternate)',
    path: 'models/umber_model/umber_model_alternate.glb',
    loader: 'gltf',
    colorMode: 'per-node',
    description: 'Umber alternate — 12 separable parts',
    materials: [
      { id: 'tripo_part_1',  name: 'Right arm',       description: 'Right arm color',       defaultColor: '#ffffff' },
      { id: 'tripo_part_2',  name: 'Right shoulder',  description: 'Right shoulder color',  defaultColor: '#ffffff' },
      { id: 'tripo_part_3',  name: 'Right leg',       description: 'Right leg color',       defaultColor: '#ffffff' },
      { id: 'tripo_part_5',  name: 'Waist',           description: 'Waist color',           defaultColor: '#ffffff' },
      { id: 'tripo_part_7',  name: 'Chest',           description: 'Chest color',           defaultColor: '#ffffff' },
      { id: 'tripo_part_8',  name: 'Head - upper',    description: 'Head - upper color',    defaultColor: '#ffffff' },
      { id: 'tripo_part_9',  name: 'Head - lower',    description: 'Head - lower color',    defaultColor: '#ffffff' },
      { id: 'tripo_part_10', name: 'Codpiece',        description: 'Codpiece color',        defaultColor: '#ffffff' },
      { id: 'tripo_part_11', name: 'Belt',            description: 'Belt color',            defaultColor: '#ffffff' },
      { id: 'tripo_part_13', name: 'Left leg',        description: 'Left leg color',        defaultColor: '#ffffff' },
      { id: 'tripo_part_16', name: 'Left shoulder',   description: 'Left shoulder color',   defaultColor: '#ffffff' },
      { id: 'tripo_part_18', name: 'Left arm',        description: 'Left arm color',        defaultColor: '#ffffff' },
    ],
    scale: [1, 1, 1],
  },
  {
    id: 'umber',
    name: 'Umber',
    path: 'models/umber_model/umber_model.glb',
    loader: 'gltf',
    colorMode: 'per-node',
    description: 'Umber model — 9 separable parts',
    materials: [
      { id: 'tripo_part_0',  name: 'Right arm', description: 'Right arm color', defaultColor: '#ffffff' },
      { id: 'tripo_part_1',  name: 'Right leg', description: 'Right leg color', defaultColor: '#ffffff' },
      { id: 'tripo_part_5',  name: 'Head',      description: 'Head color',      defaultColor: '#ffffff' },
      { id: 'tripo_part_6',  name: 'Chest',     description: 'Chest color',     defaultColor: '#ffffff' },
      { id: 'tripo_part_7',  name: 'Pants',     description: 'Pants color',     defaultColor: '#ffffff' },
      { id: 'tripo_part_8',  name: 'Left leg',  description: 'Left leg color',  defaultColor: '#ffffff' },
      { id: 'tripo_part_9',  name: 'Left arm',  description: 'Left arm color',  defaultColor: '#ffffff' },
      { id: 'tripo_part_11', name: 'Weapon',    description: 'Weapon color',    defaultColor: '#ffffff' },
      { id: 'tripo_part_13', name: 'Crystal',   description: 'Crystal color',   defaultColor: '#ffffff' },
    ],
    scale: [1, 1, 1],
  },
  {
    id: 'aline',
    name: 'Aline',
    path: 'models/aline_model/aline_model.glb',
    loader: 'gltf',
    colorMode: 'per-node',
    description: 'Aline model — 11 separable parts',
    materials: [
      { id: 'tripo_part_0',     name: 'Right arm',      description: 'Right arm color',      defaultColor: '#ffffff' },
      { id: 'tripo_part_2',     name: 'Right shoulder', description: 'Right shoulder color', defaultColor: '#ffffff' },
      { id: 'tripo_part_3',     name: 'Right leg',      description: 'Right leg color',      defaultColor: '#ffffff' },
      { id: 'tripo_part_6',     name: 'Head',           description: 'Head color',           defaultColor: '#ffffff' },
      { id: 'tripo_part_7',     name: 'Chest',          description: 'Chest color',          defaultColor: '#ffffff' },
      { id: 'tripo_part_8',     name: 'Codpiece',       description: 'Codpiece color',       defaultColor: '#ffffff' },
      { id: 'tripo_part_10',    name: 'Cape',           description: 'Cape color',           defaultColor: '#ffffff' },
      { id: 'tripo_part_14',    name: 'Left leg',       description: 'Left leg color',       defaultColor: '#ffffff' },
      { id: 'tripo_part_15',    name: 'Left shoulder',  description: 'Left shoulder color',  defaultColor: '#ffffff' },
      { id: 'tripo_part_16',    name: 'Left arm',       description: 'Left arm color',       defaultColor: '#ffffff' },
      { id: 'tripo_part_new_0', name: 'Weapon',         description: 'Weapon color',         defaultColor: '#ffffff' },
    ],
    scale: [1, 1, 1],
  },
  {
    id: 'ps5-dualsense-modified',
    name: 'PlayStation 5 DualSense',
    path: 'models/playstation_5_dualsense/dualsense_controller.gltf',
    loader: 'gltf',
    description: 'Custom Sony PlayStation 5 wireless controller',
    materials: [
      { id: 'frontPlateLowerMaskColor', name: 'Front Plate Lower', description: 'Lower front plate section',    defaultColor: '#1a1a1a' },
      { id: 'frontPlateSideMasksColor', name: 'Front Plate Sides', description: 'Side sections of front plate', defaultColor: '#ffffff' },
      { id: 'frontPlateTouchpadColor',  name: 'Touchpad',          description: 'Touchpad surface',             defaultColor: '#ffffff' },
      { id: 'backPlateColor',           name: 'Back Plate',        description: 'Controller back shell',        defaultColor: '#ffffff' },
      { id: 'actionButtonsColor',       name: 'Action Buttons',    description: 'X, O, Triangle, Square buttons', defaultColor: '#ffffff' },
      { id: 'directionalButtonsColor',  name: 'D-Pad',             description: 'Directional buttons',          defaultColor: '#ffffff' },
      { id: 'triggersColor',            name: 'Triggers',          description: 'L1, L2, R1, R2 triggers',      defaultColor: '#1a1a1a' },
      { id: 'analogsColor',             name: 'Analog Sticks',     description: 'Left and right analog sticks', defaultColor: '#333333' },
      { id: 'optionsShareButtonColor',  name: 'Options/Share',     description: 'Options and Share buttons',    defaultColor: '#e0e0e0' },
      { id: 'psButtonColor',            name: 'PS Button',         description: 'PlayStation logo button',      defaultColor: '#1a1a1a' },
    ],
    scale: [2, 2, 2],
    rotation: [0, Math.PI, 0],
    explodeMap: {
      frontPlateOutlineColor:    [0,    0.2,  0.8],
      frontPlateLowerMaskColor:  [0,   -0.5,  0.7],
      frontPlateSideMasksColor:  [0.8,  0,    0.5],
      frontPlateTouchpadColor:   [0,    0.4,  1.2],
      backPlateColor:            [0,    0,   -1.0],
      actionButtonsColor:        [0.7,  0.4,  0.8],
      directionalButtonsColor:  [-0.7,  0.4,  0.8],
      triggersColor:             [0,    0.8,  0.3],
      analogsColor:              [0,    0.5,  0.6],
      optionsShareButtonColor:   [0,    0.3,  0.7],
      psButtonColor:             [0,    0.2,  1.5],
    },
  },
]

// ===========================================================================
// 文创商品（葛镜桥主题）—— 9 个模型（原 10 个，折扇 fan_a 已于 2026-10-08 下架）
//
// 模型文件放在 public/models/products/ 下，把 GLB 放进去即可直接联调。
// 统一约定：
//   colorMode: 'body'  →  整体只有一条配色，靠 material.color 着色（BodyTintedConfigurator）
//                         「按部位分别改色」以后要开的话，把这里改成 'per-material' 即可，
//                         底座的多材质分支会按 materials 里的 name 去配 modelPresets 的材质名。
//   regions            →  部位命名表，决定「点这个零件时该贴哪些零件、显示成什么中文名」
//   explodeMap: {}     →  不需要拆件爆炸视图，保持空对象占位
//
// 关于 regions 里的 match：
//   写的是「GLB 里真实存在的名字」——在 3ds Max 里分离成独立对象时就是对象名，
//   用多维子材质时就是材质名。程序两个都会查，命中任意一个即可（不区分大小写、
//   允许 _1/_2 这类导出器补的后缀）。改名字不用改代码，只改这张表。
//   跑 `npm run models:verify` 会逐个模型打印「实际零件名 ↔ 配置部位」的对照结果。
// ===========================================================================

// ---------------------------------------------------------------------------
// 部位命名表
//
// 命名格式：<商品前缀>_<部位>，全小写 + 下划线，纯英文。前缀按商品类型固定：
//   茶杯 cup_ / 花瓶 vase_ / 笔筒 holder_ / 帆布包 bag_ / 扇子 fan_ （冰箱贴 magnet_ 已撤下）
//
// 每个部位的 match 都写两个别名：
//   ① 带前缀的（cup_body）—— 推荐写法，和 docs/模型拆分与命名规范.md 一致
//   ② 不带前缀的（body）  —— 兼容只在模型里写部位名的做法
// 两种都走「精确匹配」，所以用哪种命名都能被准确认出来，不会串到别的部位。
//
// paintable: false = 保留部位：用户点到会收到明确提示，而不是静默乱贴。
// optional:  true = 这个部位模型里可以没有（不同人拆的粗细不一样，不报警告）。
// ---------------------------------------------------------------------------

/**
 * 茶杯：杯身与把手都可贴（点哪个就贴哪个），杯口内壁与杯底保留。
 *
 * 两个茶杯共用这张表，但**拆法完全不同**（见各自 preset 上的注释）：
 *   · `mug_a` 带把手 —— 在 3ds Max 里手工拆的四件；
 *   · `mug_b` 直筒款**没有把手**，是 AI 出的一整块软体，由 `--extract-region` 按高度切成三件。
 * 所以 `handle` 标了 `optional` —— 模型里没有这个部位时自检不报「缺部位」。
 */
const CUP_REGIONS: RegionConfig[] = [
  { id: 'body',   name: '杯身外壁',   match: ['cup_body', 'body'],     paintable: true },
  { id: 'handle', name: '把手',       match: ['cup_handle', 'handle'], paintable: true, optional: true },
  { id: 'inner',  name: '杯口与内壁', match: ['cup_inner', 'inner'],   paintable: false, optional: true },
  { id: 'bottom', name: '杯底',       match: ['cup_bottom', 'bottom'], paintable: false, optional: true },
]

/**
 * 花瓶（`vase_a` 圆肚 / `vase_b` 细颈）：和两个笔筒同一类 —— AI 直接出的**一整块光滑软体**
 * （5 万面、单个连通块、没有 UV），用户的要求也一样（「只对侧面外壁贴图」），
 * 所以照搬笔筒那套「反过来摘掉不要的」：摘内腔 + 摘底，剩下整块就是外壁。
 *
 *   # 两个花瓶用同一条命令（截面实测都是正圆、半径恒定 —— 与笔筒那个「圆/方」判据无关）
 *   npm run models:fix -- "文创商品模型/vase_a.glb" --out public/models/products/vase_a.glb \
 *     --extract-inner  "node_0=vase_inner" \
 *     --extract-region "node_0=vase_bottom;axis=-y;cos=0.7;y=0~0.12" \
 *     --rename "node_0=vase_side"
 *
 * ⚠️ **`y` 的上界是 0.12，不要照抄笔筒的 0.06 —— 这条踩过坑**：
 * 花瓶的底是**两级**的（外圈一圈朝下的环 + 中心一块最低的底盘，几何上互不相连），
 * 中间那级落在 5%~11% 高度上。笔筒那套 `0~0.06` 正好切在它中间，会把半个凹底留在
 * `vase_side` 里 —— 症状是「点外壁贴图，瓶底看不见的凹面也跟着被贴上」。抬到 0.12 就摘干净。
 * 副作用：`vase_bottom` 会报「2 块互不相连的面」。**那是模型真实的几何结构，不是多选/漏选**
 * （两块都朝下、都属于瓶底、都标保留），不用处理 —— 笔筒的桶底是一整块，所以没这条告警。
 *
 * 内腔一侧和笔筒不同：**AI 生成的花瓶只建了从瓶口看得到的那一小段内壁**
 * （`vase_a` 2220 面 / `vase_b` 3071 面，半径 0.05~0.14，全长在瓶颈里），腹部以内是空的 ——
 * `--extract-inner` 摘出来的正是这一段，够用。
 *
 * ⚠️ 跑 `models:layers` 会看到 `vase_side` 里还留着**一批「朝下↓」的面**（`ny ≤ −0.7`），
 * 别当成「底没摘干净」—— 逐层看半径就清楚了：
 *   · 底部零星几十面（`vase_a` 41 面 / `vase_b` 37 面），半径 ≈ 同层外壁半径 → 壁与底交界的倒角，属外壁；
 *   · 大头在**最顶层瓶口**（`vase_a` 1259 面 半径中位 0.174 / 同层外壁 0.198 内壁 0.122；
 *     `vase_b` 414 面 半径中位 0.113 / 同层外壁 0.096 内壁 0.088）——
 *     这两个半径都**大于同层内壁**，也就是落在**外扩口沿的下表面**上：从侧下方看确实看得见，
 *     属于外壁而不是内壁，**留着是对的**。（真要摘就会在瓶口留下一圈没贴上的白边。）
 * 判断口径：「这几百面是口沿内侧翻边吗」→ 拿它的半径跟**同层** `_inner` 的半径比，比它小才是内壁。
 * 顺带一提，腰肩那些 `朝上` 的面（`vase_a` 第 7~9 层、`vase_b` 第 5~6 层）是**肩部的上斜面**
 * （收颈处法向朝上），同样是外壁、照样可贴，不是「盖」。
 *
 * UV 走 `cylinder-y`，接缝在 -Z 背面、中心正对 +Z。瓶身正圆所以展开等比；
 * **瓶颈细，同样一段角度对应的弧长短，图案在颈部被横向压窄**（颈腹半径比 vase_a≈0.3 / vase_b≈0.26）——
 * 这跟「图案真贴在一个细颈瓶上」是一回事，不算错误；想要颈部不压缩得按弧长重参数化 UV，目前不做。
 *
 * 瓶身与瓶颈**合成一个可贴区**（`vase_side`）：用户要的是「只对侧面外壁贴图」，
 * 没要求分开。想让瓶身、瓶颈分别贴不同图案的话，再加一条
 * `--extract-region "node_0=vase_neck;axis=+y;..."` 按高度切开即可，这张表加一行就行。
 */
const VASE_REGIONS: RegionConfig[] = [
  { id: 'side',   name: '瓶身外壁',   match: ['vase_side', 'side'],     paintable: true },
  { id: 'inner',  name: '瓶口与内壁', match: ['vase_inner', 'inner'],   paintable: false, optional: true },
  { id: 'bottom', name: '瓶底',       match: ['vase_bottom', 'bottom'], paintable: false, optional: true },
]

/**
 * 笔筒（`holder_a` 圆 / `holder_b` 方）：两个模型都是 AI 直接出的**一整块光滑软体**
 * （50000 面、单个连通块、没有 UV），和帆布包一样靠几何特征拆，
 * 但**这次不用圈矩形，用「法向朝里/朝外」拆** ——
 * 用户的要求是「只对侧面外壁贴图」，也就是要**把整个筒腔摘掉**，
 * 而筒腔和外壁是一整片连着翻过去的（沿筒口翻），连通块分不开。
 *
 *   # 圆笔筒 holder_a（0.737 × 0.966 × 0.733，截面半径恒定 0.337~0.339 = 正圆）
 *   npm run models:fix -- "文创商品模型/holder_a.glb" --out public/models/products/holder_a.glb \
 *     --extract-inner  "node_0=holder_inner" \
 *     --extract-region "node_0=holder_bottom;axis=-y;cos=0.7;y=0~0.06" \
 *     --rename "node_0=holder_side"
 *
 *   # 方笔筒 holder_b（0.736 × 0.762 × 0.724，截面半径 0.319↔0.420 每 90° 循环 = 方带圆角）
 *   npm run models:fix -- "文创商品模型/holder_b.glb" --out public/models/products/holder_b.glb \
 *     --extract-inner  "node_0=holder_inner" \
 *     --extract-region "node_0=holder_bottom;axis=-y;cos=0.7;y=0~0.06" \
 *     --rename "node_0=holder_side"
 *
 * **两个笔筒用同一套命令、共用这张表** —— 拆分规则写的是「法向 / 朝向」，本来就与截面形状无关：
 * 方笔筒的四个面法向朝 ±X/±Z、内腔面法向朝心（`radialDot` 在面心 −1、圆角处仍 < −0.707），
 * 所以 `--extract-inner` 一样摘得干净；口沿那圈方环是朝上的水平面（`ny > 0` 且半径 > 内壁半径），
 * 照旧留在外壁一侧。实测 `a`：21394 / 26646 / 3070 面，`b`：21639 / 24658 / 4419 面。
 *
 * 两步的分工：
 *   ① `--extract-inner` 按**法向朝不朝中轴**摘出筒腔（内壁 + 内底，实测 a 21394 / b 21639 面）。
 *      这一步同时把「朝上的水平面 + 半径小于内壁半径」的内底面一起带走，很关键：
 *      不然内底会赖在 `holder_side` 里，点外壁贴图时筒底内侧也跟着变色。
 *   ② `--extract-region "axis=-y;cos=0.7;y=0~0.06"` 再摘掉**朝下的筒底**（a 3070 / b 4419 面）。
 *      筒底朝下、只在最底下 6% 高度内 —— 不摘的话它会被算进「侧面外壁」，
 *      用户点到看不见的底面也会贴上（虽然看不出来，但语义不对）。
 *   剩下的就是 `holder_side` = 侧面外壁 + 筒口那一圈翻边。
 *
 * 筒口翻边**故意留在 `holder_side` 里**，和茶杯把「杯口」算在 `cup_body` 一侧是同一个处理：
 * 单独切出来的话，图案铺到筒口会突然断掉、在筒口留一圈白边。
 *
 * UV 走 `cylinder-y`（绕 Y 轴柱面展开），图案绕筒身一圈、接缝在 -Z 背面，
 * 中心正对 +Z（默认相机方向）。圆笔筒展开是等比的；方笔筒四个面**各分到图案的 1/4**，
 * 图案跨过竖棱连续包过去（和真实的整圈缩膜标签一样），面心附近基本不拉伸、
 * 越靠竖棱越被拉开（圆角半径约是半宽的 24%，最边缘约 1.6×）—— 想要「每面各显示一张完整图」
 * 得另加一档盒式投影，目前两者统一用柱面以保持观感一致。
 */
const HOLDER_REGIONS: RegionConfig[] = [
  { id: 'side',   name: '筒身外壁',   match: ['holder_side', 'side'],     paintable: true },
  { id: 'inner',  name: '筒口与内壁', match: ['holder_inner', 'inner'],   paintable: false, optional: true },
  { id: 'bottom', name: '筒底',       match: ['holder_bottom', 'bottom'], paintable: false, optional: true },
]

/**
 * 冰箱贴（`magnet_a` / `magnet_b`）**已从商品列表里撤下** ——
 * 两个位置先后换成了笔筒 `holder_a`（圆）与 `holder_b`（方）。
 *
 * ⚠️ 2026-10-09：`public/models/products/` 里那两份占位 GLB 也删了
 * （`models:verify` 的孤儿检测一直在报它们，生成器里的对应项同步清掉）。
 * 注意正式模型目录 `文创商品模型/` 里**从来没有过**冰箱贴 —— 想恢复得先重新做出模型来。
 *
 * 下面这段部位表留着：真拿到冰箱贴模型时放开即可，再在 `WENCHUANG_PRESETS`
 * 里加回对应条目（`tsconfig` 开了 `noUnusedLocals`，所以闲着的时候必须注释掉）。
 *
 * const MAGNET_REGIONS: RegionConfig[] = [
 *   { id: 'face', name: '正面贴图区', match: ['magnet_face', 'face'], paintable: true },
 *   { id: 'body', name: '背面与侧边', match: ['magnet_body', 'body'], paintable: false },
 * ]
 */

/**
 * 帆布包·一片式（`bag_a`）：这个模型是 AI 直接出的**一整块光滑软体** ——
 * 整块只有一个连通块、相邻面二面角全都很小（没有任何硬边），「哪块面属于谁」靠连通性
 * 和硬边都分不开。所以用 `models:fix --extract-region` 按「朝向 + 包围盒范围」圈部位，
 * **正反两面各圈一块**（两条 `--extract-region` 串联，第二条以第一条剩下的几何为输入）：
 *
 *   npm run models:fix -- "文创商品模型/bag_a.glb" --out public/models/products/bag_a.glb \
 *     --extract-region "node_0=bag_front;axis=+z;cos=0.7;y=0~0.53;z=0.5~1" \
 *     --extract-region "node_0=bag_back;axis=-z;cos=0.7;y=0~0.53;z=0~0.5" \
 *     --rename "node_0=bag_body"
 *
 * 模型是**闭合壳体**（有内表面），所以沿 Z 从中间切一刀，正好把「正面外壁」和「背面外壁」
 * 分开：正面外壁在 z 后半、法向朝 +z；背面外壁在 z 前半、法向朝 -z。
 * （内表面朝向相反，被 cos 和 z 区间同时挡掉。）
 *
 * 背面的平面投影走 `planar-z-back`（u 左右翻转）—— 观察点在 -Z 时 X 轴在屏幕上左右相反，
 * 不翻的话贴上去的文字/印章会镜像。
 *
 * 侧边与提手不在任何一块里，留在 `bag_body` 里不可贴。
 */
const BAG_A_REGIONS: RegionConfig[] = [
  { id: 'front', name: '包的正面', match: ['bag_front', 'front'], paintable: true },
  { id: 'back',  name: '包的背面', match: ['bag_back', 'back'],   paintable: true },
  { id: 'body',  name: '侧边与提手', match: ['bag_body', 'body'], paintable: false },
]

/**
 * 帆布包·托特（`bag_b`）：正式模型，同样是 AI 直接出的**一整块光滑软体**
 * （50004 面、单个连通块、一处硬边都没有、没有 UV），所以和 `bag_a` 一样用
 * `--extract-region` 圈部位。区别是**这次的可贴区不是整块面板，而是面板正中那块矩形**
 * —— 按设计稿上画的红框来的：
 *
 *   npm run models:fix -- "文创商品模型/bag_b.glb" --out public/models/products/bag_b.glb \
 *     --extract-region "node_0=bag_front;axis=+z;cos=0.6;x=0.12~0.915;y=0.10~0.42;z=0.5~1" \
 *     --extract-region "node_0=bag_back;axis=-z;cos=0.6;x=0.12~0.915;y=0.10~0.42;z=0~0.5" \
 *     --rename "node_0=bag_body"
 *
 * `x=0.12~0.915` / `y=0.10~0.42` 这两个区间是**量出来的**，不是估的：截图里模型最大包围盒
 * （橙框）的宽高比 `656/969 = 0.6770` 与模型真实包围盒 `0.676/0.998 = 0.6774` 一致，
 * 说明橙框就是世界包围盒，于是把红框 `x 553~1078 / y 644~956` 按它归一化即可
 * （`y` 要上下翻转，因为 glTF 的 y 朝上、图片的 y 朝下）。背面用同一组区间。
 *
 * `cos` 取 0.6 而不是 `bag_a` 的 0.7：这个包的软褶更多，0.7 会漏掉约 130 面
 * 朝前但被褶子掀斜的面（打印区里会留白斑）；0.4/0.5/0.6 的面数几乎一样（差 30 面以内），
 * 说明 0.6 已经收全了，再放宽只会开始吃到侧边。
 *
 * 侧边与提手不在任何一块里，留在 `bag_body` 里不可贴。
 */
const BAG_REGIONS: RegionConfig[] = [
  { id: 'front', name: '包的正面',   match: ['bag_front', 'front'], paintable: true },
  { id: 'back',  name: '包的背面',   match: ['bag_back', 'back'],   paintable: true },
  { id: 'body',  name: '侧边与提手', match: ['bag_body', 'body'],   paintable: false },
]

/**
 * 团扇（正式模型）—— **自带烘焙贴图的扫描件**，所以和其他商品都不一样：
 *
 *   · 模型只有两个零件：`fan_face`（那块白绢，**前后两层薄片**）与 `fan_body`
 *     （雕花边框 + 竹柄）。分区是在 `models:fix` 里**按贴图颜色**认出来的
 *     （白绢 = 中性浅色：每通道 >150 且通道差 ≤16），不是靠几何。
 *   · `fan_body` 走 `keepOriginalParts`：木纹贴图、法线图、金属/粗糙度全部原样保留，
 *     网页端不套 finish、不套调色板、不进全彩模式。所以这里给它的名字只用于
 *     「面板上显示 + 点了提示这是保留部位」，材质的活儿由 preset 的
 *     `keepOriginalParts` 负责。
 *   · `fan_face` 的 UV 在 `models:fix --uv-force` 时被换成**平面展开**，
 *     所以贴图能整张铺满绢面；前后两层共用这一份 UV，**正反两面会同时上色**，
 *     这就是用户要的「从背面也能看到正面图案的反向透影」—— 不需要额外做半透明。
 */
const FAN_B_REGIONS: RegionConfig[] = [
  { id: 'face', name: '扇面（白绢）', match: ['fan_face', 'face'],  paintable: true },
  { id: 'body', name: '扇框与竹柄',   match: ['fan_body', 'body'],  paintable: false },
]

export const WENCHUANG_PRESETS: ModelPreset[] = [
  {
    id: 'mug_a',
    name: '茶杯·经典款',
    path: 'models/products/mug_a.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '茶杯 · 经典款 —— 杯身与把手都可贴图，杯口内壁与杯底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点击杯身或把手', defaultColor: '#ffffff' }],
    regions: CUP_REGIONS,
    finish: 'glaze',
    explodeMap: {},
  },
  {
    /**
     * 直筒款茶杯 —— **没有把手**，材质是**塑料**（不是陶瓷）。
     *
     * 和 `mug_a` 完全不同的来源：这是 AI 直接出的一整块光滑软体
     * （50000 面、单个连通块、**零 UV**、正圆截面），几何上没有任何硬边可分，
     * 只能按**高度**切。用户给的参考框是「从唇边下沿一直到底部」，
     * 所以可贴区就是**杯身那一圈外壁**：
     *
     *   npm run models:fix -- "../文创商品模型/mug_b.glb" --out public/models/products/mug_b.glb \
     *     --extract-region "node_0=cup_inner;axis=+y;cos=-1;y=0.85~1" \
     *     --extract-region "node_0=cup_bottom;axis=-y;cos=0.7;y=0~0.08" \
     *     --rename "node_0=cup_body"
     *
     * 两刀的分工：
     *   ① `y=0.85~1` 切在**唇边下沿**（实测 y=0.904 —— 红框顶边正好压在这条线上）。
     *      `axis=+y;cos=-1` 是故意的：`cos >= -1` 恒成立，朝向条件失效，退化成**纯高度切割**，
     *      一刀拿走整段「唇边 + 杯口 + 口内壁」（25807 面 → `cup_inner`，保留部位）。
     *   ② 剩下那半再摘**朝下的底**（3628 面 → `cup_bottom`，保留）。
     *      底是**两级**的（外圈一块环 + 中心一块盘，`models:layers` 能看到），
     *      所以 `cup_bottom` 会报「2 块互不相连的面」—— 那是模型真实的几何，不是多选漏选。
     *   剩下的 23097 面 = `cup_body`，就是红框里那圈外壁。
     *
     * ⚠️ 第 ② 刀的 `y=0.08` 是**相对第 ① 刀切完之后的包围盒**（y 0~0.904）算的
     * ——`--extract-region` 的区间都是「相对当前零件包围盒的比例」，多刀会连锁。
     * 这里 0.08 × 0.904 ≈ 0.072，正好盖住底部的两级。**改了第 ① 刀的 `y` 就必须重算第 ② 刀。**
     *
     * ⚠️ `cup_body` 里还留着一块**看不见的面**：杯底内凹那段斜壁（1127 面、半径 0.21、y 0.002~0.052）。
     * 它是「内向面」，既不在「朝下且 y≤0.08」的集合里、也不在「y≥0.85」的杯口集合里，两刀都没碰到。
     * **它在外壁内侧、任何外部视角都看不到**（分色体检图确认），留着不影响外观；
     * 硬要摘出来得再多一个零件名，不值当。
     */
    id: 'mug_b',
    name: '茶杯·直筒款',
    path: 'models/products/mug_b.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '茶杯 · 直筒款（塑料）—— 只有杯身那一圈外壁可贴图，杯口唇边与杯底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点击杯身外壁', defaultColor: '#ffffff' }],
    regions: CUP_REGIONS,
    // 塑料而不是陶瓷：高光是「一片油亮的亮带」而不是釉面那种镜面小点（见 finish.ts 的 plastic 档）
    finish: 'plastic',
    explodeMap: {},
  },
  {
    id: 'vase_a',
    name: '花瓶·圆肚',
    path: 'models/products/vase_a.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '花瓶 · 圆肚（陶瓷）—— 仅瓶身外壁是贴图区，瓶口内壁与瓶底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点瓶身外壁', defaultColor: '#ffffff' }],
    regions: VASE_REGIONS,
    finish: 'glaze',
    explodeMap: {},
  },
  {
    id: 'vase_b',
    name: '花瓶·细颈',
    path: 'models/products/vase_b.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '花瓶 · 细颈（陶瓷）—— 仅瓶身外壁是贴图区，瓶口内壁与瓶底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点瓶身外壁', defaultColor: '#ffffff' }],
    regions: VASE_REGIONS,
    finish: 'glaze',
    explodeMap: {},
  },
  {
    id: 'holder_a',
    name: '笔筒·圆',
    path: 'models/products/holder_a.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '笔筒 · 圆形（陶瓷）—— 仅筒身外壁是贴图区，筒口内壁与筒底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点筒身外壁', defaultColor: '#ffffff' }],
    regions: HOLDER_REGIONS,
    finish: 'glaze',
    explodeMap: {},
  },
  {
    id: 'holder_b',
    name: '笔筒·方',
    path: 'models/products/holder_b.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '笔筒 · 方形（陶瓷）—— 仅筒身外壁是贴图区，筒口内壁与筒底为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点筒身外壁', defaultColor: '#ffffff' }],
    regions: HOLDER_REGIONS,
    finish: 'glaze',
    explodeMap: {},
  },
  {
    id: 'bag_a',
    name: '帆布包·一片式',
    path: 'models/products/bag_a.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '帆布包 · 一片式 —— 正反两面都能贴图（可以各贴一张），侧边与提手为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点包的正面或背面', defaultColor: '#ffffff' }],
    regions: BAG_A_REGIONS,
    finish: 'fabric',
    explodeMap: {},
  },
  {
    id: 'bag_b',
    name: '帆布包·托特',
    path: 'models/products/bag_b.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '帆布包 · 托特 —— 正反两面各有一块矩形打印区（可以各贴一张），侧边与提手为保留部位',
    materials: [{ id: 'print_area', name: '整体配色', description: '整体配色；贴图请点包的正面或背面', defaultColor: '#ffffff' }],
    regions: BAG_REGIONS,
    finish: 'fabric',
    explodeMap: {},
  },
  {
    id: 'fan_b',
    name: '扇子·团扇',
    path: 'models/products/fan_b.glb',
    loader: 'gltf',
    colorMode: 'body',
    description: '扇子 · 团扇 —— 只有中间那块白绢扇面可贴图（绢丝质感，正反两面同时呈现图案）；'
      + '木质扇框与竹柄保留模型自带的木纹材质',
    materials: [{ id: 'print_area', name: '扇面配色', description: '白绢扇面的底色；贴图请点扇面或直接选部位', defaultColor: '#ffffff' }],
    regions: FAN_B_REGIONS,
    // 扇框与竹柄：**原样保留模型自带的木纹贴图与材质数值**，网页端一律不碰
    keepOriginalParts: ['body'],
    // 白绢面单独给「绢丝」档（细密织纹 + 柔和丝光）。不写顶层 finish 是有意的：
    // 这个商品只有绢面一处可改，质感定死在「绢」，于是面板上就不出现质感选择器，
    // 用户不会误把它调成陶瓷釉面。
    partFinishes: { face: 'silk' },
    explodeMap: {},
  },
]

/**
 * 下拉框（ModelSelector）读的就是这个数组，9 条配置会自动出现，不需要改 UI。
 * 想同时保留底座示例模型时改成：[...LEGACY_PRESETS, ...WENCHUANG_PRESETS]
 */
export const MODEL_PRESETS: ModelPreset[] = [...WENCHUANG_PRESETS]
