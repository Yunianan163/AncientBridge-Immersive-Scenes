/**
 * bake_views.mjs — 纹理烘焙第一步：采集多机位泼溅渲染图 + 相机矩阵
 *
 * 原理：网格烘焙要"烙"进顶点的颜色，必须是泼溅模型**真实渲染**出来的颜色
 * （含 SH 视角项与混合效果），而不是 f_dc 基础色。本脚本驱动网页查看器
 * 环绕场景拍摄 16 个机位，每拍一张就导出该机位的完整相机矩阵，
 * 供 bake_vertex_colors.py 做投影采样。
 *
 * 用法: node bake_views.mjs   （serve.py 需在 8123 端口运行）
 * 产物: tools/bake_views/view_XX.png + views.json
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = 'http://localhost:8123/';
const PORT = 9333;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake_views');

fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-bake-'));
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-gpu-sandbox',
  '--no-first-run', '--no-default-browser-check',
  // 软件光栅化 282 万高斯极慢：降低分辨率换帧率，顶点烘焙只需要低频颜色
  '--window-size=960,600',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error('CDP 连不上');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};

function send(method, params = {}, timeoutMs = 60000) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' 超时')); }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const evaluate = async (expression, timeoutMs = 30000) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
console.log('[nav]', URL_);

// 等模型加载
const t0 = Date.now();
let stage = null;
while (Date.now() - t0 < 240000) {
  try { stage = await evaluate(`window.__viewer ? window.__viewer._stage : 'no-viewer'`, 10000); } catch { stage = 'eval-error'; }
  if (stage === 'loaded') break;
  await sleep(3000);
}
if (stage !== 'loaded') throw new Error('模型未加载: ' + stage);
console.log('[stage] loaded', `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// 隐藏所有 UI 覆盖层，保证截图是纯净渲染；并给渲染循环挂帧计数器，
// 用于确认「新机位的帧」真的渲染完成（软件光栅化一帧可达 10~30 秒，
// 盲等固定秒数会截到上一个机位的旧帧 —— 第一版失败的根因）
await evaluate(`(() => {
  document.querySelectorAll('#hud,#stats,#dock,#roamhint,#toast,#loadmask').forEach(e => e.style.display = 'none');
  const v = window.__viewer;
  v.setAutoRotate(false);
  v._bakeCount = 0;
  const origTick = v._tick.bind(v);
  v._tick = (dt) => { v._bakeCount++; origTick(dt); };
  return 'ui-hidden';
})()`);
await sleep(1500);

// 场景中心与取景距离（与网页端 frameScene 同一套逻辑）
const scene = await evaluate(`(() => {
  const v = window.__viewer, C = window.__CONFIG;
  const c = v.modelCenter;
  const vFov = C.camera.fov * Math.PI / 180;
  const aspect = v.camera.aspect || 1.66;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const need = (C.model.span * 0.58) / Math.sin(Math.min(vFov, hFov) / 2);
  return JSON.stringify({ cx: c.x, cy: c.y, cz: c.z, dist: need, up: C.camera.up });
})()`);
const { cx, cy, cz, dist } = JSON.parse(scene);
console.log(`[scene] center=(${cx.toFixed(3)},${cy.toFixed(3)},${cz.toFixed(3)}) dist=${dist.toFixed(3)}`);

/* 机位方案由命令行参数选择：
 *   node bake_views.mjs            远景 16 机位（默认，出 bake_views/）
 *   node bake_views.mjs near       近景 16 机位（出 bake_views_near/，纹理烘焙用，
 *                                  距离更近 → 单像素覆盖的表面积更小 → 源图分辨率更高）
 *   node bake_views.mjs ground     贴地环 8 机位（出 bake_views_ground/，12° 低仰角，
 *                                  专拍崖壁 / 桥底等低角度表面，补纹理覆盖率）
 */
const mode = process.argv[2] || 'far';
const OUTDIR = mode === 'far' ? OUT : path.join(path.dirname(OUT), `bake_views_${mode}`);
fs.mkdirSync(OUTDIR, { recursive: true });

const RING_SETS = {
  far: [{ elevDeg: 22, distFactor: 1.0, name: 'low' },
        { elevDeg: 52, distFactor: 1.0, name: 'high' }],
  near: [{ elevDeg: 32, distFactor: 0.52, name: 'near-mid' },
         { elevDeg: 62, distFactor: 0.66, name: 'near-high' }],
  ground: [{ elevDeg: 12, distFactor: 0.72, name: 'ground' }],
};
const rings = RING_SETS[mode];
const N_AZ = 8;
const views = [];
let idx = 0;

for (const ring of rings) {
  const el = ring.elevDeg * Math.PI / 180;
  for (let a = 0; a < N_AZ; a++) {
    const az = (a / N_AZ) * Math.PI * 2;
    const dx = Math.cos(el) * Math.cos(az);
    const dy = Math.sin(el);
    const dz = Math.cos(el) * Math.sin(az);

    const d = dist * ring.distFactor;
    const px = cx + dx * d, py = cy + dy * d, pz = cz + dz * d;

    await evaluate(`(() => {
      const v = window.__viewer;
      v.controls.target.set(${cx}, ${cy}, ${cz});
      v.camera.position.set(${px}, ${py}, ${pz});
      v.controls.update();
      v._bakeCount = 0;              // 只认本机位开始后的新帧
      v.start();
      return 'ok';
    })()`, 15000);

    // 轮询帧计数：至少渲染出 1 个新帧（软渲染一帧 10~30 秒，上限留 150 秒）
    let frames = 0;
    const tf = Date.now();
    while (Date.now() - tf < 150000) {
      frames = await evaluate(`window.__viewer._bakeCount`, 10000);
      if (frames >= 1) break;
      await sleep(1500);
    }
    if (frames < 1) throw new Error(`机位 ${idx} 等了 150 秒仍未渲染出新帧`);
    // 再多等一帧，确保 sort/合成稳定
    const target = frames + 1;
    const t2 = Date.now();
    while (Date.now() - t2 < 60000) {
      const f2 = await evaluate(`window.__viewer._bakeCount`, 10000);
      if (f2 >= target) break;
      await sleep(1500);
    }
    await evaluate(`window.__viewer.stop()`, 10000);
    await sleep(800);

    const r = await send('Page.captureScreenshot', { format: 'png' }, 120000);
    const file = path.join(OUTDIR, `view_${String(idx).padStart(2, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));

    const cam = await evaluate(`(() => {
      const c = window.__viewer.camera;
      const m = c.matrixWorldInverse.elements;
      const p = c.projectionMatrix.elements;
      const cv = document.getElementById('viewport');
      return JSON.stringify({
        pos: [c.position.x, c.position.y, c.position.z],
        target: [window.__viewer.controls.target.x, window.__viewer.controls.target.y, window.__viewer.controls.target.z],
        fov: c.fov, aspect: c.aspect, near: c.near, far: c.far,
        viewMatrix: m, projMatrix: p,
        width: cv.clientWidth, height: cv.clientHeight,
      });
    })()`, 15000);

    views.push({ index: idx, ring: ring.name, azimuthDeg: (a / N_AZ) * 360, elevDeg: ring.elevDeg, image: file, cam: JSON.parse(cam) });
    console.log(`[view ${idx}] ${ring.name} az=${((a / N_AZ) * 360).toFixed(0)}°`);
    idx++;
  }
}

fs.writeFileSync(path.join(OUTDIR, "views.json"), JSON.stringify(views, null, 1));
console.log(`[done] ${views.length} 机位已保存到 ${OUT}`);

ws.close();
try { edge.kill(); } catch { /* ignore */ }
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略锁文件 */ }
process.exit(0);
