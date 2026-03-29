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

# Ensure HOME=/root is set in all service files (needed for git/gh auth)
for svc in aebclawd-server aebclawd-frontend aebclawd-bot; do
  svc_file="/etc/systemd/system/${svc}.service"
  if [[ -f "$svc_file" ]] && ! grep -q 'Environment=HOME=' "$svc_file"; then
    sed -i '/Environment=NODE_ENV=production/a Environment=HOME=/root' "$svc_file"
    echo "   Patched $svc with HOME=/root"
  fi
done
systemctl daemon-reload

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
