/**
 * character.js — 场景漫游角色
 *
 * ⚠️⚠️ 本文件当前是**死模块**：全项目已无任何文件 import 它。
 *   2026-10-06 网页改为「天空 + 无人机航拍」形态时，人物漫游整体删除，
 *   连带本文件与 terrain.js 一起失去调用方；`index.html` 里也没有 `V` 键与「漫游」按钮了。
 *   保留它只为「将来若恢复漫游」留个参考；改代码时请勿以为它还在生效。
 *   依据：贵州葛镜桥/.workbuddy/memory/MEMORY.md 的「网页形态变更（2026-10-06）」。
 *
 * 原始说明如下 ——
 *
 * 用一个占位角色（胶囊体 + 头部 + 朝向锥 + 脚下光圈）跑通「人在场景里走动」
 * 的完整链路：键盘输入 → 相机相对方向 → 贴地移动 → 边界滑行 → 平滑转向。
 *
 * 之所以先用占位体而不是真人模型：尺度校准、地面贴合、相机跟随这三件事跟
 * 模型长什么样无关，用占位体调试最快。等真正的人物 .glb 到位，把 _build()
 * 里的几何体换成 GLTFLoader 加载的模型即可，其余逻辑不用动。
 */

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// 与移动相关、需要被拦截的按键
const MOVE_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight',
]);

export class Character {

    constructor(terrain, options = {}) {
        this.terrain = terrain;

        // 场景单位下的尺寸与速度（由外部按真实尺度换算好再传进来）
        this.personHeight = options.personHeight || 0.14;
        this.walkSpeed = options.walkSpeed || 0.125;
        this.runMultiplier = options.runMultiplier || 2.5;
        this.turnRate = options.turnRate || 14;

        // 高度图取的是点云中位数，往往低于肉眼可见的表面（植被冠层），
        // 抬一点让人站在「看得见的那层」上
        this.surfaceOffset = options.surfaceOffset || 0;

        /* 高度平滑速率（1/秒）。数值越大跟得越紧。
         * 12 约等于 0.08 秒的时间常数 —— 跳变被抹平，但不会让人觉得「飘」。 */
        this.heightSmoothing = options.heightSmoothing != null ? options.heightSmoothing : 12;

        this.position = new THREE.Vector3();
        this._targetY = 0;           // 高度图给出的目标脚底高度（未平滑）
        this.heading = 0;
        this.active = false;         // 未进入漫游模式时不响应键盘
        this.moving = false;
        this.running = false;

        this.keys = new Set();

        this.group = new THREE.Group();
        this.group.name = 'character';
        this.group.visible = false;

        this._build();
        this._bindKeys();
    }

    /* ============================================================== 外观 */

    _build() {
        const h = this.personHeight;
        const radius = h * 0.16;
        const trunk = h * 0.6;

        const skin = new THREE.MeshStandardMaterial({
            color: 0xff8236,
            roughness: 0.42,
            metalness: 0.05,
            emissive: 0x4a1c00,
            emissiveIntensity: 0.9,
        });

        // 躯干
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, trunk, 6, 16), skin);
        body.position.y = h * 0.48;
        this.group.add(body);

        // 头
        const head = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.3, 16, 12), skin);
        head.position.y = h * 0.9;
        this.group.add(head);

        // 朝向锥：站在远处也能一眼看出角色面朝哪边
        const nose = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.55, radius * 1.5, 12), skin);
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, h * 0.7, radius * 1.35);
        this.group.add(nose);

        // 脚下光圈：既是落地指示，也方便在复杂地形里快速定位角色
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius * 1.7, radius * 2.3, 32),
            new THREE.MeshBasicMaterial({
                color: 0xffc078,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                depthWrite: false,
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.0015;
        this.ring = ring;
        this.group.add(ring);
    }

    /* ============================================================== 输入 */

    _bindKeys() {
        this._onKeyDown = (ev) => {
            if (!this.active || !MOVE_KEYS.has(ev.code)) return;
            // 别在输入框里打字时把人给指挥走了
            const tag = ev.target && ev.target.tagName;
            if (tag && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;

            if (ev.code.startsWith('Arrow')) ev.preventDefault();   // 防止页面跟着滚动
            this.keys.add(ev.code);
            this._syncRun();
        };

        this._onKeyUp = (ev) => {
            if (!MOVE_KEYS.has(ev.code)) return;
            this.keys.delete(ev.code);
            this._syncRun();
        };

        // 失焦时清空按键，避免切窗口回来后人还在一直往前走
        this._onBlur = () => {
            this.keys.clear();
            this._syncRun();
        };

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
    }

    _syncRun() {
        this.running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    }

    _readInput(camera) {
        const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
                - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
        const r = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
                - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

        const dir = new THREE.Vector3();
        if (f === 0 && r === 0) return dir;

        // 「前」取相机视线在水平面上的投影，这样无论怎么转视角，
        // W 键始终是「朝屏幕里走」，符合第三人称的直觉
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
        forward.normalize();

        const right = new THREE.Vector3().crossVectors(forward, UP).normalize();

        return dir.addScaledVector(forward, f).addScaledVector(right, r);
    }

    /* ============================================================== 更新 */

    update(dt, camera) {
        if (!this.active) return;

        const input = this._readInput(camera);

        if (input.lengthSq() > 1e-8) {
            this.moving = true;

            const speed = this.walkSpeed * (this.running ? this.runMultiplier : 1);
            const step = input.normalize().multiplyScalar(speed * dt);
            const moved = this._tryMove(step.x, step.z);

            if (Math.abs(moved.x) > 1e-9 || Math.abs(moved.z) > 1e-9) {
                this.heading = dampAngle(
                    this.heading,
                    Math.atan2(moved.x, moved.z),
                    this.turnRate,
                    dt
                );
            }
        } else {
            this.moving = false;
        }

        /* 高度平滑：高度图是 1.12 m 格距的栅格，桥面处因分位数噪声与
         * 栏杆/崖壁混格，沿轴存在若干 3~7 m 的跳变。直接照搬会让角色
         * 「一格一格地弹跳」。这里对高度做指数阻尼，视觉上就是平滑起伏。
         *
         * 只平滑 Y —— 水平位置必须精确响应输入，否则手感会变黏。 */
        if (this.heightSmoothing > 0) {
            const k = 1 - Math.exp(-this.heightSmoothing * dt);
            this.position.y += (this._targetY - this.position.y) * k;
        }

        this.group.position.copy(this.position);
        this.group.rotation.y = this.heading;
    }

    /**
     * 尝试移动。整步走不通就退化成只走 X 或只走 Z，
     * 这样贴着地形边缘走时是「滑过去」而不是硬生生卡住。
     *
     * 关键点：不能只判断目标格「有没有高度值」。高度图是俯视投影做的，
     * 桥面正下方的河道格子里也有值（只是低几十米），只判 null 的话
     * 角色会径直走下崖壁、瞬移到河床上。所以这里走 stepAllowed()，
     * 它会额外检查坡度、落差与桥面走廊。
     */
    _tryMove(dx, dz) {
        const probe = (ox, oz) => {
            const nx = this.position.x + ox;
            const nz = this.position.z + oz;

            if (!this.terrain.stepAllowed(this.position.x, this.position.z, nx, nz)) {
                return null;
            }

            const ny = this.terrain.heightAt(nx, nz);
            if (ny === null) return null;

            // 落在桥段内时把横向夹回桥面，防止沿边缘被推出去
            const cl = this.terrain.clampToDeck(nx, nz);
            const cy = this.terrain.heightAt(cl.x, cl.z);
            if (cy === null) return null;

            return { x: cl.x, y: cy + this.surfaceOffset, z: cl.z };
        };

        let hit = probe(dx, dz);
        let ax = dx;
        let az = dz;

        if (!hit) { hit = probe(dx, 0); az = 0; }
        if (!hit) { hit = probe(0, dz); ax = 0; }
        if (!hit) return { x: 0, z: 0 };      // 三个方向都走不通，原地不动

        // 水平位置立即生效，高度交给 update() 里的阻尼平滑
        this._targetY = hit.y;
        this.position.x = hit.x;
        this.position.z = hit.z;
        return { x: ax, z: az };
    }

    /* ============================================================== 放置 */

    /** 把角色放到指定位置（该处必须踩得到地面，且满足可行走判据） */
    spawn(x, z) {
        const y = this.terrain.heightAt(x, z);
        if (y === null) return false;

        this._targetY = y + this.surfaceOffset;
        this.position.set(x, this._targetY, z);

        // 出生朝向：沿着地形「下坡」方向背对，让角色一登场就面朝场景深处
        const n = this.terrain.normalAt(x, z);
        this.heading = n ? Math.atan2(-n.dx, -n.dz) : 0;

        this.group.position.copy(this.position);
        this.group.rotation.y = this.heading;
        return true;
    }

    /** 让角色立刻转向某个水平方向（进入漫游时用它对齐相机，避免一登场就背对前方） */
    faceTowards(dx, dz) {
        if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return;
        this.heading = Math.atan2(dx, dz);
        this.group.rotation.y = this.heading;
    }

    setActive(on) {
        this.active = !!on;
        this.group.visible = !!on;
        if (!on) {
            this.keys.clear();
            this._syncRun();
            this.moving = false;
        }
    }

    /** 供相机跟随使用的目标点（略高于脚底，看起来更舒服） */
    getFollowPoint(out = new THREE.Vector3()) {
        return out.set(this.position.x, this.position.y + this.personHeight * 0.6, this.position.z);
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);

        this.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }
}

/** 角度阻尼插值，正确处理 ±π 环绕，避免转身时绕远路 */
function dampAngle(current, target, rate, dt) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * (1 - Math.exp(-rate * dt));
}
