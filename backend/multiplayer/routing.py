from django.urls import path
from .consumers import PingConsumer, RoomConsumer

websocket_urlpatterns = [
    path('ws/ping/', PingConsumer.as_asgi()),
    path('ws/multiplayer/rooms/<int:room_id>/', RoomConsumer.as_asgi()),
]
