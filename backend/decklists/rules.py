"""The rules of a deck list, as Master Duel's deck editor keeps them (엘리스 2026-10-14: "저장과 규칙부터"). Some a
saved deck may not break (its zones' sizes, 3 of a name, tokens, extra deck monsters in the extra deck); the rest it
is only told about, as the game tells a deck that a later 금제 has made unusable: fewer than 40 in the main, more of a
card than its list allows, cards not out yet then. The list is the deck's pick (참혈 2026-10-16): a game's newest
(Master Duel's by default), one of its lists by day, one of ours by code, or 무금제 (참혈 2026-10-17). A deck may hold
more of a card than its list allows (참혈 2026-10-17: "금제에 위반되어도 리스트에 투입"); it is only told."""
from collections import Counter

from carddb import banlist
from carddb.display import display_name
from carddb.models import Banlist, Card, MdPrint

MAIN_MIN, MAIN_MAX, EXTRA_MAX, COPIES_MAX = 40, 60, 15, 3
COVERS_MAX = 3
EXTRA_FRAMES = ("fusion", "synchro", "xyz", "link")
LIMIT = {"forbidden": 0, "limited": 1, "semi_limited": 2}
LIMIT_WORD = {"limited": "제한", "semi_limited": "준제한"}
FINISHES = ("normal", "shine", "royal")
ROYAL_RARITIES = {"SR", "UR", ""}   # 로얄 as the card page offers it ("" a print whose rarity is not known)
ZONES = ("main", "extra")


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


def _ints(x):
    return isinstance(x, list) and all(isinstance(i, int) and not isinstance(i, bool) for i in x)


def check_covers(covers, main, extra, copies=None):
    """The deck's 대표 카드 (참혈 2026-10-16): up to 3 of its own cards, each once, and which copy of each (0 the
    first; none said, the first), or DeckError."""
    if not _ints(covers):
        raise DeckError("대표 카드가 올바르지 않습니다.")
    if len(covers) > COVERS_MAX:
        raise DeckError(f"대표 카드는 {COVERS_MAX}장까지입니다.")
    if len(set(covers)) < len(covers):
        raise DeckError("같은 카드를 대표 카드로 두 번 고를 수 없습니다.")
    if not set(covers) <= set(main) | set(extra):
        raise DeckError("대표 카드는 덱에 든 카드에서 고릅니다.")
    copies = [0] * len(covers) if copies is None else copies
    held = Counter(main + extra)
    if not _ints(copies) or len(copies) != len(covers) or not all(0 <= k < held[c] for c, k in zip(covers, copies)):
        raise DeckError("대표 카드가 올바르지 않습니다.")
    return copies


def _prints(ids):
    """{card id: {md id of each of its prints: its rarity}}: its own print and Master Duel's alternate arts, an alternate
    art of unknown rarity taking the card's."""
    base = dict(MdPrint.objects.filter(md_id__in=ids).values_list("md_id", "rarity"))
    out = {i: {i: base.get(i, "")} for i in ids}
    for cid, md, rarity in MdPrint.objects.filter(card_id__in=ids, is_alt_art=True).values_list("card_id", "md_id", "rarity"):
        out[cid][md] = rarity or base.get(cid, "")
    return out


def check_looks(looks, main, extra, cards):
    """Each copy's print and finish (참혈 2026-10-16), lined up with the zones: null (its own print in 일반) or
    {"face": one of the card's prints, "finish": 일반 / 샤인 / 로얄}, 로얄 on an SR or UR print only. A zone left out
    is all plain. Kept without the plain ones: {} when every copy is."""
    if looks is None or looks == {}:
        return {}
    if not isinstance(looks, dict) or set(looks) - set(ZONES):
        raise DeckError("카드 모습이 올바르지 않습니다.")
    prints = None
    out = {}
    for zone, ids in zip(ZONES, (main, extra)):
        got = looks.get(zone)
        got = [None] * len(ids) if got is None else got
        if not isinstance(got, list) or len(got) != len(ids):
            raise DeckError("카드 모습이 올바르지 않습니다.")
        row = []
        for cid, look in zip(ids, got):
            if look is None:
                row.append(None)
                continue
            if (not isinstance(look, dict) or set(look) != {"face", "finish"} or not isinstance(look["face"], int)
                    or isinstance(look["face"], bool) or look["finish"] not in FINISHES):
                raise DeckError("카드 모습이 올바르지 않습니다.")
            prints = prints or _prints(set(main) | set(extra))
            rarity = prints[cid].get(look["face"])
            if rarity is None:
                raise DeckError(f"{display_name(cards[cid])}: 이 카드의 일러스트가 아닙니다.")
            if look["finish"] == "royal" and rarity not in ROYAL_RARITIES:
                raise DeckError(f"{display_name(cards[cid])}: 로얄은 SR·UR 카드만 고를 수 있습니다.")
            plain = look["face"] == cid and look["finish"] == "normal"
            row.append(None if plain else {"face": look["face"], "finish": look["finish"]})
        out[zone] = row
    return out if any(look for row in out.values() for look in row) else {}


def looks_of(d):
    """A saved deck's looks lined up with its cards; a zone whose looks don't line up (saved before them, or a
    tournament's copy changed there) is all plain."""
    looks = d.looks if isinstance(d.looks, dict) else {}
    return {zone: (looks[zone] if isinstance(looks.get(zone), list) and len(looks[zone]) == len(ids) else [None] * len(ids))
            for zone, ids in zip(ZONES, (d.main, d.extra))}


def cover_copies_of(d):
    """Which copy each of a saved deck's 대표 카드 is, the first for those saved before it was kept."""
    copies = d.cover_copies if _ints(d.cover_copies) and len(d.cover_copies) == len(d.cover_cards) else []
    return copies or [0] * len(d.cover_cards)


def check_banlist(key):
    """The 금제 a deck is kept with, or DeckError: a game's newest, a list of its that is there, a code of ours that
    is (none yet), or 무금제."""
    parsed = banlist.parse_key(key)
    if parsed and parsed[0] == "custom" and banlist.custom_list(parsed[2]) is None:
        raise DeckError("없는 금제 코드입니다.")
    if parsed is None or banlist.judged_by(key) is None:
        raise DeckError("없는 금제입니다.")
    return key


def judge_of(key):
    """The list a saved deck is checked by; one gone since (or a code no longer there), its game's newest."""
    parsed = banlist.parse_key(key)
    fallback = parsed[0] if parsed and parsed[0] != "custom" else Banlist.Format.MD
    return banlist.judged_by(key) or banlist.judged_by(fallback)


def issues(main, extra, key="md"):
    """What keeps a saved deck from being played under its 금제, in words: too few in the main, then each card over
    the list (the forbidden first, then by name), then each card not out yet then (미출시), by name."""
    out = []
    if len(main) < MAIN_MIN:
        out.append(f"메인 덱이 {MAIN_MIN}장보다 적습니다 ({len(main)}/{MAIN_MIN}).")
    judge = judge_of(key)
    statuses = judge.limits
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
    later = banlist.not_out(cards, judge.format, judge.released_by) if judge.format else set()
    out += [f"{name}: 미출시 카드입니다." for name in sorted(display_name(cards[i]) for i in later)]
    return out
