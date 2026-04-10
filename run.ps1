param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Host.UI.RawUI.WindowTitle = "My AI Playground"

# --- i18n ---
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $repoRoot "scripts\i18n.ps1")
Initialize-I18n -RepoRoot $repoRoot

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
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
$backendLog  = Join-Path $dataDir "backend.log"
$frontendLog = Join-Path $dataDir "frontend.log"

$backendUrl  = "http://127.0.0.1:8000/api/health"
$frontendUrl = "http://127.0.0.1:5173"

# --- Pre-flight checks ---
if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
    throw (T 'script.run.packageJsonNotFound')
}
if (-not (Test-Path $venvPython)) {
    throw (T 'script.run.venvNotFound')
}
if (-not (Test-Path (Join-Path $backendDir ".env"))) {
    throw (T 'script.run.envNotFound')
}

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# --- Track child processes ---
$script:children = @()

function Get-ProcessTree {
    param([int]$ParentId)
    $result = @()
    try {
        $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue
        foreach ($kid in $kids) {
            $result += Get-ProcessTree -ParentId $kid.ProcessId
            $result += $kid.ProcessId
        }
    } catch {}
    return $result
}

function Stop-Children {
    foreach ($p in $script:children) {
        if (-not $p.HasExited) {
            Write-Host (T 'script.run.killingTree' @{id="$($p.Id)"}) -ForegroundColor Yellow
            try {
                # Kill entire descendant tree (llama-server, node, etc.) bottom-up
                $tree = Get-ProcessTree -ParentId $p.Id
                foreach ($pid in $tree) {
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    }
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
        -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000" `
        -WorkingDirectory $backendDir `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError (Join-Path $dataDir "backend-err.log")
    $script:children += $backendProc
}

# --- Start frontend ---
$frontendAlreadyRunning = Test-HttpReady -Url $frontendUrl
if ($frontendAlreadyRunning) {
    Write-Step (T 'script.run.frontendAlreadyRunning')
} else {
    Write-Step (T 'script.run.startingFrontend')
    $frontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run dev -- --host=127.0.0.1 --port=5173 --strictPort" `
        -WorkingDirectory $frontendDir `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $frontendLog `
        -RedirectStandardError (Join-Path $dataDir "frontend-err.log")
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

Write-Host "`n  Backend:  http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "  Frontend: $frontendUrl" -ForegroundColor Green

# --- Open browser ---
if (-not $NoBrowser) {
    Write-Step (T 'script.run.openingBrowser')
    Start-Process $frontendUrl
}

Write-Host "`n$(T 'script.run.allReady')" -ForegroundColor Green
Write-Host "$(T 'script.run.logsInfo')`n" -ForegroundColor DarkGray

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
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "`n$(T 'script.run.shuttingDown')" -ForegroundColor Yellow
    Stop-Children
}