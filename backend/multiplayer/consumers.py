from channels.generic.websocket import AsyncJsonWebsocketConsumer


class PingConsumer(AsyncJsonWebsocketConsumer):
    """Minimal consumer for verifying WebSocket infrastructure works."""

    async def connect(self):
        await self.accept()
        await self.send_json({"type": "hello", "message": "websocket connected"})

    async def disconnect(self, code):
        pass

    async def receive_json(self, content, **kwargs):
        await self.send_json({"type": "echo", "received": content})
