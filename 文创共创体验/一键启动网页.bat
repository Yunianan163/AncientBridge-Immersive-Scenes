@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 古桥文创定制器 - 本地服务

rem ============================================================
rem  古桥文创定制器 一键启动
rem  放在「网页」文件夹里，双击即可。
rem  作用是：检查环境 -> 拉起后端 3001 + 前端 5173 -> 打开浏览器
rem ============================================================

cd /d "%~dp0wenchuang-customizer" 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 在 "%CD%" 里找不到 wenchuang-customizer 文件夹。
  echo          请把本文件放在「网页」文件夹里再双击。
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo    古桥文创定制器  -  一键启动
echo  ============================================================
echo.

rem ---------- 1/4 检查 Node ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js。
  echo          请先安装 Node.js 20 或更高版本：https://nodejs.org/
  echo          装完关掉这个窗口，重新双击本文件。
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo   [1/4] Node.js !NODEVER!

rem ---------- 2/4 检查依赖 ----------
if not exist "node_modules\vite\bin\vite.js" (
  echo   [2/4] 首次运行，正在安装依赖，大约 1-3 分钟，请耐心等...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [错误] 依赖安装失败。请把上面的报错内容发给我。
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   [2/4] 依赖安装完成
) else (
  echo   [2/4] 依赖已就绪
)

rem ---------- 3/4 检查密钥 ----------
if exist ".env" (
  echo   [3/4] 已找到 .env，AI 生图可用
) else (
  echo   [3/4] 提醒：没有 .env 文件，AI 生图会不可用（其余功能正常）
  echo         需要的话把 .env.example 复制成 .env，填入硅基流动的 Key
)

rem ---------- 4/4 检查端口 ----------
set "BUSY5173="
set "BUSY3001="
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>nul && set "BUSY5173=1"
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul 2>nul && set "BUSY3001=1"

if defined BUSY5173 (
  echo   [4/4] 端口 5173 已被占用 —— 服务可能已经在跑了
  echo.
  echo  ------------------------------------------------------------
  echo    直接打开浏览器访问： http://localhost:5173
  echo    如果打不开，说明占着 5173 的是别的东西，可以先重启电脑再试。
  echo  ------------------------------------------------------------
  echo.
  start "" "http://localhost:5173"
  pause
  exit /b 0
)
if defined BUSY3001 (
  echo   [4/4] 警告：端口 3001 被占用，后端可能起不来
  echo         -^> AI 生图 / 下单会失败，但 3D 预览和贴图仍然可用
  echo         想清干净可以关掉其它 node 窗口，或者重启电脑
) else (
  echo   [4/4] 端口 3001 / 5173 都空闲
)

echo.
echo  ------------------------------------------------------------
echo    正在启动后端(3001) + 前端(5173) ...
echo.
echo    浏览器地址：   http://localhost:5173
echo    用完后在本窗口按 Ctrl+C 停止服务
echo    本窗口不要关，关掉就等于把服务停了
echo  ------------------------------------------------------------
echo.

rem 服务起来需要几秒，等 8 秒再自动打开浏览器
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 8; Start-Process 'http://localhost:5173'"

call npm run dev:all

echo.
echo  服务已停止（按 Ctrl+C 或直接关窗口都可以）。
echo.
pause
