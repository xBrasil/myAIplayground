@echo off
:: My AI Playground — System tray launcher (no console window)
:: Uses pythonw.exe to avoid showing a console window.
:: For debug/verbose mode with a visible console, use run.cmd instead.
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0scripts\tray.py" %*
