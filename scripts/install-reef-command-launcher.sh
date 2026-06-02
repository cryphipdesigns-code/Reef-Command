#!/usr/bin/env bash
set -eu

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_BIN="$HOME/.local/bin"
APPLICATIONS_DIR="$HOME/.local/share/applications"
DESKTOP_DIR="$HOME/Desktop"
START_LINK="$LOCAL_BIN/reef-command-start"
STOP_LINK="$LOCAL_BIN/reef-command-stop"
DESKTOP_FILE="$APPLICATIONS_DIR/reef-command.desktop"
DESKTOP_COPY="$DESKTOP_DIR/Reef Command.desktop"
ICON_FILE="$ROOT_DIR/icons/reef-command.svg"

mkdir -p "$LOCAL_BIN" "$APPLICATIONS_DIR"
ln -sf "$ROOT_DIR/scripts/start-reef-command.sh" "$START_LINK"
ln -sf "$ROOT_DIR/scripts/stop-reef-command.sh" "$STOP_LINK"

write_desktop_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  {
    printf '%s\n' "[Desktop Entry]"
    printf '%s\n' "Type=Application"
    printf '%s\n' "Name=Reef Command"
    printf '%s\n' "Comment=Reef tank logbook and insights"
    printf '%s\n' "Exec=$START_LINK"
    printf '%s\n' "Icon=$ICON_FILE"
    printf '%s\n' "Terminal=false"
    printf '%s\n' "Categories=Office;Utility;"
    printf '%s\n' "StartupNotify=true"
    printf '%s\n' "StartupWMClass=reef-command"
  } > "$path"
  chmod +x "$path"
}

write_desktop_file "$DESKTOP_FILE"

if [[ -d "$DESKTOP_DIR" ]]; then
  write_desktop_file "$DESKTOP_COPY"
  if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_COPY" metadata::trusted true >/dev/null 2>&1 || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

echo "Installed Reef Command launcher:"
echo "  App menu: $DESKTOP_FILE"
if [[ -d "$DESKTOP_DIR" ]]; then
  echo "  Desktop:  $DESKTOP_COPY"
fi
echo
echo "Start from terminal: $START_LINK"
echo "Stop from terminal:  $STOP_LINK"
