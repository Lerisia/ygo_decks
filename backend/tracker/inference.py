"""Deck inference for the PC tracker: card IDs (Konami cid == Card.konami_id) → site decks."""
from collections import Counter, defaultdict

from card.models import Card, CardIdAlias
from deck.models import DeckArchetype

# 엔진 덱은 다른 덱의 용병으로 섞이는 경우가 많아, 비엔진 덱이 함께 보이면 그쪽을 먼저 제안한다
# (특이점 2026-09-15). 비엔진 후보 점수가 엔진 후보 점수의 이 비율 이상이면 엔진 후보를 뒤로 보낸다.
ENGINE_DEMOTE_MIN_RATIO = 0.2
# 순수 구축이 압도적이라 엔진 표시에도 불구하고 강등하지 않는 덱
ENGINE_ALWAYS_TOP = {"낙인"}

RANK_NAMES = {1: "rookie", 2: "bronze", 3: "silver", 4: "gold", 5: "platinum", 6: "diamond", 7: "master"}


def rank_code(rank, rate):
    """Master Duel {rank, rate} → MatchRecord.rank code ('gold3'); None if out of range."""
    name = RANK_NAMES.get(rank)
    if not name or not isinstance(rate, int) or rate < 1:
        return None
    return f"{name}{rate}"


def resolve_aliases(card_ids):
    """Replace Master Duel-only IDs (alt artworks) with the base card's Konami ID."""
    ids = [int(c) for c in card_ids if str(c).isdigit()]
    if not ids:
        return []
    alias = {a.md_id: int(a.card.konami_id) for a in CardIdAlias.objects.filter(md_id__in=set(ids)).select_related("card") if str(a.card.konami_id).isdigit()}
    return [alias.get(c, c) for c in ids]


def infer_decks(card_ids, limit=3):
    """Vote decks from a list of Konami card IDs (duplicates count).

    Returns (candidates, unknown_ids): candidates = [{"deck_id", "name", "score", "share", "is_engine"}] sorted by
    score, share = score / total votes (0..1). Cards without an archetype contribute nothing. Engine decks drop
    below a non-engine candidate that reaches ENGINE_DEMOTE_MIN_RATIO of their score, but stay in the list.
    """
    counts = Counter(str(c) for c in resolve_aliases(card_ids) if c)
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
    names, engines = {}, {}
    for da in DeckArchetype.objects.filter(name__in=list(arch_votes)).select_related("deck"):
        scores[da.deck_id] += arch_votes[da.name] * da.weight
        names[da.deck_id] = da.deck.name
        engines[da.deck_id] = da.deck.is_engine
    total = sum(arch_votes.values())
    best_plain = max((s for d, s in scores.items() if not engines[d]), default=0.0)

    def demoted(deck_id, score):
        return engines[deck_id] and names[deck_id] not in ENGINE_ALWAYS_TOP and best_plain >= ENGINE_DEMOTE_MIN_RATIO * score

    ranked = sorted(scores.items(), key=lambda kv: (demoted(*kv), -kv[1], names[kv[0]]))[:limit]
    return [{"deck_id": d, "name": names[d], "score": round(s, 2), "share": round(s / total, 3), "is_engine": engines[d]} for d, s in ranked], unknown


def card_names(card_ids):
    """Distinct ids in first-seen order → [{"id", "name", "count"}] using Korean names when available."""
    order, counts = [], Counter()
    for c in resolve_aliases(card_ids):
        if c and c not in counts:
            order.append(c)
        counts[c] += 1
    cards = {c.konami_id: c for c in Card.objects.filter(konami_id__in=[str(c) for c in order]).only("konami_id", "name", "korean_name")}
    out = []
    for c in order:
        card = cards.get(str(c))
        out.append({"id": c, "name": (card.korean_name or card.name) if card else f"#{c}", "count": counts[c]})
    return out
