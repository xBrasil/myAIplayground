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
BACKEND_LOG="$DATA_DIR/system/logs/backend.log"
FRONTEND_LOG="$DATA_DIR/system/logs/frontend.log"

NO_BROWSER=false
if [ "${1:-}" = "--no-browser" ]; then
  NO_BROWSER=true
fi

step() { echo -e "\n[$(date '+%Y-%m-%d %H:%M:%S')] ==> $1"; }
ok()   { echo -e "  [$(date '+%Y-%m-%d %H:%M:%S')] \033[32m$1\033[0m"; }
warn() { echo -e "  [$(date '+%Y-%m-%d %H:%M:%S')] \033[33m$1\033[0m"; }
err()  { echo -e "  [$(date '+%Y-%m-%d %H:%M:%S')] \033[31m$1\033[0m"; }

# ── Pre-flight checks ───────────────────────────────────────────
if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  err "package.json not found. Run install.sh first."
  exit 1
fi
if [ ! -f "$VENV_PYTHON" ]; then
  err "Python venv not found. Run install.sh first."
  exit 1
fi
if [ ! -f "$DATA_DIR/system/.env" ] && [ ! -f "$DATA_DIR/.env" ]; then
  err ".env not found in data/system/. Run install.sh first."
  exit 1
fi
mkdir -p "$DATA_DIR/system/logs"

# ── Single-instance guard ───────────────────────────────────────
LOCK_FILE="$DATA_DIR/system/.run.lock"
if command -v flock >/dev/null 2>&1; then
  # Linux: use flock (auto-released on crash)
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    warn "My AI Playground is already running. Opening browser..."
    FRONTEND_PORT=5173
    if [ -f "$DATA_DIR/system/.ports" ]; then
      FP=$(grep -o '"frontend":[[:space:]]*[0-9]*' "$DATA_DIR/system/.ports" | grep -o '[0-9]*$' || true)
      [ -n "$FP" ] && FRONTEND_PORT=$FP
    fi
    case "$(uname -s)" in
      Linux*)  xdg-open "http://127.0.0.1:$FRONTEND_PORT" 2>/dev/null || true ;;
      Darwin*) open "http://127.0.0.1:$FRONTEND_PORT" 2>/dev/null || true ;;
    esac
    exit 0
  fi
else
  # macOS / other: PID-file guard with stale-PID detection
  if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      warn "My AI Playground is already running (PID $OLD_PID). Opening browser..."
      FRONTEND_PORT=5173
      if [ -f "$DATA_DIR/system/.ports" ]; then
        FP=$(grep -o '"frontend":[[:space:]]*[0-9]*' "$DATA_DIR/system/.ports" | grep -o '[0-9]*$' || true)
        [ -n "$FP" ] && FRONTEND_PORT=$FP
      fi
      open "http://127.0.0.1:$FRONTEND_PORT" 2>/dev/null || true
      exit 0
    fi
  fi
  echo $$ > "$LOCK_FILE"
fi

# ── Port resolution ─────────────────────────────────────────────
# Kill stale processes from this repo on a given port
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti "tcp:$port" -s "tcp:listen" 2>/dev/null || true)
  for pid in $pids; do
    # Only kill if cmdline contains our repo path
    local cmd
    cmd=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ' || ps -p "$pid" -o args= 2>/dev/null || true)
    if echo "$cmd" | grep -qi "$REPO_ROOT"; then
      warn "Killing stale process PID $pid on port $port"
      kill -9 "$pid" 2>/dev/null || true
      sleep 0.5
    fi
  done
}

# Find a free port starting from $1
find_free_port() {
  local start=$1
  local max_tries=${2:-10}
  for i in $(seq 0 $((max_tries - 1))); do
    local port=$((start + i))
    if ! lsof -ti "tcp:$port" -s "tcp:listen" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  done
  err "No free port found in range $start-$((start + max_tries - 1)). All $max_tries candidate ports are busy."
  return 1
}

# Try to free default ports first
free_port 8000
free_port 5173

# Determine available ports
if ! BACKEND_PORT=$(find_free_port 8000); then exit 1; fi
if ! FRONTEND_PORT=$(find_free_port 5173); then exit 1; fi

[ "$BACKEND_PORT" -ne 8000 ] && warn "Port 8000 is busy — using port $BACKEND_PORT for backend"
[ "$FRONTEND_PORT" -ne 5173 ] && warn "Port 5173 is busy — using port $FRONTEND_PORT for frontend"

# Set env vars for child processes
export API_PORT=$BACKEND_PORT
export VITE_API_PORT=$BACKEND_PORT

# Write ports state file for tray.py
PORTS_FILE="$DATA_DIR/system/.ports"
echo "{\"backend\": $BACKEND_PORT, \"frontend\": $FRONTEND_PORT}" > "$PORTS_FILE"

BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}/api/health"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

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
  rm -f "$PORTS_FILE"
  rm -f "$LOCK_FILE"
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
  "$VENV_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --log-config log_config.json \
    >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  cd "$REPO_ROOT"
fi

# ── Start frontend ──────────────────────────────────────────────
if check_http "$FRONTEND_URL"; then
  step "Frontend already running"
else
  step "Starting frontend..."
  cd "$FRONTEND_DIR"
  export MYAI_NO_WATCH=1
  npm run dev -- --host=127.0.0.1 --port="$FRONTEND_PORT" --strictPort 2>&1 |
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
    err "Backend exited unexpectedly. Check $BACKEND_LOG"
    exit 1
  fi
  if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    err "Frontend exited unexpectedly. Check $FRONTEND_LOG"
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

ok "Backend:  http://127.0.0.1:$BACKEND_PORT"
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
    # Also check if backend API is still reachable — the HTTP
    # check detects a clean /api/shutdown exit even if kill -0 on
    # the PID hasn't updated yet.
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
