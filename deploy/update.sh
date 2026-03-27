#!/usr/bin/env bash
set -euo pipefail

# ── AEBClawd Updater ──
# Pulls latest code, rebuilds, and restarts services.
# Usage: sudo /opt/aebclawd/deploy/update.sh

INSTALL_DIR="/opt/aebclawd"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "ERROR: AEBClawd not found at $INSTALL_DIR"
  exit 1
fi

cd "$INSTALL_DIR"

echo "=> Pulling latest changes..."
git pull origin main

echo "=> Installing dependencies..."
pnpm install

echo "=> Building all apps..."
pnpm --filter server build
pnpm --filter frontend build

# Build bot only if its service is enabled
if systemctl is-enabled aebclawd-bot 2>/dev/null; then
  pnpm --filter bot build
fi

echo "=> Restarting services..."
systemctl restart aebclawd-server aebclawd-frontend

if systemctl is-enabled aebclawd-bot 2>/dev/null; then
  systemctl restart aebclawd-bot
fi

# Reload Caddy in case Caddyfile changed
systemctl reload caddy 2>/dev/null || true

echo ""
echo "Update complete. Services restarted."
echo "Check status: systemctl status aebclawd-server"
