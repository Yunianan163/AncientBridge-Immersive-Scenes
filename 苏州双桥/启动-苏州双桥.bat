@echo off
chcp 65001 >nul
title 苏州双桥服务器

:: 本脚本就放在苏州双桥项目根目录下，直接把脚本所在目录当作项目路径
set "PROJECT_DIR=%~dp0"
:: 去掉路径末尾的反斜杠，避免 cd 时被误判
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo ========================================
echo    苏州双桥 - 服务器启动器
echo ========================================
echo.
echo 项目路径: %PROJECT_DIR%
echo.

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
    echo 错误: 无法进入目录 %PROJECT_DIR%
    pause
    exit /b 1
)

if not exist "server.js" (
    echo 错误: 当前目录下找不到 server.js
    echo 请确认本脚本与 server.js 放在同一个文件夹里。
    pause
    exit /b 1
)

echo 正在检查依赖...

if not exist "node_modules" (
    echo 首次运行，正在安装依赖...
    call npm install ws
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo    服务器启动完成
echo ========================================
echo 主服务器:     http://127.0.0.1:8082
echo WebSocket:    ws://127.0.0.1:8082/ws
echo 语音对话:     http://127.0.0.1:8082/voice
echo 语音代理:     ws://127.0.0.1:8082/voice-proxy
echo ========================================
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

node server.js

pause
