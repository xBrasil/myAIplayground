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
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) { return @($py.Source, "-3") }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { return @($python.Source) }
    return $null
}

# ---- Variables ----

$frontendDir = Join-Path $repoRoot "frontend"
$backendDir  = Join-Path $repoRoot "backend"
$venvDir     = Join-Path $repoRoot ".venv"
$venvPython  = Join-Path $venvDir "Scripts\python.exe"
$envExample  = Join-Path $backendDir ".env.example"
$envFile     = Join-Path $repoRoot "data\.env"
$logFile     = Join-Path $repoRoot "data\install.log"
$isAdmin     = Test-Admin
$isWindows   = $env:OS -eq "Windows_NT"
$hasWinget   = (Get-Command winget -ErrorAction SilentlyContinue) -ne $null

# Ensure data/ exists before starting the log file
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data") | Out-Null

# Create/clear the log file in UTF-8 so Inno Setup's LoadStringsFromFile can read it
Set-Content -Path $logFile -Value "" -Encoding UTF8
Write-Status (T 'script.install.logInfo' @{path=$logFile}) -ForegroundColor DarkGray
Write-Status (T 'script.install.dateInfo' @{date=(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')}) -ForegroundColor DarkGray
if ($isAdmin) { Write-Status (T 'script.install.runningAsAdmin') -ForegroundColor Green }

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
if (-not $SkipCudaTorch) {
    try {
        $nvidiaGpus = @(Get-CimInstance Win32_VideoController -ErrorAction Stop |
            Where-Object { $_.Name -match 'NVIDIA' })
        $hasNvidiaGpu = $nvidiaGpus.Count -gt 0
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
} else {
    Write-Status "  $(T 'script.install.gpuNotDetected')" -ForegroundColor Yellow
}

# ---- 2. Python venv + backend deps ----

Write-Step (T 'script.install.creatingVenv')
if (-not (Test-Path $venvPython)) {
    if ($pythonBootstrap.Length -gt 1) {
        & $pythonBootstrap[0] $pythonBootstrap[1] -m venv $venvDir
    } else {
        & $pythonBootstrap[0] -m venv $venvDir
    }
    Assert-ExitCode "python -m venv"
}

Write-Step (T 'script.install.updatingPip')
& $venvPython -m pip install --upgrade pip
Assert-ExitCode "pip upgrade"

Write-Step (T 'script.install.backendDeps')
& $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
Assert-ExitCode "pip install requirements"

# ---- 3. llama.cpp server (pre-built binary) ----

Write-Step (T 'script.install.llamaServer')
$llamaServerDir = Join-Path $repoRoot "data\llama-server"
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
    } else {
        $assetPattern = "*-bin-win-cpu-x64*"
        Write-Status "  $(T 'script.install.noCpuFallback')" -ForegroundColor Yellow
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

        # Find matching binary asset
        $binAsset = $releaseInfo.assets | Where-Object { $_.name -like $assetPattern -and $_.name -notlike "*cudart*" } | Select-Object -First 1
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
        $variant = if ($cudaDllPattern) { "CUDA" } else { "CPU" }
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
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "data\model-cache") | Out-Null

Write-Step (T 'script.install.preparingEnv')
if (-not (Test-Path $envFile)) {
    $envContent = Get-Content $envExample -Raw
    $envContent = $envContent -replace "ENABLE_MODEL_LOADING=false", "ENABLE_MODEL_LOADING=true"
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Status (T 'script.install.envCreated') -ForegroundColor Yellow
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
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "My AI Playground.lnk"
    $targetPath = Join-Path $repoRoot ".venv\Scripts\pythonw.exe"
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

# ---- 7. Taskbar pin ----

Write-Step (T 'script.install.pinningTaskbar')
try {
    $taskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
    if (Test-Path $taskbarDir) {
        $taskbarLink = Join-Path $taskbarDir "My AI Playground.lnk"
        $targetPath = Join-Path $repoRoot ".venv\Scripts\pythonw.exe"
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
    Write-Host $errorMsg -ForegroundColor Red
    try {
        [System.IO.File]::AppendAllText($logFile, "`r`n$errorMsg`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    exit 1
}

# Explicit success exit — avoids the script inheriting a stray $LASTEXITCODE
# from an earlier native command that succeeded but left a non-zero code.
exit 0