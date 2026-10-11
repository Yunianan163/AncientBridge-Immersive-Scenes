/**
 * ui.js — 界面层
 *
 * 只负责 DOM 的读写与事件绑定，不关心三维逻辑。
 * 与 viewer 之间通过回调通信，避免相互耦合。
 */

const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) console.warn('[UI] 缺少 DOM 节点:', id);
    return el;
};

export class UI {

    constructor() {
        this.el = {
            loadmask: $('loadmask'),
            barFill: $('bar-fill'),
            stage: $('load-stage'),
            pct: $('load-pct'),
            tip: $('load-tip'),
            hud: $('hud'),
            dock: $('dock'),
            stats: $('stats'),
            snapbtn: $('snapbtn'),
            voicebtn: $('voicebtn'),
            toast: $('toast'),
            dronehint: $('dronehint'),
        };

        this._lastStageText = '';
        this._shownStats = false;
        this._toastTimer = null;

        // 与 CONFIG.splat.sphericalHarmonicsDegree 的初始值保持一致
        this._shOn = true;
    }

    /* ============================================================== 加载界面 */

    /** @param {{percent:number, label:string, phase:string}} p */
    updateProgress(p) {
        const percent = Math.max(0, Math.min(100, Number(p.percent) || 0));
        const phase = p.phase || 'download';

        // 解析阶段拿不到真实进度（库只在开始/结束各回调一次），
        // 所以进度条转为「流动条纹」的不确定态，避免出现 100% 回退到 0% 的错觉
        if (phase === 'parse') {
            if (this.el.pct) this.el.pct.textContent = '';
            if (this.el.barFill) {
                this.el.barFill.style.width = '100%';
                this.el.barFill.classList.add('is-parse');
            }
            if (this._lastStageText !== 'parse') {
                this.setStage('正在解析高斯数据…');
                this.setTip('约 282 万个高斯点，解析期间页面可能短暂无响应，请稍候');
                this._lastStageText = 'parse';
            }
            return;
        }

        if (this.el.barFill) {
            this.el.barFill.style.width = percent.toFixed(1) + '%';
            this.el.barFill.classList.remove('is-parse');
        }
        if (this.el.pct) this.el.pct.textContent = percent.toFixed(0) + '%';

        const text = percent >= 100
            ? '下载完成，开始解析…'
            : (percent <= 0 ? '正在连接服务器…' : '正在下载模型数据');

        if (text !== this._lastStageText) {
            this.setStage(text);
            this._lastStageText = text;
        }
    }

    setStage(text) {
        if (this.el.stage) this.el.stage.textContent = text;
    }

    setTip(text) {
        if (this.el.tip) this.el.tip.textContent = text;
    }

    /** 模型就绪：收起加载遮罩，放出操作界面 */
    revealModel() {
        if (this.el.loadmask) {
            this.el.loadmask.classList.add('is-done');
            setTimeout(() => {
                if (this.el.loadmask) this.el.loadmask.style.display = 'none';
            }, 700);
        }
        if (this.el.hud) this.el.hud.classList.add('is-visible');
        if (this.el.dock) this.el.dock.classList.add('is-visible');
        // 截图按钮与面板一起浮出：模型没出来之前截到的只是空场景
        if (this.el.snapbtn) this.el.snapbtn.classList.add('is-visible');
        // 语音对话键同批浮出（模型没加载完就开始对话没有意义）
        if (this.el.voicebtn) this.el.voicebtn.classList.add('is-visible');
    }

    fatal(message) {
        if (this.el.barFill) this.el.barFill.style.width = '100%';
        if (this.el.loadmask) this.el.loadmask.classList.add('is-error');
        this.setStage('加载失败');
        if (this.el.pct) this.el.pct.textContent = '';
        this.setTip(message);
        console.error('[Fatal]', message);
    }

    /* ================================================================ 状态栏 */

    updateStats(s) {
        if (!this.el.stats) return;

        if (!this._shownStats) {
            this.el.stats.classList.add('is-visible');
            this._shownStats = true;
        }

        const rows = [
            ['帧率', `${s.fps.toFixed(1)} FPS`, s.fps >= 50 ? 'ok' : (s.fps >= 25 ? 'warn' : 'bad')],
            [s.splatLabel || '高斯点', formatInt(s.splatCount), ''],
            ['分辨率', s.resolution, ''],
            ['Splat 排序', s.gpuSort ? 'GPU 加速' : 'CPU + SIMD', s.gpuSort ? 'ok' : 'dim'],
            ['共享内存', s.sharedMemory ? '已启用' : '未启用', s.sharedMemory ? 'ok' : 'dim'],
        ];

        this.el.stats.innerHTML = rows.map(
            ([k, v, cls]) =>
                `<div class="stat"><span class="stat__k">${k}</span><span class="stat__v ${cls}">${v}</span></div>`
        ).join('');
    }

    /* ================================================================ 工具栏 */

    /** @param {import('./viewer.js').SplatViewer} viewer */
    bindControls(viewer) {
        if (this.el.dock) {
            this.el.dock.addEventListener('click', (ev) => {
                const btn = ev.target.closest('button[data-act]');
                if (!btn) return;
                this._dispatch(btn.dataset.act, viewer, btn);
            });
        }

        // 键盘快捷键
        window.addEventListener('keydown', (ev) => {
            if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;

            // 飞行模式下方向键 / 空格 / WASD 等都留给无人机，不触发其他快捷键
            if (viewer.droneActive && !['d', 'r', 'f', 'h'].includes(ev.key.toLowerCase())) return;

            switch (ev.key.toLowerCase()) {
                case 'r': this._dispatch('reset', viewer); break;
                case 'f': this._dispatch('frame', viewer); break;
                case 'd': this._dispatch('drone', viewer); break;
                case ' ':
                    ev.preventDefault();
                    this._dispatch('spin', viewer);
                    break;
                case 'h': this._dispatch('stats', viewer); break;
                case 'g': this._dispatch('sh', viewer); break;
                default: break;
            }
        });
    }

    async _dispatch(act, viewer, btn) {
        switch (act) {
            case 'drone': {
                if (!viewer.drone) {
                    this.toast('无人机模块尚未就绪');
                    break;
                }
                const on = viewer.drone.toggle();
                this._syncButton('drone', on);
                this._setDroneHint(on);
                if (on) this.toast('无人机飞行 · W A S D 移动 / Q E 升降 / 拖动转向', 2600);
                break;
            }

            case 'reset':
                // 飞行中「重置」= 退出飞行回到开场机位
                if (viewer.droneActive) {
                    viewer.drone.exit();
                    this._syncButton('drone', false);
                    this._setDroneHint(false);
                }
                viewer.resetCamera();
                this.toast('已回到开场视角');
                break;

            case 'frame':
                if (viewer.droneActive) {
                    viewer.drone.exit();
                    this._syncButton('drone', false);
                    this._setDroneHint(false);
                }
                viewer.frameScene();
                this.toast('已适配整个场景');
                break;

            case 'spin': {
                const on = !viewer.autoRotate;
                viewer.setAutoRotate(on);
                if (btn) btn.classList.toggle('is-on', on);
                this._syncButton('spin', on);
                break;
            }

            case 'stats':
                this._shownStats = !this._shownStats;
                if (this.el.stats) this.el.stats.classList.toggle('is-visible', this._shownStats);
                this._syncButton('stats', this._shownStats);
                break;

            case 'sh': {
                this._shOn = !this._shOn;
                viewer.setSphericalHarmonicsDegree(this._shOn ? 1 : 0);
                this._syncButton('sh', this._shOn);
                this.toast(this._shOn
                    ? '已开启视角相关光泽（画质优先）'
                    : '已切换为基础色（性能优先）');
                break;
            }

            case 'fullscreen':
                toggleFullscreen();
                break;

            default: break;
        }
    }

    _syncButton(act, on) {
        if (!this.el.dock) return;
        const b = this.el.dock.querySelector(`button[data-act="${act}"]`);
        if (b) b.classList.toggle('is-on', !!on);
    }

    _setDroneHint(on) {
        if (this.el.dronehint) this.el.dronehint.classList.toggle('is-visible', !!on);
    }

    /* ================================================================== 提示 */

    toast(text, ms = 1800) {
        const el = this.el.toast;
        if (!el) return;
        el.textContent = text;
        el.classList.add('is-visible');

        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
    }
}

/* ==================================================================== 工具 */

export function formatInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement) {
        (d.documentElement.requestFullscreen || (() => {})).call(d.documentElement);
    } else if (d.exitFullscreen) {
        d.exitFullscreen();
    }
}
