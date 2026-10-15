"""Deck inference for the PC tracker: card IDs (Konami cid == base Master Duel id == carddb.Card.id) → site decks."""
from collections import Counter, defaultdict
from types import SimpleNamespace

from card.models import CardIdAlias
from carddb.display import display_name
from carddb.models import Card, CardGroup, CardGroupMember, CardSupport, MdPrint
from deck.models import CardDeckOverride, Deck, DeckCard, DeckCardGroup, DeckInferencePriority
from .learned import learned_decks

# 지엽적인 카드에 더 큰 표를 준다 (특이점 2026-09-29). 기록된 듀얼에서 그 카드가 보였을 때 실제로 자기 테마 덱이었던
# 비율이 SPEC_FULL_SHARE 이상이면 표 1, 그보다 낮으면 비례해서 줄인다(최소 SPEC_FLOOR). 기록이 SPEC_MIN_GAMES 판
# 미만이면 판단 근거가 없으니 엑스트라 덱 몬스터는 EXTRA_PRIOR, 메인 덱 카드는 1로 본다(액세스코드 토커 같은 범용 엑덱).
SPEC_MIN_GAMES = 5
SPEC_FULL_SHARE = 0.6
SPEC_FLOOR = 0.1
EXTRA_PRIOR = 0.6
EXTRA_FRAME_WORDS = ("fusion", "synchro", "xyz", "link")
# 엔진 덱이라고 뒤로 보내지 않는다 — 9/15의 엔진 강등은 10/15 특이점 결정으로 없앴다("케이스 바이 케이스").
# 섞어 쓰는 덱 쌍은 덱 인식 우선순위(DeckInferencePriority)로 하나씩 정한다.
# 이 덱들의 카드는 다른 덱에 섞여도 순수 구축이 압도적이라 표를 줄이지 않는다
FULL_WEIGHT_DECKS = {"낙인"}

# 상대 덱은 확신이 없으면 제안하지 않는다 = 레코더가 모름/기타로 기록 (특이점 2026-10-03). 9/30~10/3 기록 1,840판에서
# 1순위 근거가 엑스트라 덱 카드뿐이거나(다른 덱 카드가 묘지로 보낸 것일 수 있음) 1순위 표가 전체의 절반 미만이면
# 이용자가 다른 덱으로 고친 비율이 약 20%였고, 그 밖은 3.6%였다.
OPP_MIN_SHARE = 0.5

# 서포트 카드(이름에 그 카드군이 없는데 효과문이 언급하는 카드, 엘리스 2026-10-11)의 표는 구성원 표에 이 비율을 곱한다.
SUPPORT_WEIGHT = 1.0

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
    """{konami id: {deck id: weight}} for the cards that vote: the decks linked to the 카드군 each card is in and, at
    SUPPORT_WEIGHT, to the ones it supports (서포트), each with the groups above it (a group under another is part of
    it); and the decks built on a card (DeckCard) — the card itself and cards bearing its name in full, cards naming
    it at SUPPORT_WEIGHT. Once per deck at its strongest link. A CardDeckOverride sets a card's decks instead. A card
    in or supporting no linked 카드군 still votes, for no deck (its deck isn't on the site); a card touching no
    카드군, or overridden to no deck (a generic card), doesn't."""
    ids = [int(k) for k in kids if str(k).isdigit()]
    member, support = defaultdict(set), defaultdict(set)
    as_card, backs = defaultdict(set), defaultdict(set)   # the cards each counts as / names
    for cid in ids:
        as_card[cid].add(cid)
    for cid, gid in CardGroupMember.objects.filter(card_id__in=ids).exclude(how=CardGroupMember.How.REMOVED).values_list("card_id", "group_id"):
        member[cid].add(gid)
    for cid, gid, target, how in CardSupport.objects.filter(card_id__in=ids).values_list("card_id", "group_id", "target_id", "how"):
        if gid:
            support[cid].add(gid)
        elif how == CardSupport.How.NAMED:
            as_card[cid].add(target)
        else:
            backs[cid].add(target)
    parent = dict(CardGroup.objects.values_list("id", "parent_id"))

    def with_above(gids):
        out = set()
        for gid in gids:
            while gid and gid not in out:
                out.add(gid)
                gid = parent.get(gid)
        return out

    reach = {cid: (with_above(member[cid]), with_above(support[cid])) for cid in ids}
    links, card_links = defaultdict(list), defaultdict(list)
    for gid, deck_id, weight in DeckCardGroup.objects.filter(
            group_id__in={g for m, s in reach.values() for g in m | s}).values_list("group_id", "deck_id", "weight"):
        links[gid].append((deck_id, weight))
    for card_id, deck_id, weight in DeckCard.objects.filter(
            in_recorder=True, card_id__in={c for cs in (*as_card.values(), *backs.values()) for c in cs}).values_list("card_id", "deck_id", "weight"):
        card_links[card_id].append((deck_id, weight))
    out = {}
    for cid, (mine, backed) in reach.items():
        sources = [(links[g], 1.0) for g in mine] + [(links[g], SUPPORT_WEIGHT) for g in backed]
        sources += [(card_links[c], 1.0) for c in as_card[cid]] + [(card_links[c], SUPPORT_WEIGHT) for c in backs[cid]]
        if not (mine or backed or any(ls for ls, _ in sources)):
            continue   # touches no 카드군 and no deck's card: no vote at all
        votes = {}
        for decks, scale in sources:
            for deck_id, weight in decks:
                votes[deck_id] = max(votes.get(deck_id, 0.0), weight * scale)
        out[str(cid)] = votes
    overrides = defaultdict(dict)
    for cid, deck_id, weight in CardDeckOverride.objects.filter(card_id__in=ids).values_list("card_id", "deck_id", "weight"):
        overrides[str(cid)].update({deck_id: weight} if deck_id else {})
    out.update(overrides)
    return {k: v for k, v in out.items() if v or k not in overrides}


def infer_decks(card_ids, limit=3):
    """Vote decks from a list of Konami card IDs (duplicates count).

    Returns (candidates, unknown_ids): candidates = [{"deck_id", "name", "score", "share", "is_engine"}] sorted by
    score, share = score / total votes (0..1). Each card votes once, for every deck card_decks gives it; cards with
    no deck contribute nothing. Being an engine deck moves nothing (특이점 2026-10-15); a DeckInferencePriority puts
    its winner over its loser when both show.
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
    has_main = defaultdict(bool)   # does any main-deck card vote for it?
    total = 0.0
    for kid, m in links.items():
        vote = counts[kid] * weights[kid]
        total += vote
        main = not any(w in (cards[kid].frame_type or "") for w in EXTRA_FRAME_WORDS)
        for deck_id, w in m.items():
            scores[deck_id] += vote * w
            has_main[deck_id] = has_main[deck_id] or main
    names = {d: decks[d].name for d in scores}
    engines = {d: decks[d].is_engine for d in scores}
    # a priority puts its winner first only when a card of the winner's own shows, one not also voting for the loser:
    # a card both decks use says nothing of a mix (감옥신 vs 엘펜노츠, 특이점 2026-10-15)
    wins = defaultdict(set)   # winner → the losers it beats in this duel
    for p in DeckInferencePriority.objects.filter(winner_id__in=scores, loser_id__in=scores):
        if any(p.winner_id in m and p.loser_id not in m for m in links.values()):
            wins[p.winner_id].add(p.loser_id)
    beaten = set().union(*wins.values())
    # a beaten loser is part of its winner's deck: it doesn't take the winner's share — its cards count toward it
    # (특이점 2026-10-15)
    covered = dict(scores)
    for kid, m in links.items():
        vote = counts[kid] * weights[kid]
        for winner, losers in wins.items():
            if winner not in m:
                covered[winner] += vote * max((m[l] for l in losers if l in m), default=0.0)

    ranked = sorted(scores.items(), key=lambda kv: (kv[0] in beaten, -kv[1], names[kv[0]]))[:limit]
    if not ranked:
        return learned_decks(resolved, limit), unknown
    return [{"deck_id": d, "name": names[d], "score": round(s, 2), "share": round(min(1.0, covered[d] / total), 3), "is_engine": engines[d],
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
        if any(decks[d].name in FULL_WEIGHT_DECKS for d in links[kid]):
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
