#!/usr/bin/env node
/**
 * serve.js —— 场景选择页面专用静态服务器（零依赖）
 *
 * 为什么选择页面也要单独起一个服务：
 *   如果直接双击 index.html 用 file:// 打开，浏览器会把页面当成 "null 源"，
 *   页面上那三个「服务是否就绪」的探测会被 CORS / 安全策略拦掉，
 *   三个场景就会全都显示成「未启动」。给选择页面一个自己的 http 源，
 *   探测才能正常工作。
 *
 * 依赖：只用 Node 内置模块，不需要 npm install。
 *
 * 用法：
 *   node serve.js            # 默认 8080
 *   node serve.js 8090       # 指定端口
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const START_PORT = Number(process.argv[2]) || 8080;
const MAX_TRIES = 20;

/* Windows 上 .js 的 MIME 常被注册表写成 text/plain，
   而浏览器对 ES module 有严格 MIME 校验 —— 这里一律写死，不依赖系统推断。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers) {
  const head = Object.assign(
    { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    headers || {}
  );
  res.writeHead(code, head);
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
  } catch {
    send(res, 400, 'Bad Request');
    return;
  }

  if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

  // 防目录穿越：解析后必须仍在 ROOT 之内
  const target = path.resolve(ROOT, '.' + path.posix.normalize(pathname));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, '404 Not Found —— 场景选择页面根目录：' + ROOT);
      return;
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      // 页面随时可能改，一律不缓存，刷新即最新
      'Cache-Control': 'no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });

    if (req.method === 'HEAD') { res.end(); return; }

    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});

/** 端口被占就往上找，返回真正绑定的端口 */
function listen(port, triesLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error('  [错误] 无法启动：' + err.message);
    process.exit(1);
  });

  server.listen(port, () => {
    const url = 'http://localhost:' + port + '/';
    console.log('');
    console.log('  古桥数字场景 · 场景选择页面');
    console.log('  ' + '-'.repeat(46));
    console.log('  页面目录 : ' + ROOT);
    console.log('  地址     : ' + url);
    console.log('');
    console.log('  三个场景需各自的服务器同时在跑（见 启动全部场景.bat）');
    console.log('  停止服务 : Ctrl + C');
    console.log('');
  });
}

listen(START_PORT, MAX_TRIES);
