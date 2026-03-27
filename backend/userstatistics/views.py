from datetime import date

from django.http import JsonResponse
from django.db.models import Count, Sum
from django.utils.timezone import now
from deck.models import Deck
from django.views.decorators.csrf import csrf_exempt
from .models import UserResponse

@csrf_exempt
def get_deck_statistics(request):
    """
    Returns deck statistics for the current month,
    sorted by number of appearances (descending).
    """
    today = now()
    month_start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if today.month == 12:
        next_month_start = month_start.replace(year=today.year + 1, month=1)
    else:
        next_month_start = month_start.replace(month=today.month + 1)

    monthly_responses = (
        UserResponse.objects
        .filter(date__gte=month_start, date__lt=next_month_start)
        .values('deck__id', 'deck__name', 'deck__cover_image_small')
        .annotate(num_views=Count('id'))
        .order_by('-num_views')
    )

    total_views = (
        UserResponse.objects
        .filter(date__gte=month_start, date__lt=next_month_start)
        .count()
    )
    total_decks = Deck.objects.count()

    data = [
        {
            "name": entry['deck__name'],
            "num_views": entry['num_views'],
            "cover_image": f"/media/{entry['deck__cover_image_small']}" if entry['deck__cover_image_small'] else None,
            "percentage": round((entry['num_views'] / total_views) * 100, 2) if total_views > 0 else 0
        }
        for entry in monthly_responses
    ]

    return JsonResponse({
        "total_views": total_views,
        "total_decks": total_decks,
        "decks": data,
        "period": f"{today.year}.{today.month:02d}",
    }, safe=False)
