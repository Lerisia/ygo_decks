"""Links from site decks to 카드군, drafted from the YGOPRODeck themes the decks used to be tied to.

A theme there often holds a deck's support cards too, so a group is picked when most of its members sit in the
theme (precision); how much of the theme it covers tells how sure the pick is."""
from collections import defaultdict

SURE, CORE, CHECK, NONE = "sure", "core", "check", "none"


def draft():
    from carddb.models import CardGroupMember, MdPrint
    from cardsite.models import LegacyTheme

    from .models import DeckArchetype

    md = set(MdPrint.objects.values_list("card_id", flat=True))
    theme = defaultdict(set)
    for cid, name in LegacyTheme.objects.exclude(archetype="").values_list("card_id", "archetype"):
        if cid in md:
            theme[name].add(cid)
    groups = defaultdict(set)
    for gid, cid in CardGroupMember.objects.exclude(how=CardGroupMember.How.REMOVED).values_list("group_id", "card_id"):
        if cid in md:
            groups[gid].add(cid)
    rows = []
    for da in DeckArchetype.objects.select_related("deck").order_by("deck__name", "name"):
        cards = theme.get(da.name, set())
        cands = sorted(
            ((len(cards & m), len(cards & m) / len(m), len(cards & m) / len(cards), gid)
             for gid, m in groups.items() if cards & m and len(cards & m) / len(m) >= 0.6),
            reverse=True)
        if not cands:
            rows.append({"deck_id": da.deck_id, "deck": da.deck.name, "theme": da.name, "weight": da.weight, "kind": NONE,
                         "group_id": None, "precision": 0.0, "coverage": 0.0, "others": []})
            continue
        _, precision, coverage, gid = cands[0]
        kind = SURE if precision >= 0.9 and coverage >= 0.8 else CORE if precision >= 0.8 else CHECK
        rows.append({"deck_id": da.deck_id, "deck": da.deck.name, "theme": da.name, "weight": da.weight, "kind": kind,
                     "group_id": gid, "precision": round(precision, 2), "coverage": round(coverage, 2),
                     "others": [c[3] for c in cands[1:4]]})
    return rows


def apply(rows, kinds=(SURE,)):
    from .models import DeckCardGroup

    made = 0
    for r in rows:
        if r["kind"] in kinds and r["group_id"]:
            _, created = DeckCardGroup.objects.get_or_create(deck_id=r["deck_id"], group_id=r["group_id"],
                                                             defaults={"weight": r["weight"]})
            made += created
    return made
