@echo off
chcp 65001 >nul
setlocal
title 葛镜桥 · 三维高斯场景 · 本地服务器

rem ===========================================================================
rem  一键启动本地服务器
rem
rem  为什么需要这个脚本：
rem    Windows 上 `python` 常常指向 Microsoft Store 的「应用执行别名」占位符
rem    (AppData\Local\Microsoft\WindowsApps\python.exe)，而不是真正安装的 Python。
rem    直接运行 python tools/serve.py 会得到：
rem      "Python was not found; run without arguments to install from the Microsoft Store"
rem    本脚本会自动找到真正可用的 Python，无需手工配 PATH。
rem
rem  Python 是官方自带的，本脚本只用标准库，不需要 pip 安装任何东西。
rem ===========================================================================

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "PORT=8123"
set "PY="

rem ---------------------------------------------------------------- 1) py 启动器
rem Python 官方安装器默认会装上 C:\Windows\py.exe，它不受应用别名干扰
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PY=py -3"

rem -------------------------------------------------------- 2) 常见安装位置探测
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
if not defined PY call :probe "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
if not defined PY call :probe "C:\Python314\python.exe"
if not defined PY call :probe "C:\Python313\python.exe"
if not defined PY call :probe "C:\Python312\python.exe"
if not defined PY call :probe "C:\Python311\python.exe"
if not defined PY call :probe "C:\Python310\python.exe"
if not defined PY call :probe "C:\Program Files\Python313\python.exe"
if not defined PY call :probe "C:\Program Files\Python312\python.exe"
if not defined PY call :probe "C:\Program Files\Python311\python.exe"
if not defined PY call :probe "C:\Program Files\Python310\python.exe"

if not defined PY (
  echo.
  echo   [错误] 没有找到可用的 Python 3
  echo.
  echo   解决办法（任选一种）：
  echo     1. 安装 Python 3 —— https://www.python.org/downloads/
  echo        安装时务必勾选 "Add python.exe to PATH"
  echo     2. 或启用 py 启动器（安装 Python 时默认勾选 "py launcher"）
  echo.
  pause
  exit /b 1
)

rem ------------------------------------------------------------------ 启动服务
echo.
echo   本地服务器正在启动 ...
echo   使用解释器 : %PY%
echo   项目目录   : %HERE%
echo.
echo   地址 : http://localhost:%PORT%/
echo   提示 : 浏览器会自动打开；若提示无法访问，等 1~2 秒按 F5 刷新即可
echo   停止 : 在本窗口按 Ctrl + C
echo.

rem 延迟 2 秒再打开浏览器，确保服务器已经绑定端口
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%/"

%PY% "%HERE%\tools\serve.py" %PORT%

echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
exit /b 0

rem ------------------------------------------------------------------ 子过程
:probe
if defined PY exit /b 0
if exist %1 set PY="%~1"
exit /b 0
