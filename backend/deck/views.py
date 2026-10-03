import random
from django.http import JsonResponse
from django.db.models import Q
from django.utils.timezone import now
from django.shortcuts import get_object_or_404
from django.contrib.admin.models import LogEntry, CHANGE
from django.db import transaction
from .models import Deck, AestheticTag, PerformanceTag, SummoningMethod, DeckAlias, STRENGTH_BAND_TO_TIERS, STRENGTH_TIER_TO_BANDS
from .youtube import serialize_featured
from userstatistics.models import UserResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAdminUser
from user.models import User

def parse_answer_key(answer_key):
    """ Convert answer_key to dictionary form """
    criteria = {}
    pairs = answer_key.split("|")

    for pair in pairs:
        if "=" in pair:
            key, value = pair.split("=")
            if key == "summoning_methods":
                criteria[key] = [int(v) for v in value.split(",")]
            elif key in ["performance_tags", "aesthetic_tags"]:
                criteria[key] = value.split(",")
            else:
                criteria[key] = int(value)
    
    print("Converted answer keys:", criteria)
    return criteria

SHORT_TO_FIELD = {
    "s": "strength", "d": "difficulty", "t": "deck_type", "a": "art_style",
    "sm": "summoning_methods", "ptag": "performance_tags", "atag": "aesthetic_tags",
}
M2M_FIELDS = ("summoning_methods", "performance_tags", "aesthetic_tags")


def parse_short_answer_key(answer_key):
    """Survey-side key (`s=1|d=0|sm=6`) -> criteria dict. Raises ValueError on junk."""
    criteria = {}
    if not answer_key or answer_key == "empty":
        return criteria
    for pair in answer_key.split("|"):
        if not pair:
            continue
        if "=" not in pair:
            raise ValueError(pair)
        short, raw = pair.split("=", 1)
        if short not in SHORT_TO_FIELD:
            raise ValueError(short)
        field = SHORT_TO_FIELD[short]
        value = int(raw)  # ValueError propagates
        if field in M2M_FIELDS:
            criteria.setdefault(field, []).append(value)
        else:
            criteria[field] = value
    return criteria


def filter_decks(criteria, user=None):
    """Decks matching the survey criteria; the single source of truth shared by
    the step endpoint and the result endpoint."""
    query = Q()
    if criteria.get("art_style") is not None:
        query &= Q(art_style=criteria["art_style"])
    if criteria.get("deck_type") is not None:
        query &= Q(deck_type=criteria["deck_type"])
    if criteria.get("difficulty") is not None:
        query &= Q(difficulty=criteria["difficulty"])
    if criteria.get("strength") is not None:
        # Survey sends a band index (0-4). Each band covers 1-2 adjacent tiers.
        # Unknown band -> empty tuple -> __in matches nothing.
        tiers = STRENGTH_BAND_TO_TIERS.get(criteria["strength"], ())
        query &= Q(strength__in=tiers)
    if criteria.get("summoning_methods"):
        query &= Q(summoning_methods__id__in=criteria["summoning_methods"])
    if criteria.get("performance_tags"):
        query &= Q(performance_tags__id__in=criteria["performance_tags"])
    if criteria.get("aesthetic_tags"):
        query &= Q(aesthetic_tags__id__in=criteria["aesthetic_tags"])

    # Engine (용병) decks are splashed into other decks, not played alone —
    # never recommend them.
    decks = Deck.objects.filter(query).exclude(is_engine=True).distinct()
    if user is not None and user.is_authenticated and user.use_custom_lookup:
        owned = list(user.owned_decks.values_list("id", flat=True))
        if owned:
            decks = decks.exclude(id__in=owned)
    return decks


def available_options(decks):
    """For each survey key, the option values that keep >= 1 of `decks`."""
    rows = list(decks.values("id", "strength", "difficulty", "deck_type", "art_style"))
    ids = [r["id"] for r in rows]
    bands = set()
    for r in rows:
        bands.update(STRENGTH_TIER_TO_BANDS.get(r["strength"], ()))

    def m2m(field):
        return sorted({v for v in Deck.objects.filter(id__in=ids).values_list(f"{field}__id", flat=True) if v is not None})

    return {
        "s": sorted(bands),
        "d": sorted({r["difficulty"] for r in rows}),
        "t": sorted({r["deck_type"] for r in rows}),
        "a": sorted({r["art_style"] for r in rows}),
        "sm": m2m("summoning_methods"),
        "ptag": m2m("performance_tags"),
        "atag": m2m("aesthetic_tags"),
    }


@api_view(["GET"])
def recommend_step(request):
    try:
        criteria = parse_short_answer_key(request.GET.get("key", ""))
    except ValueError:
        return JsonResponse({"error": "invalid key"}, status=400)

    decks = filter_decks(criteria, request.user)
    count = decks.count()
    return JsonResponse({
        "candidate_count": count,
        "resolved": count == 1,
        "available": available_options(decks),
    })


@api_view(["GET"])
def get_deck_result(request):
    answer_key = request.GET.get("key")
    session_id = request.session.session_key
    if not session_id:
        request.session.create()
        session_id = request.session.session_key

    if not answer_key:
        return JsonResponse({"error": "answer_key is required"}, status=400)

    # Convert answer keys to dictionary form
    search_params = parse_answer_key(answer_key)
    print("Search params:", search_params)

    decks = filter_decks(search_params, request.user)
    print("Filtered QuerySet count:", decks.count())

    if answer_key == "empty":
        all_decks = Deck.objects.exclude(is_engine=True)
        deck = random.choice(list(all_decks)) if all_decks.exists() else None

    if not decks.exists():
        print("No matching decks found!")
        return JsonResponse({"error": "No matching decks found"}, status=404)

    deck = random.choice(list(decks)) if decks.count() > 1 else decks.first()
    print("Selected Deck:", deck)

    # Prevent duplicated answer to be saved
    if UserResponse.objects.filter(session_id=session_id, answers=search_params).exists():
        print("Duplicate response detected, skipping save.")
    else:
        UserResponse.objects.create(
            session_id=session_id,
            deck=deck,
            answers=search_params,
            date=now()
        )

        deck.num_views += 1
        deck.save(update_fields=['num_views'])

    result_data = {
        "id": deck.id,
        "name": deck.name,
        "cover_image": deck.cover_image.url if deck.cover_image else None,
        "strength": deck.get_strength_display(),
        "difficulty": deck.get_difficulty_display(),
        "deck_type": deck.get_deck_type_display(),
        "art_style": deck.get_art_style_display(),
        "summoning_methods": [method.get_method_display() for method in deck.summoning_methods.all()],
        "performance_tags": [performance_tag.name for performance_tag in deck.performance_tags.all()],
        "aesthetic_tags": [aesthetic_tag.name for aesthetic_tag in deck.aesthetic_tags.all()],
        "description": deck.description,
        "stats": {
            "consistency": deck.stat_consistency,
            "breakthrough": deck.stat_breakthrough,
            "interruption": deck.stat_interruption,
            "recovery": deck.stat_recovery,
            "deck_space": deck.stat_deck_space,
        },
    }

    return JsonResponse(result_data, safe=False)

def _list_cover_url(deck):
    cover = deck.cover_image_list or deck.cover_image_small
    return cover.url if cover else None


@api_view(["GET"])
def get_all_decks(request):
    decks = Deck.objects.all().prefetch_related(
        "summoning_methods", "performance_tags", "aesthetic_tags", "aliases"
    ).order_by("name")

    deck_data = [
        {
            "id": deck.id,
            "name": deck.name,
            "aliases": [alias.name for alias in deck.aliases.all()],  # << 여기 추가
            "strength": deck.get_strength_display(),
            "difficulty": deck.get_difficulty_display(),
            "deck_type": deck.get_deck_type_display(),
            "art_style": deck.get_art_style_display(),
            "is_engine": deck.is_engine,
            "summoning_methods": [method.get_method_display() for method in deck.summoning_methods.all()],
            "performance_tags": [performance_tag.name for performance_tag in deck.performance_tags.all()],
            "aesthetic_tags": [aesthetic_tag.name for aesthetic_tag in deck.aesthetic_tags.all()],
            "cover_image": _list_cover_url(deck),
        }
        for deck in decks
    ]
    return Response({"decks": deck_data})

@api_view(["GET"])
def get_deck_data(request, deck_id):
    try:
        deck = Deck.objects.get(id=deck_id)
    except Deck.DoesNotExist:
        return Response({"error": "덱을 찾을 수 없습니다."}, status=404)
    return Response(serialize_deck_detail(deck))


def serialize_deck_detail(deck):
    return {
        "id": deck.id,
        "name": deck.name,
        "cover_image": deck.cover_image.url if deck.cover_image else None,
        "cover_image_small": deck.cover_image_small.url if deck.cover_image_small else None,
        "strength": deck.get_strength_display(),
        "difficulty": deck.get_difficulty_display(),
        "deck_type": deck.get_deck_type_display(),
        "art_style": deck.get_art_style_display(),
        "is_engine": deck.is_engine,
        "play_video_url": deck.play_video_url,
        "video_count": 1 if _featured(deck) else 0,
        "note_count": _note_entry_count(_visible_notes(deck)),
        "has_hyeol": hasattr(deck, "hyeol"),
        "summoning_methods": [method.get_method_display() for method in deck.summoning_methods.all()],
        "performance_tags": [tag.name for tag in deck.performance_tags.all()],
        "aesthetic_tags": [tag.name for tag in deck.aesthetic_tags.all()],
        "description": deck.description,
        "wiki_content": deck.wiki_content,
        "stats": {
            "consistency": deck.stat_consistency,
            "breakthrough": deck.stat_breakthrough,
            "interruption": deck.stat_interruption,
            "recovery": deck.stat_recovery,
            "deck_space": deck.stat_deck_space,
        },
    }


def _featured(deck):
    try:
        return deck.featured_video
    except Exception:
        return None


@api_view(["GET"])
def get_deck_videos(request, deck_id):
    """이 덱의 대표 영상(영미권/일본 유튜브에서 선정) 하나."""
    deck = get_object_or_404(Deck, id=deck_id)
    featured = _featured(deck)
    return Response({"deck_id": deck.id, "featured": serialize_featured(featured) if featured else None})


import os
import json
from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

def get_tags(request):
    aesthetic_tags = list(AestheticTag.objects.values_list("name", flat=True))
    performance_tags = list(PerformanceTag.objects.values_list("name", flat=True))

    return JsonResponse({
        "aesthetic_tags": aesthetic_tags,
        "performance_tags": performance_tags
    })
    
@api_view(["PUT"])
@permission_classes([IsAdminUser]) # Admin only
def update_wiki_content(request, deck_id):
    deck = get_object_or_404(Deck, id=deck_id)
    wiki_content = request.data.get("wiki_content", "")

    deck.wiki_content = wiki_content
    deck.save()

    return Response({"message": "Wiki content updated successfully."})


# 특이점 2026-10-03: 운영자가 덱 문서에서 덱 정보와 스탯을 바로 고친다. 고친 내용은 관리자 페이지 기록(LogEntry)에 남는다.
EDIT_CHOICE_FIELDS = (
    ("strength", "덱 파워", Deck._Strength),
    ("difficulty", "난이도", Deck._Difficulty),
    ("deck_type", "덱 타입", Deck._DeckType),
    ("art_style", "아트 스타일", Deck._ArtStyle),
)
EDIT_STAT_FIELDS = (
    ("consistency", "stat_consistency", "안정성"),
    ("breakthrough", "stat_breakthrough", "돌파력"),
    ("interruption", "stat_interruption", "견제력"),
    ("recovery", "stat_recovery", "복구력"),
    ("deck_space", "stat_deck_space", "덱 스페이스"),
)
EDIT_TAG_FIELDS = (
    ("summoning_methods", "소환법"),
    ("performance_tags", "태그(성능적)"),
    ("aesthetic_tags", "태그(비성능적)"),
)


def _deck_edit_values(deck):
    return {
        **{field: getattr(deck, field) for field, _, _ in EDIT_CHOICE_FIELDS},
        "is_engine": deck.is_engine,
        "summoning_methods": sorted(deck.summoning_methods.values_list("method", flat=True)),
        "performance_tags": list(deck.performance_tags.order_by("id").values_list("name", flat=True)),
        "aesthetic_tags": list(deck.aesthetic_tags.order_by("id").values_list("name", flat=True)),
        "stats": {key: getattr(deck, attr) for key, attr, _ in EDIT_STAT_FIELDS},
    }


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _validate_deck_edit(data):
    """Return ({field: new value}, error message or None). Only fields present in `data` are touched."""
    updates = {}
    for field, label, choices in EDIT_CHOICE_FIELDS:
        if field in data:
            if not _is_int(data[field]) or data[field] not in choices.values:
                return None, f"{label} 값이 올바르지 않습니다."
            updates[field] = data[field]
    if "is_engine" in data:
        if not isinstance(data["is_engine"], bool):
            return None, "엔진 여부 값이 올바르지 않습니다."
        updates["is_engine"] = data["is_engine"]
    if "stats" in data:
        stats = data["stats"]
        names = {key: (attr, label) for key, attr, label in EDIT_STAT_FIELDS}
        if not isinstance(stats, dict) or not set(stats) <= set(names):
            return None, "스탯 항목이 올바르지 않습니다."
        for key, value in stats.items():
            attr, label = names[key]
            if value is not None and (not _is_int(value) or not 0 <= value <= 11):
                return None, f"{label}은 0~11 사이여야 합니다."
            updates[attr] = value
    sources = {
        "summoning_methods": lambda vals: SummoningMethod.objects.filter(method__in=vals),
        "performance_tags": lambda vals: PerformanceTag.objects.filter(name__in=vals),
        "aesthetic_tags": lambda vals: AestheticTag.objects.filter(name__in=vals),
    }
    for field, label in EDIT_TAG_FIELDS:
        if field in data:
            vals = data[field]
            if not isinstance(vals, list) or len(set(map(str, vals))) != len(vals):
                return None, f"{label} 값이 올바르지 않습니다."
            objs = list(sources[field](vals))
            if len(objs) != len(vals):
                return None, f"{label}에 없는 항목이 있습니다."
            updates[field] = objs
    return updates, None


def _describe_deck_changes(before, after):
    """'덱 파워 상위권 → 중하위권, 안정성 5 → 6' style summary of what changed."""
    def show(v):
        if v is None:
            return "-"
        if v is True or v is False:
            return "예" if v else "아니요"
        if isinstance(v, list):
            return ", ".join(map(str, v)) or "없음"
        return "?" if v == 11 else str(v)

    parts = []
    for field, label, choices in EDIT_CHOICE_FIELDS:
        if before[field] != after[field]:
            parts.append(f"{label} {choices(before[field]).label} → {choices(after[field]).label}")
    if before["is_engine"] != after["is_engine"]:
        parts.append(f"엔진 {show(before['is_engine'])} → {show(after['is_engine'])}")
    method_label = dict(SummoningMethod.SummonType.choices)
    for field, label in EDIT_TAG_FIELDS:
        old, new = before[field], after[field]
        if field == "summoning_methods":
            old, new = [method_label[m] for m in old], [method_label[m] for m in new]
        if sorted(map(str, old)) != sorted(map(str, new)):
            parts.append(f"{label} {show(old)} → {show(new)}")
    for key, _, label in EDIT_STAT_FIELDS:
        if before["stats"][key] != after["stats"][key]:
            parts.append(f"{label} {show(before['stats'][key])} → {show(after['stats'][key])}")
    return ", ".join(parts)


@api_view(["GET", "PUT"])
@permission_classes([IsAdminUser])
def edit_deck_info(request, deck_id):
    deck = get_object_or_404(Deck, id=deck_id)
    if request.method == "GET":
        return Response({
            "values": _deck_edit_values(deck),
            "options": {
                **{field: [{"value": v, "label": l} for v, l in choices.choices] for field, _, choices in EDIT_CHOICE_FIELDS},
                "summoning_methods": [
                    {"value": m.method, "label": m.get_method_display()} for m in SummoningMethod.objects.order_by("method")
                ],
                "performance_tags": list(PerformanceTag.objects.order_by("id").values_list("name", flat=True)),
                "aesthetic_tags": list(AestheticTag.objects.order_by("id").values_list("name", flat=True)),
            },
        })

    updates, error = _validate_deck_edit(request.data if isinstance(request.data, dict) else {})
    if error:
        return Response({"error": error}, status=400)
    before = _deck_edit_values(deck)
    with transaction.atomic():
        for field, value in updates.items():
            if field in dict(EDIT_TAG_FIELDS):
                getattr(deck, field).set(value)
            else:
                setattr(deck, field, value)
        deck.save()
        summary = _describe_deck_changes(before, _deck_edit_values(deck))
        if summary:
            LogEntry.objects.log_actions(
                user_id=request.user.id,
                queryset=Deck.objects.filter(id=deck.id),
                action_flag=CHANGE,
                change_message=f"덱 문서에서 수정: {summary}",
            )
    return Response({"deck": serialize_deck_detail(deck), "changed": summary})

def serialize_note(n):
    return {
        "id": n.id,
        "title": n.title,
        "author": n.author,
        "url": n.url,
        "source": n.source,
        "source_label": n.get_source_display(),
        "game": n.game,
        "game_label": n.get_game_display(),
        "is_paid": n.is_paid,
        "price": n.price,
        "published_at": n.published_at.isoformat() if n.published_at else None,
        "summary": n.summary,
        "series": n.series,
        "part": n.part,
        "part_label": n.part_label,
    }


# 특이점 지시(2026-09-13): 도감에는 유료 노트를 노출하지 않음. 데이터는 유지하므로 True로 바꾸면 유료 배지와 함께 다시 보임.
SHOW_PAID_NOTES = False


def _visible_notes(deck):
    qs = deck.notes.filter(is_active=True)
    return qs if SHOW_PAID_NOTES else qs.filter(is_paid=False)


def _note_entry_count(notes):
    """A guide split into parts counts once."""
    return len({("s", n.series) if n.series else ("n", n.id) for n in notes})


@api_view(["GET"])
def get_deck_notes(request, deck_id):
    """한국어 강의노트 목록 (활성·무료만, 정렬순)."""
    deck = get_object_or_404(Deck, id=deck_id)
    # Parts of a series sit together, at the position of the series' first-ranked part, in part order.
    notes = list(_visible_notes(deck))
    first = {}
    for i, n in enumerate(notes):
        first.setdefault(n.series or f"#{n.id}", i)
    notes.sort(key=lambda n: (first[n.series or f"#{n.id}"], n.part or 0))
    return Response({"deck_id": deck.id, "notes": [serialize_note(n) for n in notes]})


# 잔존계 패 트랩: archive id → (full card name, our card_id for the art).
HYEOL_TRAP_CARDS = {
    "droll": ("드롤 & 로크 버드", "9414502100"),
    "maxxc": ("증식의 G", "2343453800"),
    "fuwalos": ("마루챠미 후와로스", "4214149300"),
    "purulia": ("마루챠미 푸루리아", "8419258000"),
    "meowls": ("마루챠미 냐루스", "8712672100"),
}


@api_view(["GET"])
def get_deck_hyeol(request, deck_id):
    """상대법: brief 혈자리 summary (듀얼 아카이브 혈자리 아카이브, with permission); details stay on the archive."""
    from .models import DeckHyeol

    from card.models import Card

    h = DeckHyeol.objects.filter(deck_id=deck_id).first()
    if not h:
        return Response({"error": "no data"}, status=404)
    data = h.data
    arts = {c.card_id: c.card_illust.url for c in Card.objects.filter(card_id__in=[cid for _, cid in HYEOL_TRAP_CARDS.values()])
            if c.card_illust}
    for o in data.get("overview", []):
        name, cid = HYEOL_TRAP_CARDS.get(o.get("t"), (o.get("short", ""), None))
        o["name"] = name
        o["image"] = arts.get(cid)
    return Response({"deck_id": deck_id, **data})
