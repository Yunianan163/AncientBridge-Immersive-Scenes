/**
 * config.js — 全局配置
 *
 * 所有可调参数集中在此，后续调优、换模型只改这一个文件。
 * 场景相关的数值来自 tools/inspect_ply.py 对 scene.ply 的实测（已剔除飞点）。
 */

export const CONFIG = {

    /* ------------------------------------------------------------------ 模型 */
    model: {
        // 相对路径，换任何静态服务器都能直接跑
        url: './models/scene.ply',
        name: '葛镜桥',
        file: 'scene.ply',

        // 实测统计（inspect_ply.py 输出）
        stats: {
            points: 2825198,      // 2,825,198 个高斯点
            fileSizeMB: 247.88,
            shDegree: 1,
            bytesPerPoint: 92,
        },

        // 剔除 0.5% / 99.5% 飞点后的有效包围盒（**资产自身坐标系**，未修正）
        bounds: {
            min: [-0.843, -0.205, -0.547],
            max: [1.639, 0.258, 1.419],
        },
        span: 2.481,              // 最大跨度，取景与相机距离都按它推算
        // 世界坐标系下的中心由 bounds + orientationDeg 自动算出，见 viewer.js
        // （不再手写，避免改了旋转却忘了改中心）

        /* ---------------- 资产坐标系 → 世界坐标系的修正旋转 ----------------
         * 单位：度，XYZ 欧拉序；作用在整棵泼溅模型上（DropInViewer 是 Group）。
         *
         * scene.ply 的竖直轴指向 **-Y**，也就是模型上下颠倒了，需要绕 X 轴转 180°。
         * 这个结论不是靠肉眼猜的，来自两项互相独立的测量（详见 README「坐标系」）：
         *
         *   1) 用 Spirula 的 SfM 稀疏重建解出 1378 个相机位姿，
         *      统计「相机是否位于其正下方地面之上」：
         *          上 = +Z → 98.32%        上 = -Z → 11.98%
         *      两组重建（模型1 / 模型2）独立给出一致答案：SfM 世界坐标系上方向 = +Z。
         *
         *   2) 把 SfM 点云与 scene.ply 分别投影成俯视轮廓图做互相关，
         *      只有 ply = (x, -z, y) 能对上（IoU 0.689，另一种候选仅 0.166）。
         *      即 ply_y = -z_sfm。
         *
         * 把 2) 代入 1)：SfM 里 +Z 是上 → PLY 里 ply_y 为负 → 资产竖直轴 = -Y。
         * 绕 X 轴转 180° 后 (x,y,z) → (x,-y,-z)，正好还原成标准的 Z-up → Y-up 变换。 */
        orientationDeg: [180, 0, 0],
    },

    /* ------------------------------------------------------------------ 相机 */
    camera: {
        fov: 60,
        near: 0.01,               // 场景本身很小，近平裁剪面必须足够近
        far: 500,
        up: [0, 1, 0],            // 世界坐标系的竖直轴（模型已在加载时被摆正）
        // 兜底机位（无人机模块未启用时使用）
        startOffset: [1.15, 1.20, 1.50],
        minDistance: 0.05,
        maxDistance: 40,
    },

    /* ---------------------------------------------------------------- 渲染器 */
    renderer: {
        antialias: false,         // 高斯泼溅自带软边，开抗锯齿只会拖慢帧率
        maxPixelRatio: 1.5,       // 限制高 DPI 屏幕的渲染分辨率，避免帧率崩塌
        clearColor: 0x0a0d13,
    },

    /* ------------------------------------------------------------ 泼溅渲染参数 */
    splat: {
        // PLY 里没有真实 alpha 通道，此阈值用于丢弃接近透明的噪点（0-255）
        alphaRemovalThreshold: 5,

        // 球谐阶数，必须与实际数据匹配：本模型为 degree 1（9 个 f_rest 系数）
        // 0 = 只保留基础色（更快），1/2 = 保留视角相关的光泽变化
        sphericalHarmonicsDegree: 1,

        // 焦距微调系数。官方注释：场景尺寸小、高斯小的时候调大可提升清晰度
        focalAdjustment: 1.0,

        // 单个高斯的屏幕投影上限，防止贴脸时出现巨大色块
        maxScreenSpaceSplatSize: 512,

        // 内存中不做二次压缩：换取更快的加载与更低的 CPU 开销
        inMemoryCompressionLevel: 0,

        /* ---------------------------------------------------- 高光压白（治泛白）
         * 崖壁上大片泛白不是天空盒/色调映射造成的（?sky=0 对比已实证），
         * 而是重建数据的固有色：石灰岩崖壁反光 + 训练影像里过曝区域的白色高斯。
         * 这里在泼溅着色器输出前做一个「高光滚降 + 暖化」：亮度超过阈值的
         * 低饱和白斑被轻微压暗并偏向土黄色，视觉上融入山体，全场景不过曝。
         * ?tame=0 可临时关闭对比效果。 */
        highlightTame: {
            threshold: 0.62,        // 起始亮度（0-1，低于它不动）
            ceiling: 0.92,          // 全量生效亮度
            dim: 0.86,              // 高光压暗系数
            tint: [0.96, 0.86, 0.72], // 高光暖色（土黄方向，乘性）
            mix: 0.9,               // 压暖强度
        },

        // 加载后重排内存布局提升缓存命中率
        optimizeSplatData: true,

        // 是否存在不需要的中间数据释放。保留（false）便于后续交互复用原始数据
        freeIntermediateSplatData: false,

        /* -------------------------------------------------------------- 加速开关 */
        // GPU 排序：实测在本机（RTX 5070 Laptop + ANGLE/D3D11）开启后，整个场景
        // 会渲染不出来 —— 画面只剩清屏色，控制台却没有任何报错，极难排查。
        // 关闭后改用 CPU + SIMD 排序，282 万点在 1080p 下依然稳定 60 FPS，
        // 所以这里默认关闭。想验证差异可以加 URL 参数 ?gpusort=1 对比。
        gpuAcceleratedSort: false,

        // Worker 共享内存：实测对渲染结果无影响，开启可降低排序时的数据拷贝开销
        // 需要页面处于跨源隔离状态（由服务器的 COOP / COEP 响应头决定）
        sharedMemoryForWorkers: true,

        // 库的日志级别：0=关闭 1=错误 2=警告 3=信息 4=调试
        logLevel: 0,
    },

    /* ------------------------------------------------------------------ 控制 */
    controls: {
        autoRotateSpeed: 0.6,
        dampingFactor: 0.08,
        zoomSpeed: 0.9,
        panSpeed: 1.0,
    },

    /* ------------------------------------------------------ 环境：天空 */
    environment: {
        // 天空总开关（?sky=0 可临时关闭，用于对比调参）
        enabled: true,

        sky: {
            // Preetham 大气参数：turbidity 越高越浑浊（阴天感）
            turbidity: 6.0,
            rayleigh: 1.4,           // 瑞利散射强度：蓝天饱和度
            mieCoefficient: 0.004,   // 米氏散射：太阳周围的雾霭光晕
            mieDirectionalG: 0.85,

            // 太阳位置（角度制）。elevation 低一些 = 傍晚/清晨的暖光，
            // 水面高光更长更好看。
            elevationDeg: 28,
            azimuthDeg: 145,

            // ACES 色调映射曝光（只影响天空，泼溅着色器不经此通道）
            exposure: 0.62,

            /* 顶部天空穹顶：天空只在模型上方渲染（半球几何 + 地平线淡出），
             * 飞出场景从外面看时，下方是深色空间而不是一整片白茫茫。
             * fadeStart / fadeEnd 是淡出带的两端（相对穹顶的水平面高度，
             * 1 = 正上方，0 = 地平线，负 = 水平面以下）。 */
            dome: {
                enabled: true,
                fadeStart: 0.20,     // 高于此值 → 完整天空（仰角约 11.5° 以上见天）
                fadeEnd: -0.04,      // 低于此值 → 完全淡入背景色（再低会切掉河谷里的天空）
            },

            /* 下半暗穹：模型底下的「砚底盘」。与上穹在水平线附近相接，
             * 颜色从背景色渐变到更深的墨色，正下方最深 —— 从外面或下面
             * 看时模型像一方搁在砚台上的印章，而不是悬空。 */
            underDome: {
                enabled: true,
                topColor: 0x0a0d13,   // 与背景色一致，接缝无痕
                bottomColor: 0x040507, // 正下方的深墨色
            },
        },

        /* 水面（three 官方 Water 平面反射）已按要求暂时移除。
         * 实现与调参记录（level=-0.095 / distortionScale=0.015 /
         * reflectionDim=0.72 等）保留在 git 历史里，随时可以恢复。 */
    },

    /* ---------------------------------------------------------- 无人机飞行 */
    drone: {
        enabled: true,

        /* 开场镜头：东岸河面仰望主拱 —— 进页面第一眼就是这个机位。
         * 机位经无头浏览器逐点投影校准：桥横贯画面、水平居中、
         * 桥带落在画面上部 1/3（与参考构图一致），水面占下半幅。 */
        introView: {
            camera: [0.26, -0.048, 0.24],
            target: [-0.02, 0.05, 0.0],
        },

        /* 自由飞行参数（WASD 移动 / Q E 升降 / Shift 加速 / 拖动转向） */
        speed: 0.08,             // 基准巡航速度（场景单位/秒，≈9 m/s @115m/单位）
        fastMultiplier: 2.5,     // 按住 Shift 的加速倍率
        minAltitude: -0.08,      // 最低高度（河床大约在 -0.1 以下，别钻进去）
        maxAltitude: 2.5,        // 最高高度（≈290 米，足够俯瞰全河谷）
    },
};

/* ------------------------------------------------------------------ 调试开关
 * 支持用 URL 参数临时覆盖上面的配置，方便快速对比不同参数的效果，例如：
 *   ?rot=0,0,0    取消模型朝向修正（可复现「上下颠倒」的现象）
 *   ?rot=180,0,0  默认值：把上下颠倒的模型摆正
 *   ?sh=0         关闭球谐，只保留基础色
 *   ?gpusort=0    关闭 GPU 排序
 *   ?shmem=0      关闭 Worker 共享内存
 *   ?alpha=25     提高噪点剔除阈值
 *   ?focal=1.5    调整焦距系数
 *   ?log=4        打开渲染库的调试日志
 */
(function applyUrlOverrides() {
    if (typeof location === 'undefined' || !location.search) return;

    const q = new URLSearchParams(location.search);
    const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
    const bool = (k) => (q.has(k) ? !['0', 'false'].includes(String(q.get(k)).toLowerCase()) : undefined);

    // 模型朝向修正：?rot=180,0,0
    if (q.has('rot')) {
        const parts = String(q.get('rot')).split(',').map((s) => Number(s.trim()));
        if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
            CONFIG.model.orientationDeg = parts;
        }
    }

    const s = CONFIG.splat;
    const setNum = (v, key) => {
        if (v !== undefined && !Number.isNaN(v)) s[key] = v;
    };

    setNum(num('sh'), 'sphericalHarmonicsDegree');
    setNum(num('alpha'), 'alphaRemovalThreshold');
    setNum(num('focal'), 'focalAdjustment');
    setNum(num('log'), 'logLevel');
    setNum(num('maxsize'), 'maxScreenSpaceSplatSize');

    const gpuSort = bool('gpusort');
    if (gpuSort !== undefined) s.gpuAcceleratedSort = gpuSort;

    const shmem = bool('shmem');
    if (shmem !== undefined) s.sharedMemoryForWorkers = shmem;

    // 天空开关：?sky=0 关闭天空（对比调参用）
    const sky = bool('sky');
    if (sky !== undefined) CONFIG.environment.enabled = sky;

    // 高光压白开关：?tame=0 关闭（对比调参用）
    const tame = bool('tame');
    if (tame !== undefined && !tame) s.highlightTame = null;
})();
