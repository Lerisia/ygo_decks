"""Shared end-of-game finalization for multiplayer games.

Used by both the runner (natural end) in consumers.py and the manual
'game end' button handler in views.py. Returns the ranked payload that
becomes a *_game_end WS event, or None if the room has already been
finalized externally (race-safe)."""
import time

from .models import Room

POINTS_PER_QUIZ_POINT = 3
POINTS_PER_DM_POINT = 40
POINTS_PER_TW_POINT = 100


def finalize_game(room_id, game_type):
    """Awards points, clears game_state, sets room to waiting, and returns
    a {ranked: [...]} payload. Returns None if the room is no longer in_game
    (already finalized) so callers can skip the broadcast."""
    from .serializers import RoomPlayerSerializer
    room = Room.objects.get(id=room_id)
    if room.status != "in_game":
        return None

    state = room.game_state or {}
    scores = state.get("scores", {})
    players = list(room.players.filter(is_spectator=False).select_related("user").all())

    if game_type == "duchmind":
        ratio = POINTS_PER_DM_POINT
    elif game_type == "quiz":
        ratio = POINTS_PER_QUIZ_POINT
    elif game_type == "twenty":
        ratio = POINTS_PER_TW_POINT
    else:
        ratio = None

    from user.points import award_points
    kind_for_game = {
        "duchmind": "game_dm",
        "quiz": "game_quiz",
        "twenty": "game_twenty",
    }.get(game_type, "other")
    awards = {}
    for p in players:
        score = scores.get(str(p.id), 0)
        awarded = max(0, score // ratio) if ratio else 0
        awards[p.id] = awarded
        if p.user_id and awarded > 0:
            award_points(p.user, awarded, kind=kind_for_game, note=f"{score}점")

    ranked = sorted(
        [
            {
                "player": RoomPlayerSerializer(p).data,
                "score": scores.get(str(p.id), 0),
                "points_awarded": awards[p.id],
            }
            for p in players
        ],
        key=lambda x: -x["score"],
    )

    room.status = "waiting"
    room.game_state = {}
    room.save(update_fields=["status", "game_state"])
    # Game is over — clear any lingering reservations so spectators who
    # didn't get promoted aren't carried into the next game's start state.
    # The next game's start path adds participants to drawer_order from
    # `is_spectator=False` players directly, so clearing the flag is enough.
    room.players.filter(reserved_for_next=True).update(reserved_for_next=False)

    # Wipe ready state from the previous game and tell every connected
    # client so the lobby comes back clean. Without this, returning to the
    # room after a game shows everyone as still "준비됨" until they refresh.
    from . import consumers, events
    consumers._READY_STATES.pop(room_id, None)
    events.broadcast(room_id, "ready_update", {"ready_ids": []})
    # Mark the room as "just-ended" so disconnects during the result screen
    # use the in-game grace instead of the much shorter lobby grace — the
    # screen-lock / tab-switch jitter was auto-leaving viewers while they
    # read the final scoreboard. Cleared after RECENT_END_GRACE_SECONDS.
    consumers._RECENT_END_TIMES[room_id] = time.time()

    # Audit: stamp the most recent open GameLog row for this room with
    # ended_at + ranked output. Find the matching RoomLog → most recent
    # GameLog with ended_at NULL.
    try:
        from django.utils import timezone
        from .models import RoomLog, GameLog
        rlog = RoomLog.objects.filter(source_room_id=room_id).order_by("-id").first()
        if rlog:
            glog = GameLog.objects.filter(room_log=rlog, ended_at__isnull=True).order_by("-id").first()
            if glog:
                glog.ended_at = timezone.now()
                glog.ranked_json = ranked
                glog.save(update_fields=["ended_at", "ranked_json"])
    except Exception:
        pass

    return {"ranked": ranked, "game_type": game_type}
