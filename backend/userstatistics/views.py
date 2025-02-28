from django.http import JsonResponse
from deck.models import Deck
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def get_deck_statistics(request):
    """
    Returns deck statistics sorted by number of views (descending).
    """
    decks = Deck.objects.all().order_by('-num_views')

    data = [
        {
            "name": deck.name,
            "num_views": deck.num_views,
            "cover_image": request.build_absolute_uri(deck.cover_image.url) if deck.cover_image else None,
        }
        for deck in decks
    ]

    return JsonResponse({"decks": data}, safe=False)
