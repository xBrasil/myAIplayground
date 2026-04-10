param(
    [switch]$SkipCudaTorch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---- Helpers ----

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Refresh-Path {
    # Reload PATH from Machine + User so newly-installed tools are found
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:PATH = "$machine;$user"
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$FriendlyName,
        [string]$Override
    )
    Write-Host "  Instalando $FriendlyName via winget..." -ForegroundColor Yellow
    $wingetArgs = @("install", "--id", $PackageId, "--accept-source-agreements", "--accept-package-agreements", "-e")
    if ($Override) { $wingetArgs += @("--override", $Override) }
    $proc = Start-Process -FilePath "winget" -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
    Refresh-Path
    return $proc.ExitCode -eq 0
}

function Get-PythonBootstrapCommand {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return @($py.Source, "-3") }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { return @($python.Source) }
    return $null
}

# ---- Variables ----

$repoRoot    = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir  = Join-Path $repoRoot "backend"
$venvDir     = Join-Path $repoRoot ".venv"
$venvPython  = Join-Path $venvDir "Scripts\python.exe"
$envExample  = Join-Path $backendDir ".env.example"
$envFile     = Join-Path $backendDir ".env"
$logFile     = Join-Path $repoRoot "install.log"
$isAdmin     = Test-Admin
$isWindows   = $env:OS -eq "Windows_NT"
$hasWinget   = (Get-Command winget -ErrorAction SilentlyContinue) -ne $null

Start-Transcript -Path $logFile -Force | Out-Null
Write-Host "Log desta instalacao: $logFile" -ForegroundColor DarkGray
Write-Host "Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
if ($isAdmin) { Write-Host "Executando como Administrador" -ForegroundColor Green }

try {

# ---- 1. Prerequisites ----

Write-Step "Verificando pre-requisitos"

# Python
$pythonBootstrap = Get-PythonBootstrapCommand
if (-not $pythonBootstrap) {
    if ($isAdmin -and $hasWinget) {
        Install-WithWinget -PackageId "Python.Python.3.12" -FriendlyName "Python 3.12"
        $pythonBootstrap = Get-PythonBootstrapCommand
        if (-not $pythonBootstrap) { throw "Python nao encontrado apos instalacao. Reinicie o terminal e rode install.cmd novamente." }
    } else {
        throw "Python nao encontrado. Rode install.cmd como Administrador para instalar automaticamente, ou instale manualmente: https://python.org"
    }
}
Write-Host "  Python: OK" -ForegroundColor Green

# Node.js / npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    if ($isAdmin -and $hasWinget) {
        Install-WithWinget -PackageId "OpenJS.NodeJS.LTS" -FriendlyName "Node.js LTS"
        Refresh-Path
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw "npm nao encontrado apos instalacao do Node.js. Reinicie o terminal e rode install.cmd novamente."
        }
    } else {
        throw "Node.js/npm nao encontrado. Rode install.cmd como Administrador para instalar automaticamente, ou instale manualmente: https://nodejs.org"
    }
}
Write-Host "  Node.js/npm: OK" -ForegroundColor Green

# GPU detection
$hasNvidiaGpu = (-not $SkipCudaTorch) -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($hasNvidiaGpu) {
    Write-Host "  GPU NVIDIA: detectada" -ForegroundColor Green
} else {
    Write-Host "  GPU NVIDIA: nao detectada (llama-server usara CPU)" -ForegroundColor Yellow
}

# ---- 2. Python venv + backend deps ----

Write-Step "Criando ambiente virtual Python, se necessario"
if (-not (Test-Path $venvPython)) {
    if ($pythonBootstrap.Length -gt 1) {
        & $pythonBootstrap[0] $pythonBootstrap[1] -m venv $venvDir
    } else {
        & $pythonBootstrap[0] -m venv $venvDir
    }
}

Write-Step "Atualizando pip"
& $venvPython -m pip install --upgrade pip

Write-Step "Instalando dependencias do backend"
& $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")

# ---- 3. llama.cpp server (pre-built binary) ----

Write-Step "Instalando llama-server (binario pre-compilado)"
$llamaServerDir = Join-Path $repoRoot "data\llama-server"
$llamaVersionFile = Join-Path $llamaServerDir "version.txt"
$llamaInstalled = $false

# Detect OS + arch for asset matching
$assetPattern = $null
$cudaDllPattern = $null
if ($isWindows) {
    if ($hasNvidiaGpu) {
        # Detect CUDA driver version to pick the right binary
        $smiOutput = & nvidia-smi 2>&1 | Out-String
        $cudaMajor = 12  # default fallback
        if ($smiOutput -match 'CUDA Version:\s+(\d+)') {
            $cudaMajor = [int]$Matches[1]
        }
        if ($cudaMajor -ge 13) {
            $assetPattern = "*-bin-win-cuda-13*-x64*"
            $cudaDllPattern = "*cudart*-win-cuda-13*-x64*"
        } else {
            $assetPattern = "*-bin-win-cuda-12*-x64*"
            $cudaDllPattern = "*cudart*-win-cuda-12*-x64*"
        }
        Write-Host "  GPU NVIDIA detectada, CUDA driver $cudaMajor.x" -ForegroundColor Green
    } else {
        $assetPattern = "*-bin-win-cpu-x64*"
        Write-Host "  Sem GPU NVIDIA, usando versao CPU" -ForegroundColor Yellow
    }
} elseif ($IsMacOS) {
    $assetPattern = "*-bin-macos-arm64*"
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "X64") {
        $assetPattern = "*-bin-macos-x64*"
    }
} else {
    # Linux
    if ($hasNvidiaGpu) {
        $assetPattern = "*-bin-ubuntu-*vulkan*x64*"  # Vulkan as universal GPU option
    } else {
        $assetPattern = "*-bin-ubuntu-x64*"
    }
}

# Check if already installed and up-to-date
$currentVersion = if (Test-Path $llamaVersionFile) {
    (Get-Content $llamaVersionFile -Raw).Trim()
} else { "" }

$serverExe = if ($isWindows) { Join-Path $llamaServerDir "llama-server.exe" } else { Join-Path $llamaServerDir "llama-server" }

if ((Test-Path $serverExe) -and $currentVersion) {
    Write-Host "  llama-server $currentVersion ja instalado." -ForegroundColor Green
    $llamaInstalled = $true
}

if (-not $llamaInstalled) {
    Write-Host "  Consultando ultima versao do llama.cpp..." -ForegroundColor Cyan
    try {
        $releaseInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" `
            -Headers @{ "User-Agent" = "myAIplayground-installer" }
        $latestTag = $releaseInfo.tag_name

        # Find matching binary asset
        $binAsset = $releaseInfo.assets | Where-Object { $_.name -like $assetPattern -and $_.name -notlike "*cudart*" } | Select-Object -First 1
        if (-not $binAsset) {
            throw "Nenhum binario encontrado para o padrao: $assetPattern"
        }

        Write-Host "  Baixando $($binAsset.name) ($latestTag)..." -ForegroundColor Cyan

        # Create clean target directory
        if (Test-Path $llamaServerDir) { Remove-Item $llamaServerDir -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $llamaServerDir | Out-Null

        # Download and extract main binary
        $zipPath = Join-Path $env:TEMP $binAsset.name
        Invoke-WebRequest -Uri $binAsset.browser_download_url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $llamaServerDir -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue

        # Download and extract CUDA runtime DLLs if needed
        if ($cudaDllPattern) {
            $cudaAsset = $releaseInfo.assets | Where-Object { $_.name -like $cudaDllPattern } | Select-Object -First 1
            if ($cudaAsset) {
                Write-Host "  Baixando CUDA runtime DLLs ($($cudaAsset.name))..." -ForegroundColor Cyan
                $cudaZipPath = Join-Path $env:TEMP $cudaAsset.name
                Invoke-WebRequest -Uri $cudaAsset.browser_download_url -OutFile $cudaZipPath -UseBasicParsing
                Expand-Archive -Path $cudaZipPath -DestinationPath $llamaServerDir -Force
                Remove-Item $cudaZipPath -ErrorAction SilentlyContinue
            }
        }

        # Move files from subdirectories to root if needed (some zips nest in build/bin/)
        $nestedExe = Get-ChildItem -Path $llamaServerDir -Recurse -Filter "llama-server*" | Select-Object -First 1
        if ($nestedExe -and $nestedExe.Directory.FullName -ne $llamaServerDir) {
            Get-ChildItem -Path $nestedExe.Directory.FullName -File | Move-Item -Destination $llamaServerDir -Force
            # Also move DLLs from nested dirs
            Get-ChildItem -Path $llamaServerDir -Recurse -Filter "*.dll" | Where-Object {
                $_.Directory.FullName -ne $llamaServerDir
            } | Move-Item -Destination $llamaServerDir -Force
        }

        # Make executable on Unix
        if (-not $isWindows -and (Test-Path (Join-Path $llamaServerDir "llama-server"))) {
            chmod +x (Join-Path $llamaServerDir "llama-server")
        }

        # Save version
        $latestTag | Out-File -FilePath $llamaVersionFile -Encoding UTF8 -NoNewline
        $llamaInstalled = $true
        $variant = if ($cudaDllPattern) { "CUDA" } else { "CPU" }
        Write-Host "  llama-server $latestTag ($variant) instalado com sucesso." -ForegroundColor Green
    } catch {
        Write-Host "  ERRO ao baixar llama-server: $_" -ForegroundColor Red
        Write-Host "  Baixe manualmente: https://github.com/ggml-org/llama.cpp/releases/latest" -ForegroundColor Red
    }
}

# ---- 4. Frontend ----

Write-Step "Instalando dependencias do frontend"
Push-Location $frontendDir
try { & npm install } finally { Pop-Location }

# ---- 5. Data dirs + .env ----

Write-Step "Garantindo diretorios de dados locais"
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\model-cache") | Out-Null

Write-Step "Preparando backend/.env"
if (-not (Test-Path $envFile)) {
    $envContent = Get-Content $envExample -Raw
    $envContent = $envContent -replace "ENABLE_MODEL_LOADING=false", "ENABLE_MODEL_LOADING=true"
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Host "Arquivo backend/.env criado com ENABLE_MODEL_LOADING=true." -ForegroundColor Yellow
} else {
    Write-Host "Arquivo backend/.env ja existe; mantendo configuracao atual." -ForegroundColor DarkYellow
}

# ---- 6. Desktop shortcut ----

Write-Step "Criando atalho na area de trabalho"
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "My AI Playground.lnk"
    $targetPath = Join-Path $repoRoot "run.cmd"
    $iconPath = Join-Path $repoRoot "frontend\public\favicon.ico"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $repoRoot
    $shortcut.Description = "Iniciar My AI Playground"
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = "$iconPath, 0"
    }
    $shortcut.Save()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
    Write-Host "  Atalho criado: $shortcutPath" -ForegroundColor Green
} catch {
    Write-Host "  Nao foi possivel criar o atalho: $_" -ForegroundColor Yellow
}

# ---- 7. Taskbar pin ----

Write-Step "Fixando atalho na barra de tarefas"
try {
    $taskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
    if (Test-Path $taskbarDir) {
        $taskbarLink = Join-Path $taskbarDir "My AI Playground.lnk"
        $targetPath = Join-Path $repoRoot "run.cmd"
        $iconPath = Join-Path $repoRoot "frontend\public\favicon.ico"

        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($taskbarLink)
        $shortcut.TargetPath = $targetPath
        $shortcut.WorkingDirectory = $repoRoot
        $shortcut.Description = "Iniciar My AI Playground"
        if (Test-Path $iconPath) {
            $shortcut.IconLocation = "$iconPath, 0"
        }
        $shortcut.Save()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
        Write-Host "  Atalho fixado na barra de tarefas." -ForegroundColor Green
    } else {
        Write-Host "  Pasta de atalhos da barra de tarefas nao encontrada; pulando." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Nao foi possivel fixar na barra de tarefas: $_" -ForegroundColor Yellow
}

# ---- Done ----

Write-Step "Instalacao concluida"
if (-not $llamaInstalled) {
    Write-Host "ATENCAO: llama-server NAO foi instalado. Veja as mensagens acima." -ForegroundColor Red
}
Write-Host "Use run.cmd para iniciar backend + frontend e abrir a interface." -ForegroundColor Green
Write-Host "Log salvo em: $logFile" -ForegroundColor DarkGray

} finally {
    Stop-Transcript | Out-Null
}