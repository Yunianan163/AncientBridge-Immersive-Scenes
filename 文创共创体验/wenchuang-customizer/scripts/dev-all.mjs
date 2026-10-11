#!/usr/bin/env node
/**
 * 一条命令同时起「后端(3001) + 前端(5173)」，不必开两个终端。
 *
 * 零依赖：用 node 直接跑两个入口，不引 concurrently 之类的包。
 *   - 后端：server/index.js
 *   - 前端：node_modules/vite/bin/vite.js
 *
 * Ctrl+C 会把两个子进程一起收掉；任一子进程自己挂了，另一个也会跟着退，
 * 避免出现「后端死了但前端还在跑，点生图报 502 却不知道为什么」。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
const RED = '\x1b[31m'

const targets = [
  { label: `${CYAN}[后端]${RESET}`, entry: path.join(root, 'server', 'index.js') },
  { label: `${MAGENTA}[前端]${RESET}`, entry: path.join(root, 'node_modules', 'vite', 'bin', 'vite.js') },
]

const children = []
let closing = false

const shutdown = (code = 0) => {
  if (closing) return
  closing = true
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* 已经退出了 */
    }
  }
  // 给子进程一点时间打印遗言，再退
  setTimeout(() => process.exit(code), 300)
}

const pipeWithPrefix = (stream, label) => {
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) console.log(`${label} ${line}`)
  })
}

for (const { label, entry } of targets) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  pipeWithPrefix(child.stdout, label)
  pipeWithPrefix(child.stderr, label)

  child.on('error', (error) => {
    console.error(`${RED}[启动失败]${RESET} ${entry}\n  ${error.message}`)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (closing) return
    const reason = signal ? `信号 ${signal}` : `退出码 ${code}`
    console.error(`${RED}${label} 进程结束了（${reason}）${RESET}`)
    if (code === 1 || code === null) {
      console.error(`${DIM}提示：若报端口占用，先确认 3001 / 5173 没有被别的程序占着。${RESET}`)
    }
    shutdown(code ?? 1)
  })
}

console.log(`${DIM}正在启动后端(3001)与前端(5173)… 按 Ctrl+C 一起停止。${RESET}`)

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
