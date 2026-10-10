"""카드 도감: the public card list (search, filters, sort, 60 a page) and card documents — Master Duel cards with art."""
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

from .display import THUMB_DIR as CARD_THUMB_DIR, art_url, display_name, thumb_url
from .face import THUMB_DIR as FACE_THUMB_DIR, face_thumb_url, face_url
from .models import Card, CardGroupMember, MdPrint, has_art

PAGE_SIZE = 60

ATTRIBUTES = {"light": "빛", "dark": "어둠", "water": "물", "fire": "화염", "earth": "땅", "wind": "바람", "divine": "신"}
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
                 "groups")


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
    for d in (FACE_THUMB_DIR, CARD_THUMB_DIR):
        try:
            dirs.append(os.stat(os.path.join(settings.MEDIA_ROOT, d)).st_mtime)
        except OSError:
            dirs.append(0)
    return (tuple(Card.objects.aggregate(n=Count("id"), t=Max("updated_at")).values()),
            tuple(CardGroupMember.objects.aggregate(n=Count("id"), m=Max("id")).values()),
            tuple(MdArt.objects.aggregate(n=Count("id"), m=Max("id")).values()),
            tuple(MdPrint.objects.aggregate(n=Count("md_id"), d=Max("first_seen"), u=Count("first_seen")).values()),
            tuple(dirs), settings.MEDIA_ROOT)


def _card_index():
    """Every card on the site, with its names normalized once, kept in memory in both list orders and rebuilt only
    when the cards, their 카드군, their art or the thumbnail folders change — a search is a pass over memory."""
    key = _fingerprint()
    if _index["key"] == key and time.monotonic() - _index["at"] < INDEX_MAX_AGE:
        return _index
    groups = defaultdict(set)
    for cid, gid in CardGroupMember.objects.exclude(how=CardGroupMember.How.REMOVED).values_list("card_id", "group_id"):
        groups[cid].add(gid)
    md_release = dict(MdPrint.objects.filter(is_alt_art=False).exclude(first_seen=None).values_list("md_id", "first_seen"))
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
    if str(p.get("group", "")).isdigit():
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
    keep = _keep(p)
    rows = [r for r in index["name" if p.get("sort") == "name" else "new"] if keep(r)]
    if _norm(p.get("q")):
        rows = _rank(rows, p.get("q"))
    try:
        page = max(1, int(p.get("page") or 1))
    except ValueError:
        page = 1
    chunk = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    media = settings.MEDIA_URL
    return Response({
        "results": [{"id": r.id, "name": r.name,
                     "face_thumb_url": f"{media}{FACE_THUMB_DIR}/{r.id}.webp" if r.id in index["face_thumbs"] else None,
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


def _texts(card, lang):
    t = next((t for t in card.texts.all() if t.lang == lang), None)
    return {f: getattr(t, f) for f in ("materials", "effect", "pendulum_effect", "flavor")} if t else None


@api_view(["GET"])
@permission_classes([AllowAny])
def card(request, card_id):
    """Card document: names, stats, Korean and Japanese text, 카드군, the decks those 카드군 are linked to, release dates
    and Master Duel prints."""
    from deck.models import DeckCardGroup
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
    decks, seen = [], set()
    for link in (DeckCardGroup.objects.filter(group__in=groups).select_related("deck")
                 .order_by("-weight", "deck__name")):
        if link.deck_id not in seen:
            seen.add(link.deck_id)
            decks.append({"id": link.deck_id, "name": link.deck.name, "cover": _phone_cover_url(link.deck)})
    base = MdPrint.objects.filter(md_id=c.id).first()
    return Response({
        "id": c.id, "name": display_name(c), "name_ko": c.name_ko, "name_ja": c.name_ja, "name_ja_ruby": c.name_ja_ruby,
        "name_en": c.name_en, "category": c.category, "frame": c.frame, "type_line": type_line,
        "attribute": ATTRIBUTES.get(c.attribute, ""), "level_label": level_label,
        "atk": _stat(c.atk), "def": None if c.frame == "link" else _stat(c.def_value),
        "link_markers": c.link_markers, "pendulum_scale": c.pendulum_scale,
        "texts": {"ko": _texts(c, "ko"), "ja": _texts(c, "ja")},
        "image_url": art_url(c.id), "thumb_url": thumb_url(c.id), "face_url": face_url(c.id),
        "faces": [{"id": m, "face": face_url(m), "thumb": face_thumb_url(m)}
                  for m in [c.id] + list(MdPrint.objects.filter(card=c, is_alt_art=True).order_by("md_id")
                                         .values_list("md_id", flat=True)) if face_url(m)],
        "rarity": base.rarity if base else "",
        "dates": {"md": base.first_seen if base else None, "ocg": c.ocg_date, "kr": c.kr_date, "tcg": c.tcg_date},
        "groups": [{"id": g.id, "name": g.name_ko or g.text, "parent_id": g.parent_id} for g in groups],
        "decks": decks,
    })
