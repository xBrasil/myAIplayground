param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Host.UI.RawUI.WindowTitle = "My AI Playground"

# --- i18n ---
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $repoRoot "scripts\i18n.ps1")
Initialize-I18n -RepoRoot $repoRoot

function Write-Step {
    param([string]$Message)
    $ts = Get-Date -Format 'HH:mm:ss'
    Write-Host "`n[$ts] ==> $Message" -ForegroundColor Cyan
}

function Test-HttpReady {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

# --- Paths ---
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir  = Join-Path $repoRoot "backend"
$dataDir     = Join-Path $repoRoot "data"
$venvPython  = Join-Path $repoRoot ".venv\Scripts\python.exe"
$backendLog  = Join-Path $dataDir "system\logs\backend.log"
$frontendLog = Join-Path $dataDir "system\logs\frontend.log"

# --- Pre-flight checks ---
if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
    throw (T 'script.run.packageJsonNotFound')
}
if (-not (Test-Path $venvPython)) {
    throw (T 'script.run.venvNotFound')
}
if (-not (Test-Path (Join-Path $dataDir "system\.env")) -and -not (Test-Path (Join-Path $dataDir ".env"))) {
    throw (T 'script.run.envNotFound')
}

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "system\logs") | Out-Null

# --- Port resolution ---
# Helper: kill stale processes on a given port that belong to this repo
function Free-Port {
    param([int]$Port)
    try {
        $repoRootLower = $repoRoot.ToLowerInvariant().TrimEnd('\') + '\'
        $portPattern = [regex]::Escape(":$Port") + '\s'
        $netstat = netstat -ano -p TCP 2>$null | Select-String $portPattern | Select-String "LISTENING"
        foreach ($line in $netstat) {
            $pid = ($line -split '\s+')[-1]
            if ($pid -match '^\d+$' -and [int]$pid -gt 0) {
                try {
                    $proc = Get-Process -Id ([int]$pid) -ErrorAction SilentlyContinue
                    $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue

                    $procPath = if ($proc -and $proc.Path) { $proc.Path.ToLowerInvariant() } else {
                        if ($cimProc -and $cimProc.ExecutablePath) { $cimProc.ExecutablePath.ToLowerInvariant() } else { $null }
                    }
                    $commandLine = if ($cimProc -and $cimProc.CommandLine) { $cimProc.CommandLine.ToLowerInvariant() } else { $null }

                    $belongsToRepo = ($procPath -and $procPath.StartsWith($repoRootLower)) -or
                                     ($commandLine -and $commandLine.Contains($repoRootLower))

                    if ($belongsToRepo) {
                        Write-Host "  Killing stale process PID $pid on port $Port" -ForegroundColor Yellow
                        Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
                        Start-Sleep -Milliseconds 500
                    }
                } catch {}
            }
        }
    } catch {}
}

# Helper: find a free port starting from $StartPort
function Find-FreePort {
    param([int]$StartPort, [int]$MaxTries = 10)
    for ($i = 0; $i -lt $MaxTries; $i++) {
        $port = $StartPort + $i
        $portPattern = [regex]::Escape(":$port") + '\s'
        $listener = netstat -ano -p TCP 2>$null | Select-String $portPattern | Select-String "LISTENING"
        if (-not $listener) { return $port }
    }
    $endPort = $StartPort + $MaxTries - 1
    throw (T 'script.run.noFreePort' @{start="$StartPort"; end="$endPort"; tries="$MaxTries"})
}

# Try to free default ports first (kill stale processes from previous runs)
Free-Port -Port 8000
Free-Port -Port 5173

# Determine available ports
$backendPort  = Find-FreePort -StartPort 8000
$frontendPort = Find-FreePort -StartPort 5173

if ($backendPort -ne 8000) {
    Write-Host "  Port 8000 is busy — using port $backendPort for backend" -ForegroundColor Yellow
}
if ($frontendPort -ne 5173) {
    Write-Host "  Port 5173 is busy — using port $frontendPort for frontend" -ForegroundColor Yellow
}

# Set env vars for child processes (backend reads API_PORT, Vite exposes VITE_*)
$env:API_PORT = $backendPort
$env:VITE_API_PORT = $backendPort

# Write ports state file for tray.py (no BOM — PS 5.1 Set-Content adds one)
$portsFile = Join-Path $dataDir "system\.ports"
$portsJson = @{ backend = $backendPort; frontend = $frontendPort } | ConvertTo-Json
[IO.File]::WriteAllText($portsFile, $portsJson)

$backendUrl  = "http://127.0.0.1:${backendPort}/api/health"
$frontendUrl = "http://127.0.0.1:${frontendPort}"

# --- Track child processes ---
$script:children = @()

function Stop-Children {
    foreach ($p in $script:children) {
        if (-not $p.HasExited) {
            Write-Host (T 'script.run.killingTree' @{id="$($p.Id)"}) -ForegroundColor Yellow
            try {
                # taskkill /T kills the entire process tree reliably on Windows
                taskkill /F /T /PID $p.Id 2>$null | Out-Null
            } catch {}
        }
    }
    # Fallback: kill any remaining processes on our ports that belong to this repo
    $repoRootLower = $repoRoot.ToLowerInvariant().TrimEnd('\') + '\'
    foreach ($port in @($backendPort, $frontendPort)) {
        try {
            $portPattern = [regex]::Escape(":$port") + '\s'
            $netstat = netstat -ano -p TCP 2>$null | Select-String $portPattern | Select-String "LISTENING"
            foreach ($line in $netstat) {
                $pid = ($line -split '\s+')[-1]
                if ($pid -match '^\d+$' -and [int]$pid -gt 0) {
                    try {
                        $proc = Get-Process -Id ([int]$pid) -ErrorAction SilentlyContinue
                        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue

                        $procPath = if ($proc -and $proc.Path) { $proc.Path.ToLowerInvariant() } else {
                            if ($cimProc -and $cimProc.ExecutablePath) { $cimProc.ExecutablePath.ToLowerInvariant() } else { $null }
                        }
                        $commandLine = if ($cimProc -and $cimProc.CommandLine) { $cimProc.CommandLine.ToLowerInvariant() } else { $null }

                        $belongsToRepo = ($procPath -and $procPath.StartsWith($repoRootLower)) -or
                                         ($commandLine -and $commandLine.Contains($repoRootLower))

                        if ($belongsToRepo) {
                            Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
                        }
                    } catch {}
                }
            }
        } catch {}
    }
    # Remove ports state file
    Remove-Item -Path $portsFile -Force -ErrorAction SilentlyContinue
}

# Clean up children when PowerShell exits
Register-EngineEvent PowerShell.Exiting -Action { Stop-Children } | Out-Null

# --- Start backend ---
$backendAlreadyRunning = Test-HttpReady -Url $backendUrl
if ($backendAlreadyRunning) {
    Write-Step (T 'script.run.backendAlreadyRunning')
} else {
    Write-Step (T 'script.run.startingBackend')
    $backendProc = Start-Process -FilePath $venvPython `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$backendPort", "--log-config", "log_config.json" `
        -WorkingDirectory $backendDir `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError (Join-Path $dataDir "system\logs\backend-err.log")
    $script:children += $backendProc
}

# --- Start frontend ---
$frontendAlreadyRunning = Test-HttpReady -Url $frontendUrl
if ($frontendAlreadyRunning) {
    Write-Step (T 'script.run.frontendAlreadyRunning')
} else {
    Write-Step (T 'script.run.startingFrontend')
    $env:MYAI_NO_WATCH = "1"
    # Wrap in powershell to prepend timestamps to each line
    $frontendCmd = @"
& cmd.exe /c 'npm run dev -- --host=127.0.0.1 --port=$frontendPort --strictPort' 2>&1 |
    ForEach-Object { "`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') `$_" } |
    Out-File -FilePath "$frontendLog" -Encoding utf8
"@
    $encodedFrontendCmd = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($frontendCmd))
    $frontendProc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedFrontendCmd `
        -WorkingDirectory $frontendDir `
        -NoNewWindow -PassThru
    $script:children += $frontendProc
}

# --- Wait for readiness ---
Write-Step (T 'script.run.waitingServices')
$timeout = 120
$deadline = (Get-Date).AddSeconds($timeout)
$backendReady  = $backendAlreadyRunning
$frontendReady = $frontendAlreadyRunning

while ((Get-Date) -lt $deadline) {
    if (-not $backendReady)  { $backendReady  = Test-HttpReady -Url $backendUrl }
    if (-not $frontendReady) { $frontendReady = Test-HttpReady -Url $frontendUrl }

    if ($backendReady -and $frontendReady) { break }

    # Check for dead processes
    foreach ($p in $script:children) {
        if ($p.HasExited -and $p.ExitCode -ne 0) {
            $name = if ($p.Id -eq $backendProc.Id) { "Backend" } else { "Frontend" }
            Stop-Children
            throw (T 'script.run.unexpectedExit' @{name=$name; code="$($p.ExitCode)"})
        }
    }

    Start-Sleep -Milliseconds 800
}

if (-not $backendReady -or -not $frontendReady) {
    Stop-Children
    $missing = @()
    if (-not $backendReady)  { $missing += "Backend" }
    if (-not $frontendReady) { $missing += "Frontend" }
    throw (T 'script.run.serviceNotReady' @{services=($missing -join ' + '); timeout="$timeout"})
}

Write-Host "`n  Backend:  http://127.0.0.1:$backendPort" -ForegroundColor Green
Write-Host "  Frontend: $frontendUrl" -ForegroundColor Green

# --- Open browser ---
if (-not $NoBrowser) {
    Write-Step (T 'script.run.openingBrowser')
    Start-Process $frontendUrl
}

Write-Host "`n$(T 'script.run.allReady')" -ForegroundColor Green
Write-Host "$(T 'script.run.logsInfo')`n" -ForegroundColor DarkGray

# --- Minimize console window ---
Add-Type -Name ConsoleUtil -Namespace Win32 -MemberDefinition @'
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
'@ -ErrorAction SilentlyContinue
$hwnd = [Win32.ConsoleUtil]::GetConsoleWindow()
if ($hwnd -ne [IntPtr]::Zero) {
    [Win32.ConsoleUtil]::ShowWindow($hwnd, 6) | Out-Null  # SW_MINIMIZE
}

# --- Keep alive ---
try {
    while ($true) {
        foreach ($p in $script:children) {
            if ($p.HasExited) {
                $name = if ($backendProc -and $p.Id -eq $backendProc.Id) { "Backend" } else { "Frontend" }
                Write-Host "`n$(T 'script.run.processExited' @{name=$name; code="$($p.ExitCode)"})" -ForegroundColor Red
                Stop-Children
                exit $p.ExitCode
            }
        }
        # Also check if backend API is still reachable — the HTTP
        # check detects a clean /api/shutdown exit even if the process
        # object hasn't updated HasExited yet.
        if (-not (Test-HttpReady -Url $backendUrl)) {
            Start-Sleep -Seconds 2
            if (-not (Test-HttpReady -Url $backendUrl)) {
                Write-Host "`n$(T 'script.run.processExited' @{name='Backend'; code='0'})" -ForegroundColor Red
                Stop-Children
                exit 0
            }
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "`n$(T 'script.run.shuttingDown')" -ForegroundColor Yellow
    Stop-Children
}