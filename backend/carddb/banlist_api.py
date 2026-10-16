"""The 금제 lists a deck list may be checked by (참혈 2026-10-16): each game's lists by day, and the cards one limits.
Small and the same for everyone, so browsers keep them a while (a new list comes by the morning's import)."""
from django.http import Http404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import banlist

MAX_AGE = "public, max-age=600"
NO_CODE = "없는 금제 코드입니다."


def _kept(body, status=200):
    r = Response(body, status=status)
    r["Cache-Control"] = MAX_AGE
    return r


def _table(j, code=None):
    return {"format": j.format, **({"code": code} if code else {}), "day": j.day and j.day.isoformat(),
            "released_by": j.released_by.isoformat(), "latest": j.latest, "today": timezone.localdate().isoformat(),
            "limits": {str(cid): status for cid, status in j.limits.items()}}


@api_view(["GET"])
@permission_classes([AllowAny])
def banlists(request):
    """{today, lists: {game: [days, newest first]}}."""
    return _kept({"today": timezone.localdate().isoformat(), "lists": banlist.list_days()})


@api_view(["GET"])
@permission_classes([AllowAny])
def banlist_table(request, fmt, which):
    """A game's list by its day, or its newest in effect ("latest"): the cards it limits, and the day a card must be
    out by."""
    key = fmt if which == "latest" else f"{fmt}:{which}"
    j = banlist.judged_by(key) if fmt != "custom" else None
    if j is None:
        raise Http404
    return _kept(_table(j))


@api_view(["GET"])
@permission_classes([AllowAny])
def custom_table(request, code):
    """One of our own lists by its code: none yet (참혈's team makes them); the same shape as a game's when there are."""
    j = banlist.judged_by(f"custom:{code}")
    if j is None:
        return Response({"error": NO_CODE}, status=404)
    return _kept(_table(j, code))
