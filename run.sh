#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# My AI Playground — Run script for Linux / macOS
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_DIR="$REPO_ROOT/backend"
VENV_PYTHON="$REPO_ROOT/.venv/bin/python"
DATA_DIR="$REPO_ROOT/data"
BACKEND_LOG="$DATA_DIR/backend.log"
BACKEND_ERR_LOG="$DATA_DIR/backend-err.log"
FRONTEND_LOG="$DATA_DIR/frontend.log"
FRONTEND_ERR_LOG="$DATA_DIR/frontend-err.log"

BACKEND_URL="http://127.0.0.1:8000/api/health"
FRONTEND_URL="http://127.0.0.1:5173"

NO_BROWSER=false
if [ "${1:-}" = "--no-browser" ]; then
  NO_BROWSER=true
fi

step() { echo -e "\n[$(date '+%H:%M:%S')] ==> $1"; }
ok()   { echo -e "  [$(date '+%H:%M:%S')] \033[32m$1\033[0m"; }
warn() { echo -e "  [$(date '+%H:%M:%S')] \033[33m$1\033[0m"; }
err()  { echo -e "  [$(date '+%H:%M:%S')] \033[31m$1\033[0m"; }

# ── Pre-flight checks ───────────────────────────────────────────
if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  err "package.json not found. Run install.sh first."
  exit 1
fi
if [ ! -f "$VENV_PYTHON" ]; then
  err "Python venv not found. Run install.sh first."
  exit 1
fi
if [ ! -f "$DATA_DIR/.env" ]; then
  err ".env not found in data/. Run install.sh first."
  exit 1
fi
mkdir -p "$DATA_DIR"

# ── Track child PIDs ────────────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  warn "Shutting down..."
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── Helper: check if HTTP endpoint is ready ─────────────────────
check_http() {
  curl -sf --max-time 3 "$1" >/dev/null 2>&1
}

# ── Start backend ───────────────────────────────────────────────
if check_http "$BACKEND_URL"; then
  step "Backend already running"
else
  step "Starting backend..."
  cd "$BACKEND_DIR"
  "$VENV_PYTHON" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --log-config log_config.json \
    >"$BACKEND_LOG" 2>"$BACKEND_ERR_LOG" &
  BACKEND_PID=$!
  cd "$REPO_ROOT"
fi

# ── Start frontend ──────────────────────────────────────────────
if check_http "$FRONTEND_URL"; then
  step "Frontend already running"
else
  step "Starting frontend..."
  cd "$FRONTEND_DIR"
  npm run dev -- --host=127.0.0.1 --port=5173 --strictPort 2>&1 |
    while IFS= read -r line; do
      printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"
    done >"$FRONTEND_LOG" &
  FRONTEND_PID=$!
  cd "$REPO_ROOT"
fi

# ── Wait for readiness ──────────────────────────────────────────
step "Waiting for services..."
TIMEOUT=120
ELAPSED=0
BACKEND_READY=false
FRONTEND_READY=false

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if [ "$BACKEND_READY" = false ] && check_http "$BACKEND_URL"; then
    BACKEND_READY=true
  fi
  if [ "$FRONTEND_READY" = false ] && check_http "$FRONTEND_URL"; then
    FRONTEND_READY=true
  fi
  if [ "$BACKEND_READY" = true ] && [ "$FRONTEND_READY" = true ]; then
    break
  fi

  # Check for dead processes
  if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    err "Backend exited unexpectedly. Check $BACKEND_ERR_LOG"
    exit 1
  fi
  if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    err "Frontend exited unexpectedly. Check $FRONTEND_ERR_LOG"
    exit 1
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ "$BACKEND_READY" = false ] || [ "$FRONTEND_READY" = false ]; then
  MISSING=""
  [ "$BACKEND_READY" = false ] && MISSING="Backend"
  [ "$FRONTEND_READY" = false ] && MISSING="${MISSING:+$MISSING + }Frontend"
  err "$MISSING did not start within ${TIMEOUT}s"
  exit 1
fi

ok "Backend:  http://127.0.0.1:8000"
ok "Frontend: $FRONTEND_URL"

# ── Open browser ─────────────────────────────────────────────────
if [ "$NO_BROWSER" = false ]; then
  step "Opening browser..."
  OS="$(uname -s)"
  case "$OS" in
    Linux*)  xdg-open "$FRONTEND_URL" 2>/dev/null || true ;;
    Darwin*) open "$FRONTEND_URL" 2>/dev/null || true ;;
  esac
fi

echo ""
ok "My AI Playground is running!"
echo "  Logs: $BACKEND_LOG | $FRONTEND_LOG"

# ── Keep alive (background) ─────────────────────────────────────
# The monitoring loop runs in the background so the terminal is freed.
# If a child process dies, the trap handler cleans up everything.
_monitor() {
  while true; do
    if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      cleanup
      exit 1
    fi
    if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
      cleanup
      exit 1
    fi
    # Also check if backend API is still reachable (os._exit in a
    # uvicorn --reload worker kills the child but the parent python
    # process stays alive, so kill -0 never fails).
    if ! check_http "$BACKEND_URL"; then
      sleep 2
      if ! check_http "$BACKEND_URL"; then
        cleanup
        exit 0
      fi
    fi
    sleep 2
  done
}
_monitor &
disown
