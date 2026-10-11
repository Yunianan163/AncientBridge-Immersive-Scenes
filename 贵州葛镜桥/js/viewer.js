/**
 * viewer.js — 三维场景核心
 *
 * 设计取舍：
 *   没有使用库自带的 Viewer（它自带相机、渲染器与 UI，难以二次扩展），
 *   而是使用 DropInViewer —— 它本质是一个 THREE.Group，可以塞进我们自己的
 *   Three.js 场景里。这样天空、水面、无人机航线这类扩展都有了落脚点。
 *
 * 场景组成：
 *   · 高斯泼溅模型（DropInViewer）
 *   · 环境：Preetham 天空（js/environment.js）
 *   · 无人机自由飞行控制（js/drone.js）
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as GS3D from '@mkkellogg/gaussian-splats-3d';
import { CONFIG } from './config.js';
import { Environment } from './environment.js';
import { DronePilot } from './drone.js';

export class SplatViewer {

    constructor(canvas) {
        this.canvas = canvas;

        this.clock = new THREE.Clock();
        this._running = false;
        this._rafId = null;
        this._fpsFrames = 0;
        this._fpsAccum = 0;
        this.fps = 0;
        this._stage = 'init';

        // 视口尺寸（由 ResizeObserver 维护）
        this._width = 1;
        this._height = 1;

        // 外部回调
        this.onStats = null;
        this.onDroneStateChange = null;

        this.loadInfo = {
            ms: 0,
            splatCount: 0,
        };

        this.capabilities = {
            webgl2: false,
            gpuSortCapable: false,
            sharedMemoryCapable: false,
            gpuSort: false,
            sharedMemory: false,
        };

        // 模型朝向修正 + 由此推出的世界坐标系场景中心
        this._setupOrientation();

        // 环境（天空/水面）与无人机巡航
        this.environment = null;
        this.drone = null;
    }

    /**
     * 建立「资产坐标系 → 世界坐标系」的修正旋转。
     *
     * scene.ply 是上下颠倒的（竖直轴指向 -Y，推导过程见 config.js 的注释），
     * 所以这里绕 X 轴转 180° 把模型摆正。旋转作用在整个 DropInViewer 上，
     * 它本身就是一个 THREE.Group，改它的 rotation 即可带动内部所有高斯。
     *
     * 场景中心也一并按同一个旋转换算，避免「改了朝向却忘了改中心」。
     */
    _setupOrientation() {
        const [rx, ry, rz] = CONFIG.model.orientationDeg || [0, 0, 0];
        this.modelOrientation = new THREE.Euler(
            THREE.MathUtils.degToRad(rx),
            THREE.MathUtils.degToRad(ry),
            THREE.MathUtils.degToRad(rz),
            'XYZ',
        );

        const { min, max } = CONFIG.model.bounds;
        const assetCenter = new THREE.Vector3(
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
        );
        this.modelCenter = assetCenter.applyEuler(this.modelOrientation);
    }

    /** 把资产坐标系下的点换算到世界坐标系 */
    assetToWorld(x, y, z) {
        return new THREE.Vector3(x, y, z).applyEuler(this.modelOrientation);
    }

    /* ==================================================================== 初始化 */

    init() {
        this._createRenderer();
        this._createScene();
        this._createCamera();
        this._probeCapabilities();
        this._createSplatViewer();
        this._bindResize();

        this._stage = 'ready';
        return this;
    }

    _createRenderer() {
        const cfg = CONFIG.renderer;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: cfg.antialias,
            alpha: false,
            stencil: false,
            depth: true,
            powerPreference: 'high-performance',
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio));
        this.renderer.setClearColor(cfg.clearColor, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // ACES 色调映射在 environment.init() 里开启（只影响天空/水面材质）
    }

    _createScene() {
        this.scene = new THREE.Scene();

        // 高斯模型、天空、水面之外的东西（调试标记等）挂在这里统一管理
        this.helpers = new THREE.Group();
        this.helpers.name = 'helpers';
        this.scene.add(this.helpers);
    }

    _createCamera() {
        const cfg = CONFIG.camera;

        this.camera = new THREE.PerspectiveCamera(cfg.fov, 1, cfg.near, cfg.far);
        this.camera.up.set(cfg.up[0], cfg.up[1], cfg.up[2]);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = CONFIG.controls.dampingFactor;
        this.controls.zoomSpeed = CONFIG.controls.zoomSpeed;
        this.controls.autoRotateSpeed = CONFIG.controls.autoRotateSpeed;
        this.controls.minDistance = cfg.minDistance;
        this.controls.maxDistance = cfg.maxDistance;
        this.controls.screenSpacePanning = true;
        this.controls.autoRotate = false;

        // 禁止相机钻到地面以下（Y 为竖直轴）
        this.controls.maxPolarAngle = Math.PI * 0.98;

        this.resetCamera();
    }

    /** 探测运行环境能力，并记录最终实际启用的加速项 */
    _probeCapabilities() {
        const scfg = CONFIG.splat;
        const gl = this.renderer.getContext();
        const webgl2 = this.renderer.capabilities.isWebGL2;

        // GPU 排序需要 WebGL2 的浮点渲染目标
        const floatRT = !!gl.getExtension('EXT_color_buffer_float');

        // Worker 共享内存（SharedArrayBuffer）要求页面处于跨源隔离状态，
        // 由服务器的 COOP / COEP 响应头决定
        const isolated = typeof self !== 'undefined' && self.crossOriginIsolated === true;

        this.capabilities = {
            webgl2,
            // 硬件是否具备条件（用于提示，不代表会启用）
            gpuSortCapable: webgl2 && floatRT,
            sharedMemoryCapable: isolated,
            // 实际启用的加速项（配置 + 硬件能力取交集）
            gpuSort: scfg.gpuAcceleratedSort && webgl2 && floatRT,
            sharedMemory: scfg.sharedMemoryForWorkers && isolated,
        };
    }

    _createSplatViewer() {
        const scfg = CONFIG.splat;
        const cap = this.capabilities;

        this.viewer = new GS3D.DropInViewer({
            // 排序加速
            gpuAcceleratedSort: scfg.gpuAcceleratedSort && cap.gpuSort,
            sharedMemoryForWorkers: scfg.sharedMemoryForWorkers && cap.sharedMemory,
            enableSIMDInSort: true,

            // 渲染质量
            sphericalHarmonicsDegree: scfg.sphericalHarmonicsDegree,
            focalAdjustment: scfg.focalAdjustment,
            maxScreenSpaceSplatSize: scfg.maxScreenSpaceSplatSize,
            inMemoryCompressionLevel: scfg.inMemoryCompressionLevel,
            optimizeSplatData: scfg.optimizeSplatData,
            freeIntermediateSplatData: scfg.freeIntermediateSplatData,

            // 我们自己驱动渲染循环
            selfDrivenMode: false,

            logLevel: scfg.logLevel,
        });

        // 摆正模型朝向（详见 _setupOrientation / config.js 的注释）
        this.viewer.rotation.copy(this.modelOrientation);

        this.scene.add(this.viewer);
    }

    _bindResize() {
        this._onResize = this._onResize.bind(this);
        window.addEventListener('resize', this._onResize);

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(this._onResize);
            this._ro.observe(this.canvas);
        }

        this._onResize();
    }

    _onResize() {
        const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
        const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);

        this._width = w;
        this._height = h;

        this.renderer.setSize(w, h, false);   // false: 尺寸交给 CSS 控制
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /* ================================================================ 模型加载 */

    /**
     * 加载高斯泼溅模型。
     * @param {(info: {percent:number, label:string, phase:string}) => void} onProgress
     * @returns {Promise<number>} 耗时（毫秒）
     */
    async loadModel(onProgress) {
        const scfg = CONFIG.splat;
        const t0 = performance.now();

        const emit = (percent, label, phase) => {
            if (typeof onProgress !== 'function') return;
            onProgress({ percent, label, phase });
        };

        emit(0, '0%', 'download');

        await this.viewer.addSplatScene(CONFIG.model.url, {
            splatAlphaRemovalThreshold: scfg.alphaRemovalThreshold,
            sphericalHarmonicsDegree: scfg.sphericalHarmonicsDegree,
            showLoadingUI: false,          // 用我们自己的加载界面
            progressiveLoad: false,        // PLY 不支持渐进加载
            onProgress: (percent, label, status) => {
                // LoaderStatus: 0 = Downloading（有真实百分比）
                //               1 = Processing （下载完成后解析，先回调 0% 再回调 100%）
                //               2 = Done
                const phase = (status === 1 || status === 2) ? 'parse' : 'download';
                emit(percent, label, phase);
            },
        });

        this.loadInfo.ms = performance.now() - t0;
        this.loadInfo.splatCount = this.splatCount;

        this._applyHighlightTame();

        this._stage = 'loaded';
        return this.loadInfo.ms;
    }

    /**
     * 高光压白：在泼溅 fragment shader 输出前做「高光滚降 + 暖化」。
     * 背景：崖壁泛白是重建数据固有色（石灰岩反光 + 过曝白色高斯），
     * 不是天空盒造成（?sky=0 对比实证）。这里把高亮低饱和的白斑
     * 轻微压暗并偏向土黄，视觉上融入山体。参数见 config.splat.highlightTame。
     */
    _applyHighlightTame() {
        const cfg = CONFIG.splat.highlightTame;
        if (!cfg) return;

        const materials = Array.isArray(this.viewer?.viewer?.splatMesh?.material)
            ? this.viewer.viewer.splatMesh.material
            : [this.viewer?.viewer?.splatMesh?.material];

        const [tr, tg, tb] = cfg.tint;
        // 注入片段：亮度超过 threshold 的部分逐步压暗 dim 倍并乘上暖色
        const inject = `
                float _lum = dot(color, vec3(0.299, 0.587, 0.114));
                float _hi = smoothstep(${cfg.threshold.toFixed(3)}, ${cfg.ceiling.toFixed(3)}, _lum) * ${cfg.mix.toFixed(3)};
                color = mix(color, color * vec3(${tr}, ${tg}, ${tb}) * ${cfg.dim.toFixed(3)}, _hi);
`;

        let patched = 0;
        for (const mat of materials) {
            if (!mat || !mat.fragmentShader || !mat.fragmentShader.includes('vec3 color = vColor.rgb;')) continue;
            mat.fragmentShader = mat.fragmentShader.replace(
                'vec3 color = vColor.rgb;',
                'vec3 color = vColor.rgb;\n' + inject,
            );
            mat.needsUpdate = true;
            patched++;
        }
        if (patched === 0) console.warn('[Viewer] 高光压白：未找到泼溅着色器注入点（库版本变更?）');
    }

    /** 实际参与渲染的高斯点数量 */
    get splatCount() {
        try {
            const mesh = this.viewer && this.viewer.viewer && this.viewer.viewer.splatMesh;
            if (mesh && typeof mesh.getSplatCount === 'function') {
                const n = mesh.getSplatCount();
                if (n > 0) return n;
            }
        } catch (e) { /* 忽略，回退到静态统计值 */ }
        return CONFIG.model.stats.points;
    }

    /* ============================================================== 环境与无人机 */

    /**
     * 初始化天空。失败直接抛出 —— 天空是本页核心效果，
     * 缺了它宁可报错也不静默降级。
     */
    async initEnvironment() {
        this.environment = new Environment(this.scene, this.renderer);
        this.environment.init();
        return true;
    }

    /** 初始化无人机自由飞行控制 */
    initDrone() {
        if (!CONFIG.drone || !CONFIG.drone.enabled) return false;
        this.drone = new DronePilot(this.camera, this.controls, this.renderer.domElement);
        this.drone.onStateChange = (on) => {
            if (typeof this.onDroneStateChange === 'function') this.onDroneStateChange(on);
        };
        return true;
    }

    get droneActive() {
        return !!(this.drone && this.drone.active);
    }

    /* ================================================================ 相机控制 */

    /**
     * 重置到开场机位：河面上游望向主拱（config.js → drone.introView）。
     * 没有配置无人机时回退到「框住整个场景」的取景。
     */
    resetCamera() {
        const iv = CONFIG.drone && CONFIG.drone.enabled && CONFIG.drone.introView;
        if (iv && iv.camera && iv.target) {
            this.camera.position.set(iv.camera[0], iv.camera[1], iv.camera[2]);
            this.controls.target.set(iv.target[0], iv.target[1], iv.target[2]);
            this.controls.update();
            return;
        }

        const c = this.modelCenter;
        const [ox, oy, oz] = CONFIG.camera.startOffset;
        const dir = new THREE.Vector3(ox, oy, oz).normalize();
        const dist = this._fitDistance();

        this.controls.target.copy(c);
        this.camera.position.copy(c).addScaledVector(dir, dist);
        this.controls.update();
    }

    /** 让相机保持当前观察方向，只调整距离以完整容纳场景 */
    frameScene() {
        const c = this.modelCenter;

        const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (dir.lengthSq() < 1e-9) dir.set(1, 0.7, 1.2);
        dir.normalize();

        const dist = this._fitDistance();
        this.controls.target.copy(c);
        this.camera.position.copy(c).addScaledVector(dir, dist);
        this.controls.update();
    }

    /**
     * 计算「刚好框住整个场景」所需的相机距离。
     * 取垂直/水平视场角中较小的那个来算，保证两个方向都装得下。
     */
    _fitDistance() {
        const radius = CONFIG.model.span * 0.58;
        const vFov = THREE.MathUtils.degToRad(CONFIG.camera.fov);
        const aspect = Math.max(this.camera.aspect || 1, 0.05);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

        const need = radius / Math.sin(Math.min(vFov, hFov) / 2);
        return THREE.MathUtils.clamp(need, CONFIG.camera.minDistance, CONFIG.camera.maxDistance);
    }

    setAutoRotate(on) {
        this.controls.autoRotate = !!on;
    }

    get autoRotate() {
        return this.controls.autoRotate;
    }

    /** 运行时切换球谐阶数：0 = 基础色（更快），1/2 = 视角相关光泽（更真） */
    setSphericalHarmonicsDegree(deg) {
        try {
            this.viewer.setActiveSphericalHarmonicsDegrees(deg);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 射线检测：把屏幕上的一个像素换成场景里的三维坐标。
     *
     * 高斯泼溅没有网格表面，没法用 THREE.Raycaster 直接打中，必须用渲染库
     * 自带的 Raycaster（它按高斯的包围盒树做球体求交）。命中的点在返回前已经
     * 被左乘了 splatMesh.matrixWorld，所以是**世界坐标系**下的坐标，可以直接用。
     *
     * 坐标约定：px/py 以画布左上角为原点、单位为 CSS 像素（与 DOM 事件一致）。
     *
     * @returns {{point: THREE.Vector3, normal: THREE.Vector3, distance: number} | null}
     */
    pickAtScreen(px, py) {
        const inner = this.viewer && this.viewer.viewer;
        const mesh = inner && inner.splatMesh;
        if (!inner || !mesh || typeof inner.raycaster.intersectSplatMesh !== 'function') return null;

        // 矩阵必须是最新的，否则射线用了上一帧的相机位姿
        this.camera.updateMatrixWorld();

        inner.raycaster.setFromCameraAndScreenPosition(
            this.camera,
            { x: px, y: py },
            { x: this._width, y: this._height },
        );

        const hits = [];
        inner.raycaster.intersectSplatMesh(mesh, hits);
        if (!hits.length) return null;

        const hit = hits[0];
        return {
            // hit.origin 已经被库换算到世界坐标系，直接克隆即可
            point: hit.origin.clone(),
            normal: hit.normal ? hit.normal.clone().normalize() : new THREE.Vector3(0, 1, 0),
            distance: hit.distance,
        };
    }

    /* ================================================================== 截图 */

    /**
     * 抓当前画面，返回 PNG dataURL。
     *
     * 为什么不直接 canvas.toDataURL()：
     *   我们的 WebGLRenderer 建的时候没开 preserveDrawingBuffer（Three.js 默认 false）。
     *   这类上下文在帧提交之后，绘制缓冲区随时可能被清掉；等到用户点击时再去读，
     *   拿到的多半是一张全黑图。所以在同一次调用里先同步补渲染一帧、紧接着就读像素 ——
     *   此刻缓冲区一定还是热的。DropInViewer 的高斯排序挂在 onBeforeRender 上，
     *   会跟着这次 render 一起跑，抓到的画面与屏幕上看到的一致。
     *
     * 为什么临时把 pixelRatio 降回 1：
     *   高分屏上 canvas 的实际像素是 CSS 尺寸的 2 倍（1920×1080 → 3840×2160），
     *   当贴图用根本用不着这么大，base64 之后体积还要再涨 1.33 倍。
     *   降回 1:1 抓完立刻恢复，全程只走 WebGL 自己的缓冲区，不经过 2D canvas 中转，
     *   也就没有「跨上下文读回」的时序坑。
     *
     * @returns {string|null} dataURL；渲染器还没就绪时返回 null
     */
    captureFrame() {
        if (!this.renderer || !this.scene || !this.camera) return null;

        const previousRatio = this.renderer.getPixelRatio();
        let dataURL = null;

        try {
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(this._width, this._height, false);
            this.renderer.render(this.scene, this.camera);
            dataURL = this.canvas.toDataURL('image/png');
        } finally {
            // 不管成功与否都要还原，否则后面每一帧都会卡在低分辨率
            this.renderer.setPixelRatio(previousRatio);
            this.renderer.setSize(this._width, this._height, false);
            this.renderer.render(this.scene, this.camera);
        }

        return dataURL;
    }

    /* ============================================================== 调试辅助 */

    /**
     * 在场景中放一个可见标记，用来核对「某个世界坐标到底落在哪」。
     * 高斯泼溅本身没法加辅助线，量尺寸、定位特征点时全靠它。
     * @param {number|null} x 传 null 表示清除全部标记
     */
    markPoint(x, y, z, radius = 0.008) {
        if (!this._marks) {
            this._marks = new THREE.Group();
            this._marks.name = 'debug-marks';
            this.helpers.add(this._marks);
        }

        if (x === null) {
            this._marks.clear();
            return null;
        }

        const mat = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
        const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), mat);
        ball.position.set(x, y, z);

        // 加一根竖直细杆，俯视时也能看清落点，不至于被高斯完全遮住
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, radius * 12, 8), mat);
        pole.position.set(x, y + radius * 6, z);

        this._marks.add(ball, pole);
        return ball;
    }

    /* ================================================================ 渲染循环 */

    start() {
        if (this._running) return;
        this._running = true;
        this.clock.start();

        const loop = () => {
            if (!this._running) return;
            this._rafId = requestAnimationFrame(loop);
            this._step();
        };
        loop();
    }

    stop() {
        this._running = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _step() {
        // 限制单帧步长：切走标签页再切回来时 delta 会很大，无人机会瞬移出去
        const dt = Math.min(this.clock.getDelta(), 0.1);

        if (this.drone) {
            // 巡航激活时无人机全权接管相机；暂停时走 OrbitControls 的阻尼
            this.drone.update(dt);
            if (!this.drone.active) this.controls.update();
        } else {
            this.controls.update();
        }

        if (this.environment) this.environment.update(dt, this.camera);

        // DropInViewer 会在渲染过程中通过 onBeforeRender 钩子完成高斯排序与更新
        this.renderer.render(this.scene, this.camera);

        this._tick(dt);
    }

    _tick(dt) {
        this._fpsFrames++;
        this._fpsAccum += dt;

        // 每 0.5 秒刷新一次统计，避免频繁操作 DOM
        if (this._fpsAccum >= 0.5) {
            this.fps = this._fpsFrames / this._fpsAccum;
            this._fpsFrames = 0;
            this._fpsAccum = 0;

            if (typeof this.onStats === 'function') {
                this.onStats(this.snapshot());
            }
        }
    }

    snapshot() {
        const info = this.renderer.info;
        return {
            fps: this.fps,
            resolution: `${this._width} × ${this._height}`,
            pixelRatio: this.renderer.getPixelRatio(),
            drawCalls: info.render.calls,
            splatCount: this.splatCount,
            splatLabel: '高斯点',
            gpuSort: this.capabilities.gpuSort,
            sharedMemory: this.capabilities.sharedMemory,
            loadMs: this.loadInfo.ms,
            drone: this.droneActive,
        };
    }

    /* ================================================================== 清理 */

    dispose() {
        this.stop();
        window.removeEventListener('resize', this._onResize);
        if (this._ro) this._ro.disconnect();
        if (this.environment) this.environment.dispose();
        if (this.drone) this.drone.dispose();
        this.controls.dispose();
        try { this.viewer.dispose(); } catch (e) { /* ignore */ }
        this.renderer.dispose();
    }
}
