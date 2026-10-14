"""The rules of a deck list, as Master Duel's deck editor keeps them (엘리스 2026-10-14: "저장과 규칙부터"). Some a
saved deck may not break (its zones' sizes, 3 of a name, tokens, extra deck monsters in the extra deck); the rest it
is only told about, as the game tells a deck that a later 금제 has made unusable: fewer than 40 in the main, more of a
card than today's list allows."""
from collections import Counter

from django.utils import timezone

from carddb import banlist
from carddb.display import display_name
from carddb.models import Banlist, Card

MAIN_MIN, MAIN_MAX, EXTRA_MAX, COPIES_MAX = 40, 60, 15, 3
EXTRA_FRAMES = ("fusion", "synchro", "xyz", "link")
LIMIT = {"forbidden": 0, "limited": 1, "semi_limited": 2}
LIMIT_WORD = {"limited": "제한", "semi_limited": "준제한"}


class DeckError(ValueError):
    """A rule a saved deck may not break; its message is shown as it is."""


def is_extra(card):
    return card.frame.startswith(EXTRA_FRAMES)


def check(main, extra):
    """The deck's cards by id, or DeckError naming the first rule it breaks."""
    for zone, ids, most in (("메인 덱", main, MAIN_MAX), ("엑스트라 덱", extra, EXTRA_MAX)):
        if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
            raise DeckError(f"{zone}의 카드가 올바르지 않습니다.")
        if len(ids) > most:
            raise DeckError(f"{zone}은 {most}장까지입니다.")
    cards = Card.objects.in_bulk(set(main) | set(extra))
    if len(cards) < len(set(main) | set(extra)):
        raise DeckError("없는 카드가 들어 있습니다.")
    for ids, extra_zone in ((main, False), (extra, True)):
        for i in set(ids):
            c = cards[i]
            if c.frame == "token":
                raise DeckError("토큰은 덱에 넣을 수 없습니다.")
            if is_extra(c) != extra_zone:
                raise DeckError(f"{display_name(c)}: {'엑스트라 덱' if is_extra(c) else '메인 덱'}에 넣는 카드입니다.")
    copies = Counter(display_name(cards[i]) for i in main + extra)
    for name, n in copies.items():
        if n > COPIES_MAX:
            raise DeckError(f"{name}: 같은 이름의 카드는 {COPIES_MAX}장까지 넣을 수 있습니다.")
    return cards


def issues(main, extra):
    """What keeps a saved deck from being played today, in words: too few in the main, then each card over today's
    Master Duel list in the deck's order."""
    out = []
    if len(main) < MAIN_MIN:
        out.append(f"메인 덱이 {MAIN_MIN}장보다 적습니다 ({len(main)}/{MAIN_MIN}).")
    statuses = banlist.current_statuses(Banlist.Format.MD, timezone.localdate())
    cards = Card.objects.in_bulk(set(main) | set(extra))
    copies = Counter(main + extra)
    seen = set()
    for i in sorted(copies, key=lambda i: (LIMIT.get(statuses.get(i), COPIES_MAX), display_name(cards[i]))):
        status = statuses.get(i)
        if status not in LIMIT or copies[i] <= LIMIT[status] or i in seen:
            continue
        seen.add(i)
        name = display_name(cards[i])
        if status == "forbidden":
            out.append(f"{name}: 금지 카드입니다.")
        else:
            out.append(f"{name}: {LIMIT_WORD[status]} 카드는 {LIMIT[status]}장까지입니다 ({copies[i]}장).")
    return out
