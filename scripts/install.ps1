param(
    [switch]$SkipCudaTorch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---- i18n ----

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $repoRoot "scripts\i18n.ps1")
Initialize-I18n -RepoRoot $repoRoot

# ---- Helpers ----

function Write-Step {
    param([string]$Message)
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] ==> $Message"
    Write-Host "`n$line" -ForegroundColor Cyan
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
}

function Write-Status {
    param([string]$Message, [string]$ForegroundColor = "White")
    Write-Host "  $Message" -ForegroundColor $ForegroundColor
    try { Add-Content -Path $logFile -Value "  $Message" -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
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

function Assert-ExitCode {
    # Throw if the last native command exited with a non-zero code
    param([string]$Action)
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "$Action failed (exit code $LASTEXITCODE)"
    }
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$FriendlyName,
        [string]$Override
    )
    Write-Host "  $(T 'script.install.installingViaWinget' @{name=$FriendlyName})" -ForegroundColor Yellow
    $wingetArgs = @("install", "--id", $PackageId, "--accept-source-agreements", "--accept-package-agreements", "-e")
    if ($Override) { $wingetArgs += @("--override", $Override) }
    $proc = Start-Process -FilePath "winget" -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
    Refresh-Path
    return $proc.ExitCode -eq 0
}

function Invoke-ElevatedWinget {
    param([array]$Packages)
    if ($Packages.Count -eq 0) { return $true }

    $names = ($Packages | ForEach-Object { $_.FriendlyName }) -join ', '
    Write-Status (T 'script.install.elevationRequired' @{names=$names}) -ForegroundColor Yellow

    $cmds = foreach ($p in $Packages) {
        "winget install --id $($p.Id) --accept-source-agreements --accept-package-agreements -e"
    }
    $inline = ($cmds -join '; ') + '; exit $LASTEXITCODE'
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inline)

    try {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs `
                -Verb RunAs -Wait -PassThru
    } catch [System.ComponentModel.Win32Exception] {
        throw (T 'script.install.elevationDenied' @{names=$names})
    }
    Refresh-Path
    return $proc.ExitCode -eq 0
}

function Get-PythonBootstrapCommand {
    # Returns a 2-element array @(exe, "-3") for py.exe, a 1-element array
    # @(exe) for python.exe, or $null.  The comma operator ensures even a
    # single-element result is returned as [object[]], preventing PowerShell
    # from unwrapping it into a bare string (which would cause $arr[0] to
    # return the first *character* instead of the first *element*).
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return @($py.Source, "-3") }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        # Verify it's real Python (not the Windows Store stub)
        try {
            $ver = & $python.Source --version 2>&1 | Out-String
            if ($ver -notmatch 'Python \d') { return $null }
        } catch { return $null }
        return , @($python.Source)
    }
    return $null
}

# ---- Variables ----

$frontendDir = Join-Path $repoRoot "frontend"
$backendDir  = Join-Path $repoRoot "backend"
$venvDir     = Join-Path $repoRoot ".venv"
$venvPython  = Join-Path $venvDir "Scripts\python.exe"
$envExample  = Join-Path $backendDir ".env.example"
$envFile     = Join-Path $repoRoot "data\system\.env"
$logFile     = Join-Path $repoRoot "data\system\logs\install.log"
$isAdmin     = Test-Admin
$isWindows   = $env:OS -eq "Windows_NT"
$hasWinget   = (Get-Command winget -ErrorAction SilentlyContinue) -ne $null

# Ensure data directories exist before starting the log file
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\user\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\system\logs") | Out-Null

# Create/clear the log file in UTF-8 so Inno Setup's LoadStringsFromFile can read it
Set-Content -Path $logFile -Value "" -Encoding UTF8
Write-Status (T 'script.install.logInfo' @{path=$logFile}) -ForegroundColor DarkGray
Write-Status (T 'script.install.dateInfo' @{date=(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')}) -ForegroundColor DarkGray
if ($isAdmin) { Write-Status (T 'script.install.runningAsAdmin') -ForegroundColor Green }

# ---- Environment snapshot (for diagnostics) ----
Write-Status "  OS: $([System.Environment]::OSVersion.VersionString)" -ForegroundColor DarkGray
Write-Status "  Arch: $env:PROCESSOR_ARCHITECTURE" -ForegroundColor DarkGray
Write-Status "  PowerShell: $($PSVersionTable.PSVersion)" -ForegroundColor DarkGray
Write-Status "  User: $env:USERNAME" -ForegroundColor DarkGray
Write-Status "  Working dir: $repoRoot" -ForegroundColor DarkGray
Write-Status "  Winget: $(if ($hasWinget) { 'available' } else { 'NOT found' })" -ForegroundColor DarkGray
try {
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    $pyExe = Get-Command py -ErrorAction SilentlyContinue
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    Write-Status "  python: $(if ($pyCmd) { $pyCmd.Source } else { 'NOT found' })" -ForegroundColor DarkGray
    Write-Status "  py launcher: $(if ($pyExe) { $pyExe.Source } else { 'NOT found' })" -ForegroundColor DarkGray
    Write-Status "  node: $(if ($nodeCmd) { "$($nodeCmd.Source) ($(& node -v 2>&1))" } else { 'NOT found' })" -ForegroundColor DarkGray
    Write-Status "  npm: $(if ($npmCmd) { "$($npmCmd.Source) ($(& npm -v 2>&1))" } else { 'NOT found' })" -ForegroundColor DarkGray
} catch { }

try {

# ---- 1. Prerequisites ----

Write-Step (T 'script.install.prereqs')

# Python + Node.js / npm — detect missing first, then install grouped (single UAC prompt when needed)
$pythonBootstrap = Get-PythonBootstrapCommand
$hasNpm = $null -ne (Get-Command npm -ErrorAction SilentlyContinue)
$missing = @()
if (-not $pythonBootstrap) { $missing += @{ Id='Python.Python.3.12'; FriendlyName='Python 3.12' } }
if (-not $hasNpm)          { $missing += @{ Id='OpenJS.NodeJS.LTS'; FriendlyName='Node.js LTS' } }

if ($missing.Count -gt 0) {
    $missingNames = ($missing | ForEach-Object { $_.FriendlyName }) -join ', '
    if (-not $hasWinget) {
        throw (T 'script.install.prereqsMissingNoWinget' @{names=$missingNames})
    }
    if (-not $isAdmin) {
        Write-Status (T 'script.install.elevationMayBeNeeded') -ForegroundColor Yellow
    }
    if ($isAdmin) {
        foreach ($p in $missing) { Install-WithWinget -PackageId $p.Id -FriendlyName $p.FriendlyName | Out-Null }
    } else {
        Invoke-ElevatedWinget -Packages $missing | Out-Null
    }
    $pythonBootstrap = Get-PythonBootstrapCommand
    if (-not $pythonBootstrap) { throw (T 'script.install.pythonNotFoundAfterInstall') }
    if ($null -eq (Get-Command npm -ErrorAction SilentlyContinue)) { throw (T 'script.install.npmNotFoundAfterInstall') }
}
Write-Status "  $(T 'script.install.pythonOk')" -ForegroundColor Green
Write-Status "  $(T 'script.install.nodeOk')" -ForegroundColor Green

# GPU detection — try WMI first, fall back to nvidia-smi on PATH
$hasNvidiaGpu = $false
$hasAmdGpu = $false
if (-not $SkipCudaTorch) {
    try {
        $gpuControllers = @(Get-CimInstance Win32_VideoController -ErrorAction Stop)
        $nvidiaGpus = @($gpuControllers | Where-Object { $_.Name -match 'NVIDIA' })
        $hasNvidiaGpu = $nvidiaGpus.Count -gt 0
        if (-not $hasNvidiaGpu) {
            $amdGpus = @($gpuControllers | Where-Object { $_.Name -match 'AMD|Radeon' -and $_.Name -notmatch 'Microsoft' })
            $hasAmdGpu = $amdGpus.Count -gt 0
        }
    } catch {
        # WMI/CIM unavailable — fall back to nvidia-smi
        $smiCmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
        if (-not $smiCmd) {
            foreach ($p in @(
                "$env:SystemRoot\System32\nvidia-smi.exe",
                "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
            )) { if (Test-Path $p) { $hasNvidiaGpu = $true; break } }
        } else {
            $hasNvidiaGpu = $true
        }
    }
}
if ($hasNvidiaGpu) {
    Write-Status "  $(T 'script.install.gpuDetected')" -ForegroundColor Green
} elseif ($hasAmdGpu) {
    Write-Status "  AMD GPU detected (HIP/Radeon)" -ForegroundColor Green
} else {
    Write-Status "  $(T 'script.install.gpuNotDetected')" -ForegroundColor Yellow
}

# ---- 2. Python venv + backend deps ----

Write-Step (T 'script.install.creatingVenv')

# If .venv exists but python.exe is missing/broken, remove it so we can recreate
if ((Test-Path $venvDir) -and -not (Test-Path $venvPython)) {
    Write-Status "  Removing broken virtual environment..." -ForegroundColor Yellow
    Remove-Item $venvDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $venvPython)) {
    # Ensure $pythonBootstrap is always treated as an array (guards against
    # PowerShell unwrapping a single-element array into a bare string).
    [string[]]$pyArgs = @($pythonBootstrap)
    Write-Status "  Bootstrap command: $($pyArgs -join ' ')" -ForegroundColor DarkGray
    Write-Status "  Bootstrap args count: $($pyArgs.Count)" -ForegroundColor DarkGray
    Write-Status "  Target venv: $venvDir" -ForegroundColor DarkGray
    if ($pyArgs.Count -gt 1) {
        & $pyArgs[0] $pyArgs[1] -m venv $venvDir
    } else {
        & $pyArgs[0] -m venv $venvDir
    }
    Assert-ExitCode "python -m venv"
    Write-Status "  venv created successfully" -ForegroundColor Green
} else {
    Write-Status "  venv already exists: $venvPython" -ForegroundColor DarkGray
}

Write-Step (T 'script.install.updatingPip')
& $venvPython -m pip install --upgrade pip
Assert-ExitCode "pip upgrade"

Write-Step (T 'script.install.backendDeps')
& $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
Assert-ExitCode "pip install requirements"

# ---- 3. llama.cpp server (pre-built binary) ----

Write-Step (T 'script.install.llamaServer')
$llamaServerDir = Join-Path $repoRoot "data\system\llama-server"
$llamaVersionFile = Join-Path $llamaServerDir "version.txt"
$llamaInstalled = $false

# Detect OS + arch for asset matching
$assetPattern = $null
$cudaDllPattern = $null
if ($isWindows) {
    if ($hasNvidiaGpu) {
        # Detect CUDA driver version to pick the right binary
        $nvidiaSmiCmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
        $nvidiaSmi = if ($nvidiaSmiCmd) { $nvidiaSmiCmd.Source } else { $null }
        if (-not $nvidiaSmi) {
            # nvidia-smi is NOT on PATH inside the Inno Setup process; search known locations
            foreach ($candidate in @(
                "$env:SystemRoot\System32\nvidia-smi.exe",
                "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
            )) {
                if (Test-Path $candidate) { $nvidiaSmi = $candidate; break }
            }
        }
        $cudaMajor = 12  # default fallback
        if ($nvidiaSmi) {
            $smiOutput = & $nvidiaSmi 2>&1 | Out-String
            if ($smiOutput -match 'CUDA Version:\s+(\d+)') {
                $cudaMajor = [int]$Matches[1]
            }
        }
        if ($cudaMajor -ge 13) {
            $assetPattern = "*-bin-win-cuda-13*-x64*"
            $cudaDllPattern = "*cudart*-win-cuda-13*-x64*"
        } else {
            $assetPattern = "*-bin-win-cuda-12*-x64*"
            $cudaDllPattern = "*cudart*-win-cuda-12*-x64*"
        }
        Write-Status "  $(T 'script.install.gpuCudaDriver' @{version="$cudaMajor"})" -ForegroundColor Green
    } elseif ($hasAmdGpu) {
        $assetPattern = "*-bin-win-hip-radeon-x64*"
        $cudaDllPattern = $null  # AMD HIP does not need separate cudart
        Write-Status "  AMD GPU: selecting HIP/Radeon binary" -ForegroundColor Green
    } else {
        $assetPattern = "*-bin-win-cpu-x64*"
        Write-Status "  $(T 'script.install.noCpuFallback')" -ForegroundColor Yellow
    }
} elseif ($IsMacOS) {
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") {
        $assetPattern = "*-bin-macos-arm64*"
        Write-Status "  Apple Silicon detected: selecting Metal binary" -ForegroundColor Green
    } else {
        $assetPattern = "*-bin-macos-x64*"
    }
} else {
    # Linux
    if ($hasNvidiaGpu) {
        $assetPattern = "*-bin-ubuntu-*vulkan*x64*"  # Vulkan as universal GPU option
    } elseif ($hasAmdGpu) {
        $assetPattern = "*-bin-ubuntu-rocm*-x64*"
        Write-Status "  AMD GPU: selecting ROCm binary" -ForegroundColor Green
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
    Write-Status "  $(T 'script.install.llamaAlreadyInstalled' @{version=$currentVersion})" -ForegroundColor Green
    $llamaInstalled = $true
}

if (-not $llamaInstalled) {
    Write-Status "  $(T 'script.install.queryingVersion')" -ForegroundColor Cyan
    try {
        # Ensure TLS 1.2+ (PowerShell 5.1 defaults to TLS 1.0, which GitHub rejects)
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $releaseInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" `
            -Headers @{ "User-Agent" = "myAIplayground-installer" }
        $latestTag = $releaseInfo.tag_name

        # Find matching binary asset (exclude cudart bundles and kleidiai variants)
        $binAsset = $releaseInfo.assets | Where-Object { $_.name -like $assetPattern -and $_.name -notlike "*cudart*" -and $_.name -notlike "*kleidiai*" } | Select-Object -First 1
        if (-not $binAsset) {
            throw (T 'script.install.noBinaryFound' @{pattern=$assetPattern})
        }

        Write-Status "  $(T 'script.install.downloading' @{name=$binAsset.name; version=$latestTag})" -ForegroundColor Cyan

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
                Write-Status "  $(T 'script.install.downloadingCudaDlls' @{name=$cudaAsset.name})" -ForegroundColor Cyan
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
        $variant = if ($cudaDllPattern) { "CUDA" } elseif ($hasAmdGpu) { "HIP" } elseif ($IsMacOS) { "Metal" } else { "CPU" }
        Write-Status "  $(T 'script.install.llamaInstalledOk' @{version=$latestTag; variant=$variant})" -ForegroundColor Green
    } catch {
        Write-Status "  $(T 'script.install.llamaDownloadError' @{error="$_"})" -ForegroundColor Red
        Write-Status "  $(T 'script.install.llamaManualDownload')" -ForegroundColor Red
    }
}

# ---- 4. Frontend ----

Write-Step (T 'script.install.frontendDeps')
Push-Location $frontendDir
try {
    & npm install
    # npm often exits non-zero for deprecation/audit warnings — warn but don't abort
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Write-Status "npm install exited with code $LASTEXITCODE (may be warnings)" -ForegroundColor Yellow
    }
} finally { Pop-Location }

# ---- 5. Data dirs + .env ----

Write-Step (T 'script.install.dataDirs')
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\user\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\system\model-cache") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\system\logs") | Out-Null

# ---- Migrate legacy flat data/ layout to new user/system structure ----
$legacyEnv = Join-Path $repoRoot "data\.env"
if ((Test-Path $legacyEnv) -and -not (Test-Path $envFile)) {
    Write-Status "  Migrating data/.env -> data/system/.env" -ForegroundColor Yellow
    Move-Item $legacyEnv $envFile -Force
}
$legacyDb = Join-Path $repoRoot "data\app.db"
if ((Test-Path $legacyDb) -and -not (Test-Path (Join-Path $repoRoot "data\user\app.db"))) {
    Write-Status "  Migrating data/app.db -> data/user/app.db" -ForegroundColor Yellow
    Move-Item $legacyDb (Join-Path $repoRoot "data\user\app.db") -Force
}
$legacyUploads = Join-Path $repoRoot "data\uploads"
if ((Test-Path $legacyUploads) -and (Get-ChildItem $legacyUploads -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Status "  Migrating data/uploads/ -> data/user/uploads/" -ForegroundColor Yellow
    Get-ChildItem $legacyUploads -File | Move-Item -Destination (Join-Path $repoRoot "data\user\uploads") -Force
    Remove-Item $legacyUploads -Recurse -Force -ErrorAction SilentlyContinue
}
$legacySettings = Join-Path $repoRoot "data\settings.json"
if ((Test-Path $legacySettings) -and -not (Test-Path (Join-Path $repoRoot "data\user\settings.json"))) {
    Write-Status "  Migrating data/settings.json -> data/user/settings.json" -ForegroundColor Yellow
    Move-Item $legacySettings (Join-Path $repoRoot "data\user\settings.json") -Force
}
$legacyLegal = Join-Path $repoRoot "data\legal-acceptance.json"
if ((Test-Path $legacyLegal) -and -not (Test-Path (Join-Path $repoRoot "data\user\legal-acceptance.json"))) {
    Write-Status "  Migrating data/legal-acceptance.json -> data/user/legal-acceptance.json" -ForegroundColor Yellow
    Move-Item $legacyLegal (Join-Path $repoRoot "data\user\legal-acceptance.json") -Force
}
$legacyModelCache = Join-Path $repoRoot "data\model-cache"
$systemModelCache = Join-Path $repoRoot "data\system\model-cache"
if ((Test-Path $legacyModelCache) -and (Get-ChildItem $legacyModelCache -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Status "  Migrating data/model-cache/ -> data/system/model-cache/" -ForegroundColor Yellow
    Get-ChildItem $legacyModelCache -Force | Move-Item -Destination $systemModelCache -Force
    Remove-Item $legacyModelCache -Recurse -Force -ErrorAction SilentlyContinue
}
$legacyLlama = Join-Path $repoRoot "data\llama-server"
$systemLlama = Join-Path $repoRoot "data\system\llama-server"
if ((Test-Path $legacyLlama) -and (Get-ChildItem $legacyLlama -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Status "  Migrating data/llama-server/ -> data/system/llama-server/" -ForegroundColor Yellow
    if (-not (Test-Path $systemLlama)) {
        Move-Item $legacyLlama $systemLlama -Force
    } else {
        Get-ChildItem $legacyLlama -Force | Move-Item -Destination $systemLlama -Force
        Remove-Item $legacyLlama -Recurse -Force -ErrorAction SilentlyContinue
    }
}
foreach ($legacyLog in @('install.log', 'backend.log', 'backend-err.log', 'frontend.log', 'frontend-err.log')) {
    $legacyLogPath = Join-Path $repoRoot "data\$legacyLog"
    if (Test-Path $legacyLogPath) {
        Move-Item $legacyLogPath (Join-Path $repoRoot "data\system\logs\$legacyLog") -Force
    }
}

Write-Step (T 'script.install.preparingEnv')
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        $envContent = Get-Content $envExample -Raw
        $envContent = $envContent -replace "ENABLE_MODEL_LOADING=false", "ENABLE_MODEL_LOADING=true"
        Set-Content -Path $envFile -Value $envContent -Encoding UTF8
        Write-Status (T 'script.install.envCreated') -ForegroundColor Yellow
    } else {
        # Create a minimal .env if the example is missing
        Set-Content -Path $envFile -Value "ENABLE_MODEL_LOADING=true" -Encoding UTF8
        Write-Status "  .env created (minimal - .env.example not found)" -ForegroundColor Yellow
    }
} else {
    Write-Status (T 'script.install.envExists') -ForegroundColor DarkYellow
}

# ---- 6. Pre-download default model (so UI works offline on first launch) ----

Write-Step (T 'script.install.defaultModel')
$modelScript = Join-Path $repoRoot "scripts\download_default_model.py"
if ((Test-Path $venvPython) -and (Test-Path $modelScript)) {
    try {
        & $venvPython $modelScript
        if ($LASTEXITCODE -eq 0) {
            Write-Status "  $(T 'script.install.defaultModelOk')" -ForegroundColor Green
        } else {
            Write-Status "  $(T 'script.install.defaultModelFailed' @{error="exit $LASTEXITCODE"})" -ForegroundColor Yellow
        }
    } catch {
        Write-Status "  $(T 'script.install.defaultModelFailed' @{error="$_"})" -ForegroundColor Yellow
    }
} else {
    Write-Status "  $(T 'script.install.defaultModelSkipped')" -ForegroundColor DarkYellow
}

# ---- 7. Desktop shortcut ----

Write-Step (T 'script.install.creatingShortcut')
$targetPath = Join-Path $repoRoot ".venv\Scripts\pythonw.exe"
if (Test-Path $targetPath) {
    try {
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $shortcutPath = Join-Path $desktopPath "My AI Playground.lnk"
        $trayScript = Join-Path $repoRoot "scripts\tray.py"
        $iconPath = Join-Path $repoRoot "frontend\public\favicon.ico"

        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $targetPath
        $shortcut.Arguments = "`"$trayScript`""
        $shortcut.WorkingDirectory = $repoRoot
        $shortcut.Description = T 'script.install.shortcutDescription'
        if (Test-Path $iconPath) {
            $shortcut.IconLocation = "$iconPath, 0"
        }
        $shortcut.Save()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
        Write-Status "  $(T 'script.install.shortcutCreated' @{path=$shortcutPath})" -ForegroundColor Green
    } catch {
        Write-Status "  $(T 'script.install.shortcutFailed' @{error="$_"})" -ForegroundColor Yellow
    }
} else {
    Write-Status "  Skipping shortcut (pythonw.exe not found)" -ForegroundColor Yellow
}

# ---- 7. Taskbar pin ----

Write-Step (T 'script.install.pinningTaskbar')
$targetPath = Join-Path $repoRoot ".venv\Scripts\pythonw.exe"
if (Test-Path $targetPath) {
    try {
        $taskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
        if (Test-Path $taskbarDir) {
            $taskbarLink = Join-Path $taskbarDir "My AI Playground.lnk"
            $trayScript = Join-Path $repoRoot "scripts\tray.py"
            $iconPath = Join-Path $repoRoot "frontend\public\favicon.ico"

            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($taskbarLink)
            $shortcut.TargetPath = $targetPath
            $shortcut.Arguments = "`"$trayScript`""
            $shortcut.WorkingDirectory = $repoRoot
            $shortcut.Description = T 'script.install.shortcutDescription'
            if (Test-Path $iconPath) {
                $shortcut.IconLocation = "$iconPath, 0"
            }
            $shortcut.Save()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
            Write-Status "  $(T 'script.install.taskbarPinned')" -ForegroundColor Green
        } else {
            Write-Status "  $(T 'script.install.taskbarDirNotFound')" -ForegroundColor Yellow
        }
    } catch {
        Write-Status "  $(T 'script.install.taskbarFailed' @{error="$_"})" -ForegroundColor Yellow
    }
} else {
    Write-Status "  Skipping taskbar pin (pythonw.exe not found)" -ForegroundColor Yellow
}

# ---- Done ----

Write-Step (T 'script.install.done')
if (-not $llamaInstalled) {
    Write-Status (T 'script.install.llamaWarning') -ForegroundColor Red
}
Write-Status (T 'script.install.useRunCmd') -ForegroundColor Green
Write-Status (T 'script.install.logSaved' @{path=$logFile}) -ForegroundColor DarkGray

} catch {
    # Log the terminating error so the Inno memo + install.log show what went wrong.
    # Use Write-Host (always works) + direct .NET file append (resilient to file locks
    # from Inno Setup polling the log with LoadStringsFromFile / fmShareDenyWrite).
    $errorMsg = "  ERROR: $_"
    $errorDetail = "  Exception: $($_.Exception.GetType().FullName): $($_.Exception.Message)"
    $errorStack = "  At: $($_.InvocationInfo.PositionMessage)"
    Write-Host $errorMsg -ForegroundColor Red
    Write-Host $errorDetail -ForegroundColor Red
    Write-Host $errorStack -ForegroundColor DarkRed
    try {
        $fullError = "$errorMsg`r`n$errorDetail`r`n$errorStack"
        [System.IO.File]::AppendAllText($logFile, "`r`n$fullError`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    exit 1
}

# Explicit success exit — avoids the script inheriting a stray $LASTEXITCODE
# from an earlier native command that succeeded but left a non-zero code.
exit 0