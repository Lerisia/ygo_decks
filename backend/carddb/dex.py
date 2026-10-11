"""카드 도감: the public card list (search, filters, sort, 60 a page) and card documents — Master Duel cards with art."""
import json
import os
import time
import unicodedata
from collections import defaultdict

from django.conf import settings
from django.db.models import Count, Max
from django.http import Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from PIL import Image

from .display import THUMB_DIR as CARD_THUMB_DIR, art_names, art_path, art_url, display_name, thumb_url
from .face import THUMB_DIR as FACE_THUMB_DIR, face_thumb_url, face_url, is_overframe, name_mask_url
from .models import Card, CardGroup, CardGroupMember, CardSupport, MdPrint, has_art

PAGE_SIZE = 60

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
                 "groups", "supports", "as_cards", "alt", "cutin")


_index = {"key": None, "at": 0.0, "new": [], "name": [], "face_thumbs": set(), "thumbs": set()}
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
            tuple(dirs), settings.MEDIA_ROOT)


def _card_index():
    """Every card on the site, with its names normalized once, kept in memory in both list orders and rebuilt only
    when the cards, their 카드군, their art or the thumbnail folders change — a search is a pass over memory."""
    key = _fingerprint()
    if _index["key"] == key and time.monotonic() - _index["at"] < INDEX_MAX_AGE:
        return _index
    supports, as_cards = defaultdict(set), defaultdict(set)   # groups it supports / cards whose list it is in
    for cid, gid, target, how in CardSupport.objects.values_list("card_id", "group_id", "target_id", "how"):
        if gid:
            supports[cid].add(gid)
        else:
            as_cards[cid].add(target)
    groups = defaultdict(set)
    for cid, gid in CardGroupMember.objects.exclude(how=CardGroupMember.How.REMOVED).values_list("card_id", "group_id"):
        groups[cid].add(gid)
    md_release = dict(MdPrint.objects.filter(is_alt_art=False).exclude(first_seen=None).values_list("md_id", "first_seen"))
    with_art = art_names()
    alt_of = dict(MdPrint.objects.filter(is_alt_art=True).values_list("md_id", "card_id"))
    alt_cards = {cid for md_id, cid in alt_of.items() if md_id in with_art}
    cutin_cards = {alt_of.get(md_id, md_id) for md_id in _cutins()}
    rows = []
    for (cid, ko, ja, en, ocg, tcg, kr, category, frame, attribute, race, level, rank, link,
         st) in Card.objects.filter(has_art()).values_list(
            "id", "name_ko", "name_ja", "name_en", "ocg_date", "tcg_date", "kr_date", "category", "frame", "attribute",
            "race", "level", "rank", "link_rating", "spell_trap_subtype"):
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
        r.alt, r.cutin = cid in alt_cards, cid in cutin_cards
        rows.append(r)
    _index.update(
        key=key, at=time.monotonic(),
        new=sorted(rows, key=lambda r: (r.released is None, -(r.released or 0), -r.id)),
        name=sorted(rows, key=lambda r: (r.name, r.id)),
        face_thumbs=_files(FACE_THUMB_DIR), thumbs=_files(CARD_THUMB_DIR),
    )
    return _index


def _keep(p):
    """The filters of the query string as one test on an index row."""
    tests = []
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
    # (엘리스 2026-10-11)
    has = set(str(p.get("has", "")).split(","))
    if "alt" in has:
        tests.append(lambda r: r.alt)
    if "cutin" in has:
        tests.append(lambda r: r.cutin)
    if str(p.get("card", "")).isdigit():
        # a card's own support list: the card, cards bearing its name and cards naming it (엘리스 2026-10-11)
        tests.append(lambda r, v=int(p["card"]): v in r.as_cards)
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
    the chosen order (new = latest first by the day the card came to Master Duel, else its first paper release; or
    name)."""
    p = request.query_params
    index = _card_index()

    def found(params):
        keep = _keep(params)
        rows = [r for r in index["name" if params.get("sort") == "name" else "new"] if keep(r)]
        return _rank(rows, params.get("q")) if _norm(params.get("q")) else rows

    rows = found(p)
    try:
        page = max(1, int(p.get("page") or 1))
    except ValueError:
        page = 1
    chunk = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    media = settings.MEDIA_URL
    extra = {}
    if str(p.get("group", "")).isdigit():   # a group's list tells how many members and supporters it has
        base = {k: p.get(k) for k in p.keys()}
        extra["group_counts"] = {role: len(found({**base, "role": role})) for role in ("member", "support")}
    if str(p.get("card", "")).isdigit():
        named = Card.objects.filter(id=int(p["card"])).first()
        extra["card_filter"] = {"id": named.id, "name": display_name(named)} if named else None
    return Response({**extra,
        "results": [{"id": r.id, "name": r.name,
                     "face_thumb_url": face_thumb_url(r.id) if r.id in index["face_thumbs"] else None,
                     "thumb_url": f"{media}{CARD_THUMB_DIR}/{r.id}.webp" if r.id in index["thumbs"] else None,
                     "image_url": art_url(r.id)} for r in chunk],
        "total": len(rows), "page": page, "has_more": page * PAGE_SIZE < len(rows),
    })


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
    return Response({
        "categories": _options(CATEGORIES), "frames": _options(FRAMES), "attributes": _options(ATTRIBUTES),
        "races": _options(RACES), "levels": list(range(0, 14)),
        "spell_trap_kinds": [{"value": f"spell:{k}", "label": v} for k, v in SPELL_KINDS.items()]
                            + [{"value": f"trap:{k}", "label": v} for k, v in TRAP_KINDS.items()],
        "groups": groups,
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
    shown_cards = set(Card.objects.filter(has_art(), id__in=[s.target_id for s in supports if s.target_id])
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
    return Response({
        "id": c.id, "name": display_name(c), "name_ko": c.name_ko, "name_ja": c.name_ja, "name_ja_ruby": c.name_ja_ruby,
        "name_en": c.name_en, "category": c.category, "frame": c.frame, "type_line": type_line,
        "attribute": ATTRIBUTES.get(c.attribute, ""), "level_label": level_label,
        "atk": _stat(c.atk), "def": None if c.frame == "link" else _stat(c.def_value),
        "link_markers": c.link_markers, "pendulum_scale": c.pendulum_scale, "finish": _finish(c),
        "texts": {"ko": _texts(c, "ko"), "ja": _texts(c, "ja")},
        "image_url": art_url(c.id), "thumb_url": thumb_url(c.id), "face_url": face_url(c.id),
        "faces": [{"id": m, "face": face_url(m), "thumb": face_thumb_url(m), "overframe": _overframe(m), "rarity": r,
                   "name_mask": name_mask_url(m), "cutin": cutins.get(m)}
                  for m, r in rarity.items() if face_url(m)],
        # the cut-in's sound is the attribute's
        "cutin_sound": c.attribute if c.category == "monster" and c.attribute in ATTRIBUTES else "",
        "rarity": base.rarity if base else "",
        "dates": {"md": base.first_seen if base else None, "ocg": c.ocg_date, "kr": c.kr_date, "tcg": c.tcg_date},
        "groups": [{"id": g.id, "name": g.name_ko or g.text, "parent_id": g.parent_id} for g in groups],
        "supports": named,
        # how many cards its own support list holds (itself included), or 0 when no other card names it
        "supporters": (lambda n: n + 1 if n else 0)(
            CardSupport.objects.filter(target=c, card__in=Card.objects.filter(has_art()))
            .exclude(card=c).count()),
        "decks": decks,
    })
