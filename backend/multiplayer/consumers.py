from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser

from .events import room_group_name


class PingConsumer(AsyncJsonWebsocketConsumer):
    """Minimal consumer for verifying WebSocket infrastructure works."""

    async def connect(self):
        await self.accept()
        await self.send_json({"type": "hello", "message": "websocket connected"})

    async def disconnect(self, code):
        pass

    async def receive_json(self, content, **kwargs):
        await self.send_json({"type": "echo", "received": content})


class RoomConsumer(AsyncJsonWebsocketConsumer):
    """Per-room WebSocket connection.

    Auth is JWT via `?token=...` (handled by JWTAuthMiddlewareStack).
    Anonymous connections are rejected.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)  # custom: unauthorized
            return

        self.user = user
        self.room_id = int(self.scope["url_route"]["kwargs"]["room_id"])
        self.group = room_group_name(self.room_id)

        room_state = await self._get_room_state(self.room_id, user.id)
        if room_state is None:
            await self.close(code=4404)  # not found
            return
        if not room_state["is_member"]:
            await self.close(code=4403)  # not a member
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "room": room_state["room"]})

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Future: route game-specific actions to active game module
        # For now, just echo for verification
        await self.send_json({"type": "ack", "received": content})

    # === Group event handler (called by events.broadcast) ===
    async def room_event(self, message):
        await self.send_json({
            "type": message["event"],
            **message.get("payload", {}),
        })

    # === DB helpers ===
    @database_sync_to_async
    def _get_room_state(self, room_id, user_id):
        from .models import Room, RoomPlayer
        from .serializers import RoomDetailSerializer
        try:
            room = Room.objects.get(id=room_id)
        except Room.DoesNotExist:
            return None
        is_member = RoomPlayer.objects.filter(room_id=room_id, user_id=user_id).exists()
        return {
            "room": RoomDetailSerializer(room).data,
            "is_member": is_member,
        }
