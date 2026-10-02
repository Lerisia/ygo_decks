#!/bin/bash
# End-to-end deploy: build frontend + backend migrations + hand off to
# deploy_root.sh for privileged parts (file copy + service restarts).
#
# When invoked by a human the sudo call may prompt for a password (unless the
# invoker matches the sudoers rule installed for the co-op bot).

set -e

echo "Sending pre-deploy refresh notice to active rooms..."
cd /home/elyss/ygo_decks/backend
source venv/bin/activate
python manage.py notify_update || true
deactivate

echo "Building frontend..."
cd /home/elyss/ygo_decks/frontend
npm run build

# The root step wipes /var/www/frontend before copying, so a phone that reopens a cached older index.html would ask
# for bundles that no longer exist and stay white. Ship the last two days of bundles alongside the new ones.
KEEP=/home/elyss/.cache/ygodecks_assets
mkdir -p "$KEEP"
for f in $(grep -o '/assets/[^"]*' /var/www/frontend/index.html 2>/dev/null); do
    cp -n "/var/www/frontend$f" "$KEEP"/ 2>/dev/null || true
done
cp dist/assets/* "$KEEP"/
find "$KEEP" -type f -mmin +2880 -delete
cp -n "$KEEP"/* dist/assets/

echo "Running backend migrations & collectstatic..."
cd /home/elyss/ygo_decks/backend
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate
python manage.py collectstatic --noinput
deactivate

echo "Handing off privileged steps to deploy_root.sh..."
sudo /usr/local/sbin/ygo-deploy-root

echo "Deployment complete!"
