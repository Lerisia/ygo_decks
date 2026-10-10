"""카드 도감: the public card list (search, filters, sort, 60 a page) and card documents — Master Duel cards with art."""
import unicodedata
from collections import defaultdict

from django.db.models import Exists, OuterRef, Q
from django.http import Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .display import art_url, display_name, thumb_url
from .models import Card, CardGroup, CardGroupMember, CardText, MdPrint, has_art

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


def _in_group(group_id):
    return Exists(CardGroupMember.objects.filter(card=OuterRef("pk"), group_id=group_id)
                  .exclude(how=CardGroupMember.How.REMOVED))


def _filtered(p):
    qs = Card.objects.filter(has_art())
    if p.get("category") in CATEGORIES:
        qs = qs.filter(category=p["category"])
    frame = p.get("frame")
    if frame == "pendulum":
        qs = qs.filter(frame__endswith="_pendulum")
    elif frame in FRAMES:
        qs = qs.filter(frame__in=[frame, f"{frame}_pendulum"])
    if p.get("attribute") in ATTRIBUTES:
        qs = qs.filter(attribute=p["attribute"])
    if p.get("race") in RACES:
        qs = qs.filter(race=p["race"])
    if str(p.get("level", "")).isdigit():
        n = int(p["level"])
        qs = qs.filter(Q(level=n) | Q(rank=n) | Q(link_rating=n))
    category, _, kind = str(p.get("st", "")).partition(":")
    if category in ("spell", "trap") and kind:
        qs = qs.filter(category=category, spell_trap_subtype=kind)
    if str(p.get("group", "")).isdigit():
        qs = qs.filter(_in_group(int(p["group"])))
    return qs


def _released(row):
    return row[4] or row[5] or row[6]


@api_view(["GET"])
@permission_classes([AllowAny])
def cards(request):
    """Card list: filters, then search (exact → prefix → substring over Korean/Japanese/English names), then sort
    (new = latest release first, name, atk)."""
    p = request.query_params
    rows = list(_filtered(p).values_list("id", "name_ko", "name_ja", "name_en", "ocg_date", "tcg_date", "kr_date", "atk"))
    sort = p.get("sort") or "new"
    if sort == "name":
        rows.sort(key=lambda r: (r[1] or r[2], r[0]))
    elif sort == "atk":
        rows.sort(key=lambda r: (r[7] is None, -(r[7] or 0), r[1]))
    else:
        rows.sort(key=lambda r: (_released(r) is None, _released(r) and -_released(r).toordinal(), -r[0]))
    q = _norm(p.get("q"))
    if q:
        ranked = []
        for i, r in enumerate(rows):
            names = [_norm(n) for n in r[1:4] if n]
            if any(q == n for n in names):
                bucket = 0
            elif any(n.startswith(q) for n in names):
                bucket = 1
            elif any(q in n for n in names):
                bucket = 2
            else:
                continue
            ranked.append((bucket, len(_norm(r[1])), i, r))
        rows = [r for *_, r in sorted(ranked)]
    try:
        page = max(1, int(p.get("page") or 1))
    except ValueError:
        page = 1
    chunk = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    return Response({
        "results": [{"id": r[0], "name": r[1] or r[2] or r[3], "thumb_url": thumb_url(r[0]), "image_url": art_url(r[0])}
                    for r in chunk],
        "total": len(rows), "page": page, "has_more": page * PAGE_SIZE < len(rows),
    })


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


def _full_image(card_id):
    """The old card table's whole-card picture (English, YGOPRODeck) through the legacy id map, or None."""
    from card.models import Card as OldCard
    from .models import LegacyCard
    old_ids = LegacyCard.objects.filter(card_id=card_id).values_list("old_id", flat=True)
    old = OldCard.objects.filter(id__in=old_ids).exclude(card_image="").order_by("card_id").first()   # art 00 first
    return old.card_image.url if old else None


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
        "image_url": art_url(c.id), "thumb_url": thumb_url(c.id), "full_image_url": _full_image(c.id),
        "alt_arts": [u for u in (art_url(m) for m in MdPrint.objects.filter(card=c, is_alt_art=True)
                                 .order_by("md_id").values_list("md_id", flat=True)) if u],
        "rarity": base.rarity if base else "",
        "dates": {"ocg": c.ocg_date, "kr": c.kr_date, "tcg": c.tcg_date},
        "groups": [{"id": g.id, "name": g.name_ko or g.text, "parent_id": g.parent_id} for g in groups],
        "decks": decks,
    })
