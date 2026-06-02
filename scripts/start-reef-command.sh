#!/usr/bin/env bash
set -u

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
APP_HOST="127.0.0.1"
APP_PORT="5174"
APP_URL="http://$APP_HOST:$APP_PORT"

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/reef-command"
PID_DIR="$CACHE_DIR/pids"
LOG_DIR="$CACHE_DIR/logs"
BROWSER_PROFILE_DIR="$CACHE_DIR/browser-profile"
SERVER_PID="$PID_DIR/server.pid"
BROWSER_PID="$PID_DIR/browser.pid"
SERVER_LOG="$LOG_DIR/server.log"
BROWSER_LOG="$LOG_DIR/browser.log"

mkdir -p "$PID_DIR" "$LOG_DIR" "$BROWSER_PROFILE_DIR"

notify_user() {
  local message="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Reef Command" "$message" >/dev/null 2>&1 || true
  fi
}

show_error() {
  local message="$1"
  notify_user "$message"
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title="Reef Command" --text="$message" >/dev/null 2>&1 || true
  fi
}

frontend_ok() {
  curl --silent --fail --max-time 2 --head "$APP_URL" >/dev/null 2>&1
}

pid_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

wait_for_app() {
  for _ in $(seq 1 30); do
    if frontend_ok; then
      return 0
    fi
    sleep 1
  done

  show_error "Reef Command did not start in time. Logs are in $LOG_DIR."
  return 1
}

start_server() {
  if frontend_ok; then
    return 0
  fi

  if pid_running "$SERVER_PID"; then
    echo "Server process exists but is not responding yet." >> "$SERVER_LOG"
  else
    if ! command -v python3 >/dev/null 2>&1; then
      show_error "python3 is required to launch Reef Command."
      return 1
    fi

    (
      cd "$ROOT_DIR" || exit 1
      setsid python3 -m http.server "$APP_PORT" --bind "$APP_HOST" >> "$SERVER_LOG" 2>&1 < /dev/null &
      echo $! > "$SERVER_PID"
    )
  fi

  wait_for_app
}

find_browser() {
  local candidates=(
    "/snap/brave/current/opt/brave.com/brave/brave"
    "/opt/brave.com/brave/brave"
    "/usr/bin/brave-browser"
    "/usr/bin/brave"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/usr/bin/google-chrome"
    "brave-browser"
    "brave"
    "chromium"
    "chromium-browser"
    "google-chrome"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    if [[ "$candidate" != */* ]] && command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

launch_browser_app() {
  local browser
  if ! browser="$(find_browser)"; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || show_error "Reef Command is running at $APP_URL, but the browser could not be opened automatically."
    return
  fi

  local args=(
    "--app=$APP_URL"
    "--user-data-dir=$BROWSER_PROFILE_DIR"
    "--no-first-run"
    "--disable-default-apps"
    "--class=reef-command"
  )

  if [[ -n "${REEF_COMMAND_DEBUG_PORT:-}" ]]; then
    args+=("--remote-debugging-address=127.0.0.1" "--remote-debugging-port=$REEF_COMMAND_DEBUG_PORT")
  fi

  setsid "$browser" "${args[@]}" >> "$BROWSER_LOG" 2>&1 < /dev/null &
  echo $! > "$BROWSER_PID"
}

main() {
  start_server || exit 1
  notify_user "Reef Command is running."
  launch_browser_app
}

main "$@"
