@echo off
setlocal
node "%~dp0src\server.mjs"
exit /b %errorlevel%
