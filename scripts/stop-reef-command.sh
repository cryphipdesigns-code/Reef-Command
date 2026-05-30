#!/usr/bin/env bash
set -u

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/reef-command"
PID_DIR="$CACHE_DIR/pids"
SERVER_PID="$PID_DIR/server.pid"

stop_pid() {
  local label="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    return 0
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "Stopped $label."
  fi

  rm -f "$pid_file"
}

stop_pid "Reef Command" "$SERVER_PID"

if command -v notify-send >/dev/null 2>&1; then
  notify-send "Reef Command" "Reef Command stopped." >/dev/null 2>&1 || true
fi
