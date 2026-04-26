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
    RoomPlayerSerializer,
)


def _add_self_as_host(room, user):
    return RoomPlayer.objects.create(room=room, user=user, is_host=True)


@api_view(["GET"])
@permission_classes([AllowAny])
def list_rooms(request):
    """List public, non-closed rooms."""
    rooms = Room.objects.filter(is_listed=True).exclude(status="closed")
    return Response({"rooms": RoomListItemSerializer(rooms, many=True).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_room(request):
    serializer = RoomCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    raw_password = data.pop("password", "") or ""
    with transaction.atomic():
        room = Room.objects.create(
            host=request.user,
            password=make_password(raw_password) if raw_password else "",
            **data,
        )
        _add_self_as_host(room, request.user)
    return Response(RoomDetailSerializer(room).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([AllowAny])
def get_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def join_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    raw_password = request.data.get("password", "") or ""
    guest_nickname = (request.data.get("guest_nickname") or "").strip()

    if room.status == "closed":
        return Response({"error": "종료된 방입니다."}, status=400)

    if room.is_full():
        return Response({"error": "방이 가득 찼습니다."}, status=400)

    if room.has_password and not check_password(raw_password, room.password):
        return Response({"error": "비밀번호가 틀렸습니다."}, status=403)

    user = request.user if request.user.is_authenticated else None

    if user is None:
        if not room.allow_guests:
            return Response({"error": "이 방은 로그인 유저만 입장할 수 있습니다."}, status=403)
        if not guest_nickname or len(guest_nickname) > 20:
            return Response({"error": "유효한 닉네임을 입력하세요 (1~20자)."}, status=400)
        if guest_nickname in (room.kicked_guest_nicknames or []):
            return Response({"error": "강퇴된 닉네임입니다."}, status=403)
    else:
        if user.id in (room.kicked_user_ids or []):
            return Response({"error": "강퇴된 유저입니다."}, status=403)

    # Already in room?
    existing = None
    if user is not None:
        existing = RoomPlayer.objects.filter(room=room, user=user).first()
    elif guest_nickname:
        existing = RoomPlayer.objects.filter(room=room, user__isnull=True, guest_nickname=guest_nickname).first()

    if existing:
        return Response(RoomDetailSerializer(room).data)

    try:
        with transaction.atomic():
            RoomPlayer.objects.create(
                room=room,
                user=user,
                guest_nickname=guest_nickname if user is None else "",
            )
    except Exception as e:
        return Response({"error": f"입장 실패: {e}"}, status=400)

    return Response(RoomDetailSerializer(room).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def leave_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    user = request.user if request.user.is_authenticated else None
    guest_nickname = (request.data.get("guest_nickname") or "").strip()

    qs = RoomPlayer.objects.filter(room=room)
    if user:
        qs = qs.filter(user=user)
    else:
        qs = qs.filter(user__isnull=True, guest_nickname=guest_nickname)

    deleted, _ = qs.delete()
    if deleted == 0:
        return Response({"error": "방에 참가하지 않았습니다."}, status=400)

    # Host left → close room (transfer-of-host can come later)
    if user and room.host_id == user.id:
        room.status = "closed"
        room.save(update_fields=["status"])

    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def kick_player(request, room_id, player_id):
    room = get_object_or_404(Room, id=room_id)
    if room.host_id != request.user.id:
        return Response({"error": "방장만 강퇴할 수 있습니다."}, status=403)

    target = get_object_or_404(RoomPlayer, id=player_id, room=room)

    if target.user_id and target.user_id == request.user.id:
        return Response({"error": "자기 자신은 강퇴할 수 없습니다."}, status=400)

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

    return Response({"ok": True})
