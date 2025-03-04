import csv
from django.http import HttpResponse
from rest_framework.decorators import api_view
from .models import Card

@api_view(["GET"])
def export_cards_csv(request):
    """Convert card data to CSV file"""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="cards.csv"'

    writer = csv.writer(response, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(["ID", "Image URL"])

    for card in Card.objects.iterator():
        image_url = request.build_absolute_uri(card.card_image.url) if card.card_image else ""

        writer.writerow([
            str(card.card_id),
            image_url
        ])

    return response
