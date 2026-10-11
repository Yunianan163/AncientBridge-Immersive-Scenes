/**
 * environment.js — 天空
 *
 * 天空：three.js 官方 Sky 插件（Preetham 大气散射模型），带太阳光斑，
 *       通过 ACES 色调映射呈现出有层次的蓝天而不是纯色背景。
 *
 * 坐标系约定：天空天球是**世界坐标系**（模型已绕 X 轴转 180° 摆正，+Y 朝上）。
 *
 * 历史备注：此前这里还有基于 three 官方 Water 插件的平面反射水面
 * （镜像相机整场渲染 → 菲涅尔混合，桥拱有真实倒影）。应用户要求暂时移除，
 * 相关实现与调参记录可在 git 历史中找回（搜索 reflectionDim / distortionScale）。
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CONFIG } from './config.js';

export class Environment {

    /**
     * @param {THREE.Scene} scene
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;

        this.sky = null;
        this.underDome = null;
        this.sun = new THREE.Vector3();
    }

    /** 初始化天空 */
    init() {
        const cfg = CONFIG.environment;

        // 总开关关闭（?sky=0 对比调参）时什么都不加
        if (!cfg || cfg.enabled === false) return this;

        this.sky = new Sky();
        this.sky.scale.setScalar(CONFIG.model.span * 60);   // 天球要远大于场景

        /* 顶部穹顶：把 Sky 的全盒几何换成上半球（略微越过水平线一点，
         * 给淡出带留余量），下方没有面 —— 配合 fragment 里向背景色淡出，
         * 天空就只存在于模型上方，不会把整个背景填成白茫茫。 */
        const dome = cfg.sky.dome;
        if (dome && dome.enabled) {
            this.sky.geometry.dispose();
            this.sky.geometry = new THREE.SphereGeometry(
                1, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.62,
            );

            /* 地平线淡出：按片元相对穹顶中心的竖直方向（1=正上方，0=水平面）
             * 做 smoothstep，把淡出带以下的天空色混到页面背景色。
             * 背景色取渲染器 clearColor 并转线性空间，保证 mix 后与
             * 无天空处的画面完全一致、看不出接缝。 */
            const bg = new THREE.Color(CONFIG.renderer.clearColor).convertSRGBToLinear();
            this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace(
                'gl_FragColor = vec4( retColor, 1.0 );',
                [
                    'float _dirY = normalize( vWorldPosition ).y;',
                    `float _fade = smoothstep( ${dome.fadeEnd.toFixed(3)}, ${dome.fadeStart.toFixed(3)}, _dirY );`,
                    `retColor = mix( vec3( ${bg.r.toFixed(4)}, ${bg.g.toFixed(4)}, ${bg.b.toFixed(4)} ), retColor, _fade );`,
                    'gl_FragColor = vec4( retColor, 1.0 );',
                ].join('\n\t\t\t'),
            );
            this.sky.material.needsUpdate = true;
        }

        this.scene.add(this.sky);

        /* 下半暗穹：与上穹在水平线附近相接的下半球，颜色从背景色
         * 渐变到深墨色 —— 模型从下方看是「搁在砚台上」而不是悬空。 */
        const ud = cfg.underDome;
        if (ud && ud.enabled) {
            const geo = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38);
            const top = new THREE.Color(ud.topColor).convertSRGBToLinear();
            const bottom = new THREE.Color(ud.bottomColor).convertSRGBToLinear();
            const mat = new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                uniforms: {
                    uTop: { value: new THREE.Vector3(top.r, top.g, top.b) },
                    uBottom: { value: new THREE.Vector3(bottom.r, bottom.g, bottom.b) },
                },
                vertexShader: /* glsl */`
                    varying vec3 vDir;
                    void main() {
                        vec4 wp = modelMatrix * vec4(position, 1.0);
                        vDir = normalize(wp.xyz);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        gl_Position.z = gl_Position.w;
                    }
                `,
                fragmentShader: /* glsl */`
                    uniform vec3 uTop;
                    uniform vec3 uBottom;
                    varying vec3 vDir;
                    void main() {
                        // dirY: 水平线 0 → 正下方 -1，平滑落到深墨色
                        float t = smoothstep(0.0, -1.0, vDir.y);
                        gl_FragColor = vec4(mix(uTop, uBottom, t), 1.0);
                        #include <colorspace_fragment>
                    }
                `,
            });
            this.underDome = new THREE.Mesh(geo, mat);
            this.underDome.scale.setScalar(CONFIG.model.span * 60);
            this.scene.add(this.underDome);
        }

        // 天空是 HDR 亮度，配 ACES 色调映射才有自然的过渡（泼溅着色器
        // 不受 renderer.toneMapping 影响，观感不会因此改变）
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = cfg.sky.exposure;

        this.setSun(cfg.sky.elevationDeg, cfg.sky.azimuthDeg);

        const su = this.sky.material.uniforms;
        su.turbidity.value = cfg.sky.turbidity;
        su.rayleigh.value = cfg.sky.rayleigh;
        su.mieCoefficient.value = cfg.sky.mieCoefficient;
        su.mieDirectionalG.value = cfg.sky.mieDirectionalG;

        return this;
    }

    /** 设置太阳位置（角度制），同步给天空 */
    setSun(elevationDeg, azimuthDeg) {
        const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
        const theta = THREE.MathUtils.degToRad(azimuthDeg);
        this.sun.setFromSphericalCoords(1, phi, theta);

        if (this.sky) {
            this.sky.material.uniforms.sunPosition.value.copy(this.sun);
        }
    }

    /** 每帧调用（当前天空是静态的，预留接口） */
    update() { /* noop */ }

    dispose() {
        if (this.sky) {
            this.scene.remove(this.sky);
            this.sky.geometry.dispose();
            this.sky.material.dispose();
        }
        if (this.underDome) {
            this.scene.remove(this.underDome);
            this.underDome.geometry.dispose();
            this.underDome.material.dispose();
        }
    }
}
