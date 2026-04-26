"""JWT authentication middleware for WebSocket connections.

Pulls the access token from the `?token=...` query string and resolves the user.
Falls back to anonymous on any failure (consumer can reject if needed).
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _get_user_from_token(token):
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        from django.contrib.auth import get_user_model
        access = AccessToken(token)
        user_id = access["user_id"]
        return get_user_model().objects.get(id=user_id)
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs((scope.get("query_string") or b"").decode())
        token = (query.get("token") or [None])[0]
        if token:
            scope["user"] = await _get_user_from_token(token)
        else:
            scope.setdefault("user", AnonymousUser())
        return await super().__call__(scope, receive, send)


def JWTAuthMiddlewareStack(inner):
    return JWTAuthMiddleware(inner)
