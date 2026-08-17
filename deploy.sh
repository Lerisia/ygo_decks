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
