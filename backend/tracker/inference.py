"""Deck inference for the PC tracker: card IDs (Konami cid == base Master Duel id == carddb.Card.id) → site decks."""
from collections import Counter, defaultdict
from types import SimpleNamespace

from card.models import CardIdAlias
from carddb.display import display_name
from carddb.models import Card, CardGroupMember, MdPrint
from deck.models import CardDeckOverride, Deck, DeckCardGroup, DeckInferencePriority
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

# 상대 덱은 확신이 없으면 제안하지 않는다 = 레코더가 모름/기타로 기록 (특이점 2026-10-03). 9/30~10/3 기록 1,840판에서
# 1순위 근거가 엑스트라 덱 카드뿐이거나(다른 덱 카드가 묘지로 보낸 것일 수 있음) 1순위 표가 전체의 절반 미만이면
# 이용자가 다른 덱으로 고친 비율이 약 20%였고, 그 밖은 3.6%였다.
OPP_MIN_SHARE = 0.5

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
    alias = dict(MdPrint.objects.filter(md_id__in=set(ids)).values_list("md_id", "card_id"))
    rest = set(ids) - set(alias)
    if rest:
        alias.update({a.md_id: int(a.card.konami_id) for a in CardIdAlias.objects.filter(md_id__in=rest).select_related("card")
                      if str(a.card.konami_id).isdigit()})
    return [alias.get(c, c) for c in ids]


def _cards(kids):
    """{konami id: frame_type} for the ids the new card DB knows."""
    ids = [int(k) for k in kids if str(k).isdigit()]
    return {str(cid): SimpleNamespace(frame_type=frame) for cid, frame in Card.objects.filter(id__in=ids).values_list("id", "frame")}


def card_decks(kids):
    """{konami id: {deck id: weight}} for the cards that vote: the decks each card's 카드군 link to, once per deck at
    its strongest link, or the decks a CardDeckOverride sets instead. A card in no linked 카드군 still votes, for
    no deck (its deck isn't on the site); a card in no 카드군, or overridden to no deck (a generic card), doesn't."""
    ids = [int(k) for k in kids if str(k).isdigit()]
    out, groups = {}, defaultdict(set)
    for cid, gid in CardGroupMember.objects.filter(card_id__in=ids).exclude(how=CardGroupMember.How.REMOVED).values_list("card_id", "group_id"):
        groups[gid].add(cid)
        out.setdefault(str(cid), {})
    for gid, deck_id, weight in DeckCardGroup.objects.filter(group_id__in=groups).values_list("group_id", "deck_id", "weight"):
        for cid in groups[gid]:
            out[str(cid)][deck_id] = max(weight, out[str(cid)].get(deck_id, 0.0))
    overrides = defaultdict(dict)
    for cid, deck_id, weight in CardDeckOverride.objects.filter(card_id__in=ids).values_list("card_id", "deck_id", "weight"):
        overrides[str(cid)].update({deck_id: weight} if deck_id else {})
    out.update(overrides)
    return {k: v for k, v in out.items() if v or k not in overrides}


def infer_decks(card_ids, limit=3):
    """Vote decks from a list of Konami card IDs (duplicates count).

    Returns (candidates, unknown_ids): candidates = [{"deck_id", "name", "score", "share", "is_engine"}] sorted by
    score, share = score / total votes (0..1). Each card votes once, for every deck card_decks gives it; cards with
    no deck contribute nothing. Engine decks drop below a non-engine candidate that reaches
    ENGINE_DEMOTE_MIN_RATIO of their score, but stay in the list.
    """
    resolved = resolve_aliases(card_ids)
    counts = Counter(str(c) for c in resolved if c)
    if not counts:
        return [], []
    cards = _cards(counts)
    unknown = sorted(int(k) for k in counts if k not in cards and k.isdigit())
    links = card_decks([k for k in counts if k in cards])
    if not any(links.values()):
        return learned_decks(resolved, limit), unknown
    decks = Deck.objects.in_bulk({d for m in links.values() for d in m})
    weights = card_specificity(links, decks, cards)
    scores = defaultdict(float)
    specific, has_main = defaultdict(float), defaultdict(bool)   # has_main: does any main-deck card vote for it?
    total = 0.0
    for kid, m in links.items():
        vote = counts[kid] * weights[kid]
        total += vote
        main = not any(w in (cards[kid].frame_type or "") for w in EXTRA_FRAME_WORDS)
        for deck_id, w in m.items():
            scores[deck_id] += vote * w
            specific[deck_id] = max(specific[deck_id], weights[kid])
            has_main[deck_id] = has_main[deck_id] or main
    names = {d: decks[d].name for d in scores}
    engines = {d: decks[d].is_engine for d in scores}
    best_plain = max((s for d, s in scores.items() if not engines[d] and specific[d] >= SPECIFIC_MIN), default=0.0)
    beaten = {p.loser_id for p in DeckInferencePriority.objects.filter(winner_id__in=scores, loser_id__in=scores)}

    def demoted(deck_id, score):
        return engines[deck_id] and names[deck_id] not in ENGINE_ALWAYS_TOP and best_plain >= ENGINE_DEMOTE_MIN_RATIO * score

    ranked = sorted(scores.items(), key=lambda kv: (kv[0] in beaten, demoted(*kv), -kv[1], names[kv[0]]))[:limit]
    if not ranked:
        return learned_decks(resolved, limit), unknown
    return [{"deck_id": d, "name": names[d], "score": round(s, 2), "share": round(s / total, 3), "is_engine": engines[d],
             "extra_only": not has_main[d]} for d, s in ranked], unknown


def is_confident(candidate):
    """Is this opponent guess safe to record? Learned guesses are already gated at their own threshold."""
    if candidate.get("learned"):
        return True
    return not candidate.get("extra_only") and candidate["share"] >= OPP_MIN_SHARE


def infer_opponent(card_ids, limit=3):
    """infer_decks for the opponent's revealed cards → (candidates, unsure, unknown_ids).
    When the top guess isn't confident, candidates is empty (the recorder then records 모름/기타) and the guesses
    move to `unsure` so a later client can still offer them as one-click choices."""
    cands, unknown = infer_decks(card_ids, limit)
    if cands and not is_confident(cands[0]):
        return [], cands, unknown
    return cands, [], unknown


def card_specificity(links, decks, cards):
    """Vote weight per card id: how reliably seeing this card meant one of its own decks in recorded duels."""
    from .models import TrackerCardDeckStat
    seen, hits = Counter(), Counter()
    for kid, deck_id, n in TrackerCardDeckStat.objects.filter(konami_id__in=[int(k) for k in links]).values_list("konami_id", "deck_id", "games"):
        k = str(kid)
        seen[k] += n
        if deck_id in links.get(k, {}):
            hits[k] += n
    weights = {}
    for kid in links:
        if any(decks[d].name in ENGINE_ALWAYS_TOP for d in links[kid]):
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
    cards = Card.objects.in_bulk(order)
    out = []
    for c in order:
        card = cards.get(c)
        out.append({"id": c, "name": display_name(card) if card else f"#{c}", "count": counts[c],
                    "frame": card.frame if card else ""})
    return out
