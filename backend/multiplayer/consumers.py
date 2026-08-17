import asyncio
import random
import time

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.db import transaction

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


def _public_name(room, player_or_id):
    """Return the name we surface for this player in the given room — the
    real display_name normally, "플레이어N" in anonymous rooms. Accepts
    either a RoomPlayer instance or its id."""
    from .models import RoomPlayer
    from .serializers import anonymized_display_name
    player = player_or_id
    if not isinstance(player, RoomPlayer):
        try:
            player = RoomPlayer.objects.get(id=int(player_or_id))
        except Exception:
            return ""
    if getattr(room, "is_anonymous", False) and not player.is_hidden:
        return anonymized_display_name(player)
    return player.display_name


async def _player_auto_leave(player_id: int, room_id: int, grace_seconds: int):
    """Sleep through the grace window and, if the player is still
    disconnected, remove them from the room. Cancellation (caller cancels
    when the player reconnects in time, e.g. on refresh) cleanly aborts."""
    try:
        await asyncio.sleep(grace_seconds)
    except asyncio.CancelledError:
        return
    # Re-check live connection count — caller already cancels on reconnect,
    # but defend against the rare race.
    if _PLAYER_WS_COUNT.get(player_id, 0) > 0:
        _PLAYER_LEAVE_TASKS.pop(player_id, None)
        return
    try:
        await _do_remove_player(player_id, room_id)
    finally:
        _PLAYER_LEAVE_TASKS.pop(player_id, None)


@database_sync_to_async
def _room_status_for(room_id: int) -> str:
    from .models import Room
    try:
        return Room.objects.values_list("status", flat=True).get(id=room_id)
    except Room.DoesNotExist:
        return "closed"


@database_sync_to_async
def _do_remove_player(player_id: int, room_id: int):
    """Server-side equivalent of the leave_room view for a single player.
    Used by the guest auto-leave task. Mirrors the same cleanup so guests
    timing out behave identically to clicking '방 나가기'."""
    from .models import Room, RoomPlayer
    from . import events
    from .views import (
        _cleanup_player_from_game_state,
        _close_room_inline,
        _close_room_inline_if_only_spectators,
        _maybe_end_game_due_to_low_count,
        _award_partial_points_on_leave,
    )
    from .serializers import RoomDetailSerializer
    from django.db import transaction
    try:
        room = Room.objects.get(id=room_id)
    except Room.DoesNotExist:
        return
    player = RoomPlayer.objects.filter(id=player_id, room=room).first()
    if player is None:
        return
    was_host = (room.host_id == player.user_id) if player.user_id else False
    pid = player.id
    # Capture for the post-txn system chat — same pattern as leave_room.
    from .views import _player_chat_name
    auto_leave_name = _player_chat_name(player)
    auto_leave_was_stealth = player.is_hidden
    auto_leave_was_spectator = player.is_spectator
    with transaction.atomic():
        # Auto-leave (60s grace timeout) gets the same partial payout as a
        # voluntary leave — read score before cleanup strips it.
        _award_partial_points_on_leave(room, player)
        if room.status == "in_game" and not player.is_spectator:
            _cleanup_player_from_game_state(room, str(pid))
        player.delete()
        if was_host:
            next_host = (
                RoomPlayer.objects.filter(room=room, is_spectator=False)
                .exclude(user__isnull=True)
                .order_by("joined_at")
                .first()
            )
            if next_host:
                room.host = next_host.user
                room.save(update_fields=["host"])
                next_host.is_host = True
                next_host.save(update_fields=["is_host"])
            else:
                _close_room_inline(room)
        else:
            _close_room_inline_if_only_spectators(room)
    events.player_left(room.id, pid)
    if room.status == "closed":
        events.broadcast(room.id, "room_closed", {"message": "방이 종료되었습니다."})
    elif was_host:
        events.room_updated(room.id, RoomDetailSerializer(room).data)

    if not auto_leave_was_stealth and room.status != "closed":
        from .views import _post_system_chat
        verb = "관전 자동 퇴장" if auto_leave_was_spectator else "자동 퇴장"
        _post_system_chat(room, f"{auto_leave_name}님이 연결 끊김으로 {verb}되었습니다")

    _maybe_end_game_due_to_low_count(room)


def signal_runner_to_exit(room_id):
    """Wake any blocked wait_for in the room's game runner so it can re-check
    `room.status` and exit promptly. Called from end_game / close_room / when
    we need to start a new game on the same room — otherwise the old runner
    can sit in a long timeout (e.g., DRAW_SECONDS=80) and block the next
    game's runner from starting."""
    for bag in (_ROUND_END_EVENTS, _DM_END_EVENTS, _TW_END_EVENTS,
                _DM_CHOICE_EVENTS, _TW_CARD_EVENTS, _TW_QUESTION_EVENTS,
                _TW_ANSWER_EVENTS, _TW_GUESS_EVENTS,
                _TW_HAND_RAISE_EVENTS, _TW_HAND_GUESS_EVENTS):
        ev = bag.get(room_id)
        if ev is not None:
            try:
                ev.set()
            except Exception:
                pass
# Per-round early-end events so submit_answer (correct) can wake the runner.
_ROUND_END_EVENTS = {}
# DuchMind: per-room in-memory stroke log (replayed to late-joiners during a turn)
_DM_STROKES: dict[int, list] = {}
# Snapshot of strokes immediately before a "clear all" so the next undo
# can restore them. Cleared whenever the drawer adds a new stroke (any
# new content invalidates the clear-undo) or the turn flips.
_DM_PRE_CLEAR_SNAPSHOT: dict[int, list] = {}
# DuchMind: per-RoomPlayer.id timestamp of last 👍/👎 reaction — rate limit.
_DM_REACT_LAST: dict[int, float] = {}
# DuchMind: per-room "drawer chose word" event so runner can move from choosing → drawing
_DM_CHOICE_EVENTS = {}
# DuchMind: per-room "all guessed" early-end event
_DM_END_EVENTS = {}
# Twenty Questions: per-room events to wake the runner on player input.
_TW_CARD_EVENTS = {}      # drawer chose a card → start asking phase
_TW_QUESTION_EVENTS = {}  # asker submitted (or wants guess) → drawer's answer phase
_TW_ANSWER_EVENTS = {}    # drawer answered → next asker
_TW_GUESS_EVENTS = {}     # competitive: asker passed/guessed during their post-answer window
_TW_HAND_RAISE_EVENTS = {} # competitive: someone raised hand or window timed out
_TW_HAND_GUESS_EVENTS = {} # competitive: hand-raiser submitted/passed/timed out
_TW_END_EVENTS = {}       # someone correctly guessed → round done
_TW_CHAT_HISTORY: dict[int, list] = {}
_QUIZ_CHAT_HISTORY: dict[int, list] = {}
# Active WS connection count per RoomPlayer.id. Used to detect when a player
# fully closes the room page (count → 0) so we can auto-leave them after a
# short grace period. A refresh briefly drops to 0 then back to 1, which the
# grace period absorbs; navigating elsewhere on the site never reconnects, so
# they're cleanly removed from the room.
_PLAYER_WS_COUNT: dict[int, int] = {}
# Pending auto-leave tasks, keyed by RoomPlayer.id. Cancelled if the player
# reconnects within the grace window.
_PLAYER_LEAVE_TASKS: dict[int, "asyncio.Task"] = {}
# Grace period before a disconnected player is removed from the room.
# Lobby is short (a refresh always reconnects in <2s); in-game is longer
# because brief network blips during a game shouldn't cost someone their
# seat (and the runner is more forgiving of mid-turn drops).
DISCONNECT_GRACE_LOBBY_SECONDS = 300
DISCONNECT_GRACE_INGAME_SECONDS = 60
# Window after a game ends where the room is technically `status=waiting`
# (lobby) but viewers are still on the result scoreboard. Treat
# disconnects in this window with the longer in-game grace so a screen
# lock or tab switch while reading scores doesn't auto-leave them.
RECENT_END_GRACE_SECONDS = 60
_RECENT_END_TIMES: dict[int, float] = {}
# Lobby ready state: room_id -> set of str(player_id) currently flagged as ready.
# In-memory; cleared on game start or daphne restart.
_READY_STATES: dict[int, set] = {}
# Recent chat history for replay on reconnect. Bounded buffer per room.
_LOBBY_CHAT_HISTORY: dict[int, list] = {}
_DM_CHAT_HISTORY: dict[int, list] = {}
_CHAT_HISTORY_MAX = 100


class RoomConsumer(AsyncJsonWebsocketConsumer):
    """Per-room WebSocket connection.

    Handles:
    - Connection auth + room membership
    - Game action dispatch (e.g., quiz answer)
    - Game runner lifecycle (host only)
    """

    async def connect(self):
        user = self.scope.get("user")
        guest_token = self.scope.get("guest_token") or ""
        is_authed = bool(user and not isinstance(user, AnonymousUser) and user.is_authenticated)
        if not is_authed and not guest_token:
            await self.close(code=4401)
            return

        self.user = user if is_authed else None
        self.is_guest_session = not is_authed
        self.room_id = int(self.scope["url_route"]["kwargs"]["room_id"])
        self.group = room_group_name(self.room_id)

        room_state = await self._get_room_state(
            self.room_id,
            user.id if is_authed else None,
            guest_token if not is_authed else "",
        )
        if room_state is None:
            await self.close(code=4404)
            return
        if not room_state["is_member"]:
            await self.close(code=4403)
            return

        self.player_id = room_state["player_id"]
        self.is_host = room_state["is_host"]
        self.is_spectator = room_state.get("is_spectator", False)

        # Bump live connection count and cancel any pending auto-leave for
        # this player (e.g., they refreshed within the grace window).
        prev_count = _PLAYER_WS_COUNT.get(self.player_id, 0)
        _PLAYER_WS_COUNT[self.player_id] = prev_count + 1
        pending = _PLAYER_LEAVE_TASKS.pop(self.player_id, None)
        if pending and not pending.done():
            pending.cancel()
        # Coming back from 0 → 1 means they were inside the grace window and
        # other clients had been told they were offline. Tell everyone they're
        # back so the "끊김" indicator clears.
        was_offline = prev_count == 0 and pending is not None
        if was_offline:
            # We're already inside the consumer's async loop, so call
            # channel_layer.group_send directly instead of routing through
            # events.broadcast (which uses async_to_sync — would raise
            # "AsyncToSync in same thread as async event loop" here).
            await self.channel_layer.group_send(
                self.group,
                {
                    "type": "room.event",
                    "event": "player_online",
                    "payload": {"player_id": self.player_id},
                },
            )

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        # Mark the room as active on every connect — keeps the 30-minute
        # idle-cleanup clock pinned to the most recent join/reconnect
        # rather than the last `Room.save()`, which usually runs with
        # `update_fields=[...]` and so doesn't bump the auto_now field.
        await self._db_touch_room_activity()
        await self.send_json({
            "type": "connected",
            "room": room_state["room"],
            # Tell the client which RoomPlayer is theirs so it can detect
            # "self" reliably even in anonymous rooms (where display_name is
            # shared style "플레이어N").
            "your_player_id": self.player_id,
            # Stealth (운영진 유령입장) RoomPlayers have is_hidden=True and are
            # excluded from the public players list, so the client can't
            # find their own row to derive is_spectator. Surface it directly
            # so DuchMindGameView's chat filter (amSpectator) treats stealth
            # like a regular spectator and shows all chat including
            # restricted_to_solved.
            "your_is_spectator": bool(self.is_spectator),
        })
        # Send current ready state (lobby) so a reconnecting client sees who's ready.
        ready_ids = list(_READY_STATES.get(self.room_id, set()))
        await self.send_json({"type": "ready_update", "ready_ids": ready_ids})
        # Replay recent chat so a refresh doesn't blank the chat panel.
        lobby_hist = _LOBBY_CHAT_HISTORY.get(self.room_id, [])
        if lobby_hist:
            await self.send_json({"type": "lobby_chat_history", "messages": list(lobby_hist)})
        dm_hist = _DM_CHAT_HISTORY.get(self.room_id, [])
        if dm_hist:
            await self.send_json({"type": "dm_chat_history", "messages": list(dm_hist)})
        tw_hist = _TW_CHAT_HISTORY.get(self.room_id, [])
        if tw_hist:
            await self.send_json({"type": "tw_chat_history", "messages": list(tw_hist)})
        quiz_hist = _QUIZ_CHAT_HISTORY.get(self.room_id, [])
        if quiz_hist:
            await self.send_json({"type": "quiz_chat_history", "messages": list(quiz_hist)})

        # If we're rejoining an in-game room, replay current state to this client
        # so the timer / question / reveal stays in sync.
        if room_state["room"]["status"] == "in_game":
            await self._send_current_game_state()
            # Auto-restart only games whose runner can self-heal mid-state.
            # Currently: duchmind (its runner inspects state.phase and resumes
            # the in-flight turn). Quiz's runner unconditionally calls
            # start_round so we MUST NOT restart it on reconnect.
            if (self.is_host
                and room_state["room"].get("current_game") == "duchmind"
                and (self.room_id not in _GAME_RUNNERS
                     or _GAME_RUNNERS[self.room_id].done())
            ):
                await self._maybe_start_game_runner()

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)
        # Bump room activity so the cleanup clock starts from the most
        # recent disconnect rather than some stale prior save().
        if hasattr(self, "room_id"):
            try: await self._db_touch_room_activity()
            except Exception: pass
        # NOTE: do NOT cancel the runner on disconnect. The runner is per-room
        # and survives temporary disconnects (host refresh). Killing it here
        # would corrupt the in-flight round when the host re-connects.

        # Decrement the live-connection count. If this was the last open
        # connection, schedule auto-leave after a grace window — refreshes
        # reconnect within that window and cancel the pending leave;
        # navigation away never reconnects, so the player cleanly leaves.
        # Grace is longer in-game so brief network blips don't cost a seat.
        if hasattr(self, "player_id") and self.player_id is not None:
            pid = self.player_id
            _PLAYER_WS_COUNT[pid] = max(0, _PLAYER_WS_COUNT.get(pid, 1) - 1)
            if _PLAYER_WS_COUNT[pid] == 0:
                status = await _room_status_for(self.room_id)
                # Result-screen window: still status=waiting but the
                # finalize_game stamp says the game ended seconds ago.
                # Use the longer in-game grace so viewers reading the
                # scoreboard aren't auto-leaved by screen-lock blips.
                in_result_window = (
                    status == "waiting"
                    and (time.time() - _RECENT_END_TIMES.get(self.room_id, 0)) < RECENT_END_GRACE_SECONDS
                )
                grace = (
                    DISCONNECT_GRACE_INGAME_SECONDS
                    if status == "in_game" or in_result_window
                    else DISCONNECT_GRACE_LOBBY_SECONDS
                )
                _PLAYER_LEAVE_TASKS[pid] = asyncio.create_task(
                    _player_auto_leave(pid, self.room_id, grace)
                )
                # Tell everyone else this player is currently offline so the
                # UI can show a "끊김" indicator until they reconnect or the
                # grace period elapses. Direct await — see player_online above
                # for why we don't go through events.broadcast here.
                await self.channel_layer.group_send(
                    self.group,
                    {
                        "type": "room.event",
                        "event": "player_offline",
                        "payload": {"player_id": pid},
                    },
                )

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")
        # Spectators are restricted to chat-only (subject to host permission).
        if self.is_spectator and msg_type not in ("dm_chat", "tw_chat", "quiz_chat", "lobby_chat"):
            return
        if msg_type == "submit_answer":
            await self._handle_submit_answer(content.get("choice"))
        elif msg_type == "start_game_runner" and self.is_host:
            await self._maybe_start_game_runner()
        # === DuchMind handlers ===
        elif msg_type == "dm_stroke":
            await self._handle_dm_stroke(content.get("payload"))
        elif msg_type == "dm_choose_word":
            await self._handle_dm_choose_word(content.get("card_id"), content.get("word"))
        elif msg_type == "dm_chat":
            await self._handle_dm_chat(content.get("text") or "")
        elif msg_type == "dm_clear":
            await self._handle_dm_clear()
        elif msg_type == "dm_undo":
            await self._handle_dm_undo()
        elif msg_type == "dm_give_up":
            await self._handle_dm_give_up()
        elif msg_type == "dm_react":
            await self._handle_dm_react(content.get("emoji"))
        # === Twenty Questions handlers ===
        elif msg_type == "tw_choose_card":
            await self._handle_tw_choose_card(content.get("card_id"), content.get("card_name"))
        elif msg_type == "tw_submit_question":
            await self._handle_tw_submit_question(content.get("text") or "")
        elif msg_type == "tw_submit_answer":
            await self._handle_tw_submit_answer(content.get("answer"))
        elif msg_type == "tw_submit_guess":
            await self._handle_tw_submit_guess(content.get("card_id"))
        elif msg_type == "tw_pass_guess":
            await self._handle_tw_pass_guess()
        elif msg_type == "tw_raise_hand":
            await self._handle_tw_raise_hand()
        elif msg_type == "tw_pass_hand_guess":
            await self._handle_tw_pass_hand_guess()
        elif msg_type == "tw_chat":
            await self._handle_tw_chat(content.get("text") or "")
        elif msg_type == "quiz_chat":
            await self._handle_quiz_chat(content.get("text") or "")
        elif msg_type == "lobby_chat":
            await self._handle_lobby_chat(content.get("text") or "")
        elif msg_type == "set_ready":
            await self._handle_set_ready(bool(content.get("ready")))
        else:
            await self.send_json({"type": "ack", "received": content})

    # === Group event handlers ===
    async def room_event(self, message):
        evt = message["event"]
        await self.send_json({"type": evt, **message.get("payload", {})})
        # On game_started broadcast, the host starts the runner + clear ready states
        if evt == "game_started":
            _READY_STATES.pop(self.room_id, None)
            _DM_CHAT_HISTORY.pop(self.room_id, None)
            _TW_CHAT_HISTORY.pop(self.room_id, None)
            _QUIZ_CHAT_HISTORY.pop(self.room_id, None)
            if self.is_host:
                await self._maybe_start_game_runner()
        # Refresh our cached spectator flag when the toggle-spectator REST view
        # broadcasts an updated record for us. Without this, a spectator who
        # joins mid-game stays flagged as spectator on the live socket and
        # `receive_json` silently drops their dm_stroke / dm_undo / dm_clear
        # messages once they take a drawing turn.
        if evt == "player_updated":
            p = (message.get("payload") or {}).get("player") or {}
            if p.get("id") == self.player_id:
                self.is_spectator = bool(p.get("is_spectator"))

    async def personal_event(self, message):
        """Server-pushed personal message to a specific player."""
        if message.get("player_id") == self.player_id:
            await self.send_json({"type": message["event"], **message.get("payload", {})})

    # === Quiz action handling ===
    async def _handle_submit_answer(self, choice):
        if not choice:
            return
        result = await self._db_submit_answer(self.player_id, choice)
        if result is None:
            return
        # Slim reply to the answering client — correct/delta/stage/total_score
        # are intentionally hidden. The player only learns the outcome at the
        # round-end reveal, exactly like everyone else. We still send back the
        # `choice` so the UI can remember which button was tapped (e.g. for
        # the highlight that survives a reconnect later in the round).
        fe_result = {"locked": True, "choice": choice}
        if result.get("error"):
            fe_result = {"error": result["error"]}
        if "round" in result:
            fe_result["round"] = result["round"]
        await self.send_json({"type": "quiz_my_result", **fe_result})
        # Public progress broadcast — everyone sees "X/N답함" so they know
        # how many are still deciding. Correct/wrong is NOT revealed until
        # the round ends (no spoilers). Skip on error / already-locked
        # callbacks so a player tapping the same button twice doesn't fire
        # spurious broadcasts.
        if "progress" in result and not result.get("error"):
            await self._broadcast_event("quiz_progress", {
                "round": result.get("round"),
                "answered": result["progress"]["answered"],
                "total": result["progress"]["total"],
            })
        # Round ends early only when every active player has locked in
        # (correct OR wrong). No more "first correct ends the round".
        ev = _ROUND_END_EVENTS.get(self.room_id)
        if ev is not None and result.get("all_answered"):
            ev.set()

    @database_sync_to_async
    def _db_submit_answer(self, player_id, choice):
        from .models import Room, RoomPlayer
        from .games import quiz
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "quiz":
            return None
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
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
        answered, total = quiz.answered_progress(state)
        result["progress"] = {"answered": answered, "total": total}
        result["round"] = state.get("round")
        return result

    # === Game runner ===
    async def _maybe_start_game_runner(self):
        # If there's a leftover runner task from a previous game, cancel it
        # cleanly before starting a new one. (Mid-game reconnects don't reach
        # here — their callsite guards on `runner.done()` already.)
        existing = _GAME_RUNNERS.get(self.room_id)
        if existing and not existing.done():
            existing.cancel()
            try:
                await existing
            except (asyncio.CancelledError, Exception):
                pass
        game_id = await self._db_current_game()
        if game_id == "duchmind":
            _GAME_RUNNERS[self.room_id] = asyncio.create_task(self._run_duchmind_game())
        elif game_id == "twenty":
            _GAME_RUNNERS[self.room_id] = asyncio.create_task(self._run_twenty_game())
        else:
            _GAME_RUNNERS[self.room_id] = asyncio.create_task(self._run_quiz_game())

    @database_sync_to_async
    def _db_current_game(self):
        from .models import Room
        try:
            return Room.objects.get(id=self.room_id).current_game or ""
        except Room.DoesNotExist:
            return ""

    async def _run_quiz_game(self):
        from .games import quiz
        try:
            # Initialize state if not already initialized
            await self._db_init_quiz_state()

            while True:
                still_in_game = await self._db_is_in_game()
                if not still_in_game:
                    return

                # Promote any spectators who reserved a seat for the next
                # round — they become active participants from this round
                # onward.
                promoted = await self._db_promote_quiz_reservations()
                for ps in promoted:
                    await self._broadcast_event("player_updated", {"player": ps})

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
                    await self._persist_turn_log("quiz", reveal)

                # Always pause after reveal so clients can read the answer
                # (including on the final round, before quiz_game_end overwrites it).
                await asyncio.sleep(quiz.INTER_ROUND_PAUSE)

                # Check if game finished
                if await self._db_is_finished():
                    break

            # Game over
            final = await self._db_finalize_game()
            if final:  # None when manually ended externally
                await self._broadcast_event("quiz_game_end", final)
                updated = await self._db_serialize_room()
                if updated:
                    await self._broadcast_event("room_updated", {"room": updated})
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
            player_ids = list(room.players.filter(is_spectator=False).values_list("id", flat=True))
            room.game_state = quiz.init_game_state(
                player_ids, total_rounds=room.quiz_total_rounds or quiz.TOTAL_ROUNDS,
            )
            room.save(update_fields=["game_state"])

    @database_sync_to_async
    def _db_promote_quiz_reservations(self):
        """Promote spectators who reserved-for-next to active players, seed
        their score in game_state. Returns serialized snapshots of every
        promoted player so the caller can broadcast `player_updated`.
        Capped at room.max_players (room.players.is_spectator=False count
        + promoted ≤ max).
        """
        from .models import Room, RoomPlayer
        from .games import quiz
        from .serializers import RoomPlayerSerializer
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        promoted_payloads = []
        with transaction.atomic():
            reserved_qs = (
                RoomPlayer.objects
                .select_for_update()
                .filter(room=room, is_spectator=True, reserved_for_next=True)
                .order_by("joined_at")
            )
            active_count = RoomPlayer.objects.filter(room=room, is_spectator=False).count()
            for p in reserved_qs:
                if active_count >= room.max_players:
                    break
                p.is_spectator = False
                p.reserved_for_next = False
                p.score = 0
                p.save(update_fields=["is_spectator", "reserved_for_next", "score"])
                quiz.add_player(state, p.id)
                promoted_payloads.append(RoomPlayerSerializer(p).data)
                active_count += 1
            if promoted_payloads:
                room.game_state = state
                room.save(update_fields=["game_state"])
        return promoted_payloads

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
        payload = quiz.start_round(state, pack_id=room.quiz_word_pack_id)
        room.game_state = state
        room.save(update_fields=["game_state"])
        return payload

    @database_sync_to_async
    def _db_end_round(self):
        from .models import Room, RoomPlayer
        from .games import quiz
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        reveal = quiz.end_round(state)
        room.game_state = state
        room.save(update_fields=["game_state"])
        if reveal and reveal.get("winner_player_id"):
            try:
                p = RoomPlayer.objects.get(id=int(reveal["winner_player_id"]))
                reveal["winner_name"] = p.display_name
            except (RoomPlayer.DoesNotExist, ValueError):
                reveal["winner_name"] = None
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
        from .scoring import finalize_game
        return finalize_game(self.room_id, "quiz")

    # ====================================================================
    # === DuchMind (skribbl-style) ========================================
    # ====================================================================

    async def _run_duchmind_game(self):
        from .games import duchmind as dm
        try:
            await self._db_dm_init_state()

            while True:
                still = await self._db_is_in_game()
                if not still:
                    return

                # === RESUME PATH ===
                # If a previous runner died mid-turn, state.phase will be
                # "choosing", "drawing", or "reveal". Recover gracefully.
                resume = await self._db_dm_resume_info()
                if resume:
                    rphase = resume["phase"]
                    rdrawer = resume["drawer_id"]
                    rdeadline = resume["deadline"]
                    # Extend stale deadlines on resume — if the runner died and
                    # restarted (e.g., a code deploy), the persisted deadline
                    # may already be in the past, and without this guard the
                    # consumer would `wait_for(timeout=0)` and immediately auto-
                    # confirm / auto-end the turn. That made an in-progress
                    # drawer's turn appear to vanish on every deploy. Floor
                    # the remaining time at a useful baseline so the user
                    # actually gets time to act.
                    now_ts = time.time()
                    if rphase == "choosing" and rdeadline - now_ts < 5:
                        rdeadline = now_ts + max(5.0, dm.WORD_CHOICE_SECONDS / 2)
                        await self._db_dm_patch_deadline(rdeadline)
                    elif rphase == "drawing" and rdeadline - now_ts < 5:
                        # Drawing phase: use half of the room's configured
                        # draw_seconds as the floor.
                        draw_seconds = await self._db_dm_draw_seconds()
                        rdeadline = now_ts + max(10.0, draw_seconds / 2)
                        await self._db_dm_patch_deadline(rdeadline)
                    if rphase == "reveal":
                        # We were in reveal pause — just wait the (rest of the) pause.
                        await asyncio.sleep(dm.INTER_TURN_PAUSE)
                        if await self._db_dm_is_game_over():
                            break
                        continue
                    # Still inside choosing/drawing with time left — re-broadcast
                    # current state and wait the remaining time.
                    if rphase == "choosing":
                        remaining = max(0.0, rdeadline - time.time())
                        await self._broadcast_event("dm_choosing", {
                            "drawer_id": rdrawer,
                            "drawer_name": resume.get("drawer_name", ""),
                            "deadline": rdeadline,
                            "seconds_remaining": remaining,
                            "round": resume.get("round", 1),
                            "total_rounds": resume.get("total_rounds"),
                            "turn_index": resume.get("turn_index", 0),
                            "drawer_order": resume.get("drawer_order") or [],
                        })
                        await self._send_to_player(rdrawer, "dm_word_choices", {
                            "choices": resume.get("choices", []),
                            "deadline": rdeadline,
                            "seconds_remaining": remaining,
                        })
                        ev = asyncio.Event()
                        _DM_CHOICE_EVENTS[self.room_id] = ev
                        try:
                            await asyncio.wait_for(ev.wait(), timeout=remaining)
                        except asyncio.TimeoutError:
                            choices = resume.get("choices") or []
                            if choices:
                                auto = choices[0]
                                await self._db_dm_auto_confirm_word(rdrawer, auto["card_id"])
                        finally:
                            _DM_CHOICE_EVENTS.pop(self.room_id, None)
                        # Fall through to drawing phase below
                    if (await self._db_dm_resume_info() or {}).get("phase") == "drawing":
                        rdraw = await self._db_dm_drawing_payload()
                        if rdraw:
                            await self._broadcast_event("dm_drawing", rdraw)
                            await self._send_to_player(rdrawer, "dm_drawer_word", {
                                "word": rdraw["_word_for_drawer"],
                                "image_url": rdraw.get("_image_url_for_drawer"),
                            })
                            end_time = rdraw["deadline"]
                            end_ev = asyncio.Event()
                            _DM_END_EVENTS[self.room_id] = end_ev
                            try:
                                while True:
                                    now = time.time()
                                    remaining = end_time - now
                                    if remaining <= 0:
                                        break
                                    try:
                                        await asyncio.wait_for(end_ev.wait(), timeout=min(1.0, remaining))
                                        if end_ev.is_set():
                                            break
                                    except asyncio.TimeoutError:
                                        pass
                                    new_hint = await self._db_dm_maybe_reveal_hint()
                                    if new_hint is not None:
                                        await self._broadcast_event("dm_hint", {"hint": new_hint})
                            finally:
                                _DM_END_EVENTS.pop(self.room_id, None)
                        reveal = await self._db_dm_end_turn()
                        if reveal:
                            await self._broadcast_event("dm_turn_reveal", reveal)
                            await self._persist_turn_log("duchmind", reveal)
                        await asyncio.sleep(dm.INTER_TURN_PAUSE)
                        if await self._db_dm_is_game_over():
                            break
                        continue
                # === END RESUME PATH ===

                # Pick next drawer & build word options. advance_turn also
                # promotes any spectators who reserved-for-next: it returns
                # their freshly-serialized records so we can broadcast a
                # `player_updated` for each before the new turn starts.
                turn_info = await self._db_dm_advance_turn()
                if turn_info is None:
                    print(f"[DM-RUNNER] room {self.room_id}: game over (advance_turn returned None)")
                    break  # game over
                for promoted in turn_info.get("promoted") or []:
                    await self._broadcast_event("player_updated", {"player": promoted})
                print(f"[DM-RUNNER] room {self.room_id}: advancing to turn drawer={turn_info['drawer_id']} round={turn_info.get('round')}")

                drawer_id = turn_info["drawer_id"]
                # Choosing phase
                _DM_STROKES.pop(self.room_id, None)  # clear strokes for new turn
                _DM_PRE_CLEAR_SNAPSHOT.pop(self.room_id, None)
                choice_payload = await self._db_dm_start_choosing(drawer_id)
                if choice_payload is None:
                    await self._broadcast_event("dm_error", {
                        "message": "단어장이 비어있어 게임을 진행할 수 없습니다. 관리자가 /manage/duchmind-words 에서 단어를 등록해야 합니다.",
                    })
                    # Reset room status so it returns to waiting
                    await self._db_dm_abort_to_waiting()
                    updated = await self._db_serialize_room()
                    if updated:
                        await self._broadcast_event("room_updated", {"room": updated})
                    return
                # Tell everyone "drawer is choosing" FIRST so the choosing
                # state is in place before the drawer's word_choices arrives.
                # Send seconds_remaining (clock-skew safe) instead of an
                # absolute deadline.
                _now = time.time()
                _remaining = max(0.0, choice_payload["deadline"] - _now)
                await self._broadcast_event("dm_choosing", {
                    "drawer_id": drawer_id,
                    "drawer_name": choice_payload.get("drawer_name"),
                    "deadline": choice_payload["deadline"],
                    "seconds_remaining": _remaining,
                    "round": choice_payload["round"],
                    "total_rounds": choice_payload["total_rounds"],
                    "turn_index": choice_payload["turn_index"],
                    "drawer_order": choice_payload.get("drawer_order") or [],
                })
                # Then send choices privately to drawer
                await self._send_to_player(drawer_id, "dm_word_choices", {
                    "choices": choice_payload["choices"],
                    "deadline": choice_payload["deadline"],
                    "seconds_remaining": _remaining,
                })

                # Wait for drawer choice OR timeout (auto-pick first option)
                ev = asyncio.Event()
                _DM_CHOICE_EVENTS[self.room_id] = ev
                try:
                    await asyncio.wait_for(ev.wait(), timeout=dm.WORD_CHOICE_SECONDS)
                except asyncio.TimeoutError:
                    # auto-pick first option
                    auto = choice_payload["choices"][0]
                    await self._db_dm_auto_confirm_word(drawer_id, auto["card_id"])
                finally:
                    _DM_CHOICE_EVENTS.pop(self.room_id, None)

                # Drawing phase begins; broadcast question (without word)
                draw_payload = await self._db_dm_drawing_payload()
                if draw_payload is None:
                    continue
                await self._broadcast_event("dm_drawing", draw_payload)
                # Send the actual word + card image privately to the drawer
                await self._send_to_player(drawer_id, "dm_drawer_word", {
                    "word": draw_payload["_word_for_drawer"],
                    "image_url": draw_payload.get("_image_url_for_drawer"),
                })

                # Drawing tick: every 1s, check hint reveal & all-guessed early
                # end. Re-read the deadline from state each iteration so a
                # first-correct speedup (room option) shrinks the loop in real
                # time instead of waiting out the original deadline.
                end_ev = asyncio.Event()
                _DM_END_EVENTS[self.room_id] = end_ev
                try:
                    end_time = draw_payload["deadline"]
                    while True:
                        now = time.time()
                        # Pick up any deadline change (e.g. first-correct speedup).
                        latest_deadline = await self._db_dm_drawing_deadline()
                        if latest_deadline and latest_deadline != end_time:
                            end_time = latest_deadline
                            # Include server-computed seconds_remaining so the
                            # client can sidestep wall-clock skew (a fast local
                            # clock would otherwise floor (deadline - Date.now)
                            # to 0 and freeze the displayed timer).
                            await self._broadcast_event("dm_deadline", {
                                "deadline": end_time,
                                "seconds_remaining": max(0.0, end_time - time.time()),
                            })
                        remaining = end_time - now
                        if remaining <= 0:
                            break
                        try:
                            await asyncio.wait_for(end_ev.wait(), timeout=min(1.0, remaining))
                            if end_ev.is_set():
                                break
                        except asyncio.TimeoutError:
                            pass
                        # Maybe reveal a letter
                        new_hint = await self._db_dm_maybe_reveal_hint()
                        if new_hint is not None:
                            await self._broadcast_event("dm_hint", {"hint": new_hint})
                finally:
                    _DM_END_EVENTS.pop(self.room_id, None)

                # End turn — broadcast reveal
                reveal = await self._db_dm_end_turn()
                if reveal:
                    await self._broadcast_event("dm_turn_reveal", reveal)
                    await self._persist_turn_log("duchmind", reveal)

                # Pause so reveal is visible
                await asyncio.sleep(dm.INTER_TURN_PAUSE)

                # Game over check
                if await self._db_dm_is_game_over():
                    break

            final = await self._db_dm_finalize_game()
            if final:  # None when manually ended externally
                await self._broadcast_event("dm_game_end", final)
                updated = await self._db_serialize_room()
                if updated:
                    await self._broadcast_event("room_updated", {"room": updated})
        except asyncio.CancelledError:
            return
        except Exception as e:
            await self._broadcast_event("dm_error", {"message": str(e)})
        finally:
            _GAME_RUNNERS.pop(self.room_id, None)
            _DM_STROKES.pop(self.room_id, None)
            _DM_PRE_CLEAR_SNAPSHOT.pop(self.room_id, None)
            _DM_CHOICE_EVENTS.pop(self.room_id, None)
            _DM_END_EVENTS.pop(self.room_id, None)

    # ====================================================================
    # === Twenty Questions runner ========================================
    # ====================================================================
    async def _run_twenty_game(self):
        from .games import twenty as tw
        try:
            await self._db_tw_init_state()

            while True:
                still = await self._db_is_in_game()
                if not still:
                    return

                turn_info = await self._db_tw_advance_turn()
                if turn_info is None:
                    break  # game over

                drawer_id = turn_info["drawer_id"]

                # === Phase: choosing ===
                choice_payload = await self._db_tw_start_choosing(drawer_id)
                if choice_payload is None:
                    await self._broadcast_event("tw_error", {"message": "라운드 시작 실패"})
                    return
                _now = time.time()
                _remaining = max(0.0, choice_payload["deadline"] - _now)
                await self._broadcast_event("tw_choosing", {
                    "drawer_id": drawer_id,
                    "drawer_name": choice_payload.get("drawer_name"),
                    "deadline": choice_payload["deadline"],
                    "seconds_remaining": _remaining,
                    "round": choice_payload["round"],
                    "total_rounds": choice_payload["total_rounds"],
                    "turn_index": choice_payload["turn_index"],
                    "total_questions": choice_payload.get("total_questions", tw.TOTAL_QUESTIONS),
                })

                # Wait for drawer to confirm card OR timeout (auto-skip turn).
                ev = asyncio.Event()
                _TW_CARD_EVENTS[self.room_id] = ev
                try:
                    await asyncio.wait_for(ev.wait(), timeout=tw.WORD_CHOICE_SECONDS)
                except asyncio.TimeoutError:
                    # Drawer didn't pick — skip turn, no scoring.
                    await self._broadcast_event("tw_round_skipped", {"drawer_id": drawer_id})
                    await asyncio.sleep(2)
                    continue
                finally:
                    _TW_CARD_EVENTS.pop(self.room_id, None)

                # === Phase: asking ↔ answering loop ===
                # Drive via the state-machine: poll the round; when state
                # reaches "reveal" we exit. Use end-event for early-exit on
                # correct guess, plus per-step timeouts to enforce time limits.
                end_ev = asyncio.Event()
                _TW_END_EVENTS[self.room_id] = end_ev
                try:
                    # Initial broadcast: who's first asker
                    asker_payload = await self._db_tw_first_asker_payload()
                    if asker_payload:
                        await self._broadcast_event("tw_turn", asker_payload)

                    # Loop until round_over (state.phase == "reveal")
                    while True:
                        if end_ev.is_set():
                            break
                        phase = await self._db_tw_phase()
                        if phase == "reveal":
                            break
                        if phase == "asking":
                            # Wait for question or ask-timeout
                            qev = asyncio.Event()
                            _TW_QUESTION_EVENTS[self.room_id] = qev
                            ask_remaining = await self._db_tw_ask_remaining()
                            try:
                                await asyncio.wait_for(qev.wait(), timeout=max(0.5, ask_remaining))
                            except asyncio.TimeoutError:
                                # Asker timed out → burn 1 question, advance
                                result = await self._db_tw_timeout_ask()
                                if result:
                                    await self._broadcast_event("tw_pass", {
                                        "round_over": result.get("round_over", False),
                                        "next_asker": result.get("next_asker"),
                                    })
                                    if result.get("round_over"):
                                        break
                            finally:
                                _TW_QUESTION_EVENTS.pop(self.room_id, None)
                        elif phase == "answering":
                            aev = asyncio.Event()
                            _TW_ANSWER_EVENTS[self.room_id] = aev
                            ans_remaining = await self._db_tw_answer_remaining()
                            try:
                                await asyncio.wait_for(aev.wait(), timeout=max(0.5, ans_remaining))
                            except asyncio.TimeoutError:
                                result = await self._db_tw_timeout_answer()
                                if result:
                                    await self._broadcast_event("tw_answer", {
                                        "answer": "unsure",
                                        "auto": True,
                                        "round_over": result.get("round_over", False),
                                        "next_asker": result.get("next_asker"),
                                    })
                                    if result.get("round_over"):
                                        break
                            finally:
                                _TW_ANSWER_EVENTS.pop(self.room_id, None)
                        elif phase == "guess_window":
                            # Competitive only: same asker has GUESS_WINDOW_SECONDS
                            # to immediately try the answer or pass. Wake on
                            # guess (round_over) or pass; otherwise time out
                            # and advance to the next asker.
                            gev = asyncio.Event()
                            _TW_GUESS_EVENTS[self.room_id] = gev
                            gw_remaining = await self._db_tw_guess_window_remaining()
                            try:
                                await asyncio.wait_for(gev.wait(), timeout=max(0.5, gw_remaining))
                            except asyncio.TimeoutError:
                                result = await self._db_tw_timeout_guess_window()
                                if result:
                                    await self._broadcast_event("tw_pass_guess", {
                                        "auto": True,
                                        "next_asker": result.get("next_asker"),
                                        "hand_raise": result.get("hand_raise"),
                                    })
                            finally:
                                _TW_GUESS_EVENTS.pop(self.room_id, None)
                        elif phase == "hand_raise":
                            # Competitive: 10s window for non-asker guessers to
                            # claim the next post-answer guess slot. Wake on
                            # raise; on timeout, advance to next asker.
                            hev = asyncio.Event()
                            _TW_HAND_RAISE_EVENTS[self.room_id] = hev
                            hr_remaining = await self._db_tw_hand_raise_remaining()
                            try:
                                await asyncio.wait_for(hev.wait(), timeout=max(0.5, hr_remaining))
                            except asyncio.TimeoutError:
                                result = await self._db_tw_timeout_hand_raise()
                                if result:
                                    await self._broadcast_event("tw_hand_raise_timeout", {
                                        "next_asker": result.get("next_asker"),
                                    })
                            finally:
                                _TW_HAND_RAISE_EVENTS.pop(self.room_id, None)
                        elif phase == "hand_guess":
                            # Competitive: hand-raiser has GUESS_WINDOW_SECONDS
                            # to actually guess. Wake on guess/pass; on timeout,
                            # exclude them and reopen hand-raise (or advance).
                            hgev = asyncio.Event()
                            _TW_HAND_GUESS_EVENTS[self.room_id] = hgev
                            hg_remaining = await self._db_tw_hand_guess_remaining()
                            try:
                                await asyncio.wait_for(hgev.wait(), timeout=max(0.5, hg_remaining))
                            except asyncio.TimeoutError:
                                result = await self._db_tw_timeout_hand_guess()
                                if result:
                                    await self._broadcast_event("tw_pass_hand_guess", {
                                        "auto": True,
                                        "next_asker": result.get("next_asker"),
                                        "hand_raise": result.get("hand_raise"),
                                    })
                            finally:
                                _TW_HAND_GUESS_EVENTS.pop(self.room_id, None)
                        else:
                            # Unexpected phase — exit safe
                            break
                finally:
                    _TW_END_EVENTS.pop(self.room_id, None)
                    _TW_QUESTION_EVENTS.pop(self.room_id, None)
                    _TW_ANSWER_EVENTS.pop(self.room_id, None)
                    _TW_GUESS_EVENTS.pop(self.room_id, None)
                    _TW_HAND_RAISE_EVENTS.pop(self.room_id, None)
                    _TW_HAND_GUESS_EVENTS.pop(self.room_id, None)

                # === Reveal ===
                reveal = await self._db_tw_end_turn()
                if reveal:
                    await self._broadcast_event("tw_turn_reveal", reveal)
                    await self._persist_turn_log("twenty", reveal)
                await asyncio.sleep(tw.INTER_TURN_PAUSE)

                if await self._db_tw_is_game_over():
                    break

            final = await self._db_finalize_twenty()
            if final:
                await self._broadcast_event("tw_game_end", final)
                updated = await self._db_serialize_room()
                if updated:
                    await self._broadcast_event("room_updated", {"room": updated})
        except asyncio.CancelledError:
            return
        except Exception as e:
            await self._broadcast_event("tw_error", {"message": str(e)})
        finally:
            _GAME_RUNNERS.pop(self.room_id, None)
            _TW_CARD_EVENTS.pop(self.room_id, None)
            _TW_QUESTION_EVENTS.pop(self.room_id, None)
            _TW_ANSWER_EVENTS.pop(self.room_id, None)
            _TW_END_EVENTS.pop(self.room_id, None)

    # ----- DuchMind WS handlers -----
    async def _handle_dm_stroke(self, payload):
        """Drawer streams stroke data; server stores + relays to others."""
        if not isinstance(payload, dict):
            print(f"[DM-STROKE-REJECT] room {self.room_id} player {self.player_id}: payload not dict ({type(payload).__name__})")
            return
        # Authorization: only the current drawer can stroke
        if not await self._db_dm_is_drawer(self.player_id):
            print(f"[DM-STROKE-REJECT] room {self.room_id} player {self.player_id}: not_drawer")
            return
        # Append to in-memory log
        _DM_STROKES.setdefault(self.room_id, []).append(payload)
        # Cap log size (defensive)
        if len(_DM_STROKES[self.room_id]) > 50000:
            _DM_STROKES[self.room_id] = _DM_STROKES[self.room_id][-50000:]
        # Any new stroke invalidates the most recent clear-undo snapshot —
        # we only allow restoring a clear when no further drawing has
        # happened, otherwise undo semantics get tangled.
        _DM_PRE_CLEAR_SNAPSHOT.pop(self.room_id, None)
        await self._broadcast_event("dm_stroke", {"payload": payload})

    async def _handle_dm_clear(self):
        if not await self._db_dm_is_drawer(self.player_id):
            return
        # Snapshot the canvas before wiping so the next undo can restore
        # it. Users were complaining that accidental "전체" taps wiped
        # mid-drawing work with no recovery — undo now reverses the
        # clear as long as no new strokes have been added since.
        _DM_PRE_CLEAR_SNAPSHOT[self.room_id] = list(_DM_STROKES.get(self.room_id, []))
        _DM_STROKES[self.room_id] = []
        await self._broadcast_event("dm_clear", {})

    async def _handle_dm_undo(self):
        if not await self._db_dm_is_drawer(self.player_id):
            return
        # Clear-undo path: restore the pre-clear snapshot if the drawer's
        # last action was 전체 (and they haven't drawn anything since).
        snapshot = _DM_PRE_CLEAR_SNAPSHOT.pop(self.room_id, None)
        if snapshot is not None:
            _DM_STROKES[self.room_id] = list(snapshot)
            await self._broadcast_event("dm_canvas_replay", {"strokes": _DM_STROKES[self.room_id]})
            return
        log = _DM_STROKES.get(self.room_id, [])
        # Pop the latest stroke group: pop until we remove the last "start" group
        # Simple: pop items until we drop one "start"
        popped = []
        while log:
            item = log.pop()
            popped.append(item)
            if item.get("op") == "start":
                break
        await self._broadcast_event("dm_canvas_replay", {"strokes": _DM_STROKES.get(self.room_id, [])})

    async def _handle_dm_give_up(self):
        """A guesser gives up this turn. They can no longer score, and once
        all non-drawer players have either guessed or given up the turn ends
        early (same path as 'all guessed')."""
        result = await self._db_dm_mark_given_up(self.player_id)
        if not result:
            return
        await self._broadcast_event("dm_given_up", {
            "player_id": result["player_id"],
            "display_name": result["display_name"],
        })
        if result.get("all_resolved"):
            ev = _DM_END_EVENTS.get(self.room_id)
            if ev is not None:
                ev.set()

    async def _handle_dm_react(self, emoji):
        """Lightweight 👍/👎 reaction floated on the canvas. Allowed for:
          - correct guessers during the drawing phase (their 기권 button
            slot becomes react buttons since they've nothing left to do), or
          - anyone (participant or spectator) during the reveal pause.
        Rate-limited per player so it can't be machine-gunned."""
        if emoji not in ("up", "down"):
            return
        now = time.time()
        last = _DM_REACT_LAST.get(self.player_id, 0)
        if now - last < 0.5:
            return
        eligible = await self._db_dm_can_react(self.player_id)
        if not eligible:
            return
        _DM_REACT_LAST[self.player_id] = now
        await self._broadcast_event("dm_reaction", {"emoji": emoji})

    async def _handle_dm_choose_word(self, card_id, word):
        ok = await self._db_dm_confirm_word(self.player_id, card_id, word)
        if ok:
            ev = _DM_CHOICE_EVENTS.get(self.room_id)
            if ev is not None:
                ev.set()

    # ====================================================================
    # === Twenty Questions handlers ======================================
    # ====================================================================
    async def _handle_tw_choose_card(self, card_id, card_name):
        ok = await self._db_tw_confirm_card(self.player_id, card_id, card_name)
        if ok:
            # Echo the card back privately to the drawer so they always have
            # the image + name available (in case they refresh / forget).
            from card.models import Card
            image_url = None
            try:
                @database_sync_to_async
                def _get_url():
                    c = Card.objects.filter(pk=int(card_id)).first()
                    return c.card_illust.url if (c and c.card_illust) else None
                image_url = await _get_url()
            except Exception:
                pass
            await self.send_json({
                "type": "tw_drawer_card",
                "card_id": int(card_id) if card_id else None,
                "card_name": card_name,
                "image_url": image_url,
            })
            ev = _TW_CARD_EVENTS.get(self.room_id)
            if ev is not None:
                ev.set()

    def _tw_history_append(self, entry: dict) -> None:
        """Persist a styled chat entry to the per-room buffer so it replays
        on refresh. Same buffer as free-chat (`_TW_CHAT_HISTORY`); kind
        differentiates render style on the client."""
        hist = _TW_CHAT_HISTORY.setdefault(self.room_id, [])
        hist.append(entry)
        if len(hist) > _CHAT_HISTORY_MAX:
            del hist[: len(hist) - _CHAT_HISTORY_MAX]

    async def _handle_tw_submit_question(self, text: str):
        result = await self._db_tw_submit_question(self.player_id, text)
        if not result or result.get("error"):
            return
        # Broadcast question to room (anonymous-friendly: also include asker name)
        await self._broadcast_event("tw_question", {
            "asker_id": result["asker_id"],
            "asker_name": result["asker_name"],
            "text": result["text"],
            "questions_used": result["questions_used"],
            "answer_deadline": result["answer_deadline"],
        })
        self._tw_history_append({
            "kind": "question",
            "player_id": str(result["asker_id"]),
            "display_name": result["asker_name"],
            "text": result["text"],
            "question_text": result["text"],
            "ts": time.time(),
        })
        ev = _TW_QUESTION_EVENTS.get(self.room_id)
        if ev is not None:
            ev.set()

    async def _handle_tw_submit_answer(self, answer):
        result = await self._db_tw_submit_answer(self.player_id, answer)
        if not result or result.get("error"):
            return
        await self._broadcast_event("tw_answer", {
            "answer": answer,
            "questions_used": result.get("questions_used"),
            "questions_remaining": result.get("questions_remaining"),
            "round_over": result.get("round_over", False),
            "next_asker": result.get("next_asker"),
            "guess_window": result.get("guess_window"),
        })
        # Persist the resolved Q+A pair so refreshes replay it as a qa_pair
        # entry with the answer attached.
        self._tw_history_append({
            "kind": "qa_pair",
            "player_id": str(result.get("asker_id") or ""),
            "display_name": result.get("asker_name") or "",
            "text": result.get("question_text") or "",
            "question_text": result.get("question_text") or "",
            "answer": answer,
            "ts": time.time(),
        })
        ev = _TW_ANSWER_EVENTS.get(self.room_id)
        if ev is not None:
            ev.set()
        if result.get("round_over"):
            end_ev = _TW_END_EVENTS.get(self.room_id)
            if end_ev is not None:
                end_ev.set()

    async def _handle_tw_pass_guess(self):
        """Asker chose to skip their post-answer guess window (competitive)."""
        result = await self._db_tw_pass_guess_window(self.player_id)
        if not result or result.get("error"):
            return
        await self._broadcast_event("tw_pass_guess", {
            "next_asker": result.get("next_asker"),
            "hand_raise": result.get("hand_raise"),
        })
        gev = _TW_GUESS_EVENTS.get(self.room_id)
        if gev is not None:
            gev.set()

    async def _handle_tw_raise_hand(self):
        """A guesser claims the next post-answer guess slot (competitive)."""
        result = await self._db_tw_submit_raise_hand(self.player_id)
        if not result or result.get("error"):
            return
        await self._broadcast_event("tw_hand_raised", {
            "raiser_id": result.get("raiser_id"),
            "guess_window": result.get("guess_window"),
        })
        ev = _TW_HAND_RAISE_EVENTS.get(self.room_id)
        if ev is not None:
            ev.set()

    async def _handle_tw_pass_hand_guess(self):
        """Hand-raiser declined to actually guess (competitive)."""
        result = await self._db_tw_pass_hand_guess(self.player_id)
        if not result or result.get("error"):
            return
        await self._broadcast_event("tw_pass_hand_guess", {
            "next_asker": result.get("next_asker"),
            "hand_raise": result.get("hand_raise"),
        })
        ev = _TW_HAND_GUESS_EVENTS.get(self.room_id)
        if ev is not None:
            ev.set()

    async def _handle_tw_submit_guess(self, card_id):
        result = await self._db_tw_submit_guess(self.player_id, card_id)
        if not result or result.get("error"):
            return
        await self._broadcast_event("tw_guess", {
            "guesser_id": result["guesser_id"],
            "guesser_name": result["guesser_name"],
            "card_id": result["card_id"],
            "card_name": result.get("card_name"),
            "correct": result["correct"],
            "questions_used": result["questions_used"],
            "round_over": result["round_over"],
            "winner_id": result.get("winner_id"),
            "next_asker": result.get("next_asker"),
            "hand_raise": result.get("hand_raise"),
        })
        self._tw_history_append({
            "kind": "guess",
            "player_id": str(result["guesser_id"]),
            "display_name": result["guesser_name"],
            "text": result.get("card_name") or "",
            "card_name": result.get("card_name") or "",
            "correct": bool(result.get("correct")),
            "ts": time.time(),
        })
        # Always wake whatever phase wait the runner is blocked on. We don't
        # know the exact phase here without re-querying, so set them all.
        for bag in (_TW_QUESTION_EVENTS, _TW_GUESS_EVENTS,
                    _TW_HAND_RAISE_EVENTS, _TW_HAND_GUESS_EVENTS):
            ev = bag.get(self.room_id)
            if ev is not None:
                ev.set()
        if result.get("round_over"):
            end_ev = _TW_END_EVENTS.get(self.room_id)
            if end_ev is not None:
                end_ev.set()

    async def _handle_tw_chat(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        if len(text) > 200:
            text = text[:200]
        info = await self._db_lobby_player_info(self.player_id)
        if not info:
            return
        if info["is_spectator"] and not info["spectators_can_chat"] and not info.get("is_staff"):
            return
        # Drawer can't chat (could leak the answer). Server-side defense.
        if not info["is_spectator"] and await self._db_tw_is_current_drawer(info["id"]):
            return
        payload = {
            "player_id": str(info["id"]),
            "display_name": info["display_name"],
            "text": text,
            "ts": time.time(),
            "is_spectator": info["is_spectator"],
        }
        hist = _TW_CHAT_HISTORY.setdefault(self.room_id, [])
        hist.append(payload)
        if len(hist) > _CHAT_HISTORY_MAX:
            del hist[: len(hist) - _CHAT_HISTORY_MAX]
        await self._broadcast_event("tw_chat", payload)
        await self._persist_chat_log("tw", payload)

    @database_sync_to_async
    def _db_tw_is_current_drawer(self, player_id):
        from .models import Room
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return False
        if room.current_game != "twenty" or room.status != "in_game":
            return False
        rd = (room.game_state or {}).get("round_data") or {}
        return rd.get("drawer_id") == str(player_id)

    async def _handle_quiz_chat(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        if len(text) > 200:
            text = text[:200]
        info = await self._db_lobby_player_info(self.player_id)
        if not info:
            return
        if info["is_spectator"] and not info["spectators_can_chat"] and not info.get("is_staff"):
            return
        payload = {
            "player_id": str(info["id"]),
            "display_name": info["display_name"],
            "text": text,
            "ts": time.time(),
            "is_spectator": info["is_spectator"],
        }
        hist = _QUIZ_CHAT_HISTORY.setdefault(self.room_id, [])
        hist.append(payload)
        if len(hist) > _CHAT_HISTORY_MAX:
            del hist[: len(hist) - _CHAT_HISTORY_MAX]
        await self._broadcast_event("quiz_chat", payload)
        await self._persist_chat_log("quiz", payload)

    async def _handle_set_ready(self, ready: bool):
        info = await self._db_lobby_player_info(self.player_id)
        if not info:
            return
        pid = str(info["id"])
        s = _READY_STATES.setdefault(self.room_id, set())
        if ready:
            s.add(pid)
        else:
            s.discard(pid)
        await self._broadcast_event("ready_update", {"ready_ids": list(s)})

    async def _handle_lobby_chat(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        if len(text) > 200:
            text = text[:200]
        info = await self._db_lobby_player_info(self.player_id)
        if not info:
            return
        if info["is_spectator"] and not info["spectators_can_chat"] and not info.get("is_staff"):
            return
        payload = {
            "player_id": str(info["id"]),
            "display_name": info["display_name"],
            "text": text,
            "ts": time.time(),
            "is_spectator": info["is_spectator"],
        }
        # Append to bounded history so reconnecting clients get context.
        hist = _LOBBY_CHAT_HISTORY.setdefault(self.room_id, [])
        hist.append(payload)
        if len(hist) > _CHAT_HISTORY_MAX:
            del hist[: len(hist) - _CHAT_HISTORY_MAX]
        # Touch the room so the idle-cleanup cron treats lobby chat as activity.
        await self._db_touch_room_activity()
        await self._broadcast_event("lobby_chat", payload)
        await self._persist_chat_log("lobby", payload)

    @database_sync_to_async
    def _db_touch_room_activity(self):
        from django.utils import timezone
        from .models import Room
        Room.objects.filter(id=self.room_id).update(last_activity_at=timezone.now())

    @database_sync_to_async
    def _persist_chat_log(self, channel: str, payload: dict):
        """Mirror a chat broadcast into the audit log. No-op if the room
        has no RoomLog (e.g. legacy rooms created before audit was added)."""
        from .views import _record_chat_log
        _record_chat_log(self.room_id, channel, payload)

    @database_sync_to_async
    def _persist_turn_log(self, game_type: str, reveal: dict):
        """Append a TurnLog row for the just-completed turn/round. The reveal
        payload shape differs per game; pull what's relevant. No-op if the
        room has no open GameLog (legacy rooms or already-finalized state)."""
        if not reveal:
            return
        from django.utils import timezone
        from .models import Room, RoomLog, GameLog, TurnLog, RoomPlayer
        rlog = RoomLog.objects.filter(source_room_id=self.room_id).order_by("-id").first()
        if not rlog:
            return
        glog = GameLog.objects.filter(room_log=rlog, ended_at__isnull=True).order_by("-id").first()
        if not glog:
            return

        def _player_info(pid):
            try:
                p = RoomPlayer.objects.get(id=int(pid))
                return p.user_id, (p.display_name or "")[:64]
            except (RoomPlayer.DoesNotExist, ValueError, TypeError):
                return None, ""

        drawer_user_id = None
        drawer_display = ""
        word = ""
        word_card_id = ""
        correct_guessers = []
        given_up = []
        round_no = int(reveal.get("round", 0) or 0)
        turn_index = 0

        if game_type == "duchmind":
            turn_index = int(reveal.get("turn_index", 0) or 0)
            word = (reveal.get("word") or "")[:200]
            word_card_id = str(reveal.get("card_id") or "")[:64]
            drawer_pid = reveal.get("drawer_id")
            if drawer_pid:
                drawer_user_id, drawer_display = _player_info(drawer_pid)
            for pid_str, info in (reveal.get("correct_guessers") or {}).items():
                uid, disp = _player_info(pid_str)
                correct_guessers.append({
                    "user_id": uid,
                    "display": disp,
                    "score": info.get("score", 0),
                    "order": info.get("order", 0),
                })
            try:
                room = Room.objects.get(id=self.room_id)
                rd = (room.game_state or {}).get("round_data") or {}
                for pid_str in (rd.get("given_up") or []):
                    uid, disp = _player_info(pid_str)
                    given_up.append({"user_id": uid, "display": disp})
            except Room.DoesNotExist:
                pass
        elif game_type == "twenty":
            turn_index = round_no
            word = (reveal.get("card_name") or "")[:200]
            word_card_id = str(reveal.get("card_id") or "")[:64]
            drawer_pid = reveal.get("drawer_id")
            if drawer_pid:
                drawer_user_id, drawer_display = _player_info(drawer_pid)
            winner_pid = reveal.get("winner_id")
            if winner_pid:
                uid, disp = _player_info(winner_pid)
                correct_guessers.append({
                    "user_id": uid,
                    "display": disp,
                    "score": reveal.get("winner_score", 0),
                    "order": 1,
                })
        elif game_type == "quiz":
            turn_index = round_no
            word = (reveal.get("correct_answer") or "")[:200]
            winner_pid = reveal.get("winner_player_id")
            if winner_pid:
                uid, disp = _player_info(winner_pid)
                if not disp:
                    disp = (reveal.get("winner_name") or "")[:64]
                correct_guessers.append({
                    "user_id": uid,
                    "display": disp,
                    "score": reveal.get("winner_score", 0),
                    "order": 1,
                })

        TurnLog.objects.create(
            game_log=glog,
            turn_index=turn_index,
            round_no=round_no,
            drawer_user_id=drawer_user_id,
            drawer_display=drawer_display,
            word=word,
            word_card_id=word_card_id,
            correct_guessers_json=correct_guessers,
            given_up_json=given_up,
            ended_at=timezone.now(),
        )

    @database_sync_to_async
    def _db_lobby_player_info(self, player_id):
        from .models import Room, RoomPlayer
        from .serializers import anonymized_display_name
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except (Room.DoesNotExist, RoomPlayer.DoesNotExist):
            return None
        # In anonymous rooms, the public-facing name is "플레이어N" (join order).
        # Stealth admins are excluded from the index — they don't show up
        # in the player list and shouldn't shift the numbering.
        if room.is_anonymous and not player.is_hidden:
            display_name = anonymized_display_name(player)
        else:
            display_name = player.display_name
        return {
            "id": player.id,
            "display_name": display_name,
            "is_spectator": player.is_spectator,
            "spectators_can_chat": room.spectators_can_chat,
            "is_staff": bool(player.user_id and player.user and player.user.is_staff),
            "is_hidden": player.is_hidden,
        }

    async def _dm_broadcast_chat(self, payload: dict):
        """Broadcast a dm_chat event AND append to bounded history so
        reconnecting clients can replay recent messages."""
        hist = _DM_CHAT_HISTORY.setdefault(self.room_id, [])
        hist.append(payload)
        if len(hist) > _CHAT_HISTORY_MAX:
            del hist[: len(hist) - _CHAT_HISTORY_MAX]
        await self._broadcast_event("dm_chat", payload)
        await self._persist_chat_log("dm", payload)

    async def _handle_dm_chat(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        if len(text) > 200:
            text = text[:200]
        result = await self._db_dm_submit_guess(self.player_id, text)
        if not result:
            return
        kind = result.get("type")
        # Spectator branches: classification done without state mutation, so
        # no scores / points / early-end side effects.
        if kind == "spectator_correct":
            await self._dm_broadcast_chat({
                "player_id": result["player_id"],
                "display_name": result["display_name"],
                "kind": "correct",
                "text": "관전자가 정답을 맞혔습니다!",
                "is_spectator": True,
            })
            # Personal acknowledgement so the spectator sees their own hit too.
            await self.send_json({"type": "dm_my_correct", "delta": 0, "total_score": 0})
            return
        if kind == "spectator_close":
            # Private hint, no public broadcast (same as participant close).
            await self.send_json({"type": "dm_close_hint"})
            return
        if kind == "spectator_wrong":
            await self._dm_broadcast_chat({
                "player_id": result["player_id"],
                "display_name": result["display_name"],
                "kind": "wrong",
                "text": text,
                "is_spectator": True,
            })
            return
        if kind == "correct":
            # Broadcast to everyone EXCEPT player publicly
            await self._dm_broadcast_chat({
                "player_id": result["player_id"],
                "display_name": result["display_name"],
                "kind": "correct",
                "text": "정답을 맞혔습니다!",
                "delta": result["delta"],
                "total_score": result["total_score"],
            })
            # Personal acknowledgement to guesser with the actual word
            await self.send_json({
                "type": "dm_my_correct",
                "delta": result["delta"],
                "total_score": result["total_score"],
            })
            # Early end if everyone guessed
            if result.get("all_guessed"):
                ev = _DM_END_EVENTS.get(self.room_id)
                if ev is not None:
                    ev.set()
        elif kind == "close":
            # Hint privately to the typer; do NOT broadcast the text — close
            # attempts leak the answer and let others snipe it.
            await self.send_json({"type": "dm_close_hint"})
        elif result.get("reason") == "drawer":
            # Drawer must not be able to chat (could leak the answer).
            return
        else:
            # wrong / already correct / given up → just relay text.
            # When the room has `duchmind_hide_winner_chat` enabled and the
            # sender already solved this turn, mark the chat so the client
            # hides it from anyone still trying to guess (spoiler defense).
            payload = {
                "player_id": result["player_id"],
                "display_name": result["display_name"],
                "kind": "wrong",
                "text": text,
            }
            if result.get("reason") == "already_correct" and result.get("hide_winner_chat"):
                payload["restricted_to_solved"] = True
            await self._dm_broadcast_chat(payload)

    async def _send_to_player(self, room_player_id_str: str, event: str, payload: dict):
        """Send a private message to a specific RoomPlayer (by their ID)."""
        try:
            player_id = int(room_player_id_str)
        except (TypeError, ValueError):
            return
        await self.channel_layer.group_send(
            self.group,
            {"type": "personal.event", "player_id": player_id, "event": event, "payload": payload},
        )

    @database_sync_to_async
    def _db_dm_init_state(self):
        from .models import Room
        from .games import duchmind as dm
        room = Room.objects.get(id=self.room_id)
        if not room.game_state or not room.game_state.get("phase"):
            player_ids = list(room.players.filter(is_spectator=False).values_list("id", flat=True))
            print(f"[DM-INIT] room {self.room_id}: initializing with {len(player_ids)} players ({player_ids}), total_rounds={room.duchmind_total_rounds or dm.DEFAULT_TOTAL_ROUNDS}")
            room.game_state = dm.init_game_state(
                player_ids,
                total_rounds=room.duchmind_total_rounds or dm.DEFAULT_TOTAL_ROUNDS,
                draw_seconds=room.duchmind_draw_seconds or dm.DRAW_SECONDS,
                word_options=room.duchmind_word_options or dm.WORD_OPTIONS,
                show_word_length=room.duchmind_show_word_length,
                show_hints=room.duchmind_show_hints,
            )
            room.save(update_fields=["game_state"])

    @database_sync_to_async
    def _db_dm_advance_turn(self):
        from .models import Room, RoomPlayer
        from .games import duchmind as dm
        from .serializers import RoomPlayerSerializer
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        # Promote spectators who reserved for the next turn — they become
        # active participants now, get appended to the drawer rotation, and
        # their score is initialized. We collect serialized records to
        # broadcast outside this sync block.
        promoted_serialized = []
        with transaction.atomic():
            reserved_qs = (
                RoomPlayer.objects
                .select_for_update()
                .filter(room=room, is_spectator=True, reserved_for_next=True)
            )
            order = list(state.get("drawer_order") or [])
            scores = dict(state.get("scores") or {})
            for p in reserved_qs:
                p.is_spectator = False
                p.reserved_for_next = False
                p.score = 0
                p.save(update_fields=["is_spectator", "reserved_for_next", "score"])
                pid = str(p.id)
                if pid not in order:
                    order.append(pid)
                scores.setdefault(pid, 0)
                promoted_serialized.append(RoomPlayerSerializer(p).data)
            state["drawer_order"] = order
            state["scores"] = scores
        order = state.get("drawer_order") or []
        ti_before = state.get("turn_index", -1)
        round_before = state.get("round", 0)
        result = dm._next_drawer(state)
        print(f"[DM-ADVANCE] room {self.room_id}: order_len={len(order)} ti_before={ti_before} round_before={round_before} -> result={result} ti_after={state.get('turn_index')} round_after={state.get('round')} promoted={len(promoted_serialized)}")
        if result is None or state.get("round", 0) > state.get("total_rounds", 3):
            print(f"[DM-ADVANCE] room {self.room_id}: returning None (game over). total_rounds={state.get('total_rounds')}")
            return None
        drawer_id, round_no = result
        room.game_state = state
        room.save(update_fields=["game_state"])
        return {"drawer_id": drawer_id, "round": round_no, "promoted": promoted_serialized}

    @database_sync_to_async
    def _db_dm_start_choosing(self, drawer_id):
        from .models import Room, RoomPlayer, DuchMindWord, DuchMindWordPack
        from .games import duchmind as dm
        from card.models import Card
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        # Resolve which pack to use: room's selected pack, else default
        pack = room.duchmind_word_pack
        if pack is None:
            pack = DuchMindWordPack.objects.filter(is_default=True).first()
        if pack is None:
            return None
        series = getattr(pack, "series", "yugioh")
        state["pack_series"] = series  # remembered for downstream lookups
        if series == "pokemon":
            candidates = list(
                DuchMindWord.objects.filter(pack=pack, enabled=True, pokemon__isnull=False)
                .values("pokemon_id", "pokemon__name_ko", "pokemon__image_url")
            )
            if not candidates:
                return None
            used = set(state.get("used_card_ids", []))
            pool = [c for c in candidates if c["pokemon_id"] not in used] or candidates
            word_options_count = state.get("word_options") or dm.WORD_OPTIONS
            chosen = random.sample(pool, min(word_options_count, len(pool)))
            choices = [
                {
                    "card_id": c["pokemon_id"],
                    "name": c["pokemon__name_ko"],
                    "image_url": c["pokemon__image_url"] or None,
                }
                for c in chosen
            ]
        else:
            # Dedupe by korean_name so cards with multiple alt-art rows
            # (same passcode, different card_id index) don't get inflated
            # draw probability. Keep the lowest card_id per name.
            raw = (
                DuchMindWord.objects.filter(pack=pack, enabled=True, card__isnull=False)
                .order_by("card__card_id")
                .values("card_id", "card__korean_name")
            )
            seen_names: set = set()
            candidates: list = []
            for r in raw:
                kr = r["card__korean_name"]
                if kr in seen_names:
                    continue
                seen_names.add(kr)
                candidates.append(r)
            if not candidates:
                return None
            used = set(state.get("used_card_ids", []))
            pool = [c for c in candidates if c["card_id"] not in used] or candidates
            word_options_count = state.get("word_options") or dm.WORD_OPTIONS
            chosen = random.sample(pool, min(word_options_count, len(pool)))
            chosen_pks = [c["card_id"] for c in chosen]
            illust_by_pk = {
                c.pk: (c.card_illust.url if c.card_illust else None)
                for c in Card.objects.filter(pk__in=chosen_pks)
            }
            choices = [
                {
                    "card_id": c["card_id"],
                    "name": c["card__korean_name"],
                    "image_url": illust_by_pk.get(c["card_id"]),
                }
                for c in chosen
            ]
        broadcast = dm.start_choosing(state, drawer_id, choices)
        broadcast["choices"] = choices
        try:
            broadcast["drawer_name"] = _public_name(room, drawer_id)
        except RoomPlayer.DoesNotExist:
            broadcast["drawer_name"] = ""
        # Player ids in drawing order — client uses this to label each
        # player with their #N position in the round's rotation.
        broadcast["drawer_order"] = list(state.get("drawer_order") or [])
        room.game_state = state
        room.save(update_fields=["game_state"])
        return broadcast

    @database_sync_to_async
    def _db_dm_confirm_word(self, player_id, card_id, word):
        from .models import Room, RoomPlayer
        room = Room.objects.get(id=self.room_id)
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return False
        return self._dm_apply_word_choice(room, player.id, card_id)

    @database_sync_to_async
    def _db_dm_auto_confirm_word(self, drawer_player_id, card_id):
        """System-side timeout auto-pick. Bypasses user_id lookup since the
        runner already knows the RoomPlayer.id of the drawer (which may be a
        guest with no linked user)."""
        from .models import Room
        room = Room.objects.get(id=self.room_id)
        return self._dm_apply_word_choice(room, drawer_player_id, card_id)

    def _dm_apply_word_choice(self, room, drawer_player_id, card_id):
        from .games import duchmind as dm
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if state.get("phase") != "choosing":
            return False
        if str(drawer_player_id) != rd.get("drawer_id"):
            return False
        choices = rd.get("word_choices") or []
        match = next((c for c in choices if str(c.get("card_id")) == str(card_id)), None)
        if not match:
            return False
        result = dm.confirm_word(state, drawer_player_id, match["name"], match["card_id"])
        if result is None:
            return False
        # Stash the chosen image_url (and series tag) into round_data so the
        # drawer's reference image and the reveal payload don't need to
        # series-branch a DB lookup later.
        rd = state.get("round_data") or {}
        rd["word_image_url"] = match.get("image_url") or None
        rd["word_series"] = state.get("pack_series", "yugioh")
        state["round_data"] = rd
        used = set(state.get("used_card_ids", []))
        used.add(int(card_id))
        state["used_card_ids"] = list(used)
        room.game_state = state
        room.save(update_fields=["game_state"])
        return True

    @database_sync_to_async
    def _db_dm_drawing_payload(self):
        from .models import Room
        from .games import duchmind as dm
        from card.models import Card
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if state.get("phase") != "drawing" or not rd:
            return None
        # Prefer the image_url stashed at confirm time (works for both
        # yugioh and pokemon series). Fall back to a Card lookup for
        # backwards compatibility with rounds started before this code.
        image_url = rd.get("word_image_url")
        if not image_url and rd.get("word_series", "yugioh") != "pokemon":
            cid = rd.get("word_card_id")
            if cid is not None:
                try:
                    card = Card.objects.filter(pk=int(cid)).first()
                    if card and card.card_illust:
                        image_url = card.card_illust.url
                except (TypeError, ValueError):
                    pass
        show_len = state.get("show_word_length", True)
        return {
            "drawer_id": rd["drawer_id"],
            "deadline": rd["deadline"],
            "duration": state.get("draw_seconds") or dm.DRAW_SECONDS,
            "seconds_remaining": max(0.0, rd["deadline"] - time.time()),
            "hint": rd["hint_mask"] if show_len else "",
            "word_length": dm.maskable_char_count(rd["word"] or "") if show_len else 0,
            "round": state.get("round", 1),
            "total_rounds": state.get("total_rounds"),
            "turn_index": state.get("turn_index", 0),
            # Player ids in drawing order for the current round. Client
            # labels each player with their #N position in the rotation.
            "drawer_order": list(state.get("drawer_order") or []),
            "_word_for_drawer": rd.get("display_word") or rd["word"],
            "_image_url_for_drawer": image_url,
        }

    @database_sync_to_async
    def _db_dm_drawing_deadline(self):
        from .models import Room
        try:
            state = Room.objects.values_list("game_state", flat=True).get(id=self.room_id) or {}
        except Exception:
            return None
        rd = state.get("round_data") or {}
        return rd.get("deadline")

    @database_sync_to_async
    def _db_dm_patch_deadline(self, new_deadline: float):
        """Bump `state.round_data.deadline` — used by the resume path to
        extend stale deadlines so a daphne restart doesn't auto-fast-
        forward an in-progress turn."""
        from .models import Room
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if not rd:
            return
        rd["deadline"] = float(new_deadline)
        state["round_data"] = rd
        room.game_state = state
        room.save(update_fields=["game_state"])

    @database_sync_to_async
    def _db_dm_draw_seconds(self):
        """Read the room's configured draw_seconds (per-room override) or
        fall back to the game's default."""
        from .models import Room
        from .games import duchmind as dm
        try:
            state = Room.objects.values_list("game_state", flat=True).get(id=self.room_id) or {}
        except Exception:
            return dm.DRAW_SECONDS
        return int(state.get("draw_seconds") or dm.DRAW_SECONDS)

    @database_sync_to_async
    def _db_dm_maybe_reveal_hint(self):
        from .models import Room
        from .games import duchmind as dm
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        new_hint = dm.maybe_reveal_hint(state)
        if new_hint is not None:
            room.game_state = state
            room.save(update_fields=["game_state"])
        return new_hint

    @database_sync_to_async
    def _db_dm_submit_guess(self, player_id, text):
        from .models import Room, RoomPlayer
        from .games import duchmind as dm
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return None
        from .serializers import anonymized_display_name
        public_name = (
            anonymized_display_name(player)
            if (room.is_anonymous and not player.is_hidden)
            else player.display_name
        )
        if player.is_spectator:
            is_staff = bool(player.user_id and player.user and player.user.is_staff)
            if not room.spectators_can_chat and not is_staff:
                return None
            # Classify without mutating state — spectators get no score/points,
            # and their correct guess does not count for all_guessed early-end.
            kind = dm.classify_guess(state, text)
            return {
                "type": f"spectator_{kind}",  # spectator_correct/close/wrong
                "player_id": str(player.id),
                "display_name": public_name,
                "is_spectator": True,
            }
        result = dm.submit_guess(state, player.id, text)
        result["player_id"] = str(player.id)
        result["display_name"] = public_name
        result["hide_winner_chat"] = bool(room.duchmind_hide_winner_chat)
        if result.get("type") == "correct":
            player.score = state["scores"][str(player.id)]
            player.save(update_fields=["score"])
            result["all_guessed"] = dm.all_guessed(state, room.players.filter(is_spectator=False).count())
            # First-correct speedup (room option): when *this* guess is the
            # first correct of the turn, shrink the remaining time to 60% so
            # the rest of the room feels the pressure.
            rd = state.get("round_data") or {}
            cg = rd.get("correct_guessers") or {}
            if len(cg) == 1 and room.duchmind_first_correct_speedup:
                deadline = rd.get("deadline") or 0
                now = time.time()
                remaining = deadline - now
                if remaining > 0:
                    rd["deadline"] = now + remaining * 0.6
                    state["round_data"] = rd
        room.game_state = state
        room.save(update_fields=["game_state"])
        return result

    @database_sync_to_async
    def _db_dm_mark_given_up(self, player_id):
        from .models import Room, RoomPlayer
        from .games import duchmind as dm
        room = Room.objects.get(id=self.room_id)
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return None
        state = room.game_state or {}
        if not dm.mark_given_up(state, player.id):
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        from .serializers import anonymized_display_name
        public_name = (
            anonymized_display_name(player)
            if (room.is_anonymous and not player.is_hidden)
            else player.display_name
        )
        return {
            "player_id": str(player.id),
            "display_name": public_name,
            "all_resolved": dm.all_guessed(state, room.players.filter(is_spectator=False).count()),
        }

    @database_sync_to_async
    def _db_dm_end_turn(self):
        from .models import Room
        from .games import duchmind as dm
        from card.models import Card
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        # Capture the round_data image_url BEFORE end_turn wipes it (end_turn
        # advances phase to "reveal"; round_data is still kept until next turn).
        rd_before = state.get("round_data") or {}
        stashed_url = rd_before.get("word_image_url")
        rd_series = rd_before.get("word_series", "yugioh")
        reveal = dm.end_turn(state)
        room.game_state = state
        room.save(update_fields=["game_state"])
        if reveal:
            if stashed_url:
                reveal["image_url"] = stashed_url
            elif reveal.get("card_id") and rd_series != "pokemon":
                try:
                    card = Card.objects.filter(pk=int(reveal["card_id"])).first()
                    if card and card.card_illust:
                        reveal["image_url"] = card.card_illust.url
                except (TypeError, ValueError):
                    pass
        return reveal

    @database_sync_to_async
    def _db_dm_is_game_over(self):
        from .models import Room
        from .games import duchmind as dm
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        return dm.is_game_over(state)

    @database_sync_to_async
    def _db_dm_finalize_game(self):
        from .scoring import finalize_game
        return finalize_game(self.room_id, "duchmind")

    # ====================================================================
    # === Twenty Questions DB methods ====================================
    # ====================================================================
    @database_sync_to_async
    def _db_tw_init_state(self):
        from .models import Room
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        if not room.game_state or not room.game_state.get("phase"):
            player_ids = list(room.players.filter(is_spectator=False).values_list("id", flat=True))
            room.game_state = tw.init_game_state(
                player_ids,
                total_rounds=room.twenty_total_rounds or tw.DEFAULT_TOTAL_ROUNDS,
                mode=room.twenty_mode or "competitive",
                guess_attempts_max=int(room.twenty_guess_attempts or 0),
            )
            room.save(update_fields=["game_state"])

    @database_sync_to_async
    def _db_tw_advance_turn(self):
        from .models import Room
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        result = tw._next_drawer(state)
        if result is None or state.get("round", 0) > state.get("total_rounds", tw.DEFAULT_TOTAL_ROUNDS):
            return None
        drawer_id, round_no = result
        room.game_state = state
        room.save(update_fields=["game_state"])
        return {"drawer_id": drawer_id, "round": round_no}

    @database_sync_to_async
    def _db_tw_start_choosing(self, drawer_id):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        broadcast = tw.start_choosing(state, drawer_id)
        try:
            broadcast["drawer_name"] = _public_name(room, drawer_id)
        except Exception:
            broadcast["drawer_name"] = ""
        room.game_state = state
        room.save(update_fields=["game_state"])
        return broadcast

    @database_sync_to_async
    def _db_tw_confirm_card(self, player_id, card_id, card_name):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return False
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if rd.get("drawer_id") != str(player.id):
            return False
        result = tw.confirm_card(state, player.id, card_id, card_name)
        if result is None:
            return False
        room.game_state = state
        room.save(update_fields=["game_state"])
        return True

    @database_sync_to_async
    def _db_tw_first_asker_payload(self):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if state.get("phase") != "asking":
            return None
        payload = tw._current_asker_payload(state)
        if not payload:
            return None
        try:
            payload["asker_name"] = _public_name(room, payload["asker_id"])
        except Exception:
            payload["asker_name"] = ""
        payload["seconds_remaining"] = max(0.0, (rd.get("ask_deadline") or 0) - time.time())
        return payload

    @database_sync_to_async
    def _db_tw_phase(self):
        from .models import Room
        room = Room.objects.get(id=self.room_id)
        return (room.game_state or {}).get("phase", "")

    @database_sync_to_async
    def _db_tw_ask_remaining(self):
        from .models import Room
        room = Room.objects.get(id=self.room_id)
        rd = (room.game_state or {}).get("round_data") or {}
        return max(0.0, (rd.get("ask_deadline") or 0) - time.time())

    @database_sync_to_async
    def _db_tw_answer_remaining(self):
        from .models import Room
        room = Room.objects.get(id=self.room_id)
        rd = (room.game_state or {}).get("round_data") or {}
        cq = rd.get("current_question") or {}
        return max(0.0, (cq.get("answer_deadline") or 0) - time.time())

    @database_sync_to_async
    def _db_tw_submit_question(self, player_id, text):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.submit_question(state, player.id, text)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        rd = state.get("round_data") or {}
        cq = rd.get("current_question") or {}
        from .serializers import anonymized_display_name
        asker_name = (
            anonymized_display_name(player)
            if (room.is_anonymous and not player.is_hidden)
            else player.display_name
        )
        return {
            "asker_id": str(player.id),
            "asker_name": asker_name,
            "text": result["text"],
            "questions_used": rd.get("questions_used", 0),
            "answer_deadline": cq.get("answer_deadline"),
        }

    @database_sync_to_async
    def _db_tw_submit_answer(self, player_id, answer):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        # Capture the question text + asker BEFORE submit clears it (need to
        # echo into chat history as a qa_pair entry for refresh persistence).
        cq_pre = (state.get("round_data") or {}).get("current_question") or {}
        question_text = cq_pre.get("text") or ""
        asker_id_pre = cq_pre.get("asker_id") or ""
        result = tw.submit_answer(state, player.id, answer)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        rd = state.get("round_data") or {}
        result["question_text"] = question_text
        result["asker_id"] = asker_id_pre
        try:
            asker_name = _public_name(room, asker_id_pre) if asker_id_pre else ""
        except Exception:
            asker_name = ""
        result["asker_name"] = asker_name
        # Enrich next_asker / guess_window with player name if present
        next_asker = result.get("next_asker")
        if next_asker:
            try:
                target = RoomPlayer.objects.get(id=int(next_asker["asker_id"]))
                from .serializers import anonymized_display_name
                next_asker["asker_name"] = (
                    anonymized_display_name(target)
                    if (room.is_anonymous and not target.is_hidden)
                    else target.display_name
                )
            except Exception:
                next_asker["asker_name"] = ""
            next_asker["seconds_remaining"] = max(0.0, (rd.get("ask_deadline") or 0) - time.time())
        gw = result.get("guess_window")
        if gw:
            try:
                target = RoomPlayer.objects.get(id=int(gw["asker_id"]))
                from .serializers import anonymized_display_name
                gw["asker_name"] = (
                    anonymized_display_name(target)
                    if (room.is_anonymous and not target.is_hidden)
                    else target.display_name
                )
            except Exception:
                gw["asker_name"] = ""
        return {
            "round_over": result.get("round_over", False),
            "next_asker": next_asker,
            "guess_window": gw,
            "questions_used": rd.get("questions_used", 0),
            "questions_remaining": rd.get("total_questions", tw.TOTAL_QUESTIONS) - rd.get("questions_used", 0),
            "total_questions": rd.get("total_questions", tw.TOTAL_QUESTIONS),
            "question_text": result.get("question_text", ""),
            "asker_id": result.get("asker_id", ""),
            "asker_name": result.get("asker_name", ""),
        }

    def _enrich_transition(self, room, state, result):
        """Add display names + remaining time to the post-answer transition
        payloads (next_asker / hand_raise). Mutates and returns `result`."""
        from .models import RoomPlayer
        rd = state.get("round_data") or {}
        next_asker = result.get("next_asker")
        if next_asker:
            try:
                next_asker["asker_name"] = _public_name(room, next_asker["asker_id"])
            except Exception:
                next_asker["asker_name"] = ""
            next_asker["seconds_remaining"] = max(0.0, (rd.get("ask_deadline") or 0) - time.time())
        hr = result.get("hand_raise")
        if hr:
            # Tell the client which players are still allowed to raise so the
            # button can stay hidden for excluded / exhausted ones.
            from .games import twenty as tw
            eligible = tw._eligible_raisers(state, rd)
            hr["eligible_player_ids"] = eligible
            hr["seconds_remaining"] = max(0.0, (rd.get("hand_raise_deadline") or 0) - time.time())
        return result

    @database_sync_to_async
    def _db_tw_pass_guess_window(self, player_id):
        """Asker chose to skip their post-answer guess window."""
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.pass_guess_window(state, player.id)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        return self._enrich_transition(room, state, result)

    @database_sync_to_async
    def _db_tw_timeout_guess_window(self):
        """Asker's guess window expired. Same outcome as a voluntary pass."""
        from .models import Room
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.timeout_guess_window(state)
        if result is None:
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        return self._enrich_transition(room, state, result)

    @database_sync_to_async
    def _db_tw_submit_raise_hand(self, player_id):
        """Player claims the hand-raise slot."""
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.submit_raise_hand(state, player.id)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        gw = result.get("guess_window")
        if gw:
            try:
                gw["asker_name"] = _public_name(room, gw["asker_id"])
            except Exception:
                gw["asker_name"] = ""
        return result

    @database_sync_to_async
    def _db_tw_pass_hand_guess(self, player_id):
        """Hand-raiser declined to actually guess."""
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.pass_hand_guess(state, player.id)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        return self._enrich_transition(room, state, result)

    @database_sync_to_async
    def _db_tw_timeout_hand_raise(self):
        """No one raised within the hand-raise window."""
        from .models import Room
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.timeout_hand_raise(state)
        if result is None:
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        return self._enrich_transition(room, state, result)

    @database_sync_to_async
    def _db_tw_timeout_hand_guess(self):
        """Raiser's guess window expired without a guess."""
        from .models import Room
        from .games import twenty as tw
        try:
            room = Room.objects.get(id=self.room_id)
        except Exception:
            return None
        state = room.game_state or {}
        result = tw.timeout_hand_guess(state)
        if result is None:
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        return self._enrich_transition(room, state, result)

    @database_sync_to_async
    def _db_tw_guess_window_remaining(self):
        from .models import Room
        try:
            state = Room.objects.values_list("game_state", flat=True).get(id=self.room_id) or {}
        except Exception:
            return 0.0
        rd = state.get("round_data") or {}
        return max(0.0, (rd.get("guess_deadline") or 0) - time.time())

    @database_sync_to_async
    def _db_tw_hand_raise_remaining(self):
        from .models import Room
        try:
            state = Room.objects.values_list("game_state", flat=True).get(id=self.room_id) or {}
        except Exception:
            return 0.0
        rd = state.get("round_data") or {}
        return max(0.0, (rd.get("hand_raise_deadline") or 0) - time.time())

    @database_sync_to_async
    def _db_tw_hand_guess_remaining(self):
        from .models import Room
        try:
            state = Room.objects.values_list("game_state", flat=True).get(id=self.room_id) or {}
        except Exception:
            return 0.0
        rd = state.get("round_data") or {}
        return max(0.0, (rd.get("hand_guess_deadline") or 0) - time.time())

    @database_sync_to_async
    def _db_tw_submit_guess(self, player_id, card_id):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        from card.models import Card
        try:
            room = Room.objects.get(id=self.room_id)
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except Exception:
            return None
        state = room.game_state or {}
        try:
            cid = int(card_id)
        except (TypeError, ValueError):
            return {"error": "bad_card"}
        result = tw.submit_guess(state, player.id, cid)
        if result.get("error"):
            return result
        room.game_state = state
        room.save(update_fields=["game_state"])
        rd = state.get("round_data") or {}
        # Resolve guessed card name (for display)
        card_name = ""
        try:
            c = Card.objects.filter(pk=cid).first()
            if c:
                card_name = c.korean_name or c.name or ""
        except Exception:
            pass
        # Enrich next_asker / hand_raise transition payloads in place.
        self._enrich_transition(room, state, result)
        from .serializers import anonymized_display_name as _adn
        guesser_name = (
            _adn(player)
            if (room.is_anonymous and not player.is_hidden)
            else player.display_name
        )
        return {
            "guesser_id": str(player.id),
            "guesser_name": guesser_name,
            "card_id": cid,
            "card_name": card_name,
            "correct": result.get("correct", False),
            "round_over": result.get("round_over", False),
            "winner_id": result.get("winner_id"),
            "next_asker": result.get("next_asker"),
            "hand_raise": result.get("hand_raise"),
            "questions_used": rd.get("questions_used", 0),
        }

    @database_sync_to_async
    def _db_tw_timeout_ask(self):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        result = tw.timeout_ask(state)
        if result is None:
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        next_asker = result.get("next_asker")
        if next_asker:
            try:
                next_asker["asker_name"] = _public_name(room, next_asker["asker_id"])
            except Exception:
                next_asker["asker_name"] = ""
        return result

    @database_sync_to_async
    def _db_tw_timeout_answer(self):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        result = tw.timeout_answer(state)
        if result is None:
            return None
        room.game_state = state
        room.save(update_fields=["game_state"])
        next_asker = result.get("next_asker")
        if next_asker:
            try:
                next_asker["asker_name"] = _public_name(room, next_asker["asker_id"])
            except Exception:
                next_asker["asker_name"] = ""
        return result

    @database_sync_to_async
    def _db_tw_end_turn(self):
        from .models import Room, RoomPlayer
        from .games import twenty as tw
        from card.models import Card
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        reveal = tw.end_turn(state)
        room.game_state = state
        room.save(update_fields=["game_state"])
        if not reveal:
            return None
        # Enrich with names + image
        if reveal.get("drawer_id"):
            try:
                reveal["drawer_name"] = _public_name(room, reveal["drawer_id"])
            except Exception:
                pass
        if reveal.get("winner_id"):
            try:
                reveal["winner_name"] = _public_name(room, reveal["winner_id"])
            except Exception:
                pass
        if reveal.get("card_id"):
            try:
                c = Card.objects.filter(pk=int(reveal["card_id"])).first()
                if c and c.card_illust:
                    reveal["image_url"] = c.card_illust.url
            except Exception:
                pass
        return reveal

    @database_sync_to_async
    def _db_tw_is_game_over(self):
        from .models import Room
        from .games import twenty as tw
        room = Room.objects.get(id=self.room_id)
        state = room.game_state or {}
        return tw.is_game_over(state)

    @database_sync_to_async
    def _db_finalize_twenty(self):
        from .scoring import finalize_game
        return finalize_game(self.room_id, "twenty")

    @database_sync_to_async
    def _db_tw_resume_snapshot(self, player_id):
        from .models import Room, RoomPlayer
        from card.models import Card
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "twenty":
            return None
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        phase = state.get("phase")
        if phase not in ("choosing", "asking", "answering"):
            return None
        # Identify if this user is the drawer of current round
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return None
        is_drawer = (str(player.id) == rd.get("drawer_id"))
        out = {
            "phase": phase,
            "scores": dict(state.get("scores") or {}),
            "qa_log": rd.get("qa_log") or [],
        }
        drawer_name = ""
        try:
            drawer_name = _public_name(room, rd["drawer_id"])
        except Exception:
            pass
        if phase == "choosing":
            secs_remaining = max(0.0, (rd.get("deadline") or 0) - time.time())
            out["choosing"] = {
                "drawer_id": rd.get("drawer_id"),
                "drawer_name": drawer_name,
                "deadline": rd.get("deadline"),
                "seconds_remaining": secs_remaining,
                "round": state.get("round", 1),
                "total_rounds": state.get("total_rounds"),
                "turn_index": state.get("turn_index", 0),
            }
        elif phase == "asking":
            order = rd.get("guesser_order") or []
            asker_id = order[rd.get("asker_index", 0) % len(order)] if order else None
            asker_name = ""
            if asker_id:
                try:
                    asker_name = _public_name(room, asker_id)
                except Exception:
                    pass
            secs_remaining = max(0.0, (rd.get("ask_deadline") or 0) - time.time())
            total = rd.get("total_questions", 20)
            out["turn"] = {
                "asker_id": asker_id,
                "asker_name": asker_name,
                "questions_remaining": total - rd.get("questions_used", 0),
                "total_questions": total,
                "ask_deadline": rd.get("ask_deadline"),
                "seconds_remaining": secs_remaining,
            }
        elif phase == "answering":
            cq = rd.get("current_question") or {}
            asker_name = ""
            try:
                asker_name = _public_name(room, cq.get("asker_id"))
            except Exception:
                pass
            out["current_question"] = {
                "asker_id": cq.get("asker_id"),
                "asker_name": asker_name,
                "text": cq.get("text"),
                "questions_used": rd.get("questions_used", 0),
                "answer_deadline": cq.get("answer_deadline"),
            }
        # Send the chosen card privately back to the drawer so they remember it
        if is_drawer and rd.get("card_id"):
            try:
                card = Card.objects.filter(pk=int(rd["card_id"])).first()
                image_url = card.card_illust.url if (card and card.card_illust) else None
            except Exception:
                image_url = None
            out["drawer_card_for_me"] = {
                "card_id": rd.get("card_id"),
                "card_name": rd.get("card_name") or "",
                "image_url": image_url,
            }
        return out

    @database_sync_to_async
    def _db_dm_resume_info(self):
        """Inspect game_state for an in-flight turn so the runner can recover
        from a crash. Returns None when nothing needs recovery — including
        'reveal' phase, which is transient between turns and naturally
        resolves by advancing to the next drawer."""
        from .models import Room, RoomPlayer
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "duchmind":
            return None
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        phase = state.get("phase")
        if phase not in ("choosing", "drawing") or not rd:
            return None
        drawer_id = rd.get("drawer_id")
        drawer_name = ""
        if drawer_id:
            try:
                drawer_name = _public_name(room, drawer_id)
            except Exception:
                pass
        return {
            "phase": phase,
            "drawer_id": drawer_id,
            "drawer_name": drawer_name,
            "deadline": rd.get("deadline", 0),
            "choices": rd.get("word_choices") or [],
            "round": state.get("round", 1),
            "total_rounds": state.get("total_rounds"),
            "turn_index": state.get("turn_index", 0),
            "drawer_order": list(state.get("drawer_order") or []),
        }

    @database_sync_to_async
    def _db_dm_abort_to_waiting(self):
        from .models import Room
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return
        room.status = "waiting"
        room.game_state = {}
        room.save(update_fields=["status", "game_state"])
        # Same reservation-clear pattern as `scoring.finalize_game` — abort
        # paths bypass that helper but should still leave the lobby clean.
        room.players.filter(reserved_for_next=True).update(reserved_for_next=False)

    @database_sync_to_async
    def _db_dm_is_drawer(self, player_id):
        from .models import Room, RoomPlayer
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return False
        if room.current_game != "duchmind" or room.status != "in_game":
            return False
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        if state.get("phase") not in ("drawing", "choosing"):
            return False
        try:
            player = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return False
        return str(player.id) == rd.get("drawer_id")

    @database_sync_to_async
    def _db_dm_can_react(self, player_id):
        """True if this player may float a 👍/👎 right now: a correct
        guesser during the drawing phase, or anyone during the reveal
        pause (the ~10s window before the next turn)."""
        from .models import Room
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return False
        if room.current_game != "duchmind" or room.status != "in_game":
            return False
        state = room.game_state or {}
        phase = state.get("phase")
        if phase == "reveal":
            return True
        if phase == "drawing":
            rd = state.get("round_data") or {}
            return str(player_id) in (rd.get("correct_guessers") or {})
        return False

    # ====================================================================
    # === Helpers ========================================================
    # ====================================================================
    async def _broadcast_event(self, event, payload):
        await self.channel_layer.group_send(
            self.group,
            {"type": "room.event", "event": event, "payload": payload},
        )

    async def _send_current_game_state(self):
        """Replay current game state (question or reveal) to this client only,
        for graceful resume after refresh.
        """
        from .games import quiz, duchmind as dm
        game = await self._db_current_game()
        if game == "quiz":
            snapshot = await self._db_get_quiz_snapshot()
            if not snapshot:
                return
            if snapshot.get("phase") == "round":
                payload = quiz.current_question_payload(snapshot["state"])
                if payload:
                    await self.send_json({"type": "quiz_question", **payload})
            elif snapshot.get("phase") == "reveal":
                payload = quiz.current_reveal_payload(snapshot["state"])
                if payload:
                    wpid = payload.get("winner_player_id")
                    if wpid:
                        name = await self._db_winner_name(int(wpid))
                        payload["winner_name"] = name
                    await self.send_json({"type": "quiz_round_reveal", **payload})
        elif game == "duchmind":
            snap = await self._db_dm_resume_snapshot(self.player_id)
            if not snap:
                return
            # Send current scores so the live scoreboard isn't stuck at 0
            # right after a refresh.
            scores = snap.get("scores") or {}
            await self.send_json({"type": "dm_scores", "scores": scores})
            phase = snap["phase"]
            if phase == "choosing":
                await self.send_json({"type": "dm_choosing", **snap["choosing"]})
                if snap.get("drawer_choices_for_me"):
                    await self.send_json({"type": "dm_word_choices", **snap["drawer_choices_for_me"]})
            elif phase == "drawing":
                await self.send_json({"type": "dm_drawing", **snap["drawing"]})
                if snap.get("drawer_word_for_me"):
                    await self.send_json({
                        "type": "dm_drawer_word",
                        "word": snap["drawer_word_for_me"],
                        "image_url": snap.get("drawer_image_for_me"),
                    })
                # Replay who's solved / given up so the chat red-dots and
                # sidebar checkmarks survive a refresh. Must come AFTER
                # dm_drawing — that handler resets the sets to empty.
                await self.send_json({
                    "type": "dm_resolved_replay",
                    "correct_guesser_ids": snap.get("correct_guesser_ids") or [],
                    "given_up_ids": snap.get("given_up_ids") or [],
                })
                # Replay strokes accumulated so far this turn
                strokes = _DM_STROKES.get(self.room_id, [])
                if strokes:
                    await self.send_json({"type": "dm_canvas_replay", "strokes": strokes})
        elif game == "twenty":
            snap = await self._db_tw_resume_snapshot(self.player_id)
            if not snap:
                return
            scores = snap.get("scores") or {}
            await self.send_json({"type": "tw_scores", "scores": scores})
            # Replay QA log so reconnecting clients see prior questions.
            if snap.get("qa_log"):
                await self.send_json({"type": "tw_qa_log", "entries": snap["qa_log"]})
            phase = snap.get("phase")
            if phase == "choosing":
                await self.send_json({"type": "tw_choosing", **snap["choosing"]})
            elif phase == "asking":
                # Re-broadcast current asker turn marker
                if snap.get("turn"):
                    await self.send_json({"type": "tw_turn", **snap["turn"]})
                # Drawer should remember their card
                if snap.get("drawer_card_for_me"):
                    await self.send_json({
                        "type": "tw_drawer_card",
                        **snap["drawer_card_for_me"],
                    })
            elif phase == "answering":
                if snap.get("current_question"):
                    await self.send_json({"type": "tw_question", **snap["current_question"]})
                if snap.get("drawer_card_for_me"):
                    await self.send_json({
                        "type": "tw_drawer_card",
                        **snap["drawer_card_for_me"],
                    })

    @database_sync_to_async
    def _db_dm_resume_snapshot(self, player_id):
        from .models import Room, RoomPlayer
        from .games import duchmind as dm
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "duchmind":
            return None
        state = room.game_state or {}
        rd = state.get("round_data") or {}
        phase = state.get("phase")
        if phase not in ("choosing", "drawing"):
            return None
        try:
            me = RoomPlayer.objects.get(room=room, id=player_id)
        except RoomPlayer.DoesNotExist:
            return None
        is_drawer = str(me.id) == rd.get("drawer_id")
        out = {"phase": phase, "scores": dict(state.get("scores") or {})}
        if phase == "choosing":
            drawer_name = ""
            try:
                drawer_name = _public_name(room, rd["drawer_id"])
            except Exception:
                pass
            secs_remaining = max(0.0, (rd.get("deadline") or 0) - time.time())
            out["choosing"] = {
                "drawer_id": rd.get("drawer_id"),
                "drawer_name": drawer_name,
                "deadline": rd.get("deadline"),
                "seconds_remaining": secs_remaining,
                "round": state.get("round", 1),
                "total_rounds": state.get("total_rounds"),
                "turn_index": state.get("turn_index", 0),
            }
            if is_drawer:
                out["drawer_choices_for_me"] = {
                    "choices": rd.get("word_choices") or [],
                    "deadline": rd.get("deadline"),
                    "seconds_remaining": secs_remaining,
                }
        elif phase == "drawing":
            secs_remaining = max(0.0, (rd.get("deadline") or 0) - time.time())
            show_len = state.get("show_word_length", True)
            out["drawing"] = {
                "drawer_id": rd.get("drawer_id"),
                "deadline": rd.get("deadline"),
                "seconds_remaining": secs_remaining,
                "duration": state.get("draw_seconds") or dm.DRAW_SECONDS,
                "hint": rd.get("hint_mask") if show_len else "",
                "word_length": (dm.maskable_char_count(rd.get("word") or "") if show_len else 0),
                "round": state.get("round", 1),
                "total_rounds": state.get("total_rounds"),
                "turn_index": state.get("turn_index", 0),
            }
            if is_drawer:
                out["drawer_word_for_me"] = rd.get("display_word") or rd.get("word")
                # Prefer stashed image_url (works for both yugioh and pokemon).
                # Fall back to Card lookup for rounds started pre-pokemon.
                stashed = rd.get("word_image_url")
                if stashed:
                    out["drawer_image_for_me"] = stashed
                elif rd.get("word_series", "yugioh") != "pokemon":
                    from card.models import Card
                    cid = rd.get("word_card_id")
                    if cid is not None:
                        try:
                            card = Card.objects.filter(pk=int(cid)).first()
                            if card and card.card_illust:
                                out["drawer_image_for_me"] = card.card_illust.url
                        except (TypeError, ValueError):
                            pass
            # Surface who's already solved / given up this turn so a refresh
            # can restore the in-chat red dot + sidebar checkmarks (otherwise
            # dm_drawing alone resets correctGuesserIds to empty).
            out["correct_guesser_ids"] = list((rd.get("correct_guessers") or {}).keys())
            out["given_up_ids"] = list(rd.get("given_up") or [])
        return out

    @database_sync_to_async
    def _db_get_quiz_snapshot(self):
        from .models import Room
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        if room.status != "in_game" or room.current_game != "quiz":
            return None
        state = room.game_state or {}
        return {"state": state, "phase": state.get("phase")}

    @database_sync_to_async
    def _db_winner_name(self, player_id):
        from .models import RoomPlayer
        try:
            return RoomPlayer.objects.get(id=player_id).display_name
        except RoomPlayer.DoesNotExist:
            return None

    @database_sync_to_async
    def _db_serialize_room(self):
        from .models import Room
        from .serializers import RoomDetailSerializer
        try:
            room = Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        return RoomDetailSerializer(room).data

    @database_sync_to_async
    def _get_room_state(self, room_id, user_id, guest_token):
        from .models import Room, RoomPlayer
        from .serializers import RoomDetailSerializer
        try:
            room = Room.objects.get(id=room_id)
        except Room.DoesNotExist:
            return None
        membership = None
        if user_id:
            membership = RoomPlayer.objects.filter(room_id=room_id, user_id=user_id).first()
        elif guest_token:
            membership = RoomPlayer.objects.filter(room_id=room_id, guest_token=guest_token).first()
        return {
            "room": RoomDetailSerializer(room).data,
            "is_member": membership is not None,
            "is_host": bool(user_id) and room.host_id == user_id,
            "is_spectator": bool(membership and membership.is_spectator),
            "player_id": membership.id if membership else None,
        }
