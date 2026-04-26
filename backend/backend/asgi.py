"""
ASGI config for backend project.

Routes HTTP to Django and WebSocket to Channels consumers.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# Initialize Django ASGI application early to ensure AppRegistry is populated
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from multiplayer.auth import JWTAuthMiddlewareStack  # noqa: E402
from multiplayer.routing import websocket_urlpatterns  # noqa: E402


application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': JWTAuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})
