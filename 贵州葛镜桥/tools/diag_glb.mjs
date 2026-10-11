/**
 * diag_glb.mjs —— GLB 网格加载失败诊断：直接调 loadMesh 抓真实异常
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
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
  '--window-size=960,600',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
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

// 抓控制台错误
await send('Page.enable');
await send('Runtime.enable');
const consoleLogs = [];
ws.addEventListener('message', (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleLogs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleLogs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  } catch { /* ignore */ }
});

await send('Page.navigate', { url: URL_ });
console.log('[nav]', URL_);

const t0 = Date.now();
let stage = null;
while (Date.now() - t0 < 240000) {
  try { stage = await evaluate(`window.__viewer ? window.__viewer._stage : 'no-viewer'`, 10000); } catch { stage = 'eval-error'; }
  if (stage === 'loaded') break;
  await sleep(3000);
}
if (stage !== 'loaded') throw new Error('模型未加载: ' + stage);
console.log('[stage] loaded');

// 直接调 loadMesh，把错误信息抓出来
const result = await evaluate(`window.__viewer.loadMesh()
  .then(ms => 'OK ms=' + ms + ' tris=' + window.__viewer.meshInfo.tris)
  .catch(e => 'ERR ' + (e && e.message ? e.message : String(e)))`, 300000);
console.log('[loadMesh]', result);

// 顺手试一下手动切换
if (String(result).startsWith('OK')) {
  const r2 = await evaluate(`(() => {
    const ok = window.__viewer.setDisplayMode('mesh');
    return ok + ' mode=' + window.__viewer.displayMode;
  })()`, 15000);
  console.log('[setDisplayMode]', r2);
}

console.log('[console 输出]');
for (const l of consoleLogs.slice(-20)) console.log('  ' + l.slice(0, 500));

ws.close();
try { edge.kill(); } catch { /* ignore */ }
await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
