#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  AskOnce Deploy Script (No Docker Required)
#  Prerequisites: Python 3.10+, Node.js 18+
#  Usage: ./deploy.sh [start|stop|restart|status|logs|build]
# ============================================================

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
PID_DIR="$PROJECT_DIR/.pids"
LOG_DIR="$PROJECT_DIR/.logs"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }

mkdir -p "$PID_DIR" "$LOG_DIR"

# --- Detect server IP ---
get_server_ip() {
  if command -v ip &>/dev/null; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1
  elif command -v ifconfig &>/dev/null; then
    ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1
  else
    hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown"
  fi
}

# --- Preflight checks ---
preflight() {
  info "Running preflight checks..."

  # Python
  PYTHON=""
  for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
      PY_VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0")
      PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
      PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
      if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        PYTHON="$cmd"
        break
      fi
    fi
  done
  if [ -z "$PYTHON" ]; then
    error "Python 3.10+ is required. Please install it first."
    exit 1
  fi
  log "Python: $($PYTHON --version)"

  # Node.js
  if ! command -v node &>/dev/null; then
    error "Node.js is required. Please install Node.js 18+."
    exit 1
  fi
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    error "Node.js 18+ required, found $(node -v)"
    exit 1
  fi
  log "Node.js: $(node -v)"

  # npm
  if ! command -v npm &>/dev/null; then
    error "npm is required."
    exit 1
  fi
  log "npm: $(npm -v)"

  # Backend .env
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    if [ -f "$BACKEND_DIR/.env.example" ]; then
      cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
      warn "Created backend/.env from template."
      warn "Please edit backend/.env with your API keys, then re-run."
      exit 1
    else
      error "backend/.env not found. Please create it with required config."
      exit 1
    fi
  fi
  log "Backend config: backend/.env"

  if ! grep -q "ASKONCE_CLAUDE_API_KEY=.\+" "$BACKEND_DIR/.env"; then
    error "ASKONCE_CLAUDE_API_KEY not set in backend/.env"
    exit 1
  fi
  log "API key configured"
}

# --- Install & Build ---
cmd_build() {
  preflight

  info "Setting up Python virtual environment..."
  if [ ! -d "$BACKEND_DIR/venv" ]; then
    $PYTHON -m venv "$BACKEND_DIR/venv"
  fi
  "$BACKEND_DIR/venv/bin/pip" install -q --upgrade pip
  "$BACKEND_DIR/venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
  log "Backend dependencies installed"

  info "Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm ci --silent 2>/dev/null || npm install --silent
  log "Frontend dependencies installed"

  info "Building frontend (production)..."
  npm run build
  log "Frontend build complete"
}

# --- Process management ---
is_running() {
  local name="$1"
  local pidfile="$PID_DIR/${name}.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pidfile"
  fi
  return 1
}

start_backend() {
  if is_running backend; then
    warn "Backend already running (PID $(cat "$PID_DIR/backend.pid"))"
    return
  fi
  info "Starting backend (FastAPI on port 8000)..."
  cd "$BACKEND_DIR"
  nohup "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 \
    > "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
  sleep 2
  if is_running backend; then
    log "Backend started (PID $(cat "$PID_DIR/backend.pid"))"
  else
    error "Backend failed to start. Check logs: $LOG_DIR/backend.log"
    tail -20 "$LOG_DIR/backend.log"
    exit 1
  fi
}

start_frontend() {
  if is_running frontend; then
    warn "Frontend already running (PID $(cat "$PID_DIR/frontend.pid"))"
    return
  fi

  # Check if frontend is built
  if [ ! -d "$FRONTEND_DIR/.next" ]; then
    warn "Frontend not built yet. Building now..."
    cd "$FRONTEND_DIR"
    npm run build
  fi

  info "Starting frontend (Next.js on port 3000)..."
  cd "$FRONTEND_DIR"
  nohup npx next start --port 3000 \
    > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$PID_DIR/frontend.pid"
  sleep 3
  if is_running frontend; then
    log "Frontend started (PID $(cat "$PID_DIR/frontend.pid"))"
  else
    error "Frontend failed to start. Check logs: $LOG_DIR/frontend.log"
    tail -20 "$LOG_DIR/frontend.log"
    exit 1
  fi
}

stop_service() {
  local name="$1"
  local pidfile="$PID_DIR/${name}.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      # Force kill if still running
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      log "$name stopped (was PID $pid)"
    fi
    rm -f "$pidfile"
  else
    info "$name is not running"
  fi
}

# --- Commands ---
cmd_start() {
  # Build if not already built
  if [ ! -d "$BACKEND_DIR/venv" ] || [ ! -d "$FRONTEND_DIR/.next" ]; then
    cmd_build
  fi

  start_backend
  start_frontend

  echo ""
  log "AskOnce is running!"
  echo ""
  SERVER_IP=$(get_server_ip)
  echo -e "  ${CYAN}Local access:${NC}     http://localhost:3000"
  echo -e "  ${CYAN}Network access:${NC}   http://${SERVER_IP}:3000"
  echo -e "  ${CYAN}API docs:${NC}         http://${SERVER_IP}:8000/docs"
  echo ""
  info "Logs:    ./deploy.sh logs"
  info "Status:  ./deploy.sh status"
  info "Stop:    ./deploy.sh stop"
}

cmd_stop() {
  info "Stopping AskOnce..."
  stop_service frontend
  stop_service backend
  log "AskOnce stopped."
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  echo ""
  if is_running backend; then
    log "Backend:  running (PID $(cat "$PID_DIR/backend.pid")) on port 8000"
  else
    error "Backend:  not running"
  fi
  if is_running frontend; then
    log "Frontend: running (PID $(cat "$PID_DIR/frontend.pid")) on port 3000"
  else
    error "Frontend: not running"
  fi
  echo ""
  SERVER_IP=$(get_server_ip)
  echo -e "  ${CYAN}Access URL:${NC} http://${SERVER_IP}:3000"
  echo ""
}

cmd_logs() {
  local service="${2:-all}"
  case "$service" in
    backend)  tail -f "$LOG_DIR/backend.log" ;;
    frontend) tail -f "$LOG_DIR/frontend.log" ;;
    *)        tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" ;;
  esac
}

# --- Main ---
case "${1:-start}" in
  start)   cmd_start   ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  status)  cmd_status  ;;
  build)   cmd_build   ;;
  logs)    cmd_logs "$@" ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|build|logs [backend|frontend]}"
    exit 1
    ;;
esac
