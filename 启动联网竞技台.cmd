@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ARENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 if exist "E:\claude code\nodejs\node.exe" set "ARENA_NODE=E:\claude code\nodejs\node.exe"
"%ARENA_NODE%" --env-file-if-exists=.env scripts/launch.mjs
echo.
echo 竞技台服务已结束。如果端口被其他程序占用，请修改 .env 的 PORT 并同步调整 Tunnel。
pause
