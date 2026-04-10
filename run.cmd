@echo off
setlocal
title My AI Playground
powershell.exe -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if errorlevel 1 (
  echo.
  echo Inicializacao falhou. Veja as mensagens acima.
  pause
  exit /b %errorlevel%
)