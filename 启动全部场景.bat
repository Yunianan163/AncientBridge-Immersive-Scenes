@echo off
setlocal
title 古桥数字场景 - 一键启动全部场景

rem ===========================================================================
rem  古桥数字场景 · 总启动器
rem
rem  一次拉起四个服务，每个服务占一个独立控制台窗口：
rem      ① 场景选择页面    http://localhost:8080
rem      ② 苏州双桥        http://127.0.0.1:8082
rem      ③ 贵州葛镜桥      http://localhost:8123
rem      ④ 文创共创体验    http://localhost:5173   （后端 3001）
rem
rem  本文件必须放在「项目网页」文件夹里，双击运行即可。
rem  关掉本窗口不会停止已启动的服务；
rem  想停服务，请跑到对应的那个服务窗口按 Ctrl+C（或直接关掉它）。
rem
rem  【关于编码】本文件保存为 ANSI/GBK，故意不写 chcp 65001。
rem  原因：cmd 是按字节偏移读批处理文件的，一旦文件读到一半改了代码页，
rem  读取位置就会错位——中文注释会被当成命令去执行，命令行被腰斩，
rem  刷出一堆 "'xxx' is not recognized as an internal or external command"。
rem  所以让本文件直接跟随控制台默认代码页（中文 Windows 就是 936），
rem  需要 UTF-8 的子窗口各自在命令开头 chcp 65001。
rem  改动本文件时请保持 GBK 编码，不要存成 UTF-8。
rem ===========================================================================

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

set "DIR_SELECT=%HERE%\场景选择页面"
set "DIR_SUZHOU=%HERE%\苏州双桥"
set "DIR_GEJIN=%HERE%\贵州葛镜桥"
set "DIR_WENCHUANG=%HERE%\文创共创体验\wenchuang-customizer"

set "PORT_SELECT=8080"
set "PORT_SUZHOU=8082"
set "PORT_GEJIN=8123"
set "PORT_WENCHUANG=5173"
set "PORT_API=3001"

echo.
echo  ============================================================
echo    古桥数字场景  -  一键启动全部场景
echo  ============================================================
echo.
echo    项目根目录 : %HERE%
echo.

rem ---------------------------------------------------------------- 1/5 目录自检
set "BAD="
if not exist "%DIR_SELECT%\index.html" (
  echo    [错误] 缺少 场景选择页面\index.html
  set "BAD=1"
)
if not exist "%DIR_SELECT%\serve.js" (
  echo    [错误] 缺少 场景选择页面\serve.js
  set "BAD=1"
)
if not exist "%DIR_SUZHOU%\server.js" (
  echo    [错误] 缺少 苏州双桥\server.js
  set "BAD=1"
)
if not exist "%DIR_SUZHOU%\index.html" (
  echo    [错误] 缺少 苏州双桥\index.html
  set "BAD=1"
)
if not exist "%DIR_GEJIN%\index.html" (
  echo    [错误] 缺少 贵州葛镜桥\index.html
  set "BAD=1"
)
if not exist "%DIR_GEJIN%\tools\serve.py" (
  echo    [错误] 缺少 贵州葛镜桥\tools\serve.py
  set "BAD=1"
)
if not exist "%DIR_WENCHUANG%\package.json" (
  echo    [错误] 缺少 文创共创体验\wenchuang-customizer\package.json
  set "BAD=1"
)

if defined BAD (
  echo.
  echo    三个场景的文件夹不完整。
  echo    请确认本文件就放在「项目网页」文件夹里，且三个场景文件夹与它同级：
  echo.
  echo        项目网页\
  echo            启动全部场景.bat        本文件就在这一层
  echo            场景选择页面\
  echo            苏州双桥\
  echo            贵州葛镜桥\
  echo            文创共创体验\
  echo.
  pause
  exit /b 1
)
echo    [1/5] 目录结构正常（选择页 / 苏州双桥 / 贵州葛镜桥 / 文创共创体验）

rem ---------------------------------------------------------------- 2/5 运行环境
rem 找 Node：先看 PATH，再找常见安装目录，最后回落到 DeepSeek Harness 自带运行时。
rem 为什么加第三条：本机装过 Node 但 PATH 里没有时，旧版本会直接判「没装」然后退出，
rem 而内置运行时其实就在下面那个 dsh-runtimes 目录里，够用且无需任何安装。
set "NODE_CMD="
set "NODEVER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
if defined NODEVER set "NODE_CMD=node"

if not defined NODE_CMD if exist "%ProgramFiles%\nodejs\node.exe"           set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_CMD if exist "%ProgramFiles(x86)%\nodejs\node.exe"     set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_CMD if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_CMD=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_CMD if exist "%APPDATA%\npm\node.exe"                  set "NODE_CMD=%APPDATA%\npm\node.exe"

rem 注意：cmd 的 for %%A in (带 * 的引号路径) 不会展开通配符（引号内一律按字面处理），
rem 所以这里必须先 for /d 枚举 dsh-runtimes 下的运行时目录，再拼出 node.exe 全路径。
if not defined NODE_CMD (
  for /d %%R in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE_CMD if exist "%%~fR\dependencies\node\bin\node.exe" (
      set "NODE_CMD=%%~fR\dependencies\node\bin\node.exe"
      for /f "usebackq delims=" %%v in (`"%%~fR\dependencies\node\bin\node.exe" -v`) do set "NODEVER=%%v"
    )
  )
)

if not defined NODE_CMD (
  echo.
  echo    [错误] 没有找到 Node.js（PATH、常见安装目录、Harness 内置运行时都没找到）。
  echo           苏州双桥与文创共创体验都需要它，请安装 Node.js 20 或更高版本：
  echo               https://nodejs.org/
  echo           装完后关掉本窗口，重新双击本文件。
  echo.
  pause
  exit /b 1
)

rem 找 Python：Windows 上裸 python 可能落到 Microsoft Store 的占位符上，
rem 所以按「python -> py 启动器 -> 常见安装目录」的顺序探测，找到就用绝对路径。
rem 旧版本只试 `py -3`，而本机的 py 启动器指向了坏掉的解释器，于是直接判「没装 Python」。
set "PY="
set "PYVER="
call python -V >"%TEMP%\_dsh_pyver.txt" 2>&1
set /p PYVER=<"%TEMP%\_dsh_pyver.txt"
del "%TEMP%\_dsh_pyver.txt" >nul 2>nul
echo %PYVER% | findstr /C:"Python 3" >nul && set "PY=python"

if not defined PY (
  call py -3 -V >"%TEMP%\_dsh_pyver.txt" 2>&1
  set /p PYVER=<"%TEMP%\_dsh_pyver.txt"
  del "%TEMP%\_dsh_pyver.txt" >nul 2>nul
  echo %PYVER% | findstr /C:"Python 3" >nul && set "PY=py -3"
)

if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"  set PY="%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
if not defined PY if exist "C:\Python313\python.exe" set PY="C:\Python313\python.exe"
if not defined PY if exist "C:\Python312\python.exe" set PY="C:\Python312\python.exe"
if not defined PY if exist "C:\Python311\python.exe" set PY="C:\Python311\python.exe"
if not defined PY if exist "C:\Python310\python.exe" set PY="C:\Python310\python.exe"
if not defined PY if exist "C:\Program Files\Python313\python.exe" set PY="C:\Program Files\Python313\python.exe"
if not defined PY if exist "C:\Program Files\Python312\python.exe" set PY="C:\Program Files\Python312\python.exe"
if not defined PY if exist "C:\Program Files\Python311\python.exe" set PY="C:\Program Files\Python311\python.exe"
if not defined PY if exist "C:\Program Files\Python310\python.exe" set PY="C:\Program Files\Python310\python.exe"

if defined PY (
  echo    [2/5] Node.js %NODEVER%   Python %PYVER%
) else (
  echo    [2/5] Node.js %NODEVER%   Python 未找到
  echo.
  echo    [警告] 没有找到可用的 Python 3，贵州葛镜桥那个窗口会起不来。
  echo           其余三个服务不受影响。
  echo           要补上：装 Python 3（安装时勾选 Add python.exe to PATH）
  echo                   https://www.python.org/downloads/
  echo.
)

rem ---------------------------------------------------------------- 3/5 依赖自检

rem 说明：Harness 自带的 node.exe 是「裸运行时」，不含 npm。
rem 所以先确认 npm 是否可用；若不可用但依赖树完整，就直接跳过安装往下走。
set "HAVE_NPM="
for /f "delims=" %%v in ('npm -v 2^>nul') do set "HAVE_NPM=1"

if not defined HAVE_NPM (
  set "NEED_INSTALL="
  if not exist "%DIR_SUZHOU%\node_modules\ws" set "NEED_INSTALL=1"
  if not exist "%DIR_WENCHUANG%\node_modules\vite\bin\vite.js" set "NEED_INSTALL=1"
  if defined NEED_INSTALL (
    echo.
    echo    [错误] 当前用的是 Harness 自带运行时，它不带 npm，而这两个依赖还没装：
    echo           苏州双桥       需要 ws
    echo           文创共创体验   需要 vite 等
    echo.
    echo           两个办法任选其一：
    echo             1^) 装一个完整的 Node.js 20+（内含 npm）：https://nodejs.org/
    echo                装完关掉本窗口、重新双击本文件即可。
    echo             2^) 保持现状，只用「场景选择页面 8080」与「贵州葛镜桥 8123」，
    echo                这两个场景不需要 npm。
    echo.
    pause
    exit /b 1
  )
  echo    [3/5] 依赖已就绪（npm 不可用，但依赖树完整，跳过安装）
  goto :deps_ok
)
if not exist "%DIR_SUZHOU%\node_modules\ws" (
  echo.
  echo    [3/5] 苏州双桥：首次运行，安装依赖 ws ...
  pushd "%DIR_SUZHOU%"
  call npm install ws --no-audit --no-fund
  popd
)

if not exist "%DIR_WENCHUANG%\node_modules\vite\bin\vite.js" (
  echo.
  echo    [3/5] 文创共创体验：首次运行，安装依赖（约 1~3 分钟，请耐心等）...
  pushd "%DIR_WENCHUANG%"
  call npm install --no-audit --no-fund
  popd
)

if not exist "%DIR_WENCHUANG%\node_modules\vite\bin\vite.js" (
  echo    [警告] 文创共创体验的依赖没装成功，它那个窗口会起不来。
  echo           可以单独去 wenchuang-customizer 里跑一次 npm install 看报错。
) else (
  echo    [3/5] 依赖已就绪
)

:deps_ok

if not exist "%DIR_WENCHUANG%\.env" (
  echo          提醒：文创共创体验没有 .env 文件，AI 生图会不可用（其余功能正常）
)

rem ---------------------------------------------------------------- 4/5 端口检查
set "BUSY_SELECT="
set "BUSY_SUZHOU="
set "BUSY_GEJIN="
set "BUSY_WENCHUANG="
set "BUSY_API="

netstat -ano | findstr ":%PORT_SELECT%"    | findstr "LISTENING" >nul 2>nul && set "BUSY_SELECT=1"
netstat -ano | findstr ":%PORT_SUZHOU%"    | findstr "LISTENING" >nul 2>nul && set "BUSY_SUZHOU=1"
netstat -ano | findstr ":%PORT_GEJIN%"     | findstr "LISTENING" >nul 2>nul && set "BUSY_GEJIN=1"
netstat -ano | findstr ":%PORT_WENCHUANG%" | findstr "LISTENING" >nul 2>nul && set "BUSY_WENCHUANG=1"
netstat -ano | findstr ":%PORT_API%"       | findstr "LISTENING" >nul 2>nul && set "BUSY_API=1"

echo.
echo    [4/5] 端口占用检查
if defined BUSY_SELECT    echo           %PORT_SELECT% 已被占用 —— 选择页可能已经在跑，跳过启动
if defined BUSY_SUZHOU    echo           %PORT_SUZHOU% 已被占用 —— 苏州双桥可能已经在跑，跳过启动
if defined BUSY_GEJIN     echo           %PORT_GEJIN% 已被占用 —— 贵州葛镜桥可能已经在跑，跳过启动
if defined BUSY_WENCHUANG echo           %PORT_WENCHUANG% 已被占用 —— 文创共创体验可能已经在跑，跳过启动
if not defined BUSY_SELECT if not defined BUSY_SUZHOU if not defined BUSY_GEJIN if not defined BUSY_WENCHUANG echo           四个服务端口都空闲，可以放心启动
if defined BUSY_API       echo           注意：后端 %PORT_API% 被占用，文创的 AI 生图 / 下单可能会失败

rem ---------------------------------------------------------------- 5/5 拉起服务
echo.
echo    [5/5] 正在启动各服务窗口 ...
echo.

if defined BUSY_SELECT (
  echo          跳过 场景选择页面（已在运行）
) else (
  start "1_场景选择页面_%PORT_SELECT%" /D "%DIR_SELECT%" cmd /k "chcp 65001 >nul && ""%NODE_CMD%"" serve.js %PORT_SELECT%"
  echo          已启动 场景选择页面     - http://localhost:%PORT_SELECT%/
)

if defined BUSY_SUZHOU (
  echo          跳过 苏州双桥（已在运行）
) else (
  start "2_苏州双桥_%PORT_SUZHOU%" /D "%DIR_SUZHOU%" cmd /k "chcp 65001 >nul && ""%NODE_CMD%"" server.js"
  echo          已启动 苏州双桥         - http://127.0.0.1:%PORT_SUZHOU%/
)

if defined BUSY_GEJIN (
  echo          跳过 贵州葛镜桥（已在运行）
) else (
  if defined PY (
    start "3_贵州葛镜桥_%PORT_GEJIN%" /D "%DIR_GEJIN%" cmd /k "chcp 65001 >nul && %PY% tools\serve.py %PORT_GEJIN%"
    echo          已启动 贵州葛镜桥       - http://localhost:%PORT_GEJIN%/
  ) else (
    echo          跳过 贵州葛镜桥（本机没有找到 Python 3）
  )
)

if defined BUSY_WENCHUANG (
  echo          跳过 文创共创体验（已在运行）
) else (
  start "4_文创共创体验_%PORT_WENCHUANG%" /D "%DIR_WENCHUANG%" cmd /k "chcp 65001 >nul && npm run dev:all"
  echo          已启动 文创共创体验     - http://localhost:%PORT_WENCHUANG%/
)

rem ---------------------------------------------------------------- 打开选择页
echo.
echo  ============================================================
echo    全部就绪，正在打开场景选择页面 ...
echo.
echo      场景选择页面    http://localhost:%PORT_SELECT%/
echo      苏州双桥        http://127.0.0.1:%PORT_SUZHOU%/
echo      贵州葛镜桥      http://localhost:%PORT_GEJIN%/
echo      文创共创体验    http://localhost:%PORT_WENCHUANG%/
echo.
echo    第一次启动要等几秒（文创的前端编译最慢），
echo    选择页上的状态点变绿就表示该场景可用。
echo.
echo    停止服务：到各个服务窗口按 Ctrl+C
echo  ============================================================
echo.

rem 等约 9 秒，让各服务先把端口绑上，再开浏览器
start "" /min cmd /c "ping -n 10 127.0.0.1 >nul & start http://localhost:%PORT_SELECT%/"

echo    本窗口可以关掉了（不会影响已经启动的服务）。
echo.
pause
