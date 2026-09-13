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
    md_deck_id = str((obj.payload or {}).get("md_deck_id") or "")
    if md_deck_id and match.deck_id:
        TrackerDeckMap.objects.update_or_create(user=user, md_deck_id=md_deck_id, defaults={"deck_id": match.deck_id})
    return obj


def serialize_pending(obj):
    return {"id": obj.id, "did": obj.did, "status": obj.status, "created_at": obj.created_at, **(obj.payload or {})}
