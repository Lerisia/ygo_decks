from django.http import JsonResponse
from deck.models import Deck
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def get_deck_statistics(request):
    """
    Returns deck statistics sorted by number of views (descending).
    Also includes total user participation count and percentage views for each deck.
    """
    decks = Deck.objects.all().order_by('-num_views')

    total_views = sum(deck.num_views for deck in decks)
    total_decks = decks.count()

    data = [
        {
            "name": deck.name,
            "num_views": deck.num_views,
            "cover_image": deck.cover_image_small.url if deck.cover_image else None,
            "percentage": round((deck.num_views / total_views) * 100, 2) if total_views > 0 else 0
        }
        for deck in decks
    ]

    return JsonResponse({"total_views": total_views, "total_decks": total_decks, "decks": data}, safe=False)
