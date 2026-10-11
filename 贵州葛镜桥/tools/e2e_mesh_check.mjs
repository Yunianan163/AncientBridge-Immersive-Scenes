/**
 * e2e_mesh_check.mjs — 无头 Edge 验证：泼溅模式 / 网格模式 渲染与切换
 *
 * 用法: node e2e_mesh_check.mjs
 * 前提: serve.py 已在 8123 端口运行
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = 'http://localhost:8123/';
const PORT = 9333;
const OUT = path.dirname(fileURLToPath(import.meta.url));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-edge-'));
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
  '--window-size=1024,640',
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
  throw new Error('CDP 端口连不上或找不到 page target');
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

function send(method, params = {}, timeoutMs = 30000) {
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

const shot = async (name) => {
  // 软件 WebGL 渲染 282 万点太重，会占死合成器：先暂停渲染循环再截屏
  try { await evaluate(`window.__viewer && window.__viewer.stop()`, 10000); } catch { /* ignore */ }
  await sleep(1200);
  const r = await send('Page.captureScreenshot', { format: 'png' }, 120000);
  const p = path.join(OUT, `e2e_${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  try { await evaluate(`window.__viewer && window.__viewer.start()`, 10000); } catch { /* ignore */ }
  console.log(`[shot] ${p}`);
  return p;
};

await send('Page.enable');
await send('Runtime.enable');

// Edge 首启引导页顶掉目标页，必须显式导航
await send('Page.navigate', { url: URL_ });
console.log('[nav]', URL_);

// 等泼溅模型加载完成（260MB 下载 + 282 万点解析）
const t0 = Date.now();
let stage = null;
while (Date.now() - t0 < 240000) {
  try {
    stage = await evaluate(`window.__viewer ? window.__viewer._stage : 'no-viewer'`, 10000);
  } catch { stage = 'eval-error'; }
  if (stage === 'loaded') break;
  await sleep(3000);
}
console.log('[stage]', stage, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (stage !== 'loaded') throw new Error('泼溅模型未能加载: ' + stage);
await sleep(4000);                       // 等首帧排序稳定

await shot('1_splat_mode');

// 点击「网格」按钮 → loadMesh + 切换
console.log('[mesh] 点击 data-act=mesh 按钮…');
await evaluate(`(() => { document.querySelector('button[data-act="mesh"]').click(); return 'clicked'; })()`, 15000);

// 网格 55MB 下载 + 解析 + 材质创建
const t1 = Date.now();
let mode = null, meshInfo = null;
while (Date.now() - t1 < 240000) {
  try {
    const s = await evaluate(`(() => { const v = window.__viewer; return JSON.stringify({ mode: v.displayMode, ready: v.meshReady, tris: v.meshInfo.tris }); })()`, 10000);
    const j = JSON.parse(s);
    if (j.ready && j.mode === 'mesh') { mode = j.mode; meshInfo = j; break; }
  } catch { /* ignore */ }
  await sleep(3000);
}
console.log('[mesh]', JSON.stringify(meshInfo), `(${((Date.now() - t1) / 1000).toFixed(0)}s)`);
if (mode !== 'mesh') throw new Error('网格模式未能激活');
await sleep(5000);

await shot('2_mesh_mode');

// 回到泼溅模式再切一次，验证可逆
await evaluate(`(() => { document.querySelector('button[data-act="mesh"]').click(); return 'ok'; })()`, 15000);
await sleep(2500);
const back = await evaluate(`window.__viewer.displayMode`, 10000);
console.log('[back-to-splat]', back);
await shot('3_back_to_splat');

console.log('[done] 全部通过');
ws.close();
edge.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 退出中文件可能被锁，忽略 */ }
process.exit(0);
