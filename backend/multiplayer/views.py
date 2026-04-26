from django.contrib.auth.hashers import make_password, check_password
from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import Room, RoomPlayer
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
    return Response(RoomDetailSerializer(room).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([AllowAny])
def get_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def join_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    user = request.user

    if room.status == "closed":
        return Response({"error": "종료된 방입니다."}, status=400)

    # Already a member? Skip password / kick / full checks (re-entering own session).
    existing = RoomPlayer.objects.filter(room=room, user=user).first()
    if existing:
        return Response(RoomDetailSerializer(room).data)

    if user.id in (room.kicked_user_ids or []):
        return Response({"error": "강퇴된 유저입니다."}, status=403)

    if room.is_full():
        return Response({"error": "방이 가득 찼습니다."}, status=400)

    raw_password = request.data.get("password", "") or ""
    if room.has_password and not check_password(raw_password, room.password):
        return Response({"error": "비밀번호가 틀렸습니다."}, status=403)

    # Block if user is already in another active room
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

    try:
        with transaction.atomic():
            player = RoomPlayer.objects.create(room=room, user=user)
    except Exception as e:
        return Response({"error": f"입장 실패: {e}"}, status=400)

    events.player_joined(room.id, RoomPlayerSerializer(player).data)
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def leave_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    user = request.user
    player = RoomPlayer.objects.filter(room=room, user=user).first()
    if player is None:
        return Response({"error": "방에 참가하지 않았습니다."}, status=400)

    was_host = (room.host_id == user.id)
    player_id = player.id

    with transaction.atomic():
        player.delete()

        if was_host:
            # Transfer host to the next remaining player (oldest joined).
            next_host = (
                RoomPlayer.objects.filter(room=room)
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
                # No remaining players — close the room.
                room.status = "closed"
                room.save(update_fields=["status"])

    events.player_left(room.id, player_id)
    if was_host:
        events.room_updated(room.id, RoomDetailSerializer(room).data)

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
def kick_player(request, room_id, player_id):
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 강퇴할 수 있습니다."}, status=403)

    target = get_object_or_404(RoomPlayer, id=player_id, room=room)

    if target.user_id and target.user_id == request.user.id:
        return Response({"error": "자기 자신은 강퇴할 수 없습니다."}, status=400)

    target_id = target.id
    with transaction.atomic():
        if target.user_id:
            ids = list(room.kicked_user_ids or [])
            if target.user_id not in ids:
                ids.append(target.user_id)
                room.kicked_user_ids = ids
        else:
            nicks = list(room.kicked_guest_nicknames or [])
            if target.guest_nickname and target.guest_nickname not in nicks:
                nicks.append(target.guest_nickname)
                room.kicked_guest_nicknames = nicks
        room.save(update_fields=["kicked_user_ids", "kicked_guest_nicknames"])
        target.delete()

    events.player_kicked(room.id, target_id)
    return Response({"ok": True})
