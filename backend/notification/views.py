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
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    """?unread=1: the ones still on My Page; otherwise the whole history, newest first."""
    qs = Notification.objects.filter(user=request.user)
    if request.GET.get("unread") == "1":
        qs = qs.filter(read_at__isnull=True)
    return Response({"notifications": [_row(n) for n in qs[:HISTORY_LIMIT]]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def unread_count(request):
    return Response({"count": Notification.objects.filter(user=request.user, read_at__isnull=True).count()})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dismiss(request, notification_id):
    """Clear it from My Page (X, or following its action); it stays in the history."""
    n = Notification.objects.filter(id=notification_id, user=request.user).first()
    if not n:
        return Response({"error": "알림을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    if n.read_at is None:
        n.read_at = timezone.now()
        n.save(update_fields=["read_at"])
    return Response(_row(n))
