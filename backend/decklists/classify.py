"""Which 도감 deck a deck list is (엘리스 2026-10-17: the board files every list under one, and filters by it): the
recorder's inference over its cards (tracker.inference.infer_decks — card book ids are Konami ids), the first deck
with a main deck card behind it when it holds enough of the votes; the author can pick another, or none."""
from tracker.inference import infer_decks

# the top deck's share of the votes (0..1) under which the cards say no one deck: a half-and-half mix still names
# the bigger half, staples vote for nothing
MIN_SHARE = 0.3


def candidates(main, extra, limit=3):
    """The decks the cards vote for, strongest first, as {"id", "name", "share"}; those only the extra deck says left out."""
    found, _ = infer_decks(list(main) + list(extra), limit)
    return [{"id": c["deck_id"], "name": c["name"], "share": c["share"]} for c in found if not c.get("extra_only")]


def pick(found):
    """The deck the board files the list under, or None."""
    return found[0] if found and found[0]["share"] >= MIN_SHARE else None


def classify(main, extra):
    """The 도감 deck's id for these cards, or None."""
    top = pick(candidates(main, extra, 1))
    return top["id"] if top else None
