/**
 * main.js — 入口：把 UI 与三维场景装配起来
 */

import * as THREE from 'three';
import * as GS3D from '@mkkellogg/gaussian-splats-3d';

import { CONFIG } from './config.js';
import { SplatViewer } from './viewer.js';
import { UI } from './ui.js';
import { initSnapshot } from './snapshot.js';
import { initVoice } from './voice.js';

const ui = new UI();

/** 提前检测 WebGL2，避免加载到一半才失败 */
function supportsWebGL2() {
    try {
        const probe = document.createElement('canvas');
        return !!(window.WebGL2RenderingContext && probe.getContext('webgl2'));
    } catch (e) {
        return false;
    }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));

async function boot() {
    if (!supportsWebGL2()) {
        ui.fatal('当前浏览器不支持 WebGL2，无法渲染高斯泼溅场景。请使用最新版 Chrome / Edge / Firefox，并确认已开启硬件加速。');
        return;
    }

    ui.setStage('正在初始化渲染器…');

    let viewer;
    try {
        viewer = new SplatViewer(document.getElementById('viewport')).init();
    } catch (err) {
        console.error(err);
        ui.fatal('渲染器初始化失败：' + (err && err.message ? err.message : String(err)));
        return;
    }

    viewer.onStats = (s) => ui.updateStats(s);
    ui.bindControls(viewer);

    // 语音对话在加载模型之前就把事件挂上 —— 它不依赖高斯场景。
    // 按钮的显隐由 CSS 控制（revealModel() 才让它浮出），所以早早绑定不会有副作用，
    // 反而让 248 MB 模型还在下载时功能就已经就绪。
    initVoice(ui);

    // 先把渲染循环跑起来，加载期间背景不至于全黑
    viewer.start();

    try {
        const ms = await viewer.loadModel((p) => ui.updateProgress(p));

        ui.updateProgress({ percent: 100, label: '100%', phase: 'done' });
        await nextFrame();          // 让浏览器把加载界面绘制完整再切换

        ui.revealModel();
        viewer.resetCamera();       // 开场机位：河面望向主拱（config.drone.introView）

        // 右上角截图：抓帧 → 文创素材库（js/snapshot.js）
        initSnapshot(viewer, ui);

        ui.toast(`模型已就绪 · 加载耗时 ${(ms / 1000).toFixed(1)} 秒`, 2600);
    } catch (err) {
        console.error(err);
        ui.fatal('模型加载失败：' + (err && err.message ? err.message : String(err)));
        return;
    }

    // 天空（核心效果，失败直接报错，不静默降级）
    try {
        await viewer.initEnvironment();
    } catch (err) {
        console.error(err);
        ui.fatal('天空初始化失败：' + (err && err.message ? err.message : String(err)));
        return;
    }

    // 无人机自由飞行；就绪后自动切入飞行模式，立刻可以用 WASD 操控
    const droneReady = viewer.initDrone();
    if (droneReady) {
        viewer.onDroneStateChange = (on) => ui._syncButton('drone', on);
        setTimeout(() => {
            if (!window.__viewer || !window.__viewer.droneActive) {
                ui._dispatch('drone', viewer);
                ui.toast('无人机模式 · W A S D 移动 · Q E 升降 · Shift 加速', 3200);
            }
        }, 1200);
    }

    // 便于调试：浏览器控制台可直接访问这些对象调参
    window.__viewer = viewer;
    window.__CONFIG = CONFIG;
    window.__THREE = THREE;
    window.__GS3D = GS3D;
}

boot().catch((err) => {
    console.error(err);
    ui.fatal('发生未预期的错误：' + (err && err.message ? err.message : String(err)));
});
