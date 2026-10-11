/**
 * drone.js — 无人机自由飞行控制
 *
 * 操作布局（第一人称飞行相机）：
 *   W / S   沿视线方向前进 / 后退（含俯仰分量：低头飞就往下走）
 *   A / D   左右水平平移
 *   Q / E   沿世界竖直轴上升 / 下降
 *   Shift   加速（×3）
 *   拖动    转向（yaw / pitch）
 *   滚轮    调整巡航速度
 *   D       进入 / 退出飞行模式
 *
 * 实现要点：
 *   · 朝向用 YXZ 欧拉角（yaw + pitch）维护，天然避免万向节锁；
 *     进入飞行时从相机当前四元数反解，无缝衔接 OrbitControls 的视角；
 *   · 速度做指数阻尼（加速 / 减速都有惯性），手感像有质量的无人机
 *     而不是瞬移的幽灵相机；
 *   · 拖动用 Pointer Capture，鼠标拖出画布也不会丢事件。
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desired = new THREE.Vector3();

export class DronePilot {

    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
     * @param {HTMLElement} domElement 接收鼠标事件的画布
     */
    constructor(camera, controls, domElement) {
        this.camera = camera;
        this.controls = controls;
        this.dom = domElement || (controls && controls.domElement);

        const cfg = CONFIG.drone || {};
        this._speed = cfg.speed || 0.18;        // 基准巡航速度（单位/秒）
        this._fastMult = cfg.fastMultiplier || 3;
        this._minY = (cfg.minAltitude !== undefined) ? cfg.minAltitude : -0.08;
        this._maxY = (cfg.maxAltitude !== undefined) ? cfg.maxAltitude : 2.5;

        this._active = false;
        this._keys = new Set();                  // 按住的键（小写 key）
        this._yaw = 0;
        this._pitch = 0;
        this._vel = new THREE.Vector3();
        this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this._dragging = false;

        this.onStateChange = null;

        // ---- 事件（常驻监听，只在 active 时生效） ----
        this._onKeyDown = (ev) => {
            if (!this._active) return;
            if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
            const k = ev.key.toLowerCase();
            if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
                this._keys.add(k);
                if (k.startsWith('arrow')) ev.preventDefault();
            }
        };
        this._onKeyUp = (ev) => {
            this._keys.delete(ev.key.toLowerCase());
        };
        // 窗口失焦时清空按键，避免「切走标签页回来一直往前飞」
        this._onBlur = () => this._keys.clear();

        this._onPointerDown = (ev) => {
            if (!this._active || ev.button !== 0) return;
            this._dragging = true;
            try { this.dom.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        };
        this._onPointerMove = (ev) => {
            if (!this._active || !this._dragging) return;
            this._applyDrag(ev.movementX || 0, ev.movementY || 0);
        };
        this._onPointerUp = (ev) => {
            this._dragging = false;
            try { this.dom.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        };
        this._onWheel = (ev) => {
            if (!this._active) return;
            ev.preventDefault();
            const f = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
            this._speed = THREE.MathUtils.clamp(this._speed * f, 0.02, 1.2);
        };

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        if (this.dom) {
            this.dom.addEventListener('pointerdown', this._onPointerDown);
            this.dom.addEventListener('pointermove', this._onPointerMove);
            this.dom.addEventListener('pointerup', this._onPointerUp);
            this.dom.addEventListener('pointercancel', this._onPointerUp);
            this.dom.addEventListener('wheel', this._onWheel, { passive: false });
        }
    }

    /** 拖动 → 朝向。灵敏度随画布高度自适应，窗口大小变了手感不变 */
    _applyDrag(dx, dy) {
        const h = Math.max(this.dom ? this.dom.clientHeight : 900, 300);
        this._yaw -= dx * (Math.PI / h) * 0.9;
        this._pitch -= dy * (Math.PI / h) * 0.9;
        const limit = THREE.MathUtils.degToRad(85);
        this._pitch = THREE.MathUtils.clamp(this._pitch, -limit, limit);
    }

    get active() { return this._active; }

    /** 进入飞行模式：从当前视角无缝接管 */
    enter() {
        if (this._active) return;
        this._active = true;
        this._keys.clear();
        this._vel.set(0, 0, 0);

        // 从相机当前四元数反解 yaw / pitch（YXZ 顺序）
        this._euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
        this._yaw = this._euler.y;
        this._pitch = this._euler.x;

        this.controls.enabled = false;
        if (typeof this.onStateChange === 'function') this.onStateChange(true);
    }

    /** 退出飞行模式，把控制权交还给轨道控制器（从当前视角继续） */
    exit() {
        if (!this._active) return;
        this._active = false;
        this._keys.clear();
        this._vel.set(0, 0, 0);
        this.controls.enabled = true;

        // 轨道控制器需要一个 target：取当前视线前方一点，
        // 保证退出瞬间画面不跳变
        this.camera.getWorldDirection(_fwd);
        this.controls.target.copy(this.camera.position).addScaledVector(_fwd, 0.3);
        this.controls.update();
        if (typeof this.onStateChange === 'function') this.onStateChange(false);
    }

    toggle() {
        if (this._active) this.exit();
        else this.enter();
        return this._active;
    }

    /** 每帧推进；未激活时什么都不做 */
    update(dt) {
        if (!this._active) return;

        // ---- 朝向 ----
        this._euler.set(this._pitch, this._yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(this._euler);

        // 方向键也能转向（笔记本没鼠标时的备选）
        const turn = 1.6 * dt;
        if (this._keys.has('arrowleft')) this._yaw += turn;
        if (this._keys.has('arrowright')) this._yaw -= turn;
        if (this._keys.has('arrowup')) this._pitch = Math.min(this._pitch + turn, THREE.MathUtils.degToRad(85));
        if (this._keys.has('arrowdown')) this._pitch = Math.max(this._pitch - turn, THREE.MathUtils.degToRad(-85));

        // ---- 速度（指数阻尼，时间常数 ~0.22s） ----
        this.camera.getWorldDirection(_fwd);
        _right.crossVectors(_fwd, this.camera.up).normalize();

        _desired.set(0, 0, 0);
        if (this._keys.has('w')) _desired.add(_fwd);
        if (this._keys.has('s')) _desired.sub(_fwd);
        if (this._keys.has('d')) _desired.add(_right);
        if (this._keys.has('a')) _desired.sub(_right);
        if (this._keys.has('q')) _desired.y += 1;
        if (this._keys.has('e')) _desired.y -= 1;

        const speed = this._speed * (this._keys.has('shift') ? this._fastMult : 1);
        if (_desired.lengthSq() > 0) {
            _desired.normalize().multiplyScalar(speed);
        }
        const k = 1 - Math.exp(-dt / 0.22);
        this._vel.lerp(_desired, k);

        // ---- 位移 ----
        this.camera.position.addScaledVector(this._vel, dt);

        // 竖直限位：别钻进河床，也别飞出大气层
        if (this.camera.position.y < this._minY) {
            this.camera.position.y = this._minY;
            if (this._vel.y < 0) this._vel.y = 0;
        } else if (this.camera.position.y > this._maxY) {
            this.camera.position.y = this._maxY;
            if (this._vel.y > 0) this._vel.y = 0;
        }
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
        if (this.dom) {
            this.dom.removeEventListener('pointerdown', this._onPointerDown);
            this.dom.removeEventListener('pointermove', this._onPointerMove);
            this.dom.removeEventListener('pointerup', this._onPointerUp);
            this.dom.removeEventListener('pointercancel', this._onPointerUp);
            this.dom.removeEventListener('wheel', this._onWheel);
        }
    }
}
