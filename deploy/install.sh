#!/usr/bin/env bash
set -euo pipefail

# ── AEBClawd Installer ──────────────────────────────────────────
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/AhmedAEB/AEBClawd/main/deploy/install.sh)
# ─────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/AhmedAEB/AEBClawd.git"
INSTALL_DIR="/opt/aebclawd"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║       AEBClawd Installer v0.1.0       ║"
echo "  ║   Self-hosted Claude Code Interface   ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# ── Preflight ──
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This script must be run as root."
  echo "Usage: sudo bash install.sh"
  exit 1
fi

# Check OS
if ! grep -qi 'ubuntu\|debian' /etc/os-release 2>/dev/null; then
  echo "WARNING: This installer is designed for Ubuntu/Debian."
  echo "Other distros may work but are untested."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

echo "=> Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates >/dev/null 2>&1

# ── Node.js 20 ──
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
  if [[ $NODE_MAJOR -ge 20 ]]; then
    echo "=> Node.js $(node -v) found, skipping install"
  else
    echo "=> Node.js $NODE_MAJOR found but need >=20, upgrading..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1
  fi
else
  echo "=> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
fi

# ── pnpm ──
echo "=> Setting up pnpm..."
corepack enable 2>/dev/null || true
corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm >/dev/null 2>&1

# ── Clone or update repo ──
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "=> Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || git pull
else
  echo "=> Cloning AEBClawd..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── Build setup wizard ──
echo "=> Preparing setup wizard..."
cd "$INSTALL_DIR/deploy/setup"
npm install --silent 2>/dev/null || pnpm install 2>/dev/null
npx tsc 2>/dev/null

echo ""
echo "=> Launching interactive setup wizard..."
echo ""

# Hand off to the Ink TUI wizard
# exec replaces this bash process with Node
exec node "$INSTALL_DIR/deploy/setup/dist/index.js"
