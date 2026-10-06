@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ARENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 if exist "E:\claude code\nodejs\node.exe" set "ARENA_NODE=E:\claude code\nodejs\node.exe"
"%ARENA_NODE%" scripts/install.mjs
echo.
echo 初始化流程已结束。已有账户不会被覆盖；密码在 data 目录的首次登录文件中。
pause
