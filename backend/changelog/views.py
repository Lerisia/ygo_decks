from django.contrib.admin.models import ADDITION, CHANGE, DELETION, LogEntry
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import ChangelogEntry
from .serializers import ChangelogEntrySerializer, ChangelogWriteSerializer


def _visible_entries():
    return ChangelogEntry.objects.filter(published_at__lte=timezone.now())


def _is_staff(request):
    return bool(request.user and request.user.is_authenticated and request.user.is_staff)


def _forbidden(request):
    status = 403 if request.user and request.user.is_authenticated else 401
    return Response({"error": "운영진만 공지를 쓸 수 있습니다."}, status=status)


def _log(request, entry, flag, message):
    # 운영진이 사이트에서 쓴 공지도 관리자 페이지 기록에 남긴다.
    LogEntry.objects.log_actions(
        user_id=request.user.id,
        queryset=ChangelogEntry.objects.filter(id=entry.id),
        action_flag=flag,
        change_message=message,
    )


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def list_entries(request):
    if request.method == "GET":
        # Staff also see scheduled (future) entries so they can check and fix them before they go out.
        entries = ChangelogEntry.objects.all() if _is_staff(request) else _visible_entries()
        return Response(ChangelogEntrySerializer(entries, many=True).data)

    if not _is_staff(request):
        return _forbidden(request)
    ser = ChangelogWriteSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": _first_error(ser.errors)}, status=400)
    entry = ser.save()
    _log(request, entry, ADDITION, "사이트에서 공지 작성")
    return Response(ChangelogEntrySerializer(entry).data, status=201)


@api_view(["PUT", "DELETE"])
@permission_classes([AllowAny])
def entry_detail(request, pk):
    if not _is_staff(request):
        return _forbidden(request)
    entry = get_object_or_404(ChangelogEntry, pk=pk)
    if request.method == "DELETE":
        _log(request, entry, DELETION, f"사이트에서 공지 삭제: {entry.title}")
        entry.delete()
        return Response(status=204)
    ser = ChangelogWriteSerializer(entry, data=request.data, partial=True)
    if not ser.is_valid():
        return Response({"error": _first_error(ser.errors)}, status=400)
    entry = ser.save()
    _log(request, entry, CHANGE, "사이트에서 공지 수정")
    return Response(ChangelogEntrySerializer(entry).data)


def _first_error(errors):
    labels = {"title": "제목", "body": "본문", "published_at": "게시 시각"}
    for field, msgs in errors.items():
        msg = msgs[0] if isinstance(msgs, list) and msgs else msgs
        return f"{labels.get(field, field)}: {msg}"
    return "입력값이 올바르지 않습니다."


@api_view(["GET"])
@permission_classes([AllowAny])
def latest_entry(request):
    entry = _visible_entries().first()
    data = ChangelogEntrySerializer(entry).data if entry else None
    return Response({"entry": data})
