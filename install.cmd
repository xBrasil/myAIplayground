@echo off
setlocal
cd /d "%~dp0"

powershell.exe -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". '%~dp0scripts\i18n.ps1'; Initialize-I18n -RepoRoot '%~dp0.'; Write-Host (T 'script.installCmd.failed' @{path='%~dp0install.log'})"
  pause
  exit /b %errorlevel%
)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". '%~dp0scripts\i18n.ps1'; Initialize-I18n -RepoRoot '%~dp0.'; Write-Host (T 'script.installCmd.done' @{path='%~dp0install.log'}); Write-Host (T 'script.installCmd.useRunCmd')"
pause