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
from .services import touch_client
from . import version as ver


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def tracker_infer(request):
    """PC tracker: card ids (Konami cid) for both players → site deck candidates."""
    touch_client(request.user, request.headers.get("X-Tracker-Version"))
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
    touch_client(request.user, request.headers.get("X-Tracker-Version"))
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
    touch_client(request.user, request.headers.get("X-Tracker-Version"))
    from .services import upsert_game

    try:
        obj, created = upsert_game(request.user, request.data)
    except (ValueError, TypeError) as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"id": obj.id, "did": obj.did}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def version_info(request):
    """What the tracker should be running; the client checks this at startup."""
    return Response({"latest": ver.LATEST, "min_supported": ver.MIN_SUPPORTED, "url": ver.DOWNLOAD_URL})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def client_status(request):
    """Whether this user's tracker build is out of date (the site warns old builds that can't warn themselves)."""
    from .models import TrackerClient, TrackerGame, TrackerPendingMatch
    c = TrackerClient.objects.filter(user=request.user).first()
    used = bool(c) or TrackerGame.objects.filter(user=request.user).exists() \
        or TrackerPendingMatch.objects.filter(user=request.user).exists()
    v = (c.version if c else "") or None
    return Response({
        "version": v,
        "latest": ver.LATEST,
        "outdated": bool(used and ver.is_outdated(v)),
        "used_tracker": used,
        "url": ver.DOWNLOAD_URL,
        "last_seen": c.last_seen if c else None,
    })


def _rate(w, n):
    return round(w / n * 100, 1) if n else None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def matchup(request):
    """This user's record with one deck, overall and against a specific opponent deck."""
    from deck.models import Deck
    from tool.models import MatchRecord

    deck_id = request.GET.get("deck") or ""
    if not deck_id.isdigit():
        return Response({"error": "deck required"}, status=status.HTTP_400_BAD_REQUEST)
    opp_id = request.GET.get("opponent") or ""
    base = MatchRecord.objects.filter(recorded_by=request.user, deck_id=int(deck_id), is_deleted=False)

    def agg(qs):
        n = qs.count()
        w = qs.filter(result="win").count()
        return {"games": n, "wins": w, "win_rate": _rate(w, n)}

    names = dict(Deck.objects.filter(id__in=[x for x in (deck_id, opp_id) if x.isdigit()]).values_list("id", "name"))
    out = {"deck": names.get(int(deck_id)), "total": agg(base)}
    if opp_id.isdigit():
        m = base.filter(opponent_deck_id=int(opp_id))
        out["opponent"] = names.get(int(opp_id))
        out["matchup"] = agg(m)
        out["first"] = agg(m.filter(first_or_second="first"))
        out["second"] = agg(m.filter(first_or_second="second"))
    return Response(out)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def today(request):
    """Everything the tracker saw for this user since local midnight."""
    from django.utils import timezone

    from .models import TrackerGame

    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    games = list(TrackerGame.objects.filter(user=request.user, ended_at__gte=start).order_by("ended_at"))
    n = len(games)
    w = sum(1 for g in games if g.result == "win")
    firsts = [g for g in games if g.first]
    seconds = [g for g in games if g.first is False]
    out = {
        "games": n, "wins": w, "losses": n - w, "win_rate": _rate(w, n),
        "coin_win_rate": _rate(sum(1 for g in games if g.coin_win), n),
        "first": {"games": len(firsts), "wins": sum(1 for g in firsts if g.result == "win"),
                  "win_rate": _rate(sum(1 for g in firsts if g.result == "win"), len(firsts))},
        "second": {"games": len(seconds), "wins": sum(1 for g in seconds if g.result == "win"),
                   "win_rate": _rate(sum(1 for g in seconds if g.result == "win"), len(seconds))},
        "avg_turns": round(sum(g.turn for g in games) / n, 1) if n else None,
    }
    ranked = [g for g in games if g.game_mode == 3 and g.rank_code]
    if ranked:
        out["rank"] = {"from": ranked[0].rank_code, "to": ranked[-1].rank_code}
    rated = [g for g in games if g.game_mode == 19 and g.rating_after]
    if rated:
        out["rating"] = {"from": rated[0].rating_before or rated[0].rating_after, "to": rated[-1].rating_after}
    return Response(out)
