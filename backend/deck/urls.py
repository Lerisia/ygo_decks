from django.urls import path
from .views import get_deck_result, get_all_decks, get_deck_data, get_lookup_table

urlpatterns = [
    path("deck/result", get_deck_result),
    path("deck/", get_all_decks, name="all-decks"),
    path("deck/<int:deck_id>/", get_deck_data, name="deck-detail"),
    path("get_lookup_table/", get_lookup_table)
]
