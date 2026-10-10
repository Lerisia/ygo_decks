from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Notification

HISTORY_LIMIT = 100


def _row(n):
    return {
        "id": n.id,
        "sender": n.sender,
        "body": n.body,
        "action_label": n.action_label,
        "action_url": n.action_url,
        "created_at": n.created_at.isoformat(),
        "read": n.read_at is not None,
        "acted": n.acted_at is not None,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    """?unread=1: the ones still on My Page; otherwise the whole history, newest first."""
    qs = Notification.objects.filter(user=request.user, hidden_at__isnull=True)
    if request.GET.get("unread") == "1":
        qs = qs.filter(read_at__isnull=True)
    return Response({"notifications": [_row(n) for n in qs[:HISTORY_LIMIT]]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def unread_count(request):
    return Response({"count": Notification.objects.filter(user=request.user, read_at__isnull=True).count()})


def _mark(request, notification_id, *fields):
    """Stamp the given times once (the first time counts); any of them also clears it from My Page."""
    n = Notification.objects.filter(id=notification_id, user=request.user).first()
    if not n:
        return Response({"error": "알림을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    now = timezone.now()
    changed = [f for f in ("read_at", *fields) if getattr(n, f) is None]
    for f in changed:
        setattr(n, f, now)
    if changed:
        n.save(update_fields=changed)
    return Response(_row(n))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dismiss(request, notification_id):
    """X on My Page: off My Page, still in the history."""
    return _mark(request, notification_id)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def act(request, notification_id):
    """The action button was followed; it shows disabled from then on."""
    return _mark(request, notification_id, "acted_at")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def hide(request, notification_id):
    """X on the history page: gone from the member's view, but the row stays on the server."""
    return _mark(request, notification_id, "hidden_at")
