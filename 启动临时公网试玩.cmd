@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ARENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 if exist "E:\claude code\nodejs\node.exe" set "ARENA_NODE=E:\claude code\nodejs\node.exe"
"%ARENA_NODE%" --env-file-if-exists=.env scripts/quick-tunnel.mjs
echo.
echo 临时试玩已结束。再次启动会生成新网址；比赛记录和账户保存在本机。
pause
