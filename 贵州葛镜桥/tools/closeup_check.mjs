/**
 * closeup_check.mjs — 近距离对比：泼溅 vs 烘焙网格（用户实际观感场景）
 * 用法: node closeup_check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = 'http://localhost:8123/';
const PORT = 9334;
const OUT = path.dirname(fileURLToPath(import.meta.url));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-closeup-'));
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--disable-sync', '--disable-background-networking', '--disable-gpu-sandbox',
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1024,640',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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
const shot = async (name) => {
  try { await evaluate(`window.__viewer.stop()`, 10000); } catch { /* ignore */ }
  await sleep(1000);
  const r = await send('Page.captureScreenshot', { format: 'png' }, 120000);
  const p = path.join(OUT, `closeup_${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  try { await evaluate(`window.__viewer.start()`, 10000); } catch { /* ignore */ }
  console.log('[shot]', p);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });

let stage = null;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  try { stage = await evaluate(`window.__viewer ? window.__viewer._stage : 'no'`, 10000); } catch { stage = 'err'; }
  if (stage === 'loaded') break;
  await sleep(3000);
}
if (stage !== 'loaded') throw new Error('未加载: ' + stage);
console.log('[stage] loaded');

await evaluate(`(() => {
  document.querySelectorAll('#hud,#stats,#dock,#roamhint,#toast,#loadmask').forEach(e => e.style.display = 'none');
  const v = window.__viewer;
  v.setAutoRotate(false);
  v._cc = 0;
  const origTick = v._tick.bind(v);
  v._tick = (dt) => { v._cc++; origTick(dt); };
  return 'ok';
})()`);

// 桥面近景：世界坐标下桥中段（roaming spawn 附近）
const tx = -0.05, ty = -0.03, tz = 0.075;
const setCam = (d) => evaluate(`(() => {
  const v = window.__viewer;
  v.controls.target.set(${tx}, ${ty}, ${tz});
  v.camera.position.set(${tx + 0.30}, ${ty + 0.16}, ${tz + d + 0.25});
  v.controls.update();
  v._cc = 0; v.start();
  return 'ok';
})()`, 15000);

// 泼溅模式近景
await setCam(0.12);
await waitFrames(2);
await shot('1_splat');

// 网格模式近景
await evaluate(`document.querySelector('button[data-act="mesh"]').click()`, 15000);
let mode = null, t1 = Date.now();
while (Date.now() - t1 < 240000) {
  try {
    const s = await evaluate(`JSON.stringify({m: window.__viewer.displayMode, r: window.__viewer.meshReady})`, 10000);
    if (JSON.parse(s).r && JSON.parse(s).m === 'mesh') { mode = 'mesh'; break; }
  } catch { /* ignore */ }
  await sleep(2000);
}
if (mode !== 'mesh') throw new Error('网格未就绪');
await setCam(0.12);
await waitFrames(2);
await shot('2_mesh');

console.log('[done]');
ws.close();
try { edge.kill(); } catch { /* ignore */ }
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);

async function waitFrames(n) {
  const tf = Date.now();
  while (Date.now() - tf < 120000) {
    const c = await evaluate(`window.__viewer._cc`, 10000).catch(() => 0);
    if (c >= n) break;
    await sleep(1500);
  }
  await evaluate(`window.__viewer.stop()`, 10000).catch(() => {});
  await sleep(800);
  await evaluate(`window.__viewer.start()`, 10000).catch(() => {});
}
