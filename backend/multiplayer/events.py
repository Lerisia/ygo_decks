"""Helpers for broadcasting events to a room's channel group.

Use these from REST views/services when state mutates so connected clients see
updates in real time without polling.
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


ROOM_GROUP_PREFIX = "mp_room_"


def room_group_name(room_id):
    return f"{ROOM_GROUP_PREFIX}{room_id}"


def broadcast(room_id, event_type, payload=None):
    """Send an event to everyone connected to a room.

    Consumers receive it in their `event_type` handler (dots become underscores
    in the handler name per Channels convention).
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        room_group_name(room_id),
        {
            "type": "room.event",
            "event": event_type,
            "payload": payload or {},
        },
    )


def player_joined(room_id, player_data):
    broadcast(room_id, "player_joined", {"player": player_data})


def player_left(room_id, player_id):
    broadcast(room_id, "player_left", {"player_id": player_id})


def player_kicked(room_id, player_id):
    broadcast(room_id, "player_kicked", {"player_id": player_id})


def room_updated(room_id, room_data):
    """Send full room state. Useful for status changes / game start / etc."""
    broadcast(room_id, "room_updated", {"room": room_data})
