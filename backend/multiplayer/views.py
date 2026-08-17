import secrets
import time

from django.contrib.auth.hashers import make_password, check_password
from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny, IsAdminUser
from rest_framework.response import Response

from .models import Room, RoomPlayer, DuchMindWord
from .serializers import (
    RoomListItemSerializer,
    RoomDetailSerializer,
    RoomCreateSerializer,
    RoomUpdateSerializer,
    RoomPlayerSerializer,
)
from . import events


def _add_self_as_host(room, user):
    return RoomPlayer.objects.create(room=room, user=user, is_host=True)


def _create_room_log(room):
    """Snapshot a freshly-created Room into RoomLog for the audit trail.
    Returns the RoomLog row (callers don't need it, but exposing it keeps
    the helper testable). The mirror is one-way: subsequent edits to the
    live Room don't re-sync — option changes are part of the live state,
    not the audit history."""
    from .models import RoomLog
    options = {
        "max_players": room.max_players,
        "quiz_total_rounds": room.quiz_total_rounds,
        "duchmind_total_rounds": room.duchmind_total_rounds,
        "duchmind_draw_seconds": room.duchmind_draw_seconds,
        "duchmind_word_options": room.duchmind_word_options,
        "duchmind_show_word_length": room.duchmind_show_word_length,
        "duchmind_show_hints": room.duchmind_show_hints,
        "duchmind_hide_winner_chat": room.duchmind_hide_winner_chat,
        "duchmind_first_correct_speedup": room.duchmind_first_correct_speedup,
        "duchmind_word_pack_id": room.duchmind_word_pack_id,
        "quiz_word_pack_id": room.quiz_word_pack_id,
        "twenty_total_rounds": room.twenty_total_rounds,
        "twenty_mode": room.twenty_mode,
        "twenty_guess_attempts": room.twenty_guess_attempts,
    }
    return RoomLog.objects.create(
        source_room_id=room.id,
        code=room.code,
        name=room.name,
        host_username=getattr(room.host, "username", "") if room.host_id else "",
        host_id=room.host_id,
        max_players=room.max_players,
        is_anonymous=room.is_anonymous,
        allow_guests=room.allow_guests,
        spectators_can_chat=room.spectators_can_chat,
        current_game=room.current_game,
        options_json=options,
    )


def _player_chat_name(player):
    """Display name for chat — respects the room's anonymous mode."""
    from .serializers import anonymized_display_name
    if player.room.is_anonymous and not player.is_hidden:
        return anonymized_display_name(player)
    return player.display_name


def _record_chat_log(room_id: int, channel: str, payload: dict):
    """Persist a single chat broadcast to the audit log. `channel` is one
    of `lobby/dm/tw/quiz`. Failures are swallowed — we never want logging
    to break the live broadcast path."""
    try:
        from .models import RoomLog, ChatLog
        rlog = RoomLog.objects.filter(source_room_id=room_id).order_by("-id").first()
        if not rlog:
            return
        sender_id = payload.get("player_id")
        # System messages use "system" sentinel id.
        sender_user_id = None
        try:
            if isinstance(sender_id, int):
                sender_user_id = sender_id
            elif isinstance(sender_id, str) and sender_id.isdigit():
                sender_user_id = int(sender_id)
        except Exception:
            sender_user_id = None
        ChatLog.objects.create(
            room_log=rlog,
            channel=channel,
            sender_user_id=sender_user_id,
            sender_display=str(payload.get("display_name") or "")[:64],
            is_spectator=bool(payload.get("is_spectator")),
            is_system=bool(payload.get("is_system")),
            kind=str(payload.get("kind") or "")[:16],
            text=str(payload.get("text") or ""),
        )
    except Exception:
        pass


def _post_system_chat(room, text):
    """Drop a system message into the room's currently-active chat (lobby
    while waiting, in-game chat once the game starts). Stored in the same
    in-memory history dict the regular chat handlers use so reconnecting
    clients replay the system messages too."""
    from . import consumers
    payload = {
        "player_id": "system",
        "display_name": "공지",
        "text": text,
        "ts": time.time(),
        "is_spectator": False,
        "is_system": True,
    }
    if room.status == "in_game":
        if room.current_game == "duchmind":
            hist = consumers._DM_CHAT_HISTORY.setdefault(room.id, [])
            event_type = "dm_chat"
            # DM chat shape uses `kind` to render correct/wrong styling;
            # mark this as a system event so the renderer can branch on it
            # if needed (it currently keys on is_system anyway).
            payload["kind"] = "system"
        elif room.current_game == "twenty":
            hist = consumers._TW_CHAT_HISTORY.setdefault(room.id, [])
            event_type = "tw_chat"
        elif room.current_game == "quiz":
            hist = consumers._QUIZ_CHAT_HISTORY.setdefault(room.id, [])
            event_type = "quiz_chat"
        else:
            return
    else:
        hist = consumers._LOBBY_CHAT_HISTORY.setdefault(room.id, [])
        event_type = "lobby_chat"
    hist.append(payload)
    if len(hist) > consumers._CHAT_HISTORY_MAX:
        del hist[: len(hist) - consumers._CHAT_HISTORY_MAX]
    events.broadcast(room.id, event_type, payload)
    # Audit log mirror.
    channel_map = {"lobby_chat": "lobby", "dm_chat": "dm", "tw_chat": "tw", "quiz_chat": "quiz"}
    _record_chat_log(room.id, channel_map.get(event_type, "lobby"), payload)


def _room_payload(request, room):
    """RoomDetailSerializer plus `your_player_id` when derivable from the
    request. Authed users are matched by user; guests would need their token
    explicitly (handled at the call sites that know it)."""
    payload = RoomDetailSerializer(room).data
    user = request.user if request.user.is_authenticated else None
    if user:
        p = RoomPlayer.objects.filter(room=room, user=user).first()
        if p:
            payload["your_player_id"] = p.id
    return payload


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_room(request):
    """Return the active room the user is in, or null."""
    membership = (
        RoomPlayer.objects.filter(user=request.user)
        .exclude(room__status="closed")
        .select_related("room")
        .first()
    )
    if not membership:
        return Response({"room": None})
    return Response({"room": _room_payload(request, membership.room)})


@api_view(["GET"])
@permission_classes([AllowAny])
def list_rooms(request):
    """List public, non-closed rooms."""
    rooms = Room.objects.filter(is_listed=True).exclude(status="closed")
    return Response({"rooms": RoomListItemSerializer(rooms, many=True).data})


def _user_blocked_by_existing_room(user):
    """Return the active (non-closed) room the user is in, or None."""
    return (
        RoomPlayer.objects.filter(user=user)
        .exclude(room__status="closed")
        .select_related("room")
        .first()
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_room(request):
    user = request.user

    blocked = _user_blocked_by_existing_room(user)
    if blocked:
        return Response(
            {"error": "이미 다른 방에 참가 중입니다. 먼저 그 방에서 나가세요.",
             "current_room_id": blocked.room_id},
            status=400,
        )

    serializer = RoomCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    raw_password = data.pop("password", "") or ""
    with transaction.atomic():
        room = Room.objects.create(
            host=user,
            password=make_password(raw_password) if raw_password else "",
            **data,
        )
        _add_self_as_host(room, user)
        _create_room_log(room)
    return Response(_room_payload(request, room), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([AllowAny])
def get_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    return Response(_room_payload(request, room))


@api_view(["GET"])
@permission_classes([AllowAny])
def get_room_by_code(request, code):
    """Resolve a room by its 6-char invite code."""
    room = get_object_or_404(Room, code=code.upper())
    if room.status == "closed":
        return Response({"error": "종료된 방입니다."}, status=400)
    return Response(_room_payload(request, room))


@api_view(["POST"])
@permission_classes([AllowAny])
def join_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    user = request.user if request.user.is_authenticated else None

    if room.status == "closed":
        return Response({"error": "종료된 방입니다."}, status=400)

    invite_code = (request.data.get("invite") or "").strip()
    has_valid_invite = bool(invite_code) and invite_code == room.code

    is_guest = user is None
    # Guests are blocked whenever the host has `allow_guests=False`, even
    # via an invite link — sharing a link to a friend shouldn't override
    # the host's explicit "no guests" choice.
    if is_guest and not room.allow_guests:
        return Response({"error": "이 방은 게스트 입장을 허용하지 않습니다."}, status=403)

    # Already a member? Skip password / kick / full checks (re-entering own session).
    if user:
        existing = RoomPlayer.objects.filter(room=room, user=user).first()
        if existing:
            payload = RoomDetailSerializer(room).data
            payload["your_player_id"] = existing.id
            return Response(payload)
    else:
        existing_token = (request.data.get("guest_token") or "").strip()
        if existing_token:
            existing = RoomPlayer.objects.filter(room=room, guest_token=existing_token).first()
            if existing:
                return Response({
                    **RoomDetailSerializer(room).data,
                    "your_player_id": existing.id,
                    "_guest": {"token": existing.guest_token, "nickname": existing.guest_nickname, "player_id": existing.id},
                })

    # Stealth admin join — invisible to other players. Always treated as a
    # spectator so they don't enter the game's drawer rotation.
    as_stealth = bool(request.data.get("as_stealth")) and bool(user and user.is_staff)
    # Spectator joins: allowed at any time (in_game OR waiting), no full-room
    # check, no game participation. Player joins: only when room is waiting
    # and not full (otherwise they'd never get a turn).
    as_spectator = bool(request.data.get("as_spectator")) or as_stealth
    if not as_spectator:
        if room.status != "waiting":
            return Response({"error": "이미 게임이 진행 중입니다. 관전자로 입장하시거나 다음 게임을 기다리세요."}, status=400)
        if room.is_full():
            return Response({"error": "방이 가득 찼습니다. 관전자로 입장 가능합니다."}, status=400)
    if as_spectator and not (user and user.is_staff):
        spec_count = room.players.filter(is_spectator=True).count()
        if spec_count >= MAX_SPECTATORS:
            return Response({"error": f"관전 정원이 가득 찼습니다 (최대 {MAX_SPECTATORS}명)."}, status=400)

    if user and user.id in (room.kicked_user_ids or []) and not user.is_staff:
        return Response({"error": "강퇴된 유저입니다."}, status=403)

    raw_password = request.data.get("password", "") or ""
    is_admin = bool(user and user.is_staff)
    bypass_pw = has_valid_invite or is_admin
    if room.has_password and not bypass_pw and not check_password(raw_password, room.password):
        return Response({"error": "비밀번호가 틀렸습니다."}, status=403)

    if user and not is_admin:
        # Block if user is already in another active room. Admins can hop
        # between rooms freely for moderation/observation.
        blocked = (
            RoomPlayer.objects.filter(user=user)
            .exclude(room=room)
            .exclude(room__status="closed")
            .select_related("room")
            .first()
        )
        if blocked:
            return Response(
                {"error": "이미 다른 방에 참가 중입니다. 먼저 그 방에서 나가세요.",
                 "current_room_id": blocked.room_id},
                status=400,
            )

    if is_guest:
        guest_nickname = _generate_guest_nickname(room)
        guest_token = secrets.token_urlsafe(32)
        guest_icon = _pick_random_default_icon()
    else:
        guest_nickname = ""
        guest_token = ""
        guest_icon = None

    try:
        with transaction.atomic():
            player = RoomPlayer.objects.create(
                room=room,
                user=user,
                is_spectator=as_spectator,
                is_hidden=as_stealth,
                guest_nickname=guest_nickname,
                guest_token=guest_token,
                guest_icon=guest_icon,
            )
    except Exception as e:
        return Response({"error": f"입장 실패: {e}"}, status=400)

    # Hidden admins don't broadcast a player_joined — that's the whole point
    # of stealth mode.
    if not as_stealth:
        events.player_joined(room.id, RoomPlayerSerializer(player).data)
        # Surface the join in chat too (lobby or in-game) so existing
        # players see who walked in without watching the player list.
        verb = "관전 입장" if as_spectator else "입장"
        _post_system_chat(room, f"{_player_chat_name(player)}님이 {verb}했습니다")

    payload = RoomDetailSerializer(room).data
    payload["your_player_id"] = player.id
    if is_guest:
        payload["_guest"] = {
            "token": guest_token,
            "nickname": guest_nickname,
            "player_id": player.id,
        }
    return Response(payload)


MAX_SPECTATORS = 6


def _pick_random_default_icon():
    """Random icon from category=default. None if pool empty."""
    from avatar.models import CardIcon
    qs = CardIcon.objects.filter(category="default")
    n = qs.count()
    if n == 0:
        return None
    return qs[secrets.randbelow(n)]


def _generate_guest_nickname(room):
    """Generate '게스트####' that is unique within the room (not currently
    used and not previously kicked)."""
    existing = set(
        RoomPlayer.objects.filter(room=room, user__isnull=True)
        .values_list("guest_nickname", flat=True)
    )
    kicked = set(room.kicked_guest_nicknames or [])
    used = existing | kicked
    for _ in range(200):
        candidate = f"게스트{secrets.randbelow(9000) + 1000}"
        if candidate not in used:
            return candidate
    # Last-resort fallback (extremely unlikely): random suffix
    return f"게스트{secrets.token_hex(4)}"


@api_view(["POST"])
@permission_classes([AllowAny])
def leave_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    user = request.user if request.user.is_authenticated else None
    if user:
        player = RoomPlayer.objects.filter(room=room, user=user).first()
    else:
        guest_token = (request.data.get("guest_token") or "").strip()
        if not guest_token:
            return Response({"error": "인증이 필요합니다."}, status=401)
        player = RoomPlayer.objects.filter(room=room, guest_token=guest_token).first()
    if player is None:
        return Response({"error": "방에 참가하지 않았습니다."}, status=400)

    was_host = bool(user) and room.host_id == user.id
    player_id = player.id
    # Capture name + stealth flag before delete; we'll post a chat message
    # AFTER the txn commits so reconnecting clients also see it.
    leaving_name = _player_chat_name(player)
    was_stealth = player.is_hidden
    was_spectator = player.is_spectator

    with transaction.atomic():
        # Mid-game partial payout — must run before cleanup strips score.
        _award_partial_points_on_leave(room, player)
        # If a participant leaves mid-game, clean up their slot in the game
        # state BEFORE deleting the row — otherwise the runner will try to
        # advance to a deleted player and crash with RoomPlayer.DoesNotExist.
        if room.status == "in_game" and not player.is_spectator:
            _cleanup_player_from_game_state(room, str(player.id))

        player.delete()

        if was_host:
            # Transfer host to the next remaining *participant* (spectators
            # are not eligible). Oldest joined wins.
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
                # No eligible host left — close the room (drops any remaining
                # spectators too).
                _close_room_inline(room)
        else:
            # Non-host leaving: close if only spectators remain.
            _close_room_inline_if_only_spectators(room)

    events.player_left(room.id, player_id)
    if room.status == "closed":
        events.broadcast(room.id, "room_closed", {"message": "방이 종료되었습니다."})
    elif was_host:
        events.room_updated(room.id, RoomDetailSerializer(room).data)

    # Stealth players never broadcasted a join, so don't broadcast a leave.
    # Don't post a leave message if the room just closed (the room_closed
    # banner says enough).
    if not was_stealth and room.status != "closed":
        verb = "관전 퇴장" if was_spectator else "퇴장"
        _post_system_chat(room, f"{leaving_name}님이 {verb}했습니다")

    _maybe_end_game_due_to_low_count(room)

    return Response({"ok": True})


def _cleanup_player_from_game_state(room, pid_str):
    """Strip a leaving participant from the in-flight game state so the
    runner doesn't trip over `RoomPlayer.DoesNotExist` when it tries to
    advance to them. Removes them from drawer_order, scores, correct_guessers,
    and given_up. Adjusts turn_index when their slot was at-or-before the
    current position so the rotation continues smoothly."""
    state = room.game_state or {}
    if not state:
        return
    order = list(state.get("drawer_order") or [])
    if pid_str in order:
        idx = order.index(pid_str)
        order.remove(pid_str)
        ti = state.get("turn_index", -1)
        # If their slot was at-or-before the current turn_index, shift it
        # down. (At-equal: their turn was current; the runner will finish
        # the current turn, then advance — and ti needs to point at the
        # right next slot in the shrunken order.)
        if ti >= 0 and idx <= ti:
            state["turn_index"] = ti - 1
        state["drawer_order"] = order
    scores = dict(state.get("scores") or {})
    if pid_str in scores:
        del scores[pid_str]
        state["scores"] = scores
    rd = state.get("round_data") or {}
    cg = dict(rd.get("correct_guessers") or {})
    if pid_str in cg:
        del cg[pid_str]
        rd["correct_guessers"] = cg
    given_up = list(rd.get("given_up") or [])
    if pid_str in given_up:
        given_up.remove(pid_str)
        rd["given_up"] = given_up
    state["round_data"] = rd
    room.game_state = state
    room.save(update_fields=["game_state"])


def _close_room_inline(room):
    """Set room to closed and drop all players. Caller is responsible for
    broadcasting the room_closed event."""
    room.status = "closed"
    room.save(update_fields=["status"])
    room.players.all().delete()
    # Audit: stamp the matching RoomLog with closed_at so admins can see
    # when each room actually ended.
    from .models import RoomLog
    from django.utils import timezone
    RoomLog.objects.filter(source_room_id=room.id, closed_at__isnull=True).update(closed_at=timezone.now())


def _close_room_inline_if_only_spectators(room):
    """If no non-spectator players remain, close the room. Returns True iff
    the room was closed."""
    if not room.players.filter(is_spectator=False).exists():
        _close_room_inline(room)
        return True
    return False


def _award_partial_points_on_leave(room, player):
    """Mid-game leaver gets a partial payout based on their accumulated game-
    state score, using the same point/score ratio that finalize_game would
    use at game end. Only authed (non-guest) participants are eligible —
    guests don't have a points balance to credit. Caller must invoke this
    BEFORE `_cleanup_player_from_game_state` (which strips the player's
    score from state) and BEFORE `player.delete()`."""
    if room.status != "in_game":
        return 0
    if not player.user_id or player.is_spectator:
        return 0
    state = room.game_state or {}
    score = (state.get("scores") or {}).get(str(player.id), 0)
    if score <= 0:
        return 0
    from .scoring import POINTS_PER_DM_POINT, POINTS_PER_QUIZ_POINT, POINTS_PER_TW_POINT
    ratio = {
        "duchmind": POINTS_PER_DM_POINT,
        "quiz": POINTS_PER_QUIZ_POINT,
        "twenty": POINTS_PER_TW_POINT,
    }.get(room.current_game)
    if not ratio:
        return 0
    awarded = max(0, int(score) // ratio)
    if awarded <= 0:
        return 0
    from user.points import award_points
    kind = {
        "duchmind": "game_dm",
        "quiz": "game_quiz",
        "twenty": "game_twenty",
    }.get(room.current_game, "other")
    award_points(player.user, awarded, kind=kind, note=f"중도 퇴장 부분 정산 ({score}점)")
    return awarded


def _maybe_end_game_due_to_low_count(room):
    """Auto-end the in-flight game when active (non-spectator) participants
    drop below 2 — otherwise the lone remaining player would be stuck drawing
    every turn with nobody to guess until total_rounds runs out. Mirrors the
    `end_game` view's tear-down: finalize, signal runner, broadcast
    *_game_end + room_updated, and post a red [공지] in lobby/game chat.
    Returns True iff the game was ended."""
    if room.status != "in_game":
        return False
    active = room.players.filter(is_spectator=False).count()
    if active >= 2:
        return False

    import time
    from .scoring import finalize_game
    from .consumers import signal_runner_to_exit

    current_game = room.current_game
    with transaction.atomic():
        result = finalize_game(room.id, current_game)
    room.refresh_from_db()
    signal_runner_to_exit(room.id)

    if result:
        end_event = {
            "duchmind": "dm_game_end",
            "quiz": "quiz_game_end",
            "twenty": "tw_game_end",
        }.get(current_game)
        if end_event:
            events.broadcast(room.id, end_event, result)

    notice = {
        "player_id": "_system",
        "display_name": "[공지]",
        "kind": "wrong",
        "text": "참가자가 부족하여 게임을 종료합니다.",
        "ts": time.time(),
        "is_system": True,
    }
    chat_event = {
        "duchmind": "dm_chat",
        "quiz": "quiz_chat",
        "twenty": "tw_chat",
    }.get(current_game)
    if chat_event:
        events.broadcast(room.id, chat_event, notice)
    # Also drop into lobby chat — that's where the 1 remaining player lands
    # after dismissing the result screen, so they see *why* the game ended.
    events.broadcast(room.id, "lobby_chat", notice)

    events.room_updated(room.id, RoomDetailSerializer(room).data)
    return True


@api_view(["POST"])
@permission_classes([AllowAny])
def toggle_spectator(request, room_id):
    """Switch the caller between participant and spectator.

    Lobby (status=waiting): both directions allowed.
    In-game (status=in_game): only spectator → participant. The new player is
    appended to the current game's drawer rotation so they take the LAST turn
    of the current round, then continue normally.
    Switching to participant requires room not to be full."""
    room = get_object_or_404(Room, id=room_id)
    if room.status not in ("waiting", "in_game"):
        return Response({"error": "이 상태에서는 변경할 수 없습니다."}, status=400)

    user = request.user if request.user.is_authenticated else None
    if user:
        player = RoomPlayer.objects.filter(room=room, user=user).first()
    else:
        guest_token = (request.data.get("guest_token") or "").strip()
        if not guest_token:
            return Response({"error": "인증이 필요합니다."}, status=401)
        player = RoomPlayer.objects.filter(room=room, guest_token=guest_token).first()
    if player is None:
        return Response({"error": "방에 참가하지 않았습니다."}, status=400)

    becoming_spectator = not player.is_spectator
    if room.status == "in_game":
        # In-game seat changes go through reserve_for_next (queued for next
        # turn) so we never splice mid-round. toggle-spectator only adjusts
        # lobby state.
        return Response(
            {"error": "게임 진행 중에는 직접 전환할 수 없습니다. 입장 예약을 사용하세요."},
            status=400,
        )
    if becoming_spectator:
        spec_count = room.players.filter(is_spectator=True).exclude(id=player.id).count()
        if spec_count >= MAX_SPECTATORS:
            return Response({"error": f"관전 정원이 가득 찼습니다 (최대 {MAX_SPECTATORS}명)."}, status=400)
    if becoming_spectator and player.is_host:
        return Response(
            {"error": "방장은 관전자로 전환할 수 없습니다. 먼저 다른 사람에게 방장을 넘겨주세요."},
            status=400,
        )
    if not becoming_spectator and room.is_full():
        return Response({"error": "방이 가득 찼습니다."}, status=400)

    with transaction.atomic():
        player.is_spectator = becoming_spectator
        if becoming_spectator:
            # Reset score on the way out (participant→spectator) so a future
            # switch back doesn't carry stale points.
            player.score = 0
            # Returning to spectator clears any stale reservation so the
            # promote loop doesn't re-add them on the next turn.
            player.reserved_for_next = False
        player.save(update_fields=["is_spectator", "score", "reserved_for_next"])

    events.player_updated(room.id, RoomPlayerSerializer(player).data)
    if not player.is_hidden:
        verb = "관전자로 전환했습니다" if becoming_spectator else "참가자로 전환했습니다"
        _post_system_chat(room, f"{_player_chat_name(player)}님이 {verb}")
    return Response(RoomPlayerSerializer(player).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def reserve_for_next(request, room_id):
    """Spectator opts in to join the game starting next turn.

    Sets `reserved_for_next=True` on the caller's RoomPlayer; the duchmind
    game runner promotes them at the next turn-advance (is_spectator=False,
    appended to drawer_order). Once reserved, the slot counts against
    `max_players` so the room can't be over-reserved.

    Reservation is one-way (no cancel). Only valid in_game; in waiting,
    spectators should just use toggle_spectator to flip directly."""
    room = get_object_or_404(Room, id=room_id)
    if room.status != "in_game":
        return Response({"error": "게임 진행 중에만 예약할 수 있습니다."}, status=400)

    user = request.user if request.user.is_authenticated else None
    if user:
        player = RoomPlayer.objects.filter(room=room, user=user).first()
    else:
        guest_token = (request.data.get("guest_token") or "").strip()
        if not guest_token:
            return Response({"error": "인증이 필요합니다."}, status=401)
        player = RoomPlayer.objects.filter(room=room, guest_token=guest_token).first()
    if player is None:
        return Response({"error": "방에 참가하지 않았습니다."}, status=400)

    if not player.is_spectator:
        return Response({"error": "이미 참가 중입니다."}, status=400)
    if player.reserved_for_next:
        return Response({"error": "이미 예약되어 있습니다."}, status=400)
    # Capacity check: existing active + already-reserved + this one.
    if room.is_full():
        return Response({"error": "정원이 가득 찼습니다 (예약 포함)."}, status=400)

    with transaction.atomic():
        player.reserved_for_next = True
        player.save(update_fields=["reserved_for_next"])

    events.player_updated(room.id, RoomPlayerSerializer(player).data)
    if not player.is_hidden:
        _post_system_chat(room, f"{_player_chat_name(player)}님이 다음 판 입장을 예약했습니다")
    return Response(RoomPlayerSerializer(player).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def transfer_host(request, room_id, player_id):
    """Current host hands ownership to another player. Target must be a
    registered (non-guest) participant — guests/spectators are not eligible."""
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 방장을 넘길 수 있습니다."}, status=403)
    target = get_object_or_404(RoomPlayer, id=player_id, room=room)
    if target.user_id == request.user.id:
        return Response({"error": "자기 자신에게 넘길 수 없습니다."}, status=400)
    if target.is_spectator:
        return Response({"error": "관전자는 방장이 될 수 없습니다."}, status=400)
    if target.user_id is None:
        return Response({"error": "게스트는 방장이 될 수 없습니다."}, status=400)
    with transaction.atomic():
        old_host = RoomPlayer.objects.filter(room=room, user=request.user).first()
        if old_host:
            old_host.is_host = False
            old_host.save(update_fields=["is_host"])
        target.is_host = True
        target.save(update_fields=["is_host"])
        room.host = target.user
        room.save(update_fields=["host"])
    events.room_updated(room.id, RoomDetailSerializer(room).data)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def close_room(request, room_id):
    """Host-only: forcefully close the room. Drops all players and emits a
    room_closed event so connected clients are kicked out."""
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 방을 닫을 수 있습니다."}, status=403)
    if room.status == "closed":
        return Response({"error": "이미 종료된 방입니다."}, status=400)
    with transaction.atomic():
        room.status = "closed"
        room.save(update_fields=["status"])
        room.players.all().delete()
    events.broadcast(room.id, "room_closed", {"message": "방이 종료되었습니다."})
    return Response({"ok": True})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 설정을 변경할 수 있습니다."}, status=403)
    if room.status != "waiting":
        return Response({"error": "게임 중에는 설정을 변경할 수 없습니다."}, status=400)

    serializer = RoomUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # max_players cannot drop below current player count
    if "max_players" in data and data["max_players"] < room.player_count():
        return Response({"error": "현재 인원 수보다 적게 설정할 수 없습니다."}, status=400)

    if "password" in data:
        raw = data.pop("password")
        room.password = make_password(raw) if raw else ""

    for field, value in data.items():
        setattr(room, field, value)

    room.save()
    events.room_updated(room.id, RoomDetailSerializer(room).data)
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def start_game(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 게임을 시작할 수 있습니다."}, status=403)
    if room.status != "waiting":
        return Response({"error": "게임 시작 가능한 상태가 아닙니다."}, status=400)
    if room.player_count() < 2:
        return Response({"error": "최소 2명이 필요합니다."}, status=400)
    if not room.current_game:
        return Response({"error": "게임이 선택되지 않았습니다."}, status=400)
    # Twenty Questions competitive mode needs ≥3 players (1 drawer + ≥2
    # guessers) for the question rotation to make sense, and ≤6 so each
    # player gets enough turns. Cooperative mode has no such limits.
    if room.current_game == "twenty" and (room.twenty_mode or "competitive") == "competitive":
        pc = room.player_count()
        if pc < 3:
            return Response({"error": "딱무고개 경쟁전은 최소 3명이 필요합니다."}, status=400)
        if pc > 6:
            return Response({"error": "딱무고개 경쟁전은 최대 6명입니다."}, status=400)

    with transaction.atomic():
        room.status = "in_game"
        room.game_state = {}
        # Reset scores at game start
        room.players.update(score=0)
        room.save(update_fields=["status", "game_state"])
        # Audit: open a GameLog row for this game. ended_at + ranked_json
        # are filled in when finalize_game runs.
        from .models import RoomLog, GameLog
        rlog = RoomLog.objects.filter(source_room_id=room.id).order_by("-id").first()
        if rlog:
            GameLog.objects.create(
                room_log=rlog,
                game_type=room.current_game,
            )

    # If a previous game's runner is still blocked in a wait_for (e.g., the
    # last game finished but the runner hasn't unblocked yet), wake it so it
    # exits and clears _GAME_RUNNERS — otherwise _maybe_start_game_runner
    # will see the stale task and skip starting the new runner → infinite
    # "준비 중".
    from .consumers import signal_runner_to_exit
    signal_runner_to_exit(room.id)

    events.room_updated(room.id, RoomDetailSerializer(room).data)
    events.broadcast(room.id, "game_started", {"game": room.current_game})
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def end_game(request, room_id):
    from .scoring import finalize_game
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 게임을 종료할 수 있습니다."}, status=403)
    if room.status != "in_game":
        return Response({"error": "진행 중인 게임이 없습니다."}, status=400)

    current_game = room.current_game
    final_scores = list(room.players.values("id", "score").order_by("-score"))

    with transaction.atomic():
        result = finalize_game(room.id, current_game)
    room.refresh_from_db()

    # Wake the runner so it sees status=waiting and exits cleanly instead of
    # sitting in a long wait_for timeout.
    from .consumers import signal_runner_to_exit
    signal_runner_to_exit(room.id)

    if result:
        end_event = {
            "duchmind": "dm_game_end",
            "quiz": "quiz_game_end",
            "twenty": "tw_game_end",
        }.get(current_game)
        if end_event:
            events.broadcast(room.id, end_event, result)

    events.room_updated(room.id, RoomDetailSerializer(room).data)
    events.broadcast(room.id, "game_ended", {"final_scores": final_scores})
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def kick_player(request, room_id, player_id):
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 강퇴할 수 있습니다."}, status=403)

    target = get_object_or_404(RoomPlayer, id=player_id, room=room)

    if target.user_id and target.user_id == request.user.id:
        return Response({"error": "자기 자신은 강퇴할 수 없습니다."}, status=400)

    target_id = target.id
    target_name = _player_chat_name(target)
    target_was_stealth = target.is_hidden
    # Soft kick — just remove from the room. Don't persist to
    # kicked_user_ids/kicked_guest_nicknames so the target can rejoin if
    # they want; the host can kick again if it's a real problem.
    with transaction.atomic():
        # Mid-game partial payout — kicked players get the same partial
        # credit as voluntary leavers (read score before cleanup strips it).
        _award_partial_points_on_leave(room, target)
        # Strip from in-flight game state first so the runner doesn't crash
        # trying to advance to a deleted player.
        if room.status == "in_game" and not target.is_spectator:
            _cleanup_player_from_game_state(room, str(target.id))
        target.delete()

    events.player_kicked(room.id, target_id)
    if not target_was_stealth:
        _post_system_chat(room, f"{target_name}님이 강퇴되었습니다")
    _maybe_end_game_due_to_low_count(room)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def notify_update(request):
    """Push a red [공지] message into every active room's chat panels —
    lobby + DM + Quiz + Twenty — so users see it wherever they are. Used by
    admins right before a deploy so connected clients can refresh on their
    own before the WS restart."""
    import time
    from . import events
    from .models import Room
    from .consumers import (
        _LOBBY_CHAT_HISTORY,
        _DM_CHAT_HISTORY,
        _QUIZ_CHAT_HISTORY,
        _TW_CHAT_HISTORY,
        _CHAT_HISTORY_MAX,
    )
    msg = (request.data.get("message") or "").strip()
    if not msg:
        msg = "잠시 후 업데이트가 배포됩니다. 새로고침해주세요."
    payload_base = {
        "player_id": "_system",
        "display_name": "[공지]",
        "kind": "wrong",  # uses default text style on DM; is_system overrides color
        "text": msg,
        "ts": time.time(),
        "is_system": True,
    }
    rooms = Room.objects.exclude(status="closed").values_list("id", flat=True)
    for room_id in rooms:
        for hist in (
            _LOBBY_CHAT_HISTORY.setdefault(room_id, []),
            _DM_CHAT_HISTORY.setdefault(room_id, []),
            _QUIZ_CHAT_HISTORY.setdefault(room_id, []),
            _TW_CHAT_HISTORY.setdefault(room_id, []),
        ):
            hist.append(dict(payload_base))
            if len(hist) > _CHAT_HISTORY_MAX:
                del hist[: len(hist) - _CHAT_HISTORY_MAX]
        for evt in ("lobby_chat", "dm_chat", "quiz_chat", "tw_chat"):
            events.broadcast(room_id, evt, payload_base)
    return Response({"ok": True, "rooms_notified": len(rooms)})


# ============================================================================
# DuchMind word management — admin only
# ============================================================================

def _default_pack():
    from .models import DuchMindWordPack
    return DuchMindWordPack.objects.filter(is_default=True).first()


def _admin_pack(request):
    """Resolve which pack the admin word-maintenance UI is operating on:
    ?pack_id=<id> if given (must be a system pack — owner is None), else
    the default pack. Returns None if the requested pack is invalid."""
    from .models import DuchMindWordPack
    pid = request.query_params.get("pack_id") or request.data.get("pack_id")
    if pid:
        try:
            p = DuchMindWordPack.objects.get(pk=int(pid))
        except (DuchMindWordPack.DoesNotExist, ValueError, TypeError):
            return None
        if p.owner_id is not None or getattr(p, "series", "yugioh") != "yugioh":
            return None  # this admin UI handles yugioh system packs only
        return p
    return _default_pack()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dm_browse_cards(request):
    """Paginated grid of all cards-with-illustrations, flagged by whether
    they're already in ?pack_id=. Powers both the admin tier-pack curator
    and user-owned pack editors — auth is per-pack: staff edits system
    packs (owner=None), users edit packs they own. Optional ?q= filters."""
    from card.models import Card
    from .models import DuchMindWordPack
    pid = request.query_params.get("pack_id")
    if pid:
        try:
            pack = DuchMindWordPack.objects.get(pk=int(pid))
        except (DuchMindWordPack.DoesNotExist, ValueError, TypeError):
            return Response({"error": "단어장을 찾을 수 없습니다."}, status=404)
        if getattr(pack, "series", "yugioh") != "yugioh":
            return Response({"error": "이 둘러보기는 유희왕 단어장 전용입니다."}, status=400)
        if not _pack_can_edit(pack, request.user):
            return Response({"error": "이 단어장을 편집할 권한이 없습니다."}, status=403)
    else:
        # No pack_id given: fall back to the system default (admin-only path).
        if not getattr(request.user, "is_staff", False):
            return Response({"error": "단어장을 지정해주세요."}, status=400)
        pack = _default_pack()
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = min(120, max(12, int(request.query_params.get("page_size", 60))))
    except (TypeError, ValueError):
        page_size = 60
    q = (request.query_params.get("q") or "").strip()

    qs = Card.objects.filter(card_illust__isnull=False).exclude(card_illust="")
    if q:
        qs = qs.filter(korean_name__icontains=q)
    # Newly scraped cards float to the top; pre-existing rows are all
    # stamped 2020-01-01 by migration 0020 and stay in their historic id order.
    qs = qs.order_by("-created_at", "id")
    total = qs.count()
    start = (page - 1) * page_size
    chunk = list(qs[start:start + page_size].only("id", "card_id", "korean_name", "name", "card_illust"))

    in_pack = set(
        DuchMindWord.objects.filter(pack=pack, card_id__in=[c.id for c in chunk])
        .values_list("card_id", flat=True)
    ) if pack else set()

    items = []
    for c in chunk:
        try:
            url = c.card_illust.url if c.card_illust else None
        except Exception:
            url = None
        items.append({
            "id": c.id,
            "card_id": c.card_id,
            "name": c.korean_name or c.name,
            "image_url": url,
            "in_pack": c.id in in_pack,
        })
    return Response({
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size,
        "pack_id": pack.id if pack else None,
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def dm_admin_packs(request):
    """List system yugioh packs the admin maintenance UI can manage (the
    tier packs: 초급/중급/고급…). Used to populate the pack picker."""
    from .models import DuchMindWordPack
    packs = (
        DuchMindWordPack.objects
        .filter(owner__isnull=True, series="yugioh")
        .order_by("-is_default", "name")
    )
    return Response({"packs": [
        {"id": p.id, "name": p.name, "is_default": p.is_default, "entry_count": p.entries.count()}
        for p in packs
    ]})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def dm_list_words(request):
    """List a system pack's words (admin maintenance UI). Defaults to the
    default pack; pass ?pack_id= to target 중급/고급/etc."""
    pack = _admin_pack(request)
    qs = DuchMindWord.objects.filter(pack=pack).select_related("card") if pack else DuchMindWord.objects.none()
    items = [
        {
            "id": w.id, "card_id": w.card.card_id, "card_pk": w.card_id,
            "name": w.card.korean_name or w.card.name,
            "image_url": w.card.card_illust.url if w.card.card_illust else None,
            "enabled": w.enabled, "note": w.note,
        }
        for w in qs
    ]
    return Response({"words": items, "count": len(items), "pack_id": pack.id if pack else None})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def dm_search_cards(request):
    """Search cards by Korean name to add to the target pack. Excludes already-in-pack cards."""
    from card.models import Card
    pack = _admin_pack(request)
    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response({"results": []})
    used = set(DuchMindWord.objects.filter(pack=pack).values_list("card_id", flat=True)) if pack else set()
    qs = Card.objects.filter(korean_name__icontains=q).exclude(id__in=used)[:50]
    results = [
        {"id": c.id, "card_id": c.card_id, "name": c.korean_name or c.name,
         "image_url": c.card_illust.url if c.card_illust else None}
        for c in qs
    ]
    return Response({"results": results})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def dm_add_word(request):
    from card.models import Card
    pack = _admin_pack(request)
    if pack is None:
        return Response({"error": "단어장을 찾을 수 없습니다."}, status=400)
    card_pk = request.data.get("card_pk") or request.data.get("card_id")
    if not card_pk:
        return Response({"error": "card_pk가 필요합니다."}, status=400)
    try:
        card = Card.objects.get(pk=int(card_pk))
    except (Card.DoesNotExist, ValueError, TypeError):
        return Response({"error": "카드를 찾을 수 없습니다."}, status=404)
    word, created = DuchMindWord.objects.get_or_create(
        pack=pack, card=card,
        defaults={"created_by": request.user, "note": (request.data.get("note") or "")[:120]},
    )
    return Response({"id": word.id, "card_id": card.card_id, "name": card.korean_name, "created": created},
                    status=201 if created else 200)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def dm_bulk_add_words(request):
    """Add many cards at once by Korean name match to the target pack."""
    from card.models import Card
    pack = _admin_pack(request)
    if pack is None:
        return Response({"error": "단어장을 찾을 수 없습니다."}, status=400)
    names = request.data.get("names") or []
    if not isinstance(names, list):
        return Response({"error": "names must be a list."}, status=400)
    added = 0
    skipped = 0
    not_found = []
    used = set(DuchMindWord.objects.filter(pack=pack).values_list("card_id", flat=True))
    for raw in names:
        n = (raw or "").strip()
        if not n:
            continue
        c = Card.objects.filter(korean_name=n).first()
        if not c:
            not_found.append(n)
            continue
        if c.id in used:
            skipped += 1
            continue
        DuchMindWord.objects.create(pack=pack, card=c, created_by=request.user)
        used.add(c.id)
        added += 1
    return Response({"added": added, "skipped": skipped, "not_found": not_found})


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def dm_toggle_word(request, word_id):
    word = get_object_or_404(DuchMindWord, id=word_id)
    if "enabled" in request.data:
        word.enabled = bool(request.data["enabled"])
    if "note" in request.data:
        word.note = (request.data.get("note") or "")[:120]
    word.save()
    return Response({"id": word.id, "enabled": word.enabled, "note": word.note})


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def dm_delete_word(request, word_id):
    word = get_object_or_404(DuchMindWord, id=word_id)
    word.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def dm_remove_word_by_card(request):
    """Remove a card from a system pack by (pack_id, card_pk) — used by the
    browse-all grid where the UI only knows the card id, not the
    DuchMindWord row id."""
    pack = _admin_pack(request)
    if pack is None:
        return Response({"error": "단어장을 찾을 수 없습니다."}, status=400)
    card_pk = request.data.get("card_pk") or request.data.get("card_id")
    if not card_pk:
        return Response({"error": "card_pk가 필요합니다."}, status=400)
    try:
        n, _ = DuchMindWord.objects.filter(pack=pack, card_id=int(card_pk)).delete()
    except (TypeError, ValueError):
        return Response({"error": "card_pk가 유효하지 않습니다."}, status=400)
    return Response({"ok": True, "removed": n})


# ============================================================================
# DuchMind Word Pack management — user-owned packs + default pack
# ============================================================================

def _pack_summary(p, request_user=None):
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "series": getattr(p, "series", "yugioh"),
        "owner_id": p.owner_id,
        "owner_name": p.owner.username if p.owner else None,
        "is_default": p.is_default,
        "is_public": p.is_public,
        "is_mine": (request_user is not None and p.owner_id == getattr(request_user, "id", None)),
        "can_edit": (request_user is not None and _pack_can_edit(p, request_user)),
        "entry_count": p.entries.count(),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dm_pack_list(request):
    """List packs visible to the user. Yugioh system packs (owner=None,
    series=yugioh) — the tier defaults 초급 / 중급 / 고급 etc — are
    surfaced to everyone in read-only mode; can_edit on the summary still
    gates write actions to staff. Non-yugioh system packs (pokemon etc)
    stay hidden from this list — they're picker-only via ?for_game=1.
    Users additionally see packs they own."""
    from django.db.models import Q, Case, When, IntegerField, Value
    Pack = DuchMindWord._meta.get_field("pack").related_model
    base = Q(owner=request.user) | Q(owner__isnull=True, series="yugioh")
    # Game-time pack picker (room create/edit) also includes other-series
    # system packs flagged is_public=True, so the secret pokemon pack can
    # still be picked for a room without polluting the My Page list.
    if request.query_params.get("for_game") in ("1", "true", "True"):
        base = base | Q(owner__isnull=True, is_public=True)
    # Explicit tier order — Korean default order (가나다) puts 고급 before
    # 중급 alphabetically, which is wrong. Hardcode 초급 / 중급 / 고급.
    tier_order = Case(
        When(name="초급", then=Value(0)),
        When(name="중급", then=Value(1)),
        When(name="고급", then=Value(2)),
        default=Value(99),
        output_field=IntegerField(),
    )
    pack_qs = Pack.objects.filter(base).distinct().order_by(tier_order, "name")
    return Response({"packs": [_pack_summary(p, request.user) for p in pack_qs]})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dm_pack_create(request):
    Pack = DuchMindWord._meta.get_field("pack").related_model
    name = (request.data.get("name") or "").strip()
    if not name:
        return Response({"error": "이름을 입력하세요."}, status=400)
    if len(name) > 80:
        name = name[:80]
    description = (request.data.get("description") or "")[:200]
    is_public = bool(request.data.get("is_public", False))
    series = (request.data.get("series") or "yugioh").strip()
    if series not in ("yugioh", "pokemon"):
        series = "yugioh"
    pack = Pack.objects.create(
        name=name,
        description=description,
        series=series,
        owner=request.user,
        is_default=False,
        is_public=is_public,
    )
    return Response(_pack_summary(pack, request.user), status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dm_pack_detail(request, pack_id):
    from django.db.models import Q
    Pack = DuchMindWord._meta.get_field("pack").related_model
    visible = Q(is_default=True) | Q(owner=request.user)
    if getattr(request.user, "is_staff", False):
        visible = visible | Q(owner__isnull=True)
    pack = get_object_or_404(Pack.objects.filter(visible), id=pack_id)
    if getattr(pack, "series", "yugioh") == "pokemon":
        entries = pack.entries.select_related("pokemon").exclude(pokemon__isnull=True)
        items = [
            {
                "id": w.id,
                "card_id": w.pokemon.dex_number,
                "card_pk": w.pokemon_id,
                "name": w.pokemon.name_ko,
                "image_url": w.pokemon.image_url or None,
                "enabled": w.enabled,
            }
            for w in entries
        ]
    else:
        entries = pack.entries.select_related("card").exclude(card__isnull=True)
        items = [
            {
                "id": w.id,
                "card_id": w.card.card_id,
                "card_pk": w.card_id,
                "name": w.card.korean_name or w.card.name,
                "image_url": w.card.card_illust.url if w.card.card_illust else None,
                "enabled": w.enabled,
            }
            for w in entries
        ]
    return Response({"pack": _pack_summary(pack, request.user), "entries": items})


def _pack_can_edit(pack, user):
    # System packs (owner is None) — includes the default 초급 pack plus
    # any other staff-curated tiers like 중급 / 고급 — are editable by
    # staff only. User-owned packs are editable by their owner.
    if pack.owner_id is None:
        return getattr(user, "is_staff", False)
    return pack.owner_id == user.id


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def dm_pack_update(request, pack_id):
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "이 단어장을 편집할 권한이 없습니다."}, status=403)
    if "name" in request.data:
        n = (request.data.get("name") or "").strip()
        if n:
            pack.name = n[:80]
    if "description" in request.data:
        pack.description = (request.data.get("description") or "")[:200]
    if "is_public" in request.data and not pack.is_default:
        pack.is_public = bool(request.data["is_public"])
    pack.save()
    return Response(_pack_summary(pack, request.user))


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def dm_pack_delete(request, pack_id):
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if pack.is_default:
        return Response({"error": "기본 단어장은 삭제할 수 없습니다."}, status=403)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "이 단어장을 삭제할 권한이 없습니다."}, status=403)
    pack.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dm_pack_add_card(request, pack_id):
    """Add a single entry to a pack. card_pk references Card.id for yugioh
    packs, PokemonCard.id for pokemon packs."""
    from card.models import Card
    from .models import PokemonCard
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "권한 없음"}, status=403)
    card_pk = request.data.get("card_pk") or request.data.get("card_id")
    if not card_pk:
        return Response({"error": "card_pk가 필요합니다."}, status=400)

    if getattr(pack, "series", "yugioh") == "pokemon":
        try:
            pokemon = PokemonCard.objects.get(pk=int(card_pk))
        except (PokemonCard.DoesNotExist, ValueError, TypeError):
            return Response({"error": "포켓몬을 찾을 수 없습니다."}, status=404)
        word, created = DuchMindWord.objects.get_or_create(
            pack=pack, pokemon=pokemon,
            defaults={"created_by": request.user},
        )
        return Response({
            "id": word.id, "card_id": pokemon.dex_number, "name": pokemon.name_ko, "created": created,
        }, status=201 if created else 200)
    else:
        try:
            card = Card.objects.get(pk=int(card_pk))
        except (Card.DoesNotExist, ValueError, TypeError):
            return Response({"error": "카드를 찾을 수 없습니다."}, status=404)
        word, created = DuchMindWord.objects.get_or_create(
            pack=pack, card=card,
            defaults={"created_by": request.user},
        )
        return Response({
            "id": word.id, "card_id": card.card_id, "name": card.korean_name, "created": created,
        }, status=201 if created else 200)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def dm_pack_remove_word(request, pack_id, word_id):
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "권한 없음"}, status=403)
    word = get_object_or_404(DuchMindWord, id=word_id, pack=pack)
    word.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dm_pack_remove_card(request, pack_id):
    """Remove a word from a pack by card_pk (yugioh only). The browse-cards
    grid toggles inclusion per-card and only knows the card pk — this lets
    it remove without first fetching the word id."""
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "권한 없음"}, status=403)
    card_pk = request.data.get("card_pk")
    if not card_pk:
        return Response({"error": "card_pk가 필요합니다."}, status=400)
    try:
        removed, _ = DuchMindWord.objects.filter(pack=pack, card_id=int(card_pk)).delete()
    except (TypeError, ValueError):
        return Response({"error": "card_pk 형식 오류"}, status=400)
    return Response({"ok": True, "removed": removed})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dm_pack_import(request, pack_id):
    """Bulk add entries by exact Korean name match (skribbl-style CSV).
    Branches on pack.series."""
    from card.models import Card
    from .models import PokemonCard
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "권한 없음"}, status=403)
    raw = request.data.get("text") or ""
    names = [s.strip() for s in raw.replace("\n", ",").replace("\t", ",").split(",")]
    names = [n for n in names if n]
    added = 0
    skipped = 0
    not_found = []

    if getattr(pack, "series", "yugioh") == "pokemon":
        used = set(pack.entries.exclude(pokemon__isnull=True).values_list("pokemon_id", flat=True))
        for n in names:
            p = PokemonCard.objects.filter(name_ko=n).first()
            if not p:
                not_found.append(n)
                continue
            if p.id in used:
                skipped += 1
                continue
            DuchMindWord.objects.create(pack=pack, pokemon=p, created_by=request.user)
            used.add(p.id)
            added += 1
    else:
        used = set(pack.entries.exclude(card__isnull=True).values_list("card_id", flat=True))
        for n in names:
            c = Card.objects.filter(korean_name=n).first()
            if not c:
                not_found.append(n)
                continue
            if c.id in used:
                skipped += 1
                continue
            DuchMindWord.objects.create(pack=pack, card=c, created_by=request.user)
            used.add(c.id)
            added += 1
    return Response({"added": added, "skipped": skipped, "not_found": not_found})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dm_pack_export(request, pack_id):
    """Return the pack as a comma-separated string of card names (skribbl format).
    Branches on pack.series — yugioh exports card.korean_name, pokemon exports
    pokemon.name_ko."""
    from django.db.models import Q
    Pack = DuchMindWord._meta.get_field("pack").related_model
    visible = Q(is_default=True) | Q(owner=request.user)
    if getattr(request.user, "is_staff", False):
        visible = visible | Q(owner__isnull=True)
    pack = get_object_or_404(Pack.objects.filter(visible), id=pack_id)
    if getattr(pack, "series", "yugioh") == "pokemon":
        names = list(pack.entries.select_related("pokemon").values_list("pokemon__name_ko", flat=True))
    else:
        names = list(pack.entries.select_related("card").values_list("card__korean_name", flat=True))
    return Response({
        "name": pack.name,
        "csv": ",".join(n for n in names if n),
        "count": len(names),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dm_pack_search_cards(request, pack_id):
    """Search cards by name to add to a specific pack (excludes already-in-pack
    cards). Branches on pack.series — yugioh searches Card, pokemon searches
    PokemonCard."""
    from card.models import Card
    from .models import PokemonCard
    Pack = DuchMindWord._meta.get_field("pack").related_model
    pack = get_object_or_404(Pack, id=pack_id)
    if not _pack_can_edit(pack, request.user):
        return Response({"error": "권한 없음"}, status=403)
    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response({"results": []})

    if getattr(pack, "series", "yugioh") == "pokemon":
        used = set(pack.entries.exclude(pokemon__isnull=True).values_list("pokemon_id", flat=True))
        qs = PokemonCard.objects.filter(name_ko__icontains=q).exclude(id__in=used)[:50]
        results = [
            {
                "id": p.id,
                "card_id": p.dex_number,  # reused field name for client compatibility
                "name": p.name_ko,
                "image_url": p.image_url or None,
            }
            for p in qs
        ]
    else:
        used = set(pack.entries.exclude(card__isnull=True).values_list("card_id", flat=True))
        qs = Card.objects.filter(korean_name__icontains=q).exclude(id__in=used)[:50]
        results = [
            {
                "id": c.id, "card_id": c.card_id,
                "name": c.korean_name or c.name,
                "image_url": c.card_illust.url if c.card_illust else None,
            }
            for c in qs
        ]
    return Response({"results": results})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def pokemon_search(request):
    """In-game pokemon name lookup (counterpart to /api/search/ for cards).
    Returns up to 50 PokemonCard rows whose name_ko matches the query."""
    from .models import PokemonCard
    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response({"results": []})
    qs = PokemonCard.objects.filter(name_ko__icontains=q)[:50]
    results = [
        {
            "id": p.id,
            "card_id": p.dex_number,
            "name": p.name_ko,
            "image_url": p.image_url or None,
        }
        for p in qs
    ]
    return Response({"results": results})


