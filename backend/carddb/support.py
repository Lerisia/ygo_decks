"""서포트: a card supports a 카드군 when its Japanese text names 「X」 as a group (「X」モンスター, 「X」カード …) and it
is not one of them, and supports a card when the text names that card (「X」を…, 「X」のカード名が記された…). Support of
a group reaches the groups under it (「HERO」 → E・HERO), and support of a card reaches the groups the card is in
(엘리스 2026-10-11). Cards naming many targets are kept whole for now, to be looked at later."""
import re
from collections import defaultdict

from django.db import transaction

from .groups import CHAIN, N, QUOTE_JA, RENAMED_WHILE, TREATED, treated


def mentions(text, own_name):
    """(group texts, card names) a Japanese text names, without its own name, tokens, quoted effects (they match no
    card), cards named only to be left out (「X」以外) and the 「X」 of "treated as" phrases, which make the card one
    of X rather than its support."""
    t = N(text)
    for rx in (TREATED, RENAMED_WHILE):
        t = rx.sub("", t)
    groups, spans = set(), []
    for m in CHAIN.finditer(t):
        groups.update(N(x) for x in re.findall(r"「([^」]+)」", m.group(1)))
        spans.append(m.span(1))
    own, cards = N(own_name), set()
    for m in QUOTE_JA.finditer(t):
        x = N(m.group(1))
        if (not any(a <= m.start() < b for a, b in spans) and x != own and not x.endswith("トークン")
                and not t.startswith("以外", m.end())):
            cards.add(x)
    return groups, cards


def compute():
    """{(card id, ("g", group id) | ("c", card id)): how} for every card."""
    from .models import Card, CardGroup, CardGroupMember, CardSupport, CardText, SrcMd

    How = CardSupport.How
    names = dict(Card.objects.values_list("id", "name_ja"))   # like the groups: every card; pages show those with art
    by_name = {}
    for cid, name in names.items():
        if name:
            by_name.setdefault(N(name), cid)
    rubies = dict(SrcMd.objects.filter(lang="ja").values_list("md_id", "ruby"))
    by_text, children = defaultdict(list), defaultdict(set)
    for gid, text, reading, parent in CardGroup.objects.values_list("id", "text", "reading", "parent_id"):
        by_text[N(text)].append((gid, reading))
        if parent:
            children[parent].add(gid)
    member_of = defaultdict(set)
    for gid, cid in CardGroupMember.objects.exclude(how=CardGroupMember.How.REMOVED).values_list("group_id", "card_id"):
        member_of[cid].add(gid)

    def under(gid):
        for c in children[gid]:
            yield c
            yield from under(c)

    rows = {}
    for cid, mat, eff, pend in CardText.objects.filter(lang="ja", card_id__in=names).values_list(
            "card_id", "materials", "effect", "pendulum_effect"):
        text = "\n".join(s for s in (mat, eff, pend) if s)
        texts, cards = mentions(text, names[cid])
        mine, spelled = member_of[cid], N(names[cid]) + N(rubies.get(cid, ""))
        named = set()
        for x in texts:
            # one text read two ways (「C」 コクーン·チェーン): the one the card's own name spells out, else both
            said = [g for g, reading in by_text[x] if reading and reading != x and reading in spelled]
            named |= {said[0]} if len(said) == 1 else {g for g, _ in by_text[x]}
        # a member naming its own group talks about its own: nothing reaches the groups under it either (a D-HERO
        # naming 「HERO」 is no E・HERO support)
        named -= mine
        # a card bearing another card's name counts as that card (decks built on a card take it in full)
        _, also, renamed = treated(text)
        borne = {by_name.get(N(x)) for x in also | ({renamed} if renamed else set())} - {None, cid}
        found = [(("c", t), How.NAMED) for t in borne]
        found += [(("g", g), How.GROUP) for g in named]
        found += [(("g", g), How.PARENT) for n in named for g in under(n)]
        for x in cards:
            target = by_name.get(x)
            if target is not None and target != cid:
                found.append((("c", target), How.CARD))
                found += [(("g", g), How.CARD_GROUP) for g in member_of[target]]
        for key, how in found:   # strongest first: a group named outright stays "group"
            if not (key[0] == "g" and key[1] in mine):
                rows.setdefault((cid, key), how)
    # A card naming a fellow member of every 카드군 the other is in (엑소시스터 에리스 → 스텔라) is no support: their
    # 카드군 already ties them (엘리스 2026-10-11). Two cards of different groups naming each other (의식 몬스터 ↔
    # 의식 마법) stay each other's support; the card page marks them ⇄.
    for (cid, key), how in list(rows.items()):
        if how == How.CARD and member_of[key[1]] and member_of[key[1]] <= member_of[cid]:
            del rows[(cid, key)]
    return rows


@transaction.atomic
def save(rows):
    from .models import CardSupport

    CardSupport.objects.all().delete()
    CardSupport.objects.bulk_create(
        [CardSupport(card_id=cid, how=how, **({"group_id": ref} if kind == "g" else {"target_id": ref}))
         for (cid, (kind, ref)), how in rows.items()], batch_size=2000)
    counts = defaultdict(int)
    for how in rows.values():
        counts[str(how)] += 1
    return {"supports": len(rows), "cards": len({cid for cid, _ in rows}), **counts}
