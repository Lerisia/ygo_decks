"""Fallback deck guess learned from the opponent decks users recorded for tracker duels."""
import math
from collections import Counter

from django.db import transaction

from deck.models import Deck
from .models import TrackerCardDeckStat, TrackerGame

MIN_CARD_GAMES = 3  # a card seen in fewer labeled duels is noise, not evidence
SMOOTHING = 0.1
MIN_SHARE = 0.7  # below this the learned guess was right under half the time (2026-09-25 check)


def rebuild_card_deck_stats():
    from .inference import resolve_aliases
    counts = Counter()
    games = TrackerGame.objects.filter(match__is_deleted=False, match__opponent_deck__isnull=False).exclude(opp_cards=[])
    for opp_cards, deck_id in games.values_list("opp_cards", "match__opponent_deck_id").iterator():
        ids = [c["id"] if isinstance(c, dict) else c for c in opp_cards]
        counts[(0, deck_id)] += 1
        for kid in set(resolve_aliases(ids)):
            counts[(kid, deck_id)] += 1
    with transaction.atomic():
        TrackerCardDeckStat.objects.all().delete()
        TrackerCardDeckStat.objects.bulk_create(
            [TrackerCardDeckStat(konami_id=k, deck_id=d, games=n) for (k, d), n in counts.items()], batch_size=2000)
    return len(counts)


def learned_decks(konami_ids, limit=3):
    """Naive Bayes over which cards appeared in duels labeled with each deck → candidates like infer_decks."""
    ids = set(konami_ids)
    rows = TrackerCardDeckStat.objects.filter(konami_id__in=ids | {0}).values_list("konami_id", "deck_id", "games")
    prior, per_card = {}, {}
    for kid, deck_id, n in rows:
        if kid == 0:
            prior[deck_id] = n
        else:
            per_card.setdefault(kid, {})[deck_id] = n
    evidence = {k: v for k, v in per_card.items() if sum(v.values()) >= MIN_CARD_GAMES}
    if not evidence or not prior:
        return []
    logp = {d: math.log(n) + sum(math.log((ev.get(d, 0) + SMOOTHING) / (n + 1)) for ev in evidence.values())
            for d, n in prior.items()}
    top = max(logp.values())
    total = sum(math.exp(v - top) for v in logp.values())
    ranked = sorted(logp.items(), key=lambda kv: -kv[1])[:limit]
    if 1 / total < MIN_SHARE:
        return []
    decks = Deck.objects.in_bulk([d for d, _ in ranked])
    return [{"deck_id": d, "name": decks[d].name, "score": 0.0, "share": round(math.exp(v - top) / total, 3),
             "is_engine": decks[d].is_engine, "learned": True} for d, v in ranked if d in decks]
