#!/bin/sh
# Installs a Weft Worker on this box (docs/architecture/weft-worker.md#installing-on-a-box-you-already-have):
#
#   curl -fsSL https://weft.zip/worker.sh | sh -s -- <enrolment token>
#   sh install/worker.sh <enrolment token>          (from a clone)
#
# 1. the toolchain: git, node 20+, pnpm and git-lfs (Homebrew on macOS, apt-get on Linux)
# 2. Weft itself, cloned into ~/.weft-worker/weft (WEFT_WORKER_REPO picks another remote)
# 3. enrolment: the one-time token from Weft → Settings → Sync → Workers becomes this box's own key
# 4. a service that starts on boot and restarts on a crash: a launchd agent on macOS, a systemd user unit on Linux
#
# Re-running it updates the clone and restarts the service; a box that's already enrolled needs no token.
set -eu

TOKEN="${1:-}"
HOME_DIR="${WEFT_WORKER_HOME:-$HOME/.weft-worker}"
APP_DIR="$HOME_DIR/weft"
REPO="${WEFT_WORKER_REPO:-https://github.com/aimhuge/weft.git}"
BIN_DIR="$HOME/.local/bin"
OS="$(uname -s)"

say() { printf '\033[1m==> %s\033[0m\n' "$1"; }
die() { printf 'weft-worker: %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# macOS keeps Homebrew outside a non-login shell's PATH.
for p in /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in *":$p:"*) ;; *) [ -d "$p" ] && PATH="$p:$PATH" ;; esac
done
export PATH

# ── 1. toolchain ────────────────────────────────────────────────────────────
install_pkgs() {
  if [ "$OS" = Darwin ]; then
    have brew || die "Homebrew is needed to install $*: https://brew.sh"
    brew install "$@"
  else
    have apt-get || die "install $* with your package manager, then run this again"
    sudo apt-get update -y && sudo apt-get install -y "$@"
  fi
}

node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }

say "Checking the toolchain"
have git || install_pkgs git
node_ok || install_pkgs node
node_ok || die "node 20 or newer is needed (found $(node -v 2>/dev/null || echo none))"
have pnpm || { have corepack && corepack enable pnpm 2>/dev/null; } || true
have pnpm || install_pkgs pnpm
# Worth having, not worth stopping for: without it only repos that use LFS refuse to clone. The subshell keeps
# install_pkgs' die from ending the install. The filters are what make a checkout fetch real files, not pointers.
have git-lfs || ( install_pkgs git-lfs ) || say "Skipping git-lfs: repos that use Git LFS won't clone until you install it"
if have git-lfs; then git lfs install --skip-repo >/dev/null || true; fi

# ── 2. Weft ─────────────────────────────────────────────────────────────────
mkdir -p "$HOME_DIR" && chmod 700 "$HOME_DIR"
if [ -d "$APP_DIR/.git" ]; then
  say "Updating Weft in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  say "Cloning Weft into $APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
say "Installing dependencies"
(cd "$APP_DIR" && pnpm install --frozen-lockfile --config.confirmModulesPurge=false)

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/weft-worker" <<EOF
#!/bin/sh
# The Weft Worker's command line (install/worker.sh). update pulls Weft and restarts the service.
export PATH="$PATH"
if [ "\${1:-}" = update ]; then exec sh "$APP_DIR/install/worker.sh"; fi
if [ "\${1:-}" = restart ]; then
  if [ "$OS" = Darwin ]; then exec launchctl kickstart -k "gui/\$(id -u)/zip.weft.worker"; else exec systemctl --user restart weft-worker.service; fi
fi
# What weft-worker login saved (the Claude Code token), for the daemon's CLIs.
if [ -f "$HOME_DIR/worker.env" ]; then set -a; . "$HOME_DIR/worker.env"; set +a; fi
cd "$APP_DIR" && exec node node_modules/jiti/lib/jiti-cli.mjs scripts/weft-worker.ts "\$@"
EOF
chmod 755 "$BIN_DIR/weft-worker"

# ── 3. enrolment ────────────────────────────────────────────────────────────
if [ -f "$HOME_DIR/worker.json" ]; then
  say "Already enrolled ($("$BIN_DIR/weft-worker" status))"
elif [ -n "$TOKEN" ]; then
  say "Enrolling"
  "$BIN_DIR/weft-worker" enrol "$TOKEN"
else
  die "pass the enrolment token from Weft → Settings → Sync → Workers: sh worker.sh <token>"
fi

# ── 4. service ──────────────────────────────────────────────────────────────
LOG="$HOME_DIR/worker.log"
if [ "$OS" = Darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/zip.weft.worker.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>zip.weft.worker</string>
  <key>ProgramArguments</key><array><string>$BIN_DIR/weft-worker</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  # bootout returns before the old agent is gone, and bootstrap fails while it's still loaded.
  launchctl bootout "gui/$(id -u)/zip.weft.worker" 2>/dev/null || true
  i=0
  while launchctl print "gui/$(id -u)/zip.weft.worker" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  say "Running as launchd agent zip.weft.worker (log: $LOG)"
else
  UNIT="$HOME/.config/systemd/user/weft-worker.service"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Weft Worker
After=network-online.target

[Service]
ExecStart=$BIN_DIR/weft-worker start
Restart=always
RestartSec=10
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now weft-worker.service
  systemctl --user restart weft-worker.service
  # Keeps the user's services running with no one logged in.
  loginctl enable-linger "$(id -un)" 2>/dev/null || true
  say "Running as systemd user unit weft-worker (log: $LOG)"
fi
