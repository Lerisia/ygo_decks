import random
from django.http import JsonResponse
from django.db.models import Q
from django.utils.timezone import now
from .models import Deck
from userstatistics.models import UserResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
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

    # IntegerField filtering
    query = Q()
    if search_params.get("art_style") is not None:
        query &= Q(art_style=search_params["art_style"])
    if search_params.get("deck_type") is not None:
        query &= Q(deck_type=search_params["deck_type"])
    if search_params.get("difficulty") is not None:
        query &= Q(difficulty=search_params["difficulty"])
    if search_params.get("strength") is not None:
        query &= Q(strength=search_params["strength"])

    # ManyToManyField filtering (Summoning Methods & Tags)
    summoning_method_ids = search_params.get("summoning_methods", [])
    performance_tag_ids = search_params.get("performance_tags", [])
    aesthetic_tag_ids = search_params.get("aesthetic_tags", [])

    if summoning_method_ids:
        query &= Q(summoning_methods__id__in=summoning_method_ids)

    if performance_tag_ids:
        query &= Q(performance_tags__id__in=performance_tag_ids)
        
    if aesthetic_tag_ids:
        query &= Q(aesthetic_tags__id__in=aesthetic_tag_ids)

    # Apply initial query
    decks = Deck.objects.filter(query).distinct()
    print("Filtered QuerySet count:", decks.count())
    
    if request.user.is_authenticated and request.user.use_custom_lookup: # if logged in and use custom lookup
        owned_deck_ids = list(request.user.owned_decks.values_list("id", flat=True))
        print(f"Owned deck IDs to exclude: {owned_deck_ids}")

        if owned_deck_ids:
            decks = decks.exclude(id__in=owned_deck_ids)
            print("Filtered QuerySet after owned deck exclusion:", decks.count())
        else:
            print("No owned decks to exclude.")

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
        "name": deck.name,
        "cover_image": request.build_absolute_uri(deck.cover_image.url) if deck.cover_image else None,
        "strength": deck.get_strength_display(),
        "difficulty": deck.get_difficulty_display(),
        "deck_type": deck.get_deck_type_display(),
        "art_style": deck.get_art_style_display(),
        "summoning_methods": [method.get_method_display() for method in deck.summoning_methods.all()],
        "performance_tags": [performance_tag.name for performance_tag in deck.performance_tags.all()],
        "aesthetic_tags": [aesthetic_tag.name for aesthetic_tag in deck.aesthetic_tags.all()],
        "description": deck.description
    }

    return JsonResponse(result_data, safe=False)

@api_view(["GET"])
def get_all_decks(request):
    decks = Deck.objects.all().order_by("name")

    deck_data = [
        {
            "id": deck.id,
            "name": deck.name,
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
        "strength": deck.get_strength_display(),
        "difficulty": deck.get_difficulty_display(),
        "deck_type": deck.get_deck_type_display(),
        "art_style": deck.get_art_style_display(),
        "summoning_methods": [method.get_method_display() for method in deck.summoning_methods.all()],
        "performance_tags": [tag.name for tag in deck.performance_tags.all()],
        "aesthetic_tags": [tag.name for tag in deck.aesthetic_tags.all()],
        "description": deck.description,
    }

    return Response(deck_data)

import os
import json
from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

@api_view(["GET"])
def get_lookup_table(request):
    base_lookup_path = os.path.join(settings.MEDIA_ROOT, "lookup_tables", "lookup_table.json")

    # Case 1: Not logged in -> default look-up table
    if not request.user.is_authenticated:
        with open(base_lookup_path, "r") as f:
            return Response({"lookup_table": json.load(f)})

    # Case 2: Logged in but not use custom test -> default look-up table
    user = request.user
    if not user.use_custom_lookup:
        with open(base_lookup_path, "r") as f:
            return Response({"lookup_table": json.load(f)})

    # Case 3: Logged in and use custom test -> custom look-up table
    user_lookup_path = os.path.join(settings.MEDIA_ROOT, "lookup_tables", f"lookup_table_{user.id}.json")
    
    if os.path.exists(user_lookup_path):
        with open(user_lookup_path, "r") as f:
            return Response({"lookup_table": json.load(f)})

    with open(base_lookup_path, "r") as f:
        return Response({"lookup_table": json.load(f), "message": "Custom Look-up Table이 아직 생성되지 않아 기본 테이블을 제공합니다."})
