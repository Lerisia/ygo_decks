import random
from django.http import JsonResponse
from django.db.models import Q
from django.utils.timezone import now
from .models import Deck
from userstatistics.models import UserResponse

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
