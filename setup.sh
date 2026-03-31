#!/usr/bin/env bash
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────
QUARANTINE_HOURS="${QUARANTINE_HOURS:-18}"
PORT="${PORT:-4873}"
NPM_UPSTREAM="${NPM_UPSTREAM:-https://registry.npmjs.org}"
PYPI_UPSTREAM="${PYPI_UPSTREAM:-https://pypi.org}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.blueghost.proxy"
PROXY_HOST="127.0.0.1"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/blueghost"
STATE_UNSET="__BLUEGHOST_UNSET__"
NPM_REGISTRY="http://${PROXY_HOST}:${PORT}"
PYPI_INDEX="http://${PROXY_HOST}:${PORT}/simple/"

# ── Helpers ──────────────────────────────────────────────────────────
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

need_bun() {
  if ! command -v bun &>/dev/null; then
    red "bun not found. Install it: https://bun.sh"
    exit 1
  fi
}

os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      red "Unsupported OS"; exit 1 ;;
  esac
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

state_file() {
  printf '%s/%s\n' "$STATE_DIR" "$1"
}

has_saved_value() {
  local value="${1:-}"
  [[ -n "$value" && "$value" != "default" && "$value" != "null" && "$value" != "undefined" ]]
}

backup_value_once() {
  local key="$1"
  local value="${2:-}"
  local file missing
  file="$(state_file "$key")"
  missing="${file}.missing"

  if [[ -e "$file" || -e "$missing" ]]; then
    return
  fi

  ensure_state_dir
  if has_saved_value "$value"; then
    printf '%s' "$value" > "$file"
  else
    : > "$missing"
  fi
}

load_state_value() {
  local file missing
  file="$(state_file "$1")"
  missing="${file}.missing"

  if [[ -f "$missing" ]]; then
    printf '%s' "$STATE_UNSET"
    return 0
  fi

  [[ -f "$file" ]] || return 1
  cat "$file"
}

clear_state_value() {
  local file
  file="$(state_file "$1")"
  rm -f "$file" "${file}.missing"
}

backup_file_once() {
  local key="$1"
  local path="$2"
  local file missing
  file="$(state_file "$key")"
  missing="${file}.missing"

  if [[ -e "$file" || -e "$missing" ]]; then
    return
  fi

  ensure_state_dir
  if [[ -f "$path" ]]; then
    cp "$path" "$file"
  else
    : > "$missing"
  fi
}

restore_file_backup() {
  local key="$1"
  local path="$2"
  local file missing
  file="$(state_file "$key")"
  missing="${file}.missing"

  if [[ -f "$missing" ]]; then
    rm -f "$path" "$missing"
    return 0
  fi

  if [[ -f "$file" ]]; then
    cp "$file" "$path"
    rm -f "$file"
    return 0
  fi

  return 1
}

is_proxy_value() {
  local value="${1:-}"
  [[ "$value" == *"localhost"* || "$value" == *"127.0.0.1"* ]]
}

# ── Install as background service ────────────────────────────────────
install_service() {
  need_bun
  local BUN_PATH
  BUN_PATH="$(command -v bun)"

  if [[ "$(os)" == "macos" ]]; then
    local PLIST=~/Library/LaunchAgents/${LABEL}.plist
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BUN_PATH}</string>
    <string>run</string>
    <string>${PROJECT_DIR}/src/server.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>QUARANTINE_HOURS</key>
    <string>${QUARANTINE_HOURS}</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>NPM_UPSTREAM</key>
    <string>${NPM_UPSTREAM}</string>
    <key>PYPI_UPSTREAM</key>
    <string>${PYPI_UPSTREAM}</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/blueghost.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/blueghost.err</string>
</dict>
</plist>
EOF
    launchctl load "$PLIST" 2>/dev/null || true
    launchctl start "$LABEL" 2>/dev/null || true
    green "✓ Installed launchd service (${PLIST})"
    dim "  Logs: /tmp/blueghost.log"

  elif [[ "$(os)" == "linux" ]]; then
    local UNIT_DIR=~/.config/systemd/user
    mkdir -p "$UNIT_DIR"
    cat > "${UNIT_DIR}/blueghost.service" <<EOF
[Unit]
Description=Package Registry Quarantine Proxy
After=network.target

[Service]
Type=simple
ExecStart=${BUN_PATH} run ${PROJECT_DIR}/src/server.ts
Environment=QUARANTINE_HOURS=${QUARANTINE_HOURS}
Environment=PORT=${PORT}
Environment=NPM_UPSTREAM=${NPM_UPSTREAM}
Environment=PYPI_UPSTREAM=${PYPI_UPSTREAM}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now blueghost.service
    green "✓ Installed systemd user service"
    dim "  Logs: journalctl --user -u blueghost"
  fi
}

# ── Uninstall service ────────────────────────────────────────────────
uninstall_service() {
  if [[ "$(os)" == "macos" ]]; then
    local PLIST=~/Library/LaunchAgents/${LABEL}.plist
    launchctl stop "$LABEL" 2>/dev/null || true
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    green "✓ Removed launchd service"

  elif [[ "$(os)" == "linux" ]]; then
    systemctl --user disable --now blueghost.service 2>/dev/null || true
    rm -f ~/.config/systemd/user/blueghost.service
    systemctl --user daemon-reload
    green "✓ Removed systemd service"
  fi
}

# ── Configure package managers to use proxy ──────────────────────────
set_defaults() {
  bold "Configuring package managers → ${PROXY_HOST}:${PORT}"
  echo ""

  # npm (also covers yarn v1 & pnpm which read this)
  if command -v npm &>/dev/null; then
    backup_value_once "npm-registry" "$(npm config get registry 2>/dev/null || true)"
    npm config set registry "$NPM_REGISTRY"
    green "  ✓ npm"
  fi

  # pnpm (explicit, in case it doesn't inherit)
  if command -v pnpm &>/dev/null; then
    backup_value_once "pnpm-registry" "$(pnpm config get registry 2>/dev/null || true)"
    pnpm config set registry "$NPM_REGISTRY" 2>/dev/null
    green "  ✓ pnpm"
  fi

  # yarn berry (v2+)
  if command -v yarn &>/dev/null; then
    local yv
    yv="$(yarn --version 2>/dev/null || echo "0")"
    if [[ "$yv" == 2* || "$yv" == 3* || "$yv" == 4* ]]; then
      backup_value_once "yarn-npmRegistryServer" "$(yarn config get npmRegistryServer 2>/dev/null || true)"
      yarn config set npmRegistryServer "$NPM_REGISTRY" 2>/dev/null
      green "  ✓ yarn (berry)"
    else
      green "  ✓ yarn (classic, uses npm config)"
    fi
  fi

  # bun
  local BUNFIG=~/.bunfig.toml
  if command -v bun &>/dev/null; then
    backup_file_once "bunfig" "$BUNFIG"
    # Create or update global bunfig
    if [[ -f "$BUNFIG" ]]; then
      # Remove existing [install] registry line if present
      sed -i.bak '/^\[install\]/,/^$/{ /registry/d; }' "$BUNFIG" 2>/dev/null || true
      rm -f "${BUNFIG}.bak"
    fi
    # Ensure [install] section exists with registry
    if grep -q '^\[install\]' "$BUNFIG" 2>/dev/null; then
      awk '/^\[install\]/{print; print "registry = \"'"$NPM_REGISTRY"'\""; next}1' \
        "$BUNFIG" > "${BUNFIG}.tmp" && mv "${BUNFIG}.tmp" "$BUNFIG"
    else
      printf '\n[install]\nregistry = "%s"\n' "$NPM_REGISTRY" >> "$BUNFIG"
    fi
    green "  ✓ bun (~/.bunfig.toml)"
  fi

  # pip
  if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
    local PIP_CMD
    PIP_CMD="$(command -v pip3 || command -v pip)"
    backup_value_once "pip-index-url" "$("$PIP_CMD" config get global.index-url 2>/dev/null || true)"
    backup_value_once "pip-trusted-host" "$("$PIP_CMD" config get global.trusted-host 2>/dev/null || true)"
    "$PIP_CMD" config set global.index-url "$PYPI_INDEX" 2>/dev/null
    "$PIP_CMD" config set global.trusted-host "$PROXY_HOST" 2>/dev/null
    green "  ✓ pip"
  fi

  # uv
  if command -v uv &>/dev/null; then
    # uv reads UV_INDEX_URL or pyproject.toml. Best bet: shell profile.
    _add_env_line "export UV_INDEX_URL=\"${PYPI_INDEX}\""
    green "  ✓ uv (added UV_INDEX_URL to shell profile)"
  fi

  echo ""
  green "Done. Restart your shell or source your profile."
}

# ── Unconfigure package managers ─────────────────────────────────────
unset_defaults() {
  bold "Removing proxy configuration from package managers"
  echo ""

  if command -v npm &>/dev/null; then
    local npm_saved
    npm_saved="$(load_state_value "npm-registry" 2>/dev/null || printf '%s' "$STATE_UNSET")"
    if [[ "$npm_saved" == "$STATE_UNSET" ]]; then
      npm config delete registry 2>/dev/null || true
    else
      npm config set registry "$npm_saved" 2>/dev/null || true
    fi
    clear_state_value "npm-registry"
    green "  ✓ npm"
  fi

  if command -v pnpm &>/dev/null; then
    local pnpm_saved
    pnpm_saved="$(load_state_value "pnpm-registry" 2>/dev/null || printf '%s' "$STATE_UNSET")"
    if [[ "$pnpm_saved" == "$STATE_UNSET" ]]; then
      pnpm config delete registry 2>/dev/null || true
    else
      pnpm config set registry "$pnpm_saved" 2>/dev/null || true
    fi
    clear_state_value "pnpm-registry"
    green "  ✓ pnpm"
  fi

  if command -v yarn &>/dev/null; then
    local yv
    yv="$(yarn --version 2>/dev/null || echo "0")"
    if [[ "$yv" == 2* || "$yv" == 3* || "$yv" == 4* ]]; then
      local yarn_saved
      yarn_saved="$(load_state_value "yarn-npmRegistryServer" 2>/dev/null || printf '%s' "$STATE_UNSET")"
      if [[ "$yarn_saved" == "$STATE_UNSET" ]]; then
        yarn config unset npmRegistryServer 2>/dev/null || true
      else
        yarn config set npmRegistryServer "$yarn_saved" 2>/dev/null || true
      fi
      clear_state_value "yarn-npmRegistryServer"
    fi
    green "  ✓ yarn"
  fi

  # bun
  local BUNFIG=~/.bunfig.toml
  if ! restore_file_backup "bunfig" "$BUNFIG" && [[ -f "$BUNFIG" ]]; then
    sed -i.bak '/registry.*\(localhost\|127\.0\.0\.1\)/d' "$BUNFIG" 2>/dev/null || true
    rm -f "${BUNFIG}.bak"
  fi
  if [[ -f "$BUNFIG" || -f "$(state_file "bunfig")" || -f "$(state_file "bunfig").missing" ]]; then
    rm -f "$(state_file "bunfig")" "$(state_file "bunfig").missing"
    green "  ✓ bun"
  fi

  if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
    local PIP_CMD
    PIP_CMD="$(command -v pip3 || command -v pip)"
    local pip_index_saved pip_host_saved
    pip_index_saved="$(load_state_value "pip-index-url" 2>/dev/null || printf '%s' "$STATE_UNSET")"
    pip_host_saved="$(load_state_value "pip-trusted-host" 2>/dev/null || printf '%s' "$STATE_UNSET")"
    if [[ "$pip_index_saved" == "$STATE_UNSET" ]]; then
      "$PIP_CMD" config unset global.index-url 2>/dev/null || true
    else
      "$PIP_CMD" config set global.index-url "$pip_index_saved" 2>/dev/null || true
    fi
    if [[ "$pip_host_saved" == "$STATE_UNSET" ]]; then
      "$PIP_CMD" config unset global.trusted-host 2>/dev/null || true
    else
      "$PIP_CMD" config set global.trusted-host "$pip_host_saved" 2>/dev/null || true
    fi
    clear_state_value "pip-index-url"
    clear_state_value "pip-trusted-host"
    green "  ✓ pip"
  fi

  _remove_env_line "UV_INDEX_URL"
  green "  ✓ uv"

  echo ""
  green "Done. Restart your shell or source your profile."
}

# ── Status ───────────────────────────────────────────────────────────
status() {
  echo ""
  if curl -sf "${NPM_REGISTRY}/" >/dev/null 2>&1; then
    green "● proxy is running on port ${PORT}"
  else
    red "○ proxy is not responding on port ${PORT}"
  fi

  echo ""
  bold "Package manager configs:"

  if command -v npm &>/dev/null; then
    local reg
    reg="$(npm config get registry 2>/dev/null)"
    if is_proxy_value "$reg"; then
      green "  ✓ npm → ${reg}"
    else
      dim "  ○ npm → ${reg} (not proxied)"
    fi
  fi

  if command -v bun &>/dev/null && [[ -f ~/.bunfig.toml ]]; then
    if grep -Eq "localhost|127\.0\.0\.1" ~/.bunfig.toml 2>/dev/null; then
      green "  ✓ bun → proxied"
    else
      dim "  ○ bun → not proxied"
    fi
  fi

  if command -v pip3 &>/dev/null || command -v pip &>/dev/null; then
    local PIP_CMD idx
    PIP_CMD="$(command -v pip3 || command -v pip)"
    idx="$("$PIP_CMD" config get global.index-url 2>/dev/null || echo "default")"
    if is_proxy_value "$idx"; then
      green "  ✓ pip → ${idx}"
    else
      dim "  ○ pip → ${idx} (not proxied)"
    fi
  fi

  echo ""
}

# ── Shell profile helpers ────────────────────────────────────────────
_fish_config=~/.config/fish/config.fish

_shell_profile() {
  case "${SHELL:-}" in
    */fish) echo "fish" ;;
    */zsh)  echo ~/.zshrc ;;
    */bash) echo ~/.bashrc ;;
    *)      echo ~/.profile ;;
  esac
}

_add_env_line() {
  local line="$1"
  local profile
  profile="$(_shell_profile)"

  if [[ "$profile" == "fish" ]]; then
    mkdir -p "$(dirname "$_fish_config")"
    # Extract VAR="VALUE" from 'export VAR="VALUE"'
    local var val
    var="$(echo "$line" | sed 's/^export \([A-Z_]*\)=.*/\1/')"
    val="$(echo "$line" | sed 's/^export [A-Z_]*="\(.*\)"/\1/')"
    local fish_line="set -gx ${var} \"${val}\"  # blueghost"
    if ! grep -qF "$fish_line" "$_fish_config" 2>/dev/null; then
      echo "$fish_line" >> "$_fish_config"
    fi
  else
    if ! grep -qF "$line" "$profile" 2>/dev/null; then
      echo "$line  # blueghost" >> "$profile"
    fi
  fi
}

_remove_env_line() {
  local var="$1"
  local profile
  profile="$(_shell_profile)"

  if [[ "$profile" == "fish" ]]; then
    sed -i.bak "/${var}.*blueghost/d" "$_fish_config" 2>/dev/null || true
    rm -f "${_fish_config}.bak"
  else
    sed -i.bak "/${var}.*blueghost/d" "$profile" 2>/dev/null || true
    rm -f "${profile}.bak"
  fi
}

# ── CLI ──────────────────────────────────────────────────────────────
usage() {
  cat <<EOF

  blueghost setup

  Usage:
    ./setup.sh install         Install as background service
    ./setup.sh uninstall       Remove background service
    ./setup.sh set-defaults    Configure all package managers to use proxy
    ./setup.sh unset-defaults  Revert package manager configs
    ./setup.sh status          Check what's running and configured

  Environment:
    QUARANTINE_HOURS=18        Hours to quarantine new versions (default: 18)
    PORT=4873                  Port to run on (default: 4873)
    NPM_UPSTREAM=...           Override upstream npm registry
    PYPI_UPSTREAM=...          Override upstream PyPI registry

EOF
}

case "${1:-}" in
  install)        install_service ;;
  uninstall)      uninstall_service ;;
  set-defaults)   set_defaults ;;
  unset-defaults) unset_defaults ;;
  status)         status ;;
  *)              usage ;;
esac
