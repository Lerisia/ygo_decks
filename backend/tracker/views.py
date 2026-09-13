import json
import os
import re
import uuid

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .inference import card_names, infer_decks


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def tracker_infer(request):
    """PC tracker: card ids (Konami cid) for both players → site deck candidates."""
    def _ids(key):
        v = request.data.get(key) or []
        return [int(x) for x in v if str(x).isdigit()]

    out = {}
    for key in ("my", "opp"):
        ids = _ids(f"{key}_cards")
        cands, unknown = infer_decks(ids)
        out[key] = {"candidates": cands, "unknown_ids": unknown, "cards": card_names(ids)}
    return Response(out)


@api_view(["POST"])
@permission_classes([AllowAny])
def tracker_snapshot(request):
    """Collector build of the tracker: store a raw game snapshot (JSON) for schema research.
    Auth: X-Tracker-Key header must equal settings.TRACKER_SNAPSHOT_KEY (unset → endpoint disabled)."""
    key = getattr(settings, "TRACKER_SNAPSHOT_KEY", "")
    if not key or request.headers.get("X-Tracker-Key") != key:
        return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
    body = request.data
    if not isinstance(body, dict):
        return Response({"error": "json object expected"}, status=status.HTTP_400_BAD_REQUEST)
    tag = re.sub(r"[^A-Za-z0-9_-]", "", str(body.get("tag") or "snapshot"))[:40] or "snapshot"
    sender = re.sub(r"[^A-Za-z0-9_-]", "", str(body.get("sender") or "anon"))[:40] or "anon"
    out_dir = os.path.join(settings.BASE_DIR, "data", "tracker_snapshots")
    os.makedirs(out_dir, exist_ok=True)
    name = f"{timezone.now().strftime('%Y%m%d_%H%M%S')}_{sender}_{tag}_{uuid.uuid4().hex[:6]}.json"
    with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=1)
    return Response({"stored": name}, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def pending_matches(request):
    """GET: this user's games waiting for confirmation. POST (tracker): upload/refresh one captured game."""
    from .models import TrackerPendingMatch
    from .services import serialize_pending, upsert_pending

    if request.method == "GET":
        qs = TrackerPendingMatch.objects.filter(user=request.user, status="pending")
        return Response([serialize_pending(o) for o in qs])
    try:
        obj, created = upsert_pending(request.user, request.data)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(serialize_pending(obj), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def pending_discard(request, pending_id):
    from .models import TrackerPendingMatch

    obj = TrackerPendingMatch.objects.filter(user=request.user, id=pending_id).first()
    if not obj:
        return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
    if obj.status == "pending":
        obj.status = "discarded"
        obj.save(update_fields=["status", "updated_at"])
    return Response({"id": obj.id, "status": obj.status})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def games(request):
    """Tracker: archive one captured duel (full decklist + revealed opponent cards). Idempotent per did."""
    from .services import upsert_game

    try:
        obj, created = upsert_game(request.user, request.data)
    except (ValueError, TypeError) as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"id": obj.id, "did": obj.did}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
