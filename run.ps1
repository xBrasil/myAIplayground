param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Host.UI.RawUI.WindowTitle = "My AI Playground"

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
$repoRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
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
    throw "frontend/package.json nao encontrado. Rode a partir da raiz do repositorio."
}
if (-not (Test-Path $venvPython)) {
    throw ".venv nao encontrado. Rode install.cmd primeiro."
}
if (-not (Test-Path (Join-Path $backendDir ".env"))) {
    throw "backend/.env nao encontrado. Rode install.cmd primeiro."
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
            Write-Host "Encerrando arvore de processos $($p.Id)..." -ForegroundColor Yellow
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
    Write-Step "Backend ja esta em execucao; reutilizando instancia existente"
} else {
    Write-Step "Iniciando backend (log: data\backend.log)"
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
    Write-Step "Frontend ja esta em execucao; reutilizando instancia existente"
} else {
    Write-Step "Iniciando frontend (log: data\frontend.log)"
    $frontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run dev -- --host=127.0.0.1 --port=5173 --strictPort" `
        -WorkingDirectory $frontendDir `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $frontendLog `
        -RedirectStandardError (Join-Path $dataDir "frontend-err.log")
    $script:children += $frontendProc
}

# --- Wait for readiness ---
Write-Step "Aguardando servicos..."
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
            throw "$name encerrou inesperadamente (exit code $($p.ExitCode)). Verifique os logs em data\"
        }
    }

    Start-Sleep -Milliseconds 800
}

if (-not $backendReady -or -not $frontendReady) {
    Stop-Children
    $missing = @()
    if (-not $backendReady)  { $missing += "Backend" }
    if (-not $frontendReady) { $missing += "Frontend" }
    throw "$($missing -join ' e ') nao ficou pronto em ${timeout}s. Verifique os logs em data\"
}

Write-Host "`n  Backend:  http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "  Frontend: $frontendUrl" -ForegroundColor Green

# --- Open browser ---
if (-not $NoBrowser) {
    Write-Step "Abrindo navegador"
    Start-Process $frontendUrl
}

Write-Host "`nTudo pronto. Pressione Ctrl+C para encerrar." -ForegroundColor Green
Write-Host "Logs: data\backend.log, data\frontend.log`n" -ForegroundColor DarkGray

# --- Keep alive ---
try {
    while ($true) {
        foreach ($p in $script:children) {
            if ($p.HasExited) {
                $name = if ($backendProc -and $p.Id -eq $backendProc.Id) { "Backend" } else { "Frontend" }
                Write-Host "`n$name encerrou (exit code $($p.ExitCode))." -ForegroundColor Red
                Stop-Children
                exit $p.ExitCode
            }
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "`nEncerrando..." -ForegroundColor Yellow
    Stop-Children
}