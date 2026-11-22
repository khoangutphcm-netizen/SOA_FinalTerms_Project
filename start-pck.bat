@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-pck.ps1" -Mode Local
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-pck.ps1" %*
)
exit /b %errorlevel%
