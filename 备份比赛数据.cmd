@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ARENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 if exist "E:\claude code\nodejs\node.exe" set "ARENA_NODE=E:\claude code\nodejs\node.exe"
"%ARENA_NODE%" scripts/backup.mjs
echo.
echo 数据备份流程已结束。
pause
