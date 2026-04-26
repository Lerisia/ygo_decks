import asyncio
import time

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


# Map from room_id -> running game-runner task. Lives in-process; one runner
# per host's consumer process is sufficient since only the host runs it.
_GAME_RUNNERS = {}
# Per-round early-end events so submit_answer (correct) can wake the runner.
_ROUND_END_EVENTS = {}


class RoomConsumer(AsyncJsonWebsocketConsumer):
    """Per-room WebSocket connection.

    Handles:
    - Connection auth + room membership
    - Game action dispatch (e.g., quiz answer)
    - Game runner lifecycle (host only)
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4401)
            return

        self.user = user
        self.room_id = int(self.scope["url_route"]["kwargs"]["room_id"])
        self.group = room_group_name(self.room_id)

        room_state = await self._get_room_state(self.room_id, user.id)
        if room_state is None:
            await self.close(code=4404)
            return
        if not room_state["is_member"]:
            await self.close(code=4403)
            return

        self.is_host = room_state["is_host"]

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "room": room_state["room"]})

        # If reconnecting host into an in-game room, restart the game runner if needed
        if self.is_host and room_state["room"]["status"] == "in_game":
            await self._maybe_start_game_runner()

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)
        # If host disconnects, cancel game runner
        if getattr(self, "is_host", False):
            task = _GAME_RUNNERS.pop(self.room_id, None)
            if task and not task.done():
                task.cancel()

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")
        print(f"[RoomConsumer room={self.room_id} user={self.user.id}] receive: {content}")
        if msg_type == "submit_answer":
            await self._handle_submit_answer(content.get("choice"))
        elif msg_type == "start_game_runner" and self.is_host:
            await self._maybe_start_game_runner()
        else:
            await self.send_json({"type": "ack", "received": content})

    # === Group event handlers ===
    async def room_event(self, message):
        evt = message["event"]
        await self.send_json({"type": evt, **message.get("payload", {})})
        # On game_started broadcast, the host starts the runner
        if evt == "game_started" and self.is_host:
            await self._maybe_start_game_runner()

    async def personal_event(self, message):
        """Server-pushed personal message to a specific user."""
        if message.get("user_id") == self.user.id:
            await self.send_json({"type": message["event"], **message.get("payload", {})})

    # === Quiz action handling ===
    async def _handle_submit_answer(self, choice):
        if not choice:
            return
        result = await self._db_submit_answer(self.user.id, choice)
        if result is None:
            return
        await self.send_json({"type": "quiz_my_result", **result})
        # First correct answer ends the round immediately.
        if result.get("correct") is True:
            ev = _ROUND_END_EVENTS.get(self.room_id)
            if ev is not None:
                ev.set()

        # Check if all players answered → end round early via runner
        if result.get("all_answered"):
            task = _GAME_RUNNERS.get(self.room_id)
            if task:
                # Signal early end via shared event, if any (not strictly needed)
                pass

    @database_sync_to_async
    def _db_submit_answer(self, user_id, choice):
        from .models import Room, RoomPlayer
        from .games import quiz
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "quiz":
            return None
        try:
            player = RoomPlayer.objects.get(room=room, user_id=user_id)
        except RoomPlayer.DoesNotExist:
            return None

        state = room.game_state or {}
        result = quiz.submit_answer(state, player.id, choice)
        room.game_state = state
        # Persist score on RoomPlayer too (so leaderboard via REST is accurate)
        if "total_score" in result:
            player.score = result["total_score"]
            player.save(update_fields=["score"])
        room.save(update_fields=["game_state"])

        result["all_answered"] = quiz.all_answered(state)
        return result

    # === Game runner ===
    async def _maybe_start_game_runner(self):
        if self.room_id in _GAME_RUNNERS and not _GAME_RUNNERS[self.room_id].done():
            return
        _GAME_RUNNERS[self.room_id] = asyncio.create_task(self._run_quiz_game())

    async def _run_quiz_game(self):
        from .games import quiz
        try:
            # Initialize state if not already initialized
            await self._db_init_quiz_state()

            while True:
                still_in_game = await self._db_is_in_game()
                if not still_in_game:
                    return

                payload = await self._db_start_round()
                if payload is None:
                    break  # no questions or finished

                # Set up early-end event for this round
                ev = asyncio.Event()
                _ROUND_END_EVENTS[self.room_id] = ev

                await self._broadcast_event("quiz_question", payload)

                # Wait for either round timer OR a correct answer (early end)
                try:
                    await asyncio.wait_for(ev.wait(), timeout=quiz.ROUND_DURATION)
                except asyncio.TimeoutError:
                    pass
                finally:
                    _ROUND_END_EVENTS.pop(self.room_id, None)

                # End round, broadcast reveal
                reveal = await self._db_end_round()
                if reveal:
                    await self._broadcast_event("quiz_round_reveal", reveal)

                # Check if game finished
                if await self._db_is_finished():
                    break

                # Pause before next round
                await asyncio.sleep(quiz.INTER_ROUND_PAUSE)

            # Game over
            final = await self._db_finalize_game()
            await self._broadcast_event("quiz_game_end", final)
        except asyncio.CancelledError:
            return
        except Exception as e:
            await self._broadcast_event("quiz_error", {"message": str(e)})
        finally:
            _GAME_RUNNERS.pop(self.room_id, None)

    @database_sync_to_async
    def _db_init_quiz_state(self):
        from .models import Room, RoomPlayer
        from .games import quiz
        room = Room.objects.get(id=self.room_id)
        if not room.game_state:
            player_ids = list(room.players.values_list("id", flat=True))
            room.game_state = quiz.init_game_state(player_ids)
            room.save(update_fields=["game_state"])

    @database_sync_to_async
    def _db_is_in_game(self):
        from .models import Room
        try:
            return Room.objects.get(id=self.room_id).status == "in_game"
        except Room.DoesNotExist:
            return False

    @database_sync_to_async
    def _db_start_round(self):
        from .models import Room
        from .games import quiz
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        if quiz.is_finished(state):
            return None
        payload = quiz.start_round(state)
        room.game_state = state
        room.save(update_fields=["game_state"])
        return payload

    @database_sync_to_async
    def _db_end_round(self):
        from .models import Room
        from .games import quiz
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        reveal = quiz.end_round(state)
        room.game_state = state
        room.save(update_fields=["game_state"])
        return reveal

    @database_sync_to_async
    def _db_is_finished(self):
        from .models import Room
        from .games import quiz
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return True
        return quiz.is_finished(room.game_state or {})

    @database_sync_to_async
    def _db_finalize_game(self):
        from .models import Room
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        scores = state.get("scores", {})
        # Map RoomPlayer.id -> display info
        from .serializers import RoomPlayerSerializer
        players = list(room.players.all())
        ranked = sorted(
            [{"player": RoomPlayerSerializer(p).data, "score": scores.get(str(p.id), 0)} for p in players],
            key=lambda x: -x["score"],
        )
        room.status = "waiting"
        room.game_state = {}
        room.save(update_fields=["status", "game_state"])
        return {"ranked": ranked}

    # === Helpers ===
    async def _broadcast_event(self, event, payload):
        await self.channel_layer.group_send(
            self.group,
            {"type": "room.event", "event": event, "payload": payload},
        )

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
            "is_host": room.host_id == user_id,
        }
