"""카드 도감: the public card list (search, filters, sort, 60 a page) and card documents — Master Duel cards with art."""
import json
from datetime import date, timedelta
import os
import time
import unicodedata
from collections import Counter, defaultdict

from django.conf import settings
from django.db.models import Count, Max
from django.http import Http404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from PIL import Image

from . import banlist
from .display import ART_ORDER, THUMB_DIR as CARD_THUMB_DIR, art_names, art_path, art_url, display_name, thumb_url
from .face import THUMB_DIR as FACE_THUMB_DIR, face_thumb_url, face_url, is_overframe, name_mask_url
from .models import Banlist, BanlistEntry, Card, CardGroup, CardGroupMember, CardSupport, MdPrint, has_art

PAGE_SIZE = 60
IDS_MAX = 200   # ids=…: a deck's cards asked at once (90 at most), all on one page

ATTRIBUTES = {"light": "빛", "dark": "어둠", "water": "물", "fire": "화염", "earth": "땅", "wind": "바람", "divine": "신"}
# Master Duel's finish shaders draw the attribute icon from an atlas: 光 闇 水 炎 / 地 風 神 魔 / 罠
FINISH_TILES = {"light": 0, "dark": 1, "water": 2, "fire": 3, "earth": 4, "wind": 5, "divine": 6, "spell": 7, "trap": 8}
RACES = {
    "dragon": "드래곤족", "spellcaster": "마법사족", "warrior": "전사족", "beast": "야수족", "beast_warrior": "야수전사족",
    "winged_beast": "비행야수족", "dinosaur": "공룡족", "fish": "어류족", "sea_serpent": "해룡족", "reptile": "파충류족",
    "insect": "곤충족", "plant": "식물족", "fairy": "천사족", "fiend": "악마족", "zombie": "언데드족", "machine": "기계족",
    "aqua": "물족", "pyro": "화염족", "thunder": "번개족", "rock": "암석족", "psychic": "사이킥족", "wyrm": "환룡족",
    "cyberse": "사이버스족", "divine_beast": "환신야수족", "illusion": "환상마족",
}
FRAMES = {"normal": "일반", "effect": "효과", "ritual": "의식", "fusion": "융합", "synchro": "싱크로", "xyz": "엑시즈",
          "pendulum": "펜듈럼", "link": "링크", "token": "토큰"}
SPELL_KINDS = {"normal": "일반 마법", "quick_play": "속공 마법", "continuous": "지속 마법", "field": "필드 마법",
               "equip": "장착 마법", "ritual": "의식 마법"}
TRAP_KINDS = {"normal": "일반 함정", "continuous": "지속 함정", "counter": "카운터 함정"}
TYPE_WORDS = {"normal": "일반", "effect": "효과", "tuner": "튜너", "fusion": "융합", "synchro": "싱크로", "xyz": "엑시즈",
              "link": "링크", "pendulum": "펜듈럼", "ritual": "의식", "flip": "리버스", "gemini": "듀얼", "spirit": "스피릿",
              "union": "유니온", "toon": "툰", "special_summon": "특수 소환", "token": "토큰"}
CATEGORIES = {"monster": "몬스터", "spell": "마법", "trap": "함정"}


def _norm(s):
    return "".join(unicodedata.normalize("NFKC", s or "").split()).lower()


CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"


def choseong(s):
    """블랙매지션 → ㅂㄹㅁㅈㅅ (other letters stay as they are)."""
    return "".join(CHOSEONG[(ord(ch) - 0xAC00) // 588] if "가" <= ch <= "힣" else ch for ch in s)


class _Row:
    __slots__ = ("id", "name", "norms", "cho", "released", "category", "frame", "attribute", "race", "numbers", "st",
                 "groups", "supports", "as_cards", "named", "names", "alt", "cutin", "overframe", "rarity", "type_key", "number", "atk",
                 "def_", "ban")


# 디폴트 순, as Master Duel names it (몬마함순; 엘리스 2026-10-12, from the game's list): each monster frame before its pendulum,
# level / rank / link low to high, then the card's number; then spells and traps by kind (the official database's
# order of kinds), tokens last
TYPE_ORDER = {kind: i for i, kind in enumerate(
    ["normal", "normal_pendulum", "effect", "effect_pendulum", "ritual", "ritual_pendulum", "fusion", "fusion_pendulum",
     "synchro", "synchro_pendulum", "xyz", "xyz_pendulum", "link"]
    + [f"spell:{k}" for k in ("normal", "quick_play", "continuous", "equip", "field", "ritual")]
    + [f"trap:{k}" for k in ("normal", "continuous", "counter")] + ["token"])}
RARITY_ORDER = {"N": 0, "R": 1, "SR": 2, "UR": 3}
# Master Duel's sorts (엘리스 10/12), each either way: the value, and whether high to low turns the whole order round
# (newest, name, 디폴트 순) or only the value, equal cards keeping the 디폴트 순 (rarity, level / rank / link, ATK, DEF).
# Cards without the value (None: a spell's level, a link's DEF) come last, in the 디폴트 순.
SORTS = {
    "type": (lambda r: r.type_key, True),
    "new": (lambda r: None if r.released is None else (r.released, r.id), True),
    "name": (lambda r: (r.name, r.id), True),
    "rarity": (lambda r: RARITY_ORDER.get(r.rarity), False),
    "level": (lambda r: r.number, False),
    "atk": (lambda r: r.atk, False),
    "def": (lambda r: r.def_, False),
    # 조회순 (/dev/cards, 참혈 2026-10-14): ordered by _popular_order, as the counts behind it change
    "popular": (None, True),
}
BAN_FILTERS = {"forbidden", "limited", "semi_limited", "unlimited"}
HIGH_FIRST = {"new", "popular"}   # the way a sort goes when none is asked: the newest first, the rest low to high

_index = {"key": None, "at": 0.0, "type": [], "orders": {}, "face_thumbs": set(), "thumbs": set()}
INDEX_MAX_AGE = 600   # seconds; also rebuilt then, for edits the fingerprint can't see (a bare QuerySet.update)


def _files(rel_dir):
    try:
        return {int(f[:-5]) for f in os.listdir(os.path.join(settings.MEDIA_ROOT, rel_dir)) if f[:-5].isdigit()}
    except OSError:
        return set()


def _fingerprint():
    from .models import MdArt
    dirs = []
    for d in (FACE_THUMB_DIR, CARD_THUMB_DIR, "md_ui/cutin/index.json"):
        try:
            dirs.append(os.stat(os.path.join(settings.MEDIA_ROOT, d)).st_mtime)
        except OSError:
            dirs.append(0)
    return (tuple(Card.objects.aggregate(n=Count("id"), t=Max("updated_at")).values()),
            tuple(CardGroupMember.objects.aggregate(n=Count("id"), m=Max("id")).values()),
            tuple(CardSupport.objects.aggregate(n=Count("id"), m=Max("id")).values()),
            tuple(MdArt.objects.aggregate(n=Count("id"), m=Max("id")).values()),
            tuple(MdPrint.objects.aggregate(n=Count("md_id"), d=Max("first_seen"), u=Count("first_seen")).values()),
            # a new 금제 list, or the day one comes into effect
            tuple(BanlistEntry.objects.aggregate(n=Count("id"), m=Max("id")).values()), timezone.localdate(),
            tuple(dirs), settings.MEDIA_ROOT)


def _shown_groups(card_ids=None):
    """Each card's reviewed 카드군 (as its page shows them): {card id: {group id}}."""
    rows = CardGroupMember.objects.filter(group__needs_review=False).exclude(how=CardGroupMember.How.REMOVED)
    if card_ids is not None:
        rows = rows.filter(card_id__in=card_ids)
    out = defaultdict(set)
    for cid, gid in rows.values_list("card_id", "group_id"):
        out[cid].add(gid)
    return out


def _card_index():
    """Every card on the site, with its names normalized once, kept in memory in both list orders and rebuilt only
    when the cards, their 카드군, their art or the thumbnail folders change — a search is a pass over memory."""
    key = _fingerprint()
    if _index["key"] == key and time.monotonic() - _index["at"] < INDEX_MAX_AGE:
        return _index
    supports, as_cards = defaultdict(set), defaultdict(set)   # groups it supports / cards whose list it is in
    named, names = defaultdict(set), defaultdict(set)         # cards whose name it bears / cards it names
    shown = _shown_groups()
    for cid, gid, target, how in CardSupport.objects.values_list("card_id", "group_id", "target_id", "how"):
        if gid:
            supports[cid].add(gid)
        else:
            # a card's support list leaves out its own 카드군, however the card names it (엘리스 10/12)
            if not shown[cid] & shown[target]:
                as_cards[cid].add(target)
            (named if how == CardSupport.How.NAMED else names)[cid].add(target)
    groups = defaultdict(set)
    for cid, gid in CardGroupMember.objects.exclude(how=CardGroupMember.How.REMOVED).values_list("card_id", "group_id"):
        groups[cid].add(gid)
    md_release = dict(MdPrint.objects.filter(is_alt_art=False).exclude(first_seen=None).values_list("md_id", "first_seen"))
    md_rarity = dict(MdPrint.objects.filter(is_alt_art=False).values_list("md_id", "rarity"))
    md_ban = banlist.current_statuses(Banlist.Format.MD, timezone.localdate())
    with_art = art_names()
    alt_of = dict(MdPrint.objects.filter(is_alt_art=True).values_list("md_id", "card_id"))
    alt_cards = {cid for md_id, cid in alt_of.items() if md_id in with_art}
    overframe_cards = {cid for md_id, cid in alt_of.items() if md_id in with_art and _overframe(md_id)}
    cutin_cards = {alt_of.get(md_id, md_id) for md_id in _cutins()}
    rows = []
    for (cid, ko, ja, en, ocg, tcg, kr, category, frame, attribute, race, level, rank, link,
         st, atk, def_value) in Card.objects.filter(has_art()).values_list(
            "id", "name_ko", "name_ja", "name_en", "ocg_date", "tcg_date", "kr_date", "category", "frame", "attribute",
            "race", "level", "rank", "link_rating", "spell_trap_subtype", "atk", "def_value"):
        r = _Row()
        r.id, r.name = cid, ko or ja or en
        r.norms = [_norm(n) for n in (ko, ja, en) if n]
        r.cho = choseong(_norm(ko))
        released = md_release.get(cid) or ocg or tcg or kr   # Master Duel's day first (엘리스 10/11)
        r.released = released.toordinal() if released else None
        r.category, r.frame, r.attribute, r.race, r.st = category, frame, attribute, race, st
        r.numbers = {n for n in (level, rank, link) if n is not None}
        r.groups = groups.get(cid, set())
        r.supports = supports.get(cid, set())
        r.as_cards = as_cards.get(cid, set()) | {cid}
        r.named, r.names = named.get(cid, set()), names.get(cid, set())
        r.alt, r.cutin, r.overframe = cid in alt_cards, cid in cutin_cards, cid in overframe_cards
        r.rarity = md_rarity.get(cid, "")
        r.ban = md_ban.get(cid, "")   # today's Master Duel 금제, for the icon in the card's corner (엘리스 10/12)
        kind = frame if category == "monster" else f"{category}:{st}"
        number = rank if frame.startswith("xyz") else link if frame == "link" else level
        r.type_key = (TYPE_ORDER.get(kind, len(TYPE_ORDER)), number or 0, cid)
        monster = category == "monster"
        r.number, r.atk, r.def_ = (number, atk, def_value) if monster else (None, None, None)
        rows.append(r)
    _index.update(
        key=key, at=time.monotonic(),
        type=sorted(rows, key=lambda r: r.type_key), orders={},
        face_thumbs=_files(FACE_THUMB_DIR), thumbs=_files(CARD_THUMB_DIR),
    )
    return _index


POPULAR_MAX_AGE = 300   # seconds between counts of card page views
REVIEW_GAP = timedelta(minutes=5)   # a person's view of a card counts again only this long after the last counted
_views = {"at": 0.0, "counts": {}, "order": None}


def _card_views():
    """How often each card's page was viewed (analytics page views of /cards/<id>), a person's views of a card
    counting again only five minutes after the last one counted (참혈 2026-10-14), the team left out: its signed-in
    users and any browser seen signed in as one of them. Counted again every five minutes."""
    from analytics.models import PageView
    now = time.time()
    if now - _views["at"] > POPULAR_MAX_AGE:
        team = set(PageView.objects.filter(user__is_staff=True).values_list("visitor_id", flat=True))
        counts, last = Counter(), {}
        for path, visitor, at in (PageView.objects.filter(path__startswith="/cards/").exclude(user__is_staff=True)
                                  .order_by("created_at").values_list("path", "visitor_id", "created_at")):
            tail = path[len("/cards/"):].strip("/")
            if not tail.isdigit() or visitor in team:
                continue
            key = (int(tail), visitor)
            if key not in last or at - last[key] >= REVIEW_GAP:
                counts[key[0]] += 1
                last[key] = at
        _views.update(at=now, counts=dict(counts), order=None)
    return _views["counts"]


def _popular_order(index):
    """조회순: the most viewed cards first, then the newest, then by name."""
    views = _card_views()
    if _views["order"] is None or _views["order"][0] is not index["type"]:
        rows = sorted(index["type"], key=lambda r: (-views.get(r.id, 0), r.released is None, -(r.released or 0), r.name, r.id))
        _views["order"] = (index["type"], rows)
    return _views["order"][1]


def _ordered(index, sort, high_first):
    """Every card in a sort, either way; made once per index (추천순 once per count of views)."""
    if sort == "popular":
        rows = _popular_order(index)
        return rows if high_first else rows[::-1]
    if (sort, high_first) not in index["orders"]:
        value, whole = SORTS[sort]
        have = [r for r in index["type"] if value(r) is not None]
        missing = [r for r in index["type"] if value(r) is None]
        # Python's sort is stable either way round: equal values keep the 디폴트 순 they come in
        have.sort(key=value, reverse=high_first)
        if whole and high_first:
            missing.reverse()
        index["orders"][sort, high_first] = have + missing
    return index["orders"][sort, high_first]


def _deck_tests(deck_id):
    """A deck's 테마 카드 and its 서포트 as two tests on index rows (덱 문서 → 카드 도감, 특이점 2026-10-12) — the card
    page's decks the other way round: cards in the deck's 카드군 or one under them, the card it is built on (DeckCard)
    and cards bearing that card's name; then cards supporting those 카드군 or naming that card, unless already one of
    the first."""
    from deck.models import DeckCard, DeckCardGroup
    linked = set(DeckCardGroup.objects.filter(deck_id=deck_id).values_list("group_id", flat=True))
    parent = dict(CardGroup.objects.values_list("id", "parent_id"))

    def under_linked(gid):
        seen = set()
        while gid and gid not in seen:
            if gid in linked:
                return True
            seen.add(gid)
            gid = parent.get(gid)
        return False

    groups = {gid for gid in parent if under_linked(gid)}
    cards = set(DeckCard.objects.filter(deck_id=deck_id).values_list("card_id", flat=True))

    def member(r):
        return bool(r.groups & groups) or r.id in cards or bool(r.named & cards)

    def support(r):
        return not member(r) and (bool(r.supports & groups) or bool(r.names & cards))

    if not linked and cards:
        # built on a card alone, no 카드군 to split by (빛의 황금궤, 엘리스 10/12): one list, as the card's own support
        # list is — the card, the cards bearing its name and the cards naming it
        return (lambda r: member(r) or support(r)), (lambda r: False), True
    return member, support, False


def deck_card_counts(deck_id):
    """How many 테마 카드 and 서포트 the card book shows for a deck (its page's button); a deck built on a card alone
    has one list (by_card)."""
    member, support, by_card = _deck_tests(deck_id)
    rows = _card_index()["type"]
    counts = {"member": sum(1 for r in rows if member(r)), "support": sum(1 for r in rows if support(r))}
    return {**counts, "by_card": True} if by_card else counts


def _asked_ids(p):
    """ids=1,2,3 → {1, 2, 3} (the first IDS_MAX), or None when not asked."""
    if not p.get("ids"):
        return None
    ids = dict.fromkeys(int(x) for x in str(p["ids"]).split(",") if x.strip().isdigit())
    return set(list(ids)[:IDS_MAX])


def _keep(p):
    """The filters of the query string as one test on an index row."""
    tests = []
    ids = _asked_ids(p)
    if ids is not None:
        tests.append(lambda r, v=ids: r.id in v)
    if p.get("category") in CATEGORIES:
        tests.append(lambda r, v=p["category"]: r.category == v)
    frame = p.get("frame")
    if frame == "pendulum":
        tests.append(lambda r: r.frame.endswith("_pendulum"))
    elif frame in FRAMES:
        tests.append(lambda r, v=(frame, f"{frame}_pendulum"): r.frame in v)
    if p.get("attribute") in ATTRIBUTES:
        tests.append(lambda r, v=p["attribute"]: r.attribute == v)
    if p.get("race") in RACES:
        tests.append(lambda r, v=p["race"]: r.race == v)
    if str(p.get("level", "")).isdigit():
        tests.append(lambda r, v=int(p["level"]): v in r.numbers)
    category, _, kind = str(p.get("st", "")).partition(":")
    if category in ("spell", "trap") and kind:
        tests.append(lambda r, v=(category, kind): (r.category, r.st) == v)
    # cards with another art (다른 일러스트), with a monster cut-in (소환 연출), or with both: has=alt,cutin
    # (엘리스 2026-10-11); with an 오버프레임 print: has=overframe (특이점 2026-10-12)
    has = set(str(p.get("has", "")).split(","))
    if "alt" in has:
        tests.append(lambda r: r.alt)
    if "cutin" in has:
        tests.append(lambda r: r.cutin)
    if "overframe" in has:
        tests.append(lambda r: r.overframe)
    # today's Master Duel 금제, any of several: ban=forbidden,limited (엘리스 10/12); not on the list is unlimited
    bans = {b for b in str(p.get("ban", "")).split(",") if b in BAN_FILTERS}
    if bans:
        tests.append(lambda r, v=bans: (r.ban or "unlimited") in v)
    if str(p.get("card", "")).isdigit():
        # a card's own support list: the card, cards bearing its name and cards naming it (엘리스 2026-10-11)
        tests.append(lambda r, v=int(p["card"]): v in r.as_cards)
    if str(p.get("deck", "")).isdigit():
        member, support, by_card = _deck_tests(int(p["deck"]))
        tests.append(support if p.get("role") == "support" and not by_card else member)
    if str(p.get("group", "")).isdigit():
        # a group's members, or with role=support the cards supporting it (서포트, 엘리스 2026-10-11)
        if p.get("role") == "support":
            tests.append(lambda r, v=int(p["group"]): v in r.supports)
        else:
            tests.append(lambda r, v=int(p["group"]): v in r.groups)
    return lambda r: all(t(r) for t in tests)


def _rank(rows, query):
    """Rows matching the query, exact names first, then names starting with it, then names holding it (shorter names
    first within each); a query of bare 초성 (ㅂㄹㅁㅈㅅ) is matched against the Korean names' 초성."""
    raw = "".join((query or "").split())
    by_cho = bool(raw) and all(ch in CHOSEONG for ch in raw)   # before NFKC, which turns ㅂ into another jamo
    q = raw if by_cho else _norm(query)
    ranked = []
    for i, r in enumerate(rows):
        names = [r.cho] if by_cho else r.norms
        if q in names:
            bucket = 0
        elif any(n.startswith(q) for n in names):
            bucket = 1
        elif any(q in n for n in names):
            bucket = 2
        else:
            continue
        ranked.append((bucket, len(r.norms[0]) if r.norms else 0, i, r))
    return [r for *_, r in sorted(ranked, key=lambda t: t[:3])]


@api_view(["GET"])
@permission_classes([AllowAny])
def cards(request):
    """Card list: filters, then search (exact → prefix → substring over Korean/Japanese/English names, or 초성), in
    the chosen order (SORTS: new = by the day the card came to Master Duel, else its first paper release; name;
    type = 디폴트 순; rarity, level, atk, def), low to high or high to low (dir)."""
    p = request.query_params
    index = _card_index()

    def found(params):
        keep = _keep(params)
        sort = params.get("sort") if params.get("sort") in SORTS else "type"   # 디폴트 순 first (엘리스 10/12)
        way = params.get("dir")
        high_first = way == "desc" if way in ("asc", "desc") else sort in HIGH_FIRST
        rows = [r for r in _ordered(index, sort, high_first) if keep(r)]
        return _rank(rows, params.get("q")) if _norm(params.get("q")) else rows

    rows = found(p)
    try:
        page = max(1, int(p.get("page") or 1))
    except ValueError:
        page = 1
    if _asked_ids(p) is not None:   # a deck's cards (덱 구축, 참혈 2026-10-13): all of them at once
        page, chunk, has_more = 1, rows, False
    else:
        chunk, has_more = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE], page * PAGE_SIZE < len(rows)
    media = settings.MEDIA_URL
    extra = {}
    if str(p.get("group", "")).isdigit():   # a group's list tells how many members and supporters it has
        base = {k: p.get(k) for k in p.keys()}
        extra["group_counts"] = {role: len(found({**base, "role": role})) for role in ("member", "support")}
    if str(p.get("deck", "")).isdigit():   # a deck's list: its name and how many 테마 카드 and 서포트 it has
        from deck.models import Deck
        base = {k: p.get(k) for k in p.keys()}
        by_card = _deck_tests(int(p["deck"]))[2]
        extra["deck_counts"] = {role: len(found({**base, "role": role})) for role in ("member", "support")}
        if by_card:
            extra["deck_counts"]["support"] = 0
        deck = Deck.objects.filter(id=int(p["deck"])).values("id", "name").first()
        extra["deck_filter"] = {**deck, "by_card": by_card} if deck else None
    if str(p.get("card", "")).isdigit():
        named = Card.objects.filter(id=int(p["card"])).first()
        extra["card_filter"] = {"id": named.id, "name": display_name(named)} if named else None
    alts = None
    if _asked_ids(p) is not None:   # a deck's cards: its copies may be drawn in an alternate art (참혈 2026-10-16)
        alts = defaultdict(list)
        for cid, md in (MdPrint.objects.filter(card_id__in=[r.id for r in chunk], is_alt_art=True)
                        .order_by("md_id").values_list("card_id", "md_id")):
            thumb = face_thumb_url(md)
            if thumb:
                alts[cid].append({"id": md, "thumb": thumb})
        # and in a finish: what the Shine / Royal shaders draw each print with (참혈 2026-10-16)
        looks = {c.id: {"finish": _finish(c), "prints": [
            {"id": m, "overframe": _overframe(m), "name_mask": name_mask_url(m)}
            for m in [c.id, *(a["id"] for a in alts[c.id])] if face_url(m)]}
            for c in Card.objects.filter(id__in=[r.id for r in chunk])}
    released = None
    if _asked_ids(p) is not None:   # and the day each came out in each game, for the 금제 the deck picks (참혈 2026-10-16)
        days = {fmt.value: banlist.released_days([r.id for r in chunk], fmt) for fmt in Banlist.Format}
        iso = lambda d: d.isoformat() if isinstance(d, date) else d   # true: out, the day not known; None: never
        released = {r.id: {fmt: iso(by_id[r.id]) for fmt, by_id in days.items()} for r in chunk}
    return Response({**extra,
        "results": [{**({"alts": alts[r.id], "released": released[r.id], **looks.get(r.id, {})} if alts is not None else {}),
                     "id": r.id, "name": r.name,
                     "face_thumb_url": face_thumb_url(r.id) if r.id in index["face_thumbs"] else None,
                     "thumb_url": f"{media}{CARD_THUMB_DIR}/{r.id}.webp" if r.id in index["thumbs"] else None,
                     "image_url": art_url(r.id), "rarity": r.rarity, "ban": r.ban,
                     "category": r.category, "frame": r.frame} for r in chunk],
        "total": len(rows), "page": page, "has_more": has_more,
    })


# the filter chips' keys: what narrows the cards without naming a 카드군, card or deck
CHIP_FILTERS = ("category", "frame", "attribute", "race", "level", "st", "has", "ban")


@api_view(["GET"])
@permission_classes([AllowAny])
def filtered_counts(request):
    """How many cards pass the filter chips in each 카드군 and in each card's support list, for the unified search's
    suggestions to follow the chips (/dev/cards, 참혈 2026-10-14). Only those with a card left are listed."""
    keep = _keep({k: v for k, v in request.query_params.items() if k in CHIP_FILTERS})
    rows = _card_index()["type"]
    lists = Counter(t for r in rows for t in r.as_cards)
    groups, cards = Counter(), Counter()
    for r in rows:
        if keep(r):
            groups.update(r.groups)
            cards.update(t for t in r.as_cards if lists[t] > 1)
    return Response({"groups": groups, "cards": cards})


@api_view(["GET"])
@permission_classes([AllowAny])
def dex_counts(request):
    """How many decks and cards the 도감 holds (its tabs and the home page show them)."""
    from deck.models import Deck
    return Response({"decks": Deck.objects.count(), "cards": Card.objects.filter(has_art()).count()})


def _options(labels):
    return [{"value": k, "label": v} for k, v in labels.items()]


@api_view(["GET"])
@permission_classes([AllowAny])
def card_options(request):
    """Korean labels for every filter, and the reviewed 카드군 with cards on the site (one row for a text written two
    ways with the same cards)."""
    members, info = defaultdict(set), {}
    for gid, cid, name, text in (CardGroupMember.objects.filter(group__needs_review=False)
                                 .filter(has_art("card_id")).exclude(how=CardGroupMember.How.REMOVED)
                                 .values_list("group_id", "card_id", "group__name_ko", "group__text")):
        members[gid].add(cid)
        info[gid] = name or text
    seen, groups = set(), []
    for gid in sorted(members):
        key = (info[gid], frozenset(members[gid]))
        if key not in seen:
            seen.add(key)
            groups.append({"id": gid, "name": info[gid], "count": len(members[gid])})
    groups.sort(key=lambda g: (g["name"], g["id"]))
    # cards with a support list of their own (some other card names them), searched beside the 카드군 (엘리스 10/12);
    # count is the list's size, the card itself included, as on its page
    rows = _card_index()["type"]
    by_id = {r.id: r for r in rows}
    lists = Counter(t for r in rows for t in r.as_cards)
    support_cards = sorted(({"id": t, "name": by_id[t].name, "count": n} for t, n in lists.items() if n > 1 and t in by_id),
                           key=lambda c: (c["name"], c["id"]))
    return Response({
        "categories": _options(CATEGORIES), "frames": _options(FRAMES), "attributes": _options(ATTRIBUTES),
        "races": _options(RACES), "levels": list(range(0, 14)),
        "spell_trap_kinds": [{"value": f"spell:{k}", "label": v} for k, v in SPELL_KINDS.items()]
                            + [{"value": f"trap:{k}", "label": v} for k, v in TRAP_KINDS.items()],
        "groups": groups,
        "support_cards": support_cards,
    })


def _stat(v):
    return None if v is None else "?" if v < 0 else str(v)


def _finish(c):
    """The per-card values the Shine / Royal shaders need: the attribute icon's tile, the stars (a rank counts
    negative, its stars on the left) and the frame, whose lines and relief the shaders light (a print in
    오버프레임 has none: that is per face)."""
    tile = FINISH_TILES.get(c.category if c.category in ("spell", "trap") else c.attribute, 0)
    if c.category != "monster" or c.frame == "link":
        stars = 0
    elif c.frame.startswith("xyz"):
        stars = -(c.rank or 0)
    else:
        stars = c.level or 0
    frame = "link" if c.frame == "link" else "pendulum" if c.frame.endswith("_pendulum") else "normal"
    return {"attribute": tile, "level": stars, "frame": frame}


_cutin_index = {"key": None, "index": {}}


def _cutins():
    """Master Duel's monster cut-ins on media (md_ui/cutin/index.json: print id → animation and the game's camera
    view), read again when the file changes."""
    path = os.path.join(settings.MEDIA_ROOT, "md_ui", "cutin", "index.json")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    if (path, mtime) != _cutin_index["key"]:
        with open(path) as f:
            _cutin_index["index"] = {int(k): v for k, v in json.load(f).items()}
        _cutin_index["key"] = (path, mtime)
    return _cutin_index["index"]


def _overframe(md_id):
    path = art_path(md_id)
    if not path or not os.path.exists(path):
        return False
    with Image.open(path) as art:   # reads the header only
        return is_overframe(art)


def _texts(card, lang):
    t = next((t for t in card.texts.all() if t.lang == lang), None)
    return {f: getattr(t, f) for f in ("materials", "effect", "pendulum_effect", "flavor")} if t else None


@api_view(["GET"])
@permission_classes([AllowAny])
def card(request, card_id):
    """Card document: names, stats, Korean and Japanese text, 카드군, the decks those 카드군 are linked to, release dates
    and Master Duel prints."""
    from deck.models import DeckCard, DeckCardGroup
    from deck.views import _phone_cover_url

    c = Card.objects.filter(has_art(), id=card_id).prefetch_related("texts").first()
    if not c:
        raise Http404
    if c.category == "monster":
        type_line = " / ".join([RACES.get(c.race, c.race)] + [TYPE_WORDS.get(t, t) for t in c.types])
        if c.link_rating:
            level_label = f"링크 {c.link_rating}"
        elif c.rank is not None and c.frame.startswith("xyz"):
            level_label = f"랭크 {c.rank}"
        else:
            level_label = f"레벨 {c.level}" if c.level is not None else ""
    else:
        type_line = (SPELL_KINDS if c.category == "spell" else TRAP_KINDS).get(c.spell_trap_subtype, CATEGORIES[c.category])
        level_label = ""
    groups = sorted((m.group for m in c.group_memberships.select_related("group")
                     if m.how != CardGroupMember.How.REMOVED and not m.group.needs_review),
                    key=lambda g: (g.name_ko or g.text))
    # 서포트: what the card names outright (a 카드군 or a card); the decks of every group it supports follow its own
    supports = list(CardSupport.objects.filter(card=c).select_related("group", "target"))
    own_groups = {g.id for g in groups}
    # a card of its own 카드군 is none of its 서포트 (엘리스 10/12)
    targets = [s.target_id for s in supports if s.target_id]
    theirs = _shown_groups(targets)
    shown_cards = set(Card.objects.filter(has_art(), id__in=[t for t in targets if not theirs[t] & own_groups])
                      .values_list("id", flat=True))
    # a card naming this one back supports it too: the pair is marked as mutual (의식 몬스터 ↔ 의식 마법)
    back = set(CardSupport.objects.filter(target=c, how=CardSupport.How.CARD).values_list("card_id", flat=True))
    named = sorted(
        [{"kind": "group", "id": s.group_id, "name": s.group.name_ko or s.group.text, "mutual": False} for s in supports
         if s.how == CardSupport.How.GROUP and not s.group.needs_review]
        + [{"kind": "card", "id": s.target_id, "name": display_name(s.target), "mutual": s.target_id in back}
           for s in supports if s.how == CardSupport.How.CARD and s.target_id in shown_cards],
        key=lambda x: (x["kind"] != "group", x["name"]))
    # A group under another is part of it, so the decks linked to the groups above come next (HERO's deck for a card
    # supporting E・HERO).
    parent = dict(CardGroup.objects.values_list("id", "parent_id"))

    def above(gids):
        out = []
        for gid in gids:
            gid = parent.get(gid)
            while gid and gid not in out:
                out.append(gid)
                gid = parent.get(gid)
        return out

    mine, backed = [g.id for g in groups], [s.group_id for s in supports if s.group_id]
    # decks built on a card (빛의 황금궤 …): this card or a card whose name it bears, then a card it names
    as_card = [c.id] + [s.target_id for s in supports if s.how == CardSupport.How.NAMED]
    names_card = [s.target_id for s in supports if s.how == CardSupport.How.CARD]
    decks, seen = [], set()
    for via, model, field, ids in (("member", DeckCardGroup, "group_id", mine), ("member", DeckCardGroup, "group_id", above(mine)),
                                   ("member", DeckCard, "card_id", as_card),
                                   ("support", DeckCardGroup, "group_id", backed), ("support", DeckCardGroup, "group_id", above(backed)),
                                   ("support", DeckCard, "card_id", names_card)):
        for link in model.objects.filter(**{f"{field}__in": ids}).select_related("deck").order_by("-weight", "deck__name"):
            if link.deck_id not in seen:
                seen.add(link.deck_id)
                decks.append({"id": link.deck_id, "name": link.deck.name, "cover": _phone_cover_url(link.deck), "via": via})
    base = MdPrint.objects.filter(md_id=c.id).first()
    # each print has its own rarity: an alternate art or 오버프레임 of an N / R card can be UR (and then comes in 로얄)
    alts = list(MdPrint.objects.filter(card=c, is_alt_art=True).order_by("md_id").values_list("md_id", "rarity"))
    rarity = {c.id: base.rarity if base else ""} | {m: r or (base.rarity if base else "") for m, r in alts}
    cutins = _cutins()
    # the cards naming this one or bearing its name, but none of its own 카드군 (엘리스 10/12)
    naming = list(CardSupport.objects.filter(target=c, card__in=Card.objects.filter(has_art()))
                  .exclude(card=c).values_list("card_id", flat=True))
    naming_groups = _shown_groups(naming)
    supporters = [cid for cid in naming if not naming_groups[cid] & own_groups]
    return Response({
        "id": c.id, "name": display_name(c), "name_ko": c.name_ko, "name_ja": c.name_ja, "name_ja_ruby": c.name_ja_ruby,
        "name_en": c.name_en, "category": c.category, "frame": c.frame, "type_line": type_line,
        "attribute": ATTRIBUTES.get(c.attribute, ""), "level_label": level_label,
        # what the document's Master Duel icons are chosen by
        "attribute_key": c.attribute if c.category == "monster" else "", "race": c.race if c.category == "monster" else "",
        "spell_trap_kind": c.spell_trap_subtype if c.category != "monster" else "",
        "atk": _stat(c.atk), "def": None if c.frame == "link" else _stat(c.def_value),
        "link_markers": c.link_markers, "pendulum_scale": c.pendulum_scale, "finish": _finish(c),
        "texts": {"ko": _texts(c, "ko"), "ja": _texts(c, "ja")},
        "image_url": art_url(c.id), "thumb_url": thumb_url(c.id), "face_url": face_url(c.id),
        "faces": [{"id": m, "face": face_url(m), "thumb": face_thumb_url(m), "overframe": _overframe(m), "rarity": r,
                   "name_mask": name_mask_url(m), "cutin": cutins.get(m)}
                  for m, r in rarity.items() if face_url(m)],
        # each print's Master Duel art in each version (일본판 ocg / 한국판 tcg), for a deck cover picked from the card
        # book (특이점 10/17)
        "arts": [{"id": m, "version": v, "url": settings.MEDIA_URL + versions[v], "overframe": _overframe(m)}
                 for m, versions in ((m, art_names().get(m) or {}) for m in rarity) for v in ART_ORDER if v in versions],
        # the cut-in's sound is the attribute's
        "cutin_sound": c.attribute if c.category == "monster" and c.attribute in ATTRIBUTES else "",
        "rarity": base.rarity if base else "",
        "dates": {"md": base.first_seen if base else None, "ocg": c.ocg_date, "kr": c.kr_date, "tcg": c.tcg_date},
        "groups": [{"id": g.id, "name": g.name_ko or g.text, "parent_id": g.parent_id} for g in groups],
        "supports": named,
        # how many cards its own support list holds (itself included), or 0 when no other card names it
        "supporters": (lambda n: n + 1 if n else 0)(len(supporters)),
        "decks": decks,
        # each game's 연혁: its release and 금제 changes (엘리스 10/12)
        "history": banlist.card_history(c),
        # today's Master Duel 금제 for the icon beside its name, "" when unlimited (엘리스 10/12)
        "ban": banlist.current_statuses(Banlist.Format.MD, timezone.localdate(), card=c.id).get(c.id, ""),
    })
