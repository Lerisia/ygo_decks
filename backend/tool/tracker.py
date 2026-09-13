"""Deck inference for the PC tracker: card IDs (Konami cid == Card.konami_id) → site decks."""
from collections import Counter, defaultdict

from card.models import Card
from deck.models import DeckArchetype

RANK_NAMES = {1: "rookie", 2: "bronze", 3: "silver", 4: "gold", 5: "platinum", 6: "diamond", 7: "master"}


def rank_code(rank, rate):
    """Master Duel {rank, rate} → MatchRecord.rank code ('gold3'); None if out of range."""
    name = RANK_NAMES.get(rank)
    if not name or not isinstance(rate, int) or rate < 1:
        return None
    return f"{name}{rate}"


def infer_decks(card_ids, limit=3):
    """Vote decks from a list of Konami card IDs (duplicates count).

    Returns (candidates, unknown_ids): candidates = [{"deck_id", "name", "score", "share"}] sorted by score,
    share = score / total votes (0..1). Cards without an archetype contribute nothing.
    """
    counts = Counter(str(c) for c in card_ids if c)
    if not counts:
        return [], []
    cards = {c.konami_id: c for c in Card.objects.filter(konami_id__in=list(counts)).only("konami_id", "archetype")}
    unknown = sorted(int(k) for k in counts if k not in cards and k.isdigit())
    arch_votes = Counter()
    for kid, n in counts.items():
        card = cards.get(kid)
        if card and card.archetype:
            arch_votes[card.archetype] += n
    if not arch_votes:
        return [], unknown
    scores = defaultdict(float)
    names = {}
    for da in DeckArchetype.objects.filter(name__in=list(arch_votes)).select_related("deck"):
        scores[da.deck_id] += arch_votes[da.name] * da.weight
        names[da.deck_id] = da.deck.name
    total = sum(arch_votes.values())
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], names[kv[0]]))[:limit]
    return [{"deck_id": d, "name": names[d], "score": round(s, 2), "share": round(s / total, 3)} for d, s in ranked], unknown
