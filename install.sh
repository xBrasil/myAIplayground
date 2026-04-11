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
ENV_EXAMPLE="$BACKEND_DIR/.env.example"
ENV_FILE="$BACKEND_DIR/.env"
LOG_FILE="$REPO_ROOT/install.log"
DATA_DIR="$REPO_ROOT/data"
LLAMA_DIR="$DATA_DIR/llama-server"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "── Install log: $LOG_FILE"
echo "── Date: $(date '+%Y-%m-%d %H:%M:%S')"

step() { echo -e "\n\033[36m==> $1\033[0m"; }
ok()   { echo -e "  \033[32m$1\033[0m"; }
warn() { echo -e "  \033[33m$1\033[0m"; }
err()  { echo -e "  \033[31m$1\033[0m"; }

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
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 11 ]; then
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
if ! command -v npm &>/dev/null; then
  err "Node.js / npm not found. Please install it first:"
  if [ "$PLATFORM" = "linux" ]; then
    echo "  https://nodejs.org or: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
  else
    echo "  macOS: brew install node"
  fi
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
if [ ! -f "$VENV_PYTHON" ]; then
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
mkdir -p "$DATA_DIR" "$DATA_DIR/uploads" "$DATA_DIR/model-cache"

step "Preparing .env..."
if [ ! -f "$ENV_FILE" ]; then
  sed 's/ENABLE_MODEL_LOADING=false/ENABLE_MODEL_LOADING=true/' "$ENV_EXAMPLE" > "$ENV_FILE"
  warn ".env created from .env.example (ENABLE_MODEL_LOADING=true)"
else
  ok ".env already exists"
fi

# ── Done ────────────────────────────────────────────────────────
step "Installation complete!"
if [ "$LLAMA_INSTALLED" = false ]; then
  err "WARNING: llama-server was not installed. Download it manually."
fi
ok "Run ./run.sh to start the application."
echo "── Log saved: $LOG_FILE"
