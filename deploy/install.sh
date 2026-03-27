#!/usr/bin/env bash
set -euo pipefail

# ── AEBClawd Installer ──────────────────────────────────────────
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/AhmedAEB/AEBClawd/main/deploy/install.sh)
# ─────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/AhmedAEB/AEBClawd.git"
INSTALL_DIR="/opt/aebclawd"
MIN_RAM_MB=1500
MIN_DISK_GB=5

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

# ── Check disk space ──
DISK_AVAIL_KB=$(df / --output=avail | tail -1 | tr -d ' ')
DISK_AVAIL_GB=$((DISK_AVAIL_KB / 1024 / 1024))
if [[ $DISK_AVAIL_GB -lt $MIN_DISK_GB ]]; then
  echo "ERROR: Not enough disk space. Need at least ${MIN_DISK_GB}GB, have ${DISK_AVAIL_GB}GB."
  exit 1
fi
echo "=> Disk: ${DISK_AVAIL_GB}GB available"

# ── Check RAM + auto-create swap if needed ──
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
TOTAL_SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
EFFECTIVE_MB=$((TOTAL_RAM_MB + TOTAL_SWAP_MB))
echo "=> RAM: ${TOTAL_RAM_MB}MB | Swap: ${TOTAL_SWAP_MB}MB"

if [[ $EFFECTIVE_MB -lt $MIN_RAM_MB ]]; then
  # Calculate how much swap we need (aim for RAM + swap >= 2GB)
  SWAP_NEEDED_MB=$((2048 - EFFECTIVE_MB))
  # Minimum 1GB swap, round up to nearest GB
  SWAP_GB=$(( (SWAP_NEEDED_MB + 1023) / 1024 ))
  [[ $SWAP_GB -lt 1 ]] && SWAP_GB=1

  # Check we have enough disk for swap (need swap + MIN_DISK_GB)
  SWAP_KB=$((SWAP_GB * 1024 * 1024))
  if [[ $((DISK_AVAIL_KB - SWAP_KB)) -lt $((MIN_DISK_GB * 1024 * 1024)) ]]; then
    echo "WARNING: Not enough disk for ${SWAP_GB}GB swap + ${MIN_DISK_GB}GB install."
    echo "Builds may fail due to low memory. Continuing anyway..."
  else
    if [[ ! -f /swapfile ]]; then
      echo "=> Low memory detected. Creating ${SWAP_GB}GB swap..."
      fallocate -l ${SWAP_GB}G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024)) status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      # Persist across reboots
      if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
      fi
      echo "   Swap created and activated."
    else
      echo "=> Swapfile already exists, ensuring it's active..."
      swapon /swapfile 2>/dev/null || true
    fi
  fi
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
