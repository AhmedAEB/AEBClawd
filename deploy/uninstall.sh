#!/usr/bin/env bash
set -euo pipefail

# ── AEBClawd Uninstaller ──
# Stops services and removes the installation.
# Usage: sudo /opt/aebclawd/deploy/uninstall.sh

INSTALL_DIR="/opt/aebclawd"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run as root: sudo bash uninstall.sh"
  exit 1
fi

echo "This will stop all AEBClawd services and remove the installation."
read -p "Are you sure? [y/N] " -n 1 -r
echo
[[ ! $REPLY =~ ^[Yy]$ ]] && exit 0

echo "=> Stopping services..."
systemctl stop aebclawd-server aebclawd-frontend aebclawd-bot 2>/dev/null || true
systemctl disable aebclawd-server aebclawd-frontend aebclawd-bot 2>/dev/null || true

echo "=> Removing systemd units..."
rm -f /etc/systemd/system/aebclawd-server.service
rm -f /etc/systemd/system/aebclawd-frontend.service
rm -f /etc/systemd/system/aebclawd-bot.service
systemctl daemon-reload

echo "=> Stopping voice containers..."
cd "$INSTALL_DIR" 2>/dev/null && docker compose down 2>/dev/null || true

echo "=> Removing installation directory..."
rm -rf "$INSTALL_DIR"

# Ask about user and data
read -p "Remove aebclawd user and home directory? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  userdel -r aebclawd 2>/dev/null || true
  rm -f /etc/sudoers.d/aebclawd
  echo "   User removed."
fi

read -p "Remove Caddy configuration? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -f /etc/caddy/Caddyfile
  systemctl stop caddy 2>/dev/null || true
  echo "   Caddy config removed."
fi

echo ""
echo "AEBClawd has been uninstalled."
echo "Note: Docker, Caddy, and Node.js packages were left in place."
