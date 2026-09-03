import re
from collections import defaultdict
from datetime import timedelta

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response

from .models import PageView

VISITOR_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_PATH = 200
MAX_DURATION_SEC = 30 * 60
DEFAULT_DAYS, MAX_DAYS = 14, 90


@api_view(["POST"])
@permission_classes([AllowAny])
def pageview_beacon(request):
    data = request.data
    visitor = str(data.get("visitor_id") or "")
    path = str(data.get("path") or "").split("?", 1)[0].split("#", 1)[0]
    if not VISITOR_RE.match(visitor) or not path.startswith("/") or len(path) > MAX_PATH:
        return Response({"error": "invalid beacon"}, status=400)
    try:
        duration_ms = int(data.get("duration_ms") or 0)
    except (TypeError, ValueError):
        duration_ms = 0
    duration_sec = max(0, min(duration_ms // 1000, MAX_DURATION_SEC))
    pv = PageView.objects.create(
        visitor_id=visitor,
        user=request.user if request.user.is_authenticated else None,
        path=path,
        duration_sec=duration_sec,
    )
    return Response({"id": pv.id}, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def pageview_leave(request, pageview_id):
    """Second half of a page visit: set the dwell time on the row created at
    page entry. Visitor id must match so strangers can't edit rows."""
    visitor = str(request.data.get("visitor_id") or "")
    if not VISITOR_RE.match(visitor):
        return Response({"error": "invalid beacon"}, status=400)
    try:
        duration_ms = int(request.data.get("duration_ms") or 0)
    except (TypeError, ValueError):
        duration_ms = 0
    duration_sec = max(0, min(duration_ms // 1000, MAX_DURATION_SEC))
    updated = PageView.objects.filter(id=pageview_id, visitor_id=visitor).update(duration_sec=duration_sec)
    if not updated:
        return Response({"error": "not found"}, status=404)
    return HttpResponse(status=204)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def summary(request):
    try:
        days = int(request.GET.get("days", DEFAULT_DAYS))
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    days = max(1, min(days, MAX_DAYS))

    today = timezone.localdate()
    start_date = today - timedelta(days=days - 1)
    start_dt = timezone.make_aware(timezone.datetime.combine(start_date, timezone.datetime.min.time()))

    rows = PageView.objects.filter(created_at__gte=start_dt).values_list("visitor_id", "path", "duration_sec", "created_at")

    by_day = defaultdict(lambda: {"visitors": set(), "views": 0, "dwell_sec": 0})
    by_path = defaultdict(lambda: {"visitors": set(), "views": 0, "dwell_sec": 0})
    for visitor, path, dur, created in rows:
        d = timezone.localtime(created).date()
        for bucket in (by_day[d], by_path[path]):
            bucket["visitors"].add(visitor)
            bucket["views"] += 1
            bucket["dwell_sec"] += dur

    daily = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        b = by_day.get(d)
        views = b["views"] if b else 0
        dwell = b["dwell_sec"] if b else 0
        daily.append({
            "date": d.isoformat(),
            "visitors": len(b["visitors"]) if b else 0,
            "views": views,
            "dwell_sec": dwell,
            "avg_dwell_sec": round(dwell / views) if views else 0,
        })

    top_pages = sorted(
        ({"path": p, "views": b["views"], "visitors": len(b["visitors"]), "dwell_sec": b["dwell_sec"]} for p, b in by_path.items()),
        key=lambda r: (-r["views"], r["path"]),
    )[:10]

    t = daily[-1]
    return Response({
        "range_days": days,
        "today": {"visitors": t["visitors"], "views": t["views"], "dwell_sec": t["dwell_sec"]},
        "daily": daily,
        "top_pages": top_pages,
    })
