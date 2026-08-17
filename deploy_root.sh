#!/bin/bash
# Root-only portion of deploy.sh: file copy + service restarts.
# Invoked by deploy.sh via `sudo`. Whitelisted in /etc/sudoers.d/coop-bot-deploy
# so the bot (and anyone in the sudoers rule) can invoke it without a password
# — but ONLY this exact script path.
#
# Do NOT add any parameterisation that lets a caller execute arbitrary commands.
# This script MUST remain owned by root and non-writable by the invoking user
# (see bot/README.md for the install command).

set -euo pipefail

FRONTEND_DIST=/home/elyss/ygo_decks/frontend/dist
FRONTEND_TARGET=/var/www/frontend

if [ ! -d "$FRONTEND_DIST" ]; then
    echo "ERROR: $FRONTEND_DIST does not exist. Run 'npm run build' first." >&2
    exit 1
fi

echo "→ Deploying frontend assets"
rm -rf "$FRONTEND_TARGET"/*
cp -r "$FRONTEND_DIST"/. "$FRONTEND_TARGET"/
chown -R www-data:www-data "$FRONTEND_TARGET"

echo "→ Restarting services"
systemctl restart nginx
systemctl restart gunicorn
systemctl restart daphne

echo "→ Root deploy done"
