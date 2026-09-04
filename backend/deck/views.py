import random
from django.http import JsonResponse
from django.db.models import Q
from django.utils.timezone import now
from django.shortcuts import get_object_or_404
from .models import Deck, AestheticTag, PerformanceTag, DeckAlias, STRENGTH_BAND_TO_TIERS, STRENGTH_TIER_TO_BANDS
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

    decks = Deck.objects.filter(query).distinct()
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
        all_decks = Deck.objects.all()
        deck = random.choice(all_decks) if all_decks.exists() else None

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
            "cover_image": deck.cover_image_small.url if deck.cover_image_small else None,
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

    deck_data = {
        "id": deck.id,
        "name": deck.name,
        "cover_image": deck.cover_image.url if deck.cover_image else None,
        "cover_image_small": deck.cover_image_small.url if deck.cover_image_small else None,
        "strength": deck.get_strength_display(),
        "difficulty": deck.get_difficulty_display(),
        "deck_type": deck.get_deck_type_display(),
        "art_style": deck.get_art_style_display(),
        "is_engine": deck.is_engine,
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

    return Response(deck_data)


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