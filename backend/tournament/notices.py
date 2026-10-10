from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Announcement, Entrant

WINDOW_HOURS = 24  # older notices (a room code from yesterday) are not worth popping up
LIMIT = 5


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_announcements(request):
    """Recent announcements from running tournaments the caller has entered, alone or in a team, newest first,
    so the site can pop up things like a Master Duel room code (특이점 2026-10-10). ?after=<id> returns only newer ones."""
    user = request.user
    entered = (
        Entrant.objects.exclude(status__in=["withdrawn", "kicked"])
        .filter(Q(user=user) | Q(members__user=user))
        .values_list("tournament_id", flat=True)
    )
    qs = (
        Announcement.objects.filter(
            tournament_id__in=entered,
            tournament__status__in=["recruiting", "ongoing"],
            created_at__gte=timezone.now() - timedelta(hours=WINDOW_HOURS),
        )
        .exclude(author=user)
        .select_related("tournament")
        .order_by("-id")
    )
    after = request.GET.get("after", "")
    if after.isdigit():
        qs = qs.filter(id__gt=int(after))
    return Response([
        {
            "id": a.id,
            "tournament_id": a.tournament_id,
            "tournament_name": a.tournament.name,
            "content": a.content,
            "created_at": a.created_at.isoformat(),
        }
        for a in qs[:LIMIT]
    ])
