#!/bin/bash

echo "Building frontend..."
cd /home/elyss/ygo_decks/frontend
npm run build

echo "Deploying frontend..."
sudo rm -rf /var/www/frontend/*
sudo cp -r dist/* /var/www/frontend/
sudo chown -R www-data:www-data /var/www/frontend

echo "Restarting nginx..."
sudo systemctl restart nginx

echo "Restarting backend..."
cd /home/elyss/ygo_decks/backend
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart gunicorn

echo "Deployment complete!"

