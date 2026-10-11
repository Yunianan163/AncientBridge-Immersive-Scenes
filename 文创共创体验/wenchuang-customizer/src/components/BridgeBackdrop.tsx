/**
 * 古风装饰层 —— 「双桥记」的长卷
 *
 * 画面底部长卷上并置了两座桥，是整个主题的视觉落点：
 *
 *   左 · 周庄双桥（明万历，苏州昆山）
 *     世德桥是**石拱桥**（东西向，跨南北市河），半圆拱洞向上鼓、落在水面上；
 *     永安桥是**石梁桥**（南北向，跨银子浜口），方洞、平梁。
 *     一圆一方、一横一竖交叉，正是俗称「钥匙桥」的钥匙形。
 *
 *   右 · 葛镜桥（明万历，贵州福泉）
 *     **二墩三孔**石拱桥，变截面圆弧**尖拱**（拱顶收成一个尖）；
 *     「桥在绝壁之上起拱，借江心一礁石下脚」——
 *     所以两墩底下各压一块礁石，两岸是断续崖壁。
 *
 * ⚠️ 构图必须收在「画布真正露出来的那一条」里，否则两座桥会被面板盖掉：
 *      左侧「配色」面板固定 280px、右侧工作台固定 350px，
 *      在 1440 宽下换算成 viewBox 坐标，可见区只有 **x ≈ 294 ~ 846**；
 *      1280 宽时是 319 ~ 814。所以两桥全部排在 **x 320 ~ 820** 之间，
 *      这条带子以外只放远山、崖壁、水波这些「裁掉也不可惜」的东西。
 *      竖向同理：全部压在 y ≥ 62，超宽屏（2560）从顶部裁下来也切不到主体。
 *
 * ⚠️ preserveAspectRatio 用 slice（不是 meet）：meet 在宽屏下会按高度收缩、
 *    左右留出空白，水波就断了；slice 永远铺满宽度，代价只是超宽屏裁掉一点顶部。
 */

/** 明式回纹角饰（左上角，右侧靠 scaleX(-1) 镜像一份） */
function CornerFret() {
  return (
    <svg viewBox="0 0 92 92" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
      <path d="M4 4H56V16H16V44H44V30H30" />
      <path d="M4 12H48V22H26V38H38" strokeWidth="1" strokeOpacity="0.7" />
    </svg>
  )
}

/** 底部水墨长卷 */
function Scroll() {
  return (
    <svg
      viewBox="0 0 1200 200"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        {/* 水波：规则排列的鱼鳞式波纹，正是传统水纹的画法 */}
        <pattern id="bwb-wave" width="72" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 9q18-7 36 0t36 0" strokeWidth="1.3" strokeOpacity="0.8" />
          <path d="M-36 18q18-7 36 0t36 0" strokeWidth="1.1" strokeOpacity="0.45" />
        </pattern>
        {/* 麻条石桥栏：等距短竖线 */}
        <pattern id="bwb-rail" width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M4.5 0V9" strokeWidth="1.5" strokeOpacity="0.9" />
        </pattern>
      </defs>

      {/* ================================================================ 远山 */}
      <path
        d="M0 92 L70 68 L116 86 L168 64 L214 90 L268 72 L316 92 L372 66 L424 88 L478 70
           L530 92 L584 68 L640 88 L696 72 L748 92 L804 66 L856 88 L908 70 L962 92
           L1016 68 L1068 90 L1122 70 L1176 92 L1200 82"
        strokeWidth="1.1"
        strokeOpacity="0.3"
      />

      {/* ==================================================================
          左半 · 周庄双桥（钥匙形）
          世德桥 = 圆拱桥，东西向；永安桥 = 石梁桥，南北向，在 x≈520 交叉
          ================================================================== */}

      {/* 河东民居：黛瓦硬山 + 马头墙 */}
      <g strokeWidth="1.4" strokeOpacity="0.9">
        <path d="M330 104 V90 H338 V80 H346 V90 H354 V104" />
        <path d="M322 88 L366 76 L410 88" />
        <path d="M300 104 H400" strokeOpacity="0.45" />
        <path d="M342 104 V126 M396 104 V126" strokeOpacity="0.55" />
      </g>
      {/* 垂柳 */}
      <g strokeWidth="1.2" strokeOpacity="0.7">
        <path d="M420 104 C416 128 424 146 418 166" />
        <path d="M428 104 C432 126 424 144 432 162" />
        <path d="M436 104 C434 124 440 140 436 156" />
      </g>

      {/* 世德桥 —— 石拱桥：半圆拱洞落在水面、向上鼓，桥台把桥面顶起来 */}
      <g strokeWidth="1.8">
        <path d="M388 98 H548" />
        <path d="M412 148 A36 36 0 0 1 484 148" />
        <path d="M412 148 V98 M484 148 V98" strokeWidth="1.5" strokeOpacity="0.85" />
        {/* 石阶引桥，伸入街巷 */}
        <path d="M388 98 L364 110 M402 98 V106 M534 98 V106 M548 98 L568 108"
              strokeWidth="1.3" strokeOpacity="0.65" />
      </g>
      {/* 麻条石桥栏 */}
      <path d="M390 88 H546" strokeWidth="1.8" />
      <rect x="394" y="88" width="148" height="9" fill="url(#bwb-rail)" stroke="none" />

      {/* 永安桥 —— 石梁桥：平梁 + 方洞，与世德桥交叉成钥匙形 */}
      <g strokeWidth="1.8">
        <path d="M508 98 H584" />
        <path d="M522 98 V148 H568 V98" strokeWidth="1.5" strokeOpacity="0.85" />
      </g>
      <path d="M510 88 H582" strokeWidth="1.8" />
      <rect x="514" y="88" width="64" height="9" fill="url(#bwb-rail)" stroke="none" />

      {/* ==================================================================
          右半 · 葛镜桥（二墩三孔 · 尖拱 · 绝壁借礁）
          ================================================================== */}

      {/* 两桥之间：坡岸 + 桥头石碑（张鹤鸣《葛镜桥碑记》所立之处） */}
      <path d="M548 186 L580 168 L604 150 L616 140" strokeWidth="1.3" strokeOpacity="0.5" />
      <g strokeWidth="1.3" strokeOpacity="0.8">
        <path d="M594 148 V124 H610 V148" />
        <path d="M588 148 H616" />
        <path d="M598 130 H606 M598 136 H606" strokeWidth="1" strokeOpacity="0.55" />
      </g>

      {/* 桥面（起拱）+ 上层栏杆 */}
      <path d="M620 108 Q720 94 820 108" strokeWidth="2" />
      <path d="M626 98 Q720 84 814 98" strokeWidth="1.2" strokeOpacity="0.6" />

      {/* 三孔尖拱 —— 变截面圆弧尖拱：每孔由**两段圆弧**在拱顶交出一个尖，
          外面再套一道内弧线，就是石拱桥的「拱券」厚度。中孔最高。
          ⚠️ 别用单个 Q 曲线：那样拱顶太尖、拱侧近乎直线，看着像帐篷不像桥。 */}
      <g strokeWidth="1.8">
        <path d="M632 152 A19 19 0 0 1 652 126 A19 19 0 0 1 672 152" />
        <path d="M688 152 A30 30 0 0 1 720 114 A30 30 0 0 1 752 152" />
        <path d="M768 152 A19 19 0 0 1 788 126 A19 19 0 0 1 808 152" />
      </g>
      {/* 拱券内圈 */}
      <g strokeWidth="1.1" strokeOpacity="0.5">
        <path d="M638 152 A14 14 0 0 1 652 132 A14 14 0 0 1 666 152" />
        <path d="M695 152 A25 25 0 0 1 720 120 A25 25 0 0 1 745 152" />
        <path d="M774 152 A14 14 0 0 1 788 132 A14 14 0 0 1 802 152" />
      </g>

      {/* 两端桥台 */}
      <path d="M620 108 V150 M820 108 V150" strokeWidth="1.5" strokeOpacity="0.8" />

      {/* 二墩 —— 借江心礁石下脚 */}
      <g strokeWidth="1.5">
        <path d="M674 102 V148 M686 102 V148" />
        <path d="M662 148 L698 148 L706 158 L654 158 Z" strokeWidth="1.3" />
        <path d="M754 102 V148 M766 102 V148" />
        <path d="M742 148 L778 148 L786 158 L734 158 Z" strokeWidth="1.3" />
      </g>

      {/* 两岸崖壁（两桥之外唯一的差异：这里不是水乡，是峡谷） */}
      <g strokeWidth="1.3" strokeOpacity="0.55">
        <path d="M470 186 L516 172 L556 158 L590 146 L614 138" />
        <path d="M826 138 L856 148 L886 136 L916 156 L950 146 L984 164 L1018 156 L1054 174 L1090 166 L1126 184 L1164 176 L1200 190" strokeOpacity="0.42" />
      </g>

      {/* 山岚 */}
      <g strokeWidth="1.1" strokeOpacity="0.28">
        <path d="M486 132 H546 M498 142 H566" />
        <path d="M1082 128 H1146" />
      </g>

      {/* ---------------------------------------------------------------- 江面 */}
      <rect x="0" y="152" width="1200" height="48" fill="url(#bwb-wave)" stroke="none" />
      {/* 倒影：两桥都映在水里 */}
      <g strokeWidth="1" strokeOpacity="0.26">
        <path d="M646 162 q12 6 24 0" />
        <path d="M686 170 q16 6 32 0" />
        <path d="M776 162 q12 6 24 0" />
        <path d="M432 166 q16 6 32 0" />
        <path d="M532 170 q14 6 28 0" />
      </g>
    </svg>
  )
}

export function BridgeBackdrop() {
  return (
    <div className="bridge-backdrop" role="presentation" aria-hidden="true">
      <div className="bridge-corner is-left">
        <CornerFret />
      </div>
      <div className="bridge-corner is-right">
        <CornerFret />
      </div>
      <div className="bridge-scroll">
        <Scroll />
      </div>
      <div className="bridge-caption">
        <span>明萬曆間 · 周莊雙橋 一圓一方</span>
        <span className="bridge-caption-sep">·</span>
        <span>平越葛鏡 三毀三建 三孔凌虛</span>
      </div>
    </div>
  )
}
