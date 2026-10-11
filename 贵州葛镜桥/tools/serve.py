# -*- coding: utf-8 -*-
"""
serve.py — 本地开发服务器

为什么不用 `python -m http.server`：
  1. 需要发送 COOP / COEP 响应头，让页面进入「跨源隔离」状态，
     从而启用 SharedArrayBuffer —— 高斯排序 Worker 靠它提速约一倍。
  2. 需要为 .ply / .ksplat / .splat / .glb 补上正确的 MIME 类型。
  3. 需要多线程，否则 248 MB 模型下载时页面其他请求会被阻塞。
  4. 顺带把实时语音的 WebSocket 代理（tools/voice-proxy.mjs）拉起来，
     这样两个启动器（启动服务器.bat / 启动全部场景.bat）都不用改。

用法：
    python tools/serve.py            # 默认 8123 端口
    python tools/serve.py 9000       # 指定端口
"""

import functools
import glob
import http.server
import mimetypes
import os
import shutil
import socket
import socketserver
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 指向 web/

# ---------------------------------------------------------------------------
# MIME 类型映射
#
# 踩过的坑：Windows 注册表经常把 .js 注册成 text/plain，而 Python 的 mimetypes
# 会去读注册表，于是本地服务器给 .js 返回 text/plain —— 浏览器对 ES module 有
# 严格的 MIME 校验，会直接拒绝加载脚本，页面表现是「完全没反应」，控制台也不
# 报错。所以这里必须显式指定，不依赖系统推断。
# ---------------------------------------------------------------------------
EXTRA_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    # 三维资源
    '.ply': 'application/octet-stream',
    '.ksplat': 'application/octet-stream',
    '.splat': 'application/octet-stream',
    '.spz': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
}

for _ext, _mime in EXTRA_TYPES.items():
    mimetypes.add_type(_mime, _ext)


class Handler(http.server.SimpleHTTPRequestHandler):

    # SimpleHTTPRequestHandler 在模块导入时就把 mimetypes 快照成了类属性，
    # 所以必须直接覆盖，仅调用 add_type() 不会生效
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        **EXTRA_TYPES,
    }

    def end_headers(self):
        # 跨源隔离：这是启用 SharedArrayBuffer 的前提
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        # 协商缓存：文件没变走 304，避免每次刷新都重下 248 MB
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 静音常规请求，只留错误
        if args and str(args[1]).startswith(('4', '5')):
            sys.stderr.write('  [%s] %s\n' % (args[1], args[0]))

    # -----------------------------------------------------------------------
    # 浏览器中途断开时必须兜住，否则**整个服务器会被打死**
    #
    # 实测踩到的坑（2026-10-11）：8123 服务会莫名其妙整个退出，日志里刷满
    #   ConnectionResetError: [WinError 10054] 远程主机强迫关闭了一个现有的连接
    # 回溯链是  copyfile → shutil.copyfileobj → fdst_write → sendall。
    #
    # 成因：本页要传 247.9 MB 的 scene.ply，传输期间用户在浏览器里
    # 点了别的链接 / 刷新 / 按了停止加载 / 或者页面导航走了 —— 连接就断了。
    # 基类 SimpleHTTPRequestHandler 默认**不处理**这类异常，它一路冒泡到
    # socketserver 的 handle_error 并向上抛出，把 serve_forever() 打断，
    # 于是整个 8123 死掉。**每一次浏览器中断下载都能复现**。
    #
    # 这里把 copyfile 包一层：连接类错误只记一行、直接收工，绝不上抛。
    # 其余异常照旧抛出，免得把真正的 bug 也一起吞掉。
    # -----------------------------------------------------------------------
    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionError, BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # 客户端已经走了，这是常态而非故障 —— 静默收尾即可
            pass

    # -----------------------------------------------------------------------
    # 页面没放 favicon，浏览器每次开页都会来要一次，日志被 "404 /favicon.ico" 刷满，
    # 真正的错误反而被淹掉（排查断连问题时就是先看到几十行这个）。
    # 直接回 204 No Content：不发内容、不算错误、不进日志。
    # -----------------------------------------------------------------------
    def do_GET(self):
        if self.path.split('?')[0] == '/favicon.ico':
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def find_port(start, tries=30):
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    raise SystemExit('在 %d-%d 范围内找不到可用端口' % (start, start + tries))


def find_node():
    """找 Node：PATH → 常见安装目录 → Harness 自带运行时（与根启动器同一套顺序）。

    本机的 node 可能不在 PATH 里（例如只装了 Harness 自带运行时），
    而语音代理必须要 Node，所以这里自己探一遍，不指望用户配好环境。
    """
    found = shutil.which('node')
    if found:
        return found

    candidates = [
        r'C:\Program Files\nodejs\node.exe',
        r'C:\Program Files (x86)\nodejs\node.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\nodejs\node.exe'),
        os.path.expandvars(r'%APPDATA%\npm\node.exe'),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path

    base = os.path.expandvars(r'%USERPROFILE%\.dsh\dsh-runtimes')
    for runtime in glob.glob(os.path.join(base, '*')):
        exe = os.path.join(runtime, 'dependencies', 'node', 'bin', 'node.exe')
        if os.path.exists(exe):
            return exe
    return None


def start_voice_proxy():
    """顺带把实时语音的 WebSocket 代理拉起来。

    为什么由这里拉：葛镜桥的入口就是 serve.py，两个 .bat 都只调它。
    在服务端起这个子进程，就**不必改任何批处理文件** —— 尤其根启动器
    「启动全部场景.bat」是 GBK 编码的，动它容易把中文注释读乱。

    找不到 Node 时只是语音不可用，静态场景照常跑，不阻断。
    """
    script = os.path.join(ROOT, 'tools', 'voice-proxy.mjs')
    if not os.path.exists(script):
        return None

    node = find_node()
    if not node:
        # flush：Python 在管道/重定向下是块缓冲，不 flush 的话这几行会压在缓冲区里，
        # 而子进程（Node）却会立刻输出 —— 现象是「先看到代理日志，后看到横幅」，很难读
        print('  语音对话 : 未找到 Node.js —— 实时语音不可用（静态场景不受影响）', flush=True)
        return None

    try:
        # stdio 直接继承：两条日志各带自己的前缀（[voice-proxy] / serve 方），
        # 不用再包一层带颜色的转发
        proc = subprocess.Popen([node, script], cwd=ROOT)
        print('  语音对话 : ws://127.0.0.1:8124/voice-proxy   (pid %d)' % proc.pid, flush=True)
        return proc
    except OSError as err:
        print('  语音对话 : 启动失败 —— %s' % err, flush=True)
        return None


def main():
    want = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    port = find_port(want)

    handler = functools.partial(Handler, directory=ROOT)

    with Server(('127.0.0.1', port), handler) as httpd:
        print('')
        print('  葛镜桥 · 三维高斯场景')
        print('  ' + '-' * 46)
        print('  根目录 : %s' % ROOT)
        print('  地址   : http://localhost:%d/' % port)
        print('')

        voice = start_voice_proxy()

        print('')
        print('  跨源隔离 : 已开启（SharedArrayBuffer 可用）')
        print('  停止服务 : Ctrl + C')
        print('')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n  服务已停止')
        finally:
            # 别把语音代理晾成孤儿进程，它占着 8124 端口
            if voice and voice.poll() is None:
                voice.terminate()
                try:
                    voice.wait(timeout=3)
                except Exception:
                    voice.kill()


if __name__ == '__main__':
    main()
