"""Pending-match lifecycle shared by the tracker API and the record API."""
from .inference import card_names, infer_decks
from .models import TrackerDeckMap, TrackerPendingMatch

CAPTURE_FIELDS = (
    "game_mode", "result", "finish", "coin_win", "first", "my_id", "my_name", "opp_name",
    "rank_before", "rank_after", "rank_code", "wins", "rating_before", "rating_after",
    "turn", "md_deck_id", "my_cards", "opp_cards", "started_at", "ended_at",
)


def build_payload(user, data):
    """Keep the tracker's capture fields and add server-side deck inference / card names."""
    payload = {k: data.get(k) for k in CAPTURE_FIELDS}
    my_cards = [int(c) for c in (data.get("my_cards") or []) if str(c).isdigit()]
    opp_cards = [int(c) for c in (data.get("opp_cards") or []) if str(c).isdigit()]
    payload["my_cards"], payload["opp_cards"] = my_cards, opp_cards
    my_c, _ = infer_decks(my_cards)
    opp_c, _ = infer_decks(opp_cards)
    payload["my_candidates"], payload["opp_candidates"] = my_c, opp_c
    payload["my_card_names"], payload["opp_card_names"] = card_names(my_cards), card_names(opp_cards)
    md_deck_id = str(data.get("md_deck_id") or "")
    mapped = TrackerDeckMap.objects.filter(user=user, md_deck_id=md_deck_id).select_related("deck").first() if md_deck_id else None
    payload["suggested_deck"] = {"deck_id": mapped.deck_id, "name": mapped.deck.name, "source": "remembered"} if mapped \
        else ({**my_c[0], "source": "inferred"} if my_c else None)
    payload["suggested_opp_deck"] = {**opp_c[0], "source": "inferred"} if opp_c else None
    return payload


def upsert_pending(user, data):
    did = str(data.get("did") or "").strip()
    if not did or not did.isdigit():
        raise ValueError("did required")
    payload = build_payload(user, data)
    obj, created = TrackerPendingMatch.objects.get_or_create(user=user, did=did, defaults={"payload": payload})
    if not created and obj.status == "pending":
        obj.payload = payload
        obj.save(update_fields=["payload", "updated_at"])
    return obj, created


def consume_pending(user, pending_id, match):
    """Called after a MatchRecord is saved from a pending item: mark it confirmed and remember the deck mapping."""
    obj = TrackerPendingMatch.objects.filter(user=user, id=pending_id, status="pending").first()
    if not obj:
        return None
    obj.status, obj.match = "confirmed", match
    obj.save(update_fields=["status", "match", "updated_at"])
    link_game(user, obj.did, match)
    md_deck_id = str((obj.payload or {}).get("md_deck_id") or "")
    if md_deck_id and match.deck_id:
        TrackerDeckMap.objects.update_or_create(user=user, md_deck_id=md_deck_id, defaults={"deck_id": match.deck_id})
    return obj


def serialize_pending(obj):
    return {"id": obj.id, "did": obj.did, "status": obj.status, "created_at": obj.created_at, **(obj.payload or {})}


def _dt(value):
    from django.utils.dateparse import parse_datetime
    from django.utils import timezone
    if not value:
        return None
    dt = parse_datetime(str(value))
    if dt is None:
        return None
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def upsert_game(user, data):
    """Archive a captured duel (idempotent per did). Opponent cards may be ints or {id,pos,face} dicts."""
    from .inference import resolve_aliases
    from .models import TrackerGame
    did = str(data.get("did") or "").strip()
    if not did or not did.isdigit():
        raise ValueError("did required")
    my_cards = resolve_aliases(data.get("my_cards") or [])
    opp_raw = data.get("opp_cards") or []
    opp_ids = resolve_aliases([c.get("id") if isinstance(c, dict) else c for c in opp_raw])
    opp_cards = []
    for c, cid in zip(opp_raw, opp_ids):
        if isinstance(c, dict):
            opp_cards.append({"id": cid, "pos": c.get("pos"), "face": c.get("face")})
        else:
            opp_cards.append({"id": cid})
    fields = {
        "game_mode": int(data.get("game_mode") or 0),
        "result": str(data.get("result") or "")[:8],
        "finish": str(data.get("finish") or "")[:32],
        "coin_win": data.get("coin_win"),
        "first": data.get("first"),
        "my_name": str(data.get("my_name") or "")[:64],
        "opp_name": str(data.get("opp_name") or "")[:64],
        "rank_before": data.get("rank_before"),
        "rank_after": data.get("rank_after"),
        "rank_code": str(data.get("rank_code") or "")[:16],
        "wins": data.get("wins"),
        "rating_before": data.get("rating_before"),
        "rating_after": data.get("rating_after"),
        "turn": int(data.get("turn") or 0),
        "md_deck_id": str(data.get("md_deck_id") or "")[:32],
        "my_cards": my_cards,
        "opp_cards": opp_cards,
        "started_at": _dt(data.get("started_at")),
        "ended_at": _dt(data.get("ended_at")),
    }
    obj, created = TrackerGame.objects.update_or_create(user=user, did=did, defaults=fields)
    return obj, created


def link_game(user, did, match):
    """Attach a saved MatchRecord to its raw capture (called from add-match)."""
    from .models import TrackerGame
    did = str(did or "").strip()
    if not did:
        return 0
    return TrackerGame.objects.filter(user=user, did=did).update(match=match)
