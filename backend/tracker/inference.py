"""Deck inference for the PC tracker: card IDs (Konami cid == Card.konami_id) → site decks."""
from collections import Counter, defaultdict

from card.models import Card, CardIdAlias, CardArchetypeOverride
from deck.models import DeckArchetype, DeckInferencePriority
from .learned import learned_decks

# 지엽적인 카드에 더 큰 표를 준다 (특이점 2026-09-29). 기록된 듀얼에서 그 카드가 보였을 때 실제로 자기 테마 덱이었던
# 비율이 SPEC_FULL_SHARE 이상이면 표 1, 그보다 낮으면 비례해서 줄인다(최소 SPEC_FLOOR). 기록이 SPEC_MIN_GAMES 판
# 미만이면 판단 근거가 없으니 엑스트라 덱 몬스터는 EXTRA_PRIOR, 메인 덱 카드는 1로 본다(액세스코드 토커 같은 범용 엑덱).
SPEC_MIN_GAMES = 5
SPEC_FULL_SHARE = 0.6
SPEC_FLOOR = 0.1
EXTRA_PRIOR = 0.6
EXTRA_FRAME_WORDS = ("fusion", "synchro", "xyz", "link")
# 엔진 덱을 뒤로 미는 근거는 지엽적인 카드(가중치 SPECIFIC_MIN 이상)만 인정한다 — 범용 카드 한 장이 전용 카드를 보인
# 엔진 덱을 밀어내지 않게.
SPECIFIC_MIN = 0.5

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
    resolved = resolve_aliases(card_ids)
    counts = Counter(str(c) for c in resolved if c)
    if not counts:
        return [], []
    cards = {}
    for c in Card.objects.filter(konami_id__in=list(counts)).only("konami_id", "archetype", "frame_type"):
        if c.konami_id not in cards or (c.frame_type and not cards[c.konami_id].frame_type):
            cards[c.konami_id] = c
    unknown = sorted(int(k) for k in counts if k not in cards and k.isdigit())
    overrides = {o.konami_id: o.archetype for o in CardArchetypeOverride.objects.filter(konami_id__in=list(counts))}
    card_arch = {}
    for kid in counts:
        card = cards.get(kid)
        archetype = overrides.get(kid, card.archetype) if card else None
        if archetype:
            card_arch[kid] = archetype
    if not card_arch:
        return learned_decks(resolved, limit), unknown
    arch_rows = defaultdict(list)
    for da in DeckArchetype.objects.filter(name__in=set(card_arch.values())).select_related("deck"):
        arch_rows[da.name].append(da)
    weights = card_specificity(card_arch, arch_rows, cards)
    arch_votes = Counter()
    for kid, archetype in card_arch.items():
        arch_votes[archetype] += counts[kid] * weights[kid]
    arch_specific = defaultdict(float)
    for kid, archetype in card_arch.items():
        arch_specific[archetype] = max(arch_specific[archetype], weights[kid])
    scores = defaultdict(float)
    names, engines, specific = {}, {}, defaultdict(float)
    for archetype, rows in arch_rows.items():
        for da in rows:
            scores[da.deck_id] += arch_votes[archetype] * da.weight
            names[da.deck_id] = da.deck.name
            engines[da.deck_id] = da.deck.is_engine
            specific[da.deck_id] = max(specific[da.deck_id], arch_specific[archetype])
    total = sum(arch_votes.values())
    best_plain = max((s for d, s in scores.items() if not engines[d] and specific[d] >= SPECIFIC_MIN), default=0.0)
    beaten = {p.loser_id for p in DeckInferencePriority.objects.filter(winner_id__in=scores, loser_id__in=scores)}

    def demoted(deck_id, score):
        return engines[deck_id] and names[deck_id] not in ENGINE_ALWAYS_TOP and best_plain >= ENGINE_DEMOTE_MIN_RATIO * score

    ranked = sorted(scores.items(), key=lambda kv: (kv[0] in beaten, demoted(*kv), -kv[1], names[kv[0]]))[:limit]
    if not ranked:
        return learned_decks(resolved, limit), unknown
    return [{"deck_id": d, "name": names[d], "score": round(s, 2), "share": round(s / total, 3), "is_engine": engines[d]} for d, s in ranked], unknown


def card_specificity(card_arch, arch_rows, cards):
    """Vote weight per card id: how reliably seeing this card meant its own theme's deck in recorded duels."""
    from .models import TrackerCardDeckStat
    seen, hits = Counter(), Counter()
    for kid, deck_id, n in TrackerCardDeckStat.objects.filter(konami_id__in=[int(k) for k in card_arch]).values_list("konami_id", "deck_id", "games"):
        k = str(kid)
        seen[k] += n
        if deck_id in {da.deck_id for da in arch_rows.get(card_arch.get(k), [])}:
            hits[k] += n
    weights = {}
    for kid in card_arch:
        if any(da.deck.name in ENGINE_ALWAYS_TOP for da in arch_rows.get(card_arch[kid], [])):
            weights[kid] = 1.0   # 낙인: its cards also get splashed elsewhere, but pure builds dominate — keep full weight
        elif seen[kid] >= SPEC_MIN_GAMES:
            share = (hits[kid] + 1) / (seen[kid] + 2)   # smoothed so one odd label doesn't swing it
            weights[kid] = max(SPEC_FLOOR, min(1.0, share / SPEC_FULL_SHARE))
        else:
            frame = (cards[kid].frame_type or "") if kid in cards else ""
            weights[kid] = EXTRA_PRIOR if any(w in frame for w in EXTRA_FRAME_WORDS) else 1.0
    return weights


def card_names(card_ids):
    """Distinct ids in first-seen order → [{"id", "name", "count"}] using Korean names when available."""
    order, counts = [], Counter()
    for c in resolve_aliases(card_ids):
        if c and c not in counts:
            order.append(c)
        counts[c] += 1
    # duplicate rows exist for some ids; keep the one that knows its frame type
    cards = {}
    for c in Card.objects.filter(konami_id__in=[str(c) for c in order]).only("konami_id", "name", "korean_name", "frame_type"):
        if c.konami_id not in cards or (c.frame_type and not cards[c.konami_id].frame_type):
            cards[c.konami_id] = c
    out = []
    for c in order:
        card = cards.get(str(c))
        out.append({"id": c, "name": (card.korean_name or card.name) if card else f"#{c}", "count": counts[c],
                    "frame": (card.frame_type or "") if card else ""})
    return out
