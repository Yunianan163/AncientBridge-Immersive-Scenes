/**
 * snapshot.js — 场景截图 → 文创素材库
 *
 * 点右上角的 📷 把当前画面存成 PNG，POST 到文创后端（默认 http://127.0.0.1:3001）
 * 的 /api/scene-snapshots，落到 wenchuang-customizer/server/public/scene-shots/。
 * 文创页面右侧工作台的「场景截图」面板会把它们列出来，点一下就能直接贴到商品上。
 *
 * 端口约定与「启动全部场景.bat」里的 PORT_API(3001) 一致。
 * 换机器或临时换端口不必改代码，URL 上带 ?api=http://host:port 即可覆盖。
 *
 * 抓帧本身在 SplatViewer.captureFrame() 里（那边要处理 preserveDrawingBuffer 的坑），
 * 这里只管上传和反馈。
 */

export const SCENE_NAME = '贵州葛镜桥';

const DEFAULT_API_BASE = 'http://127.0.0.1:3001';

/** 允许 ?api=... 覆盖（调试用）；解析不出来就回退默认值，不抛错 */
function apiBase() {
    try {
        const override = new URLSearchParams(window.location.search).get('api');
        if (override) return override.replace(/\/+$/, '');
    } catch (e) { /* 用默认值 */ }
    return DEFAULT_API_BASE;
}

/**
 * 挂上截图按钮的事件。按钮的显示时机由 ui.revealModel() 控制（模型就绪后才浮出来）。
 *
 * @param {import('./viewer.js').SplatViewer} viewer
 * @param {import('./ui.js').UI} ui
 */
export function initSnapshot(viewer, ui) {
    const btn = document.getElementById('snapbtn');
    if (!btn) {
        console.warn('[Snapshot] 找不到 #snapbtn，截图功能未启用');
        return;
    }

    let busy = false;

    btn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        btn.classList.add('is-busy');

        try {
            // 1) 抓帧。截的是 canvas 里的三维画面本体，界面上的面板/按钮不会进去。
            const dataURL = viewer.captureFrame();
            // 全黑或没渲染的图，PNG 压缩后会异常小；这里只挡明显异常的
            if (!dataURL || dataURL.length < 4096) {
                throw new Error('画面还没准备好，请稍后再试');
            }

            ui.toast('正在保存截图…', 2000);

            // 2) 上传到素材库
            const response = await fetch(apiBase() + '/api/scene-snapshots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataURL, scene_name: SCENE_NAME }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                throw new Error(data.error || '文创后端返回 HTTP ' + response.status);
            }

            const shot = data.snapshot || {};
            const size = shot.width ? ' · ' + shot.width + '×' + shot.height : '';
            ui.toast('已存入文创素材库' + size, 2800);
        } catch (err) {
            console.error('[Snapshot]', err);
            ui.toast(
                '截图保存失败：' + (err && err.message ? err.message : '请确认文创后端(3001)已启动'),
                3600,
            );
        } finally {
            busy = false;
            btn.classList.remove('is-busy');
        }
    });
}
