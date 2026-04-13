@echo off
title My AI Playground
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" %*
if errorlevel 1 (
  echo.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". '%~dp0scripts\i18n.ps1'; Initialize-I18n -RepoRoot '%~dp0.'; Write-Host (T 'script.runCmd.failed')"
  pause
  exit /b %errorlevel%
)