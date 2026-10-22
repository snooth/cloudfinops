#!/usr/bin/env bash
# Cloud FinOps — start/stop/status without faffing about
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="${ROOT}/.run"
SERVER_PID="${PID_DIR}/server.pid"
CLIENT_PID="${PID_DIR}/client.pid"
LOG_DIR="${ROOT}/logs"
ENV_FILE="${ROOT}/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[finops]${NC} $*"; }
ok()   { echo -e "${GREEN}[finops]${NC} $*"; }
warn() { echo -e "${YELLOW}[finops]${NC} $*"; }
err()  { echo -e "${RED}[finops]${NC} $*" >&2; }

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "Required command not found: $1"
    exit 1
  fi
}

check_prerequisites() {
  require_cmd node
  require_cmd npm
  local node_major
  node_major=$(node -p "process.versions.node.split('.')[0]")
  if [[ "$node_major" -lt 18 ]]; then
    err "Node.js 18+ required (found $(node -v))"
    exit 1
  fi
}

setup_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "${ROOT}/.env.example" ]]; then
      cp "${ROOT}/.env.example" "$ENV_FILE"
      warn "Created .env from .env.example"
    else
      warn "No .env — rolling with defaults"
    fi
  fi
}

install_deps() {
  log "Running npm install..."
  cd "$ROOT"
  npm install
  ok "Dependencies installed"
}

build_client() {
  log "Building client (production)..."
  cd "$ROOT"
  npm run build -w client
  ok "Frontend built"
}

mkdir -p "$PID_DIR" "$LOG_DIR"

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

start_server() {
  if is_running "$SERVER_PID"; then
    warn "Server already running (PID $(cat "$SERVER_PID"))"
    return 0
  fi
  log "Starting API on port ${PORT:-4000}..."
  cd "$ROOT"
  # shellcheck disable=SC1090
  [[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a
  nohup node "${ROOT}/server/src/index.js" >> "${LOG_DIR}/server.log" 2>&1 &
  echo $! > "$SERVER_PID"
  sleep 2
  if is_running "$SERVER_PID"; then
    ok "Server started (PID $(cat "$SERVER_PID")) — http://0.0.0.0:${PORT:-4000}"
  else
    err "Server failed to start. Check ${LOG_DIR}/server.log"
    exit 1
  fi
}

start_dev_client() {
  if is_running "$CLIENT_PID"; then
    warn "Dev client already running (PID $(cat "$CLIENT_PID"))"
    return 0
  fi
  log "Starting Vite dev server..."
  cd "$ROOT"
  nohup npm run dev -w client >> "${LOG_DIR}/client.log" 2>&1 &
  echo $! > "$CLIENT_PID"
  sleep 2
  if is_running "$CLIENT_PID"; then
    ok "Dev client started (PID $(cat "$CLIENT_PID")) — http://0.0.0.0:5173"
  else
    err "Client failed to start. Check ${LOG_DIR}/client.log"
    exit 1
  fi
}

stop_process() {
  local name="$1"
  local pidfile="$2"
  if is_running "$pidfile"; then
    local pid
    pid=$(cat "$pidfile")
    log "Stopping $name (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$pidfile"
    ok "$name stopped"
  else
    rm -f "$pidfile"
  fi
}

cmd_start() {
  check_prerequisites
  setup_env
  install_deps
  build_client
  start_server
  ok "Cloud FinOps portal is ready!"
  echo ""
  echo "  Portal:  http://localhost:${PORT:-4000} (also http://0.0.0.0:${PORT:-4000} on your LAN)"
  echo "  API:     http://localhost:${PORT:-4000}/api/dashboard"
  echo "  Logs:    ${LOG_DIR}/server.log"
  echo ""
}

cmd_dev() {
  check_prerequisites
  setup_env
  install_deps
  start_server
  start_dev_client
  ok "Development mode running!"
  echo ""
  echo "  Frontend (hot reload): http://localhost:5173 (also http://0.0.0.0:5173 on your LAN)"
  echo "  API:                   http://localhost:${PORT:-4000}"
  echo ""
}

cmd_stop() {
  stop_process "dev client" "$CLIENT_PID"
  stop_process "server" "$SERVER_PID"
  ok "All services stopped"
}

cmd_status() {
  echo ""
  echo "Cloud FinOps Portal Status"
  echo "=========================="
  if is_running "$SERVER_PID"; then
    echo -e "  Server:  ${GREEN}running${NC} (PID $(cat "$SERVER_PID"))"
    # shellcheck disable=SC1090
    [[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a
    if curl -sf "http://localhost:${PORT:-4000}/api/health" &>/dev/null; then
      echo -e "  Health:  ${GREEN}healthy${NC}"
    else
      echo -e "  Health:  ${YELLOW}not responding${NC}"
    fi
  else
    echo -e "  Server:  ${RED}stopped${NC}"
  fi

  if is_running "$CLIENT_PID"; then
    echo -e "  Client:  ${GREEN}running${NC} (PID $(cat "$CLIENT_PID")) — dev mode"
  else
    echo -e "  Client:  ${RED}stopped${NC} (production build served by server)"
  fi

  if [[ -f "$ENV_FILE" ]]; then
    echo -e "  Config:  ${GREEN}.env present${NC}"
  else
    echo -e "  Config:  ${YELLOW}no .env (using defaults)${NC}"
  fi
  echo ""
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

usage() {
  echo "Usage: $0 {start|dev|stop|status|restart|install|build}"
  echo ""
  echo "  start    Install deps, build frontend, start production server"
  echo "  dev      Start API + Vite dev server with hot reload"
  echo "  stop     Stop all running services"
  echo "  status   Show service status"
  echo "  restart  Stop and start production mode"
  echo "  install  Install npm dependencies only"
  echo "  build    Build frontend only"
}

case "${1:-}" in
  start)   cmd_start ;;
  dev)     cmd_dev ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  restart) cmd_restart ;;
  install) check_prerequisites && install_deps ;;
  build)   check_prerequisites && install_deps && build_client ;;
  *)       usage; exit 1 ;;
esac
