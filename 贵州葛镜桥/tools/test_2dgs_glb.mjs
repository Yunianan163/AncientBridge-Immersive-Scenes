/**
 * test_2dgs_glb.mjs —— 无头 Edge 验证 integrate_2dgs_mesh.py 产物
 * 能被网页端 GLTFLoader 真实加载（COLOR_0/vertexColors/面数断言）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_ = 'http://localhost:8123/__glbtest.html';
const PORT = 9335;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-glbtest-'));
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--enable-unsafe-swiftshader',
  '--disable-sync', '--disable-background-networking',
  '--disable-gpu-sandbox',
  '--no-first-run', '--no-default-browser-check',
  '--window-size=800,600',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  for (;;) {
    const msg = JSON.parse(await ws.next());
    if (msg.id === id) return msg.result ?? msg;
  }
}

/* 极简 WebSocket 客户端（Node 22 原生 WebSocket） */
async function connect(port, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      const page = list.find(t => t.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Edge 未就绪 */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 连接失败');
}

const ws = await connect(PORT);
await new Promise(r => { ws.onopen = r; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Page.navigate', { url: URL_ });

/* 等页面跑完（title 变 glbtest-done 或超时 20s） */
let result = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const evalRes = await send('Runtime.evaluate', {
    expression: 'window.__result ? JSON.stringify(window.__result) : null',
    returnByValue: true,
  });
  if (evalRes.result?.result?.value) {
    result = JSON.parse(evalRes.result.result.value);
    break;
  }
}

console.log(result ? JSON.stringify(result, null, 2) : '{"ok":false,"error":"timeout"}');

/* 断言 */
if (!result?.ok) { console.log('[FAIL] GLTFLoader 加载失败'); process.exitCode = 1; }
else if (!result.hasColor || !result.vertexColorsFlag) { console.log('[FAIL] COLOR_0/vertexColors 缺失'); process.exitCode = 1; }
else if (result.tris !== 6240) { console.log(`[FAIL] 面数 ${result.tris} != 6240`); process.exitCode = 1; }
else { console.log('[PASS] GLTFLoader 真实加载通过：顶点色材质生效、面数正确'); }

ws.close();
edge.kill();
await sleep(1500);                       // 等 Edge 完全退出释放文件锁
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 锁着就留给系统清理 */ }
