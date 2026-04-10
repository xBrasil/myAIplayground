@echo off
setlocal
cd /d "%~dp0"

powershell.exe -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Instalacao falhou. Verifique o log: %~dp0install.log
  pause
  exit /b %errorlevel%
)
echo.
echo Instalacao concluida. Log salvo em: %~dp0install.log
echo Use run.cmd para iniciar a aplicacao.
pause