#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# My AI Playground — Installer for Linux / macOS
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_DIR="$REPO_ROOT/backend"
VENV_DIR="$REPO_ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
DATA_DIR="$REPO_ROOT/data"
ENV_EXAMPLE="$BACKEND_DIR/.env.example"
ENV_FILE="$DATA_DIR/system/.env"
LOG_FILE="$DATA_DIR/system/logs/install.log"
LLAMA_DIR="$DATA_DIR/system/llama-server"

mkdir -p "$DATA_DIR/user/uploads" "$DATA_DIR/system/logs"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "── Install log: $LOG_FILE"
echo "── Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "── Platform: $(uname -s) $(uname -r) ($(uname -m))"
echo "── User: $(whoami)"
echo "── Shell: $SHELL ($BASH_VERSION)"
echo "── Working dir: $REPO_ROOT"
echo "── python3: $(command -v python3 2>/dev/null || echo 'NOT found') $(python3 --version 2>/dev/null || true)"
echo "── node: $(command -v node 2>/dev/null || echo 'NOT found') $(node -v 2>/dev/null || true)"
echo "── npm: $(command -v npm 2>/dev/null || echo 'NOT found') $(npm -v 2>/dev/null || true)"

step() { echo -e "\n[$(date '+%H:%M:%S')] ==> $1"; }
ok()   { echo -e "  [$(date '+%H:%M:%S')] \033[32m$1\033[0m"; }
warn() { echo -e "  [$(date '+%H:%M:%S')] \033[33m$1\033[0m"; }
err()  { echo -e "  [$(date '+%H:%M:%S')] \033[31m$1\033[0m"; }

# ── Detect OS ────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  *)       err "Unsupported OS: $OS"; exit 1 ;;
esac
echo "── Platform: $PLATFORM ($ARCH)"

# ── 1. Prerequisites ────────────────────────────────────────────
step "Checking prerequisites..."

# Python
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PY_VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJOR" -gt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 11 ]; }; then
      PYTHON_CMD="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON_CMD" ]; then
  err "Python 3.11+ not found. Please install it first:"
  if [ "$PLATFORM" = "linux" ]; then
    echo "  Ubuntu/Debian: sudo apt install python3 python3-venv python3-pip"
    echo "  Fedora:        sudo dnf install python3 python3-pip"
    echo "  Arch:          sudo pacman -S python python-pip"
  else
    echo "  macOS: brew install python@3.12"
  fi
  exit 1
fi
ok "Python: $($PYTHON_CMD --version)"

# Node.js / npm
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
  err "Node.js / npm not found. Please install it first:"
  if [ "$PLATFORM" = "linux" ]; then
    echo "  https://nodejs.org or: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
  else
    echo "  macOS: brew install node"
  fi
  exit 1
fi
NODE_VER=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ is required (found v$NODE_VER). Please upgrade:"
  echo "  https://nodejs.org"
  exit 1
fi
ok "Node.js: $(node --version), npm: $(npm --version)"

# GPU detection
HAS_NVIDIA=false
if command -v nvidia-smi &>/dev/null; then
  HAS_NVIDIA=true
  ok "NVIDIA GPU detected"
else
  warn "No NVIDIA GPU detected (will use CPU mode)"
fi

# ── 2. Python venv + backend deps ──────────────────────────────
step "Creating Python virtual environment..."

# If .venv exists but python binary is missing/broken, recreate it
if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_PYTHON" ]; then
  warn "Removing broken virtual environment..."
  rm -rf "$VENV_DIR"
fi

if [ ! -f "$VENV_PYTHON" ]; then
  # On Debian/Ubuntu, python3-venv may not be installed
  if ! "$PYTHON_CMD" -m venv --help &>/dev/null; then
    err "Python venv module not found. Please install it:"
    echo "  Ubuntu/Debian: sudo apt install python3-venv"
    echo "  Fedora:        sudo dnf install python3-virtualenv"
    exit 1
  fi
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

step "Updating pip..."
"$VENV_PYTHON" -m pip install --upgrade pip

step "Installing backend dependencies..."
"$VENV_PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt"

# ── 3. llama.cpp server (pre-built binary) ─────────────────────
step "Setting up llama-server..."
LLAMA_VERSION_FILE="$LLAMA_DIR/version.txt"
LLAMA_INSTALLED=false

CURRENT_VERSION=""
if [ -f "$LLAMA_VERSION_FILE" ]; then
  CURRENT_VERSION="$(cat "$LLAMA_VERSION_FILE" | tr -d '[:space:]')"
fi

SERVER_BIN="$LLAMA_DIR/llama-server"
if [ -x "$SERVER_BIN" ] && [ -n "$CURRENT_VERSION" ]; then
  ok "llama-server already installed ($CURRENT_VERSION)"
  LLAMA_INSTALLED=true
fi

if [ "$LLAMA_INSTALLED" = false ]; then
  # Determine asset pattern
  ASSET_PATTERN=""
  if [ "$PLATFORM" = "macos" ]; then
    if [ "$ARCH" = "arm64" ]; then
      ASSET_PATTERN="bin-macos-arm64"
    else
      ASSET_PATTERN="bin-macos-x64"
    fi
  else
    # Linux
    if [ "$HAS_NVIDIA" = true ]; then
      ASSET_PATTERN="bin-ubuntu.*vulkan.*x64"
    else
      ASSET_PATTERN="bin-ubuntu-x64"
    fi
  fi

  echo "  Querying latest llama.cpp release..."
  RELEASE_JSON=$(curl -sS -H "User-Agent: myAIplayground-installer" \
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest") || {
    err "Failed to query GitHub API"
    RELEASE_JSON=""
  }

  if [ -n "$RELEASE_JSON" ]; then
    LATEST_TAG=$(echo "$RELEASE_JSON" | "$VENV_PYTHON" -c "import sys,json; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null || echo "")

    if [ -n "$LATEST_TAG" ]; then
      # Find matching asset URL
      ASSET_URL=$(echo "$RELEASE_JSON" | "$VENV_PYTHON" -c "
import sys, json, re
data = json.load(sys.stdin)
for a in data.get('assets', []):
    name = a['name']
    if re.search(r'$ASSET_PATTERN', name) and 'cudart' not in name:
        print(a['browser_download_url'])
        break
" 2>/dev/null || echo "")

      if [ -n "$ASSET_URL" ]; then
        echo "  Downloading: $(basename "$ASSET_URL") ($LATEST_TAG)..."
        mkdir -p "$LLAMA_DIR"
        TMP_ZIP="/tmp/llama-server-download.zip"
        curl -L -o "$TMP_ZIP" "$ASSET_URL"

        # Extract
        rm -rf "$LLAMA_DIR"/*
        if command -v unzip &>/dev/null; then
          unzip -o "$TMP_ZIP" -d "$LLAMA_DIR"
        else
          "$VENV_PYTHON" -c "import zipfile; zipfile.ZipFile('$TMP_ZIP').extractall('$LLAMA_DIR')"
        fi
        rm -f "$TMP_ZIP"

        # Move files from subdirectories to root if needed
        NESTED=$(find "$LLAMA_DIR" -name "llama-server" -type f | head -1)
        if [ -n "$NESTED" ] && [ "$(dirname "$NESTED")" != "$LLAMA_DIR" ]; then
          mv "$(dirname "$NESTED")"/* "$LLAMA_DIR"/ 2>/dev/null || true
        fi

        # Make executable
        chmod +x "$LLAMA_DIR/llama-server" 2>/dev/null || true

        # Save version
        echo -n "$LATEST_TAG" > "$LLAMA_VERSION_FILE"
        LLAMA_INSTALLED=true
        ok "llama-server installed ($LATEST_TAG)"
      else
        err "No matching binary found for pattern: $ASSET_PATTERN"
        echo "  Download manually from: https://github.com/ggml-org/llama.cpp/releases"
      fi
    else
      err "Could not determine latest tag"
    fi
  fi
fi

# ── 4. Frontend ─────────────────────────────────────────────────
step "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install
cd "$REPO_ROOT"

# ── 5. Data dirs + .env ─────────────────────────────────────────
step "Creating data directories..."
mkdir -p "$DATA_DIR/user/uploads" "$DATA_DIR/system/model-cache" "$DATA_DIR/system/logs"

# ---- Migrate legacy flat data/ layout to new user/system structure ----
if [ -f "$DATA_DIR/.env" ] && [ ! -f "$ENV_FILE" ]; then
  warn "Migrating data/.env -> data/system/.env"
  mv "$DATA_DIR/.env" "$ENV_FILE"
fi
if [ -f "$DATA_DIR/app.db" ] && [ ! -f "$DATA_DIR/user/app.db" ]; then
  warn "Migrating data/app.db -> data/user/app.db"
  mv "$DATA_DIR/app.db" "$DATA_DIR/user/app.db"
fi
if [ -d "$DATA_DIR/uploads" ] && [ "$(ls -A "$DATA_DIR/uploads" 2>/dev/null)" ]; then
  warn "Migrating data/uploads/ -> data/user/uploads/"
  mv "$DATA_DIR/uploads/"* "$DATA_DIR/user/uploads/" 2>/dev/null || true
  rmdir "$DATA_DIR/uploads" 2>/dev/null || true
fi
if [ -f "$DATA_DIR/settings.json" ] && [ ! -f "$DATA_DIR/user/settings.json" ]; then
  warn "Migrating data/settings.json -> data/user/settings.json"
  mv "$DATA_DIR/settings.json" "$DATA_DIR/user/settings.json"
fi
if [ -f "$DATA_DIR/legal-acceptance.json" ] && [ ! -f "$DATA_DIR/user/legal-acceptance.json" ]; then
  warn "Migrating data/legal-acceptance.json -> data/user/legal-acceptance.json"
  mv "$DATA_DIR/legal-acceptance.json" "$DATA_DIR/user/legal-acceptance.json"
fi
if [ -d "$DATA_DIR/model-cache" ] && [ ! -d "$DATA_DIR/system/model-cache" ]; then
  warn "Migrating data/model-cache/ -> data/system/model-cache/"
  mv "$DATA_DIR/model-cache" "$DATA_DIR/system/model-cache"
fi
if [ -d "$DATA_DIR/llama-server" ] && [ ! -d "$DATA_DIR/system/llama-server" ]; then
  warn "Migrating data/llama-server/ -> data/system/llama-server/"
  mv "$DATA_DIR/llama-server" "$DATA_DIR/system/llama-server"
fi
for legacyLog in install.log backend.log backend-err.log frontend.log frontend-err.log; do
  if [ -f "$DATA_DIR/$legacyLog" ]; then
    mv "$DATA_DIR/$legacyLog" "$DATA_DIR/system/logs/$legacyLog"
  fi
done

step "Preparing .env..."
if [ ! -f "$ENV_FILE" ]; then
  sed 's/ENABLE_MODEL_LOADING=false/ENABLE_MODEL_LOADING=true/' "$ENV_EXAMPLE" > "$ENV_FILE"
  warn ".env created from .env.example (ENABLE_MODEL_LOADING=true)"
else
  ok ".env already exists"
fi

# ── Done ────────────────────────────────────────────────────────

# ── 6. Pre-download default model ───────────────────────────────
step "Default model download"
MODEL_SCRIPT="$REPO_ROOT/scripts/download_default_model.py"
if [ -f "$VENV_PYTHON" ] && [ -f "$MODEL_SCRIPT" ]; then
  if "$VENV_PYTHON" "$MODEL_SCRIPT"; then
    ok "Default model downloaded successfully."
  else
    warn "Default model download failed (exit $?)."
  fi
else
  warn "Skipped default model download."
fi

# ── 7. Desktop shortcut (Linux only) ────────────────────────────
if [ "$PLATFORM" = "linux" ]; then
  step "Creating desktop shortcut..."
  DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
  DESKTOP_FILE="$DESKTOP_DIR/my-ai-playground.desktop"
  ICON_PATH="$REPO_ROOT/frontend/public/favicon.ico"
  if [ -d "$DESKTOP_DIR" ]; then
    cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=My AI Playground
Comment=Local AI assistant
Exec=$REPO_ROOT/tray.sh
Icon=$ICON_PATH
Terminal=false
Categories=Utility;
EOF
    chmod +x "$DESKTOP_FILE" 2>/dev/null || true
    ok "Shortcut created: $DESKTOP_FILE"
  else
    warn "Desktop directory not found, skipping shortcut."
  fi
fi

# ── Done ────────────────────────────────────────────────────────
step "Installation complete!"
if [ "$LLAMA_INSTALLED" = false ]; then
  err "WARNING: llama-server was not installed. Download it manually."
fi
ok "Run ./run.sh to start the application."
echo "── Log saved: $LOG_FILE"
