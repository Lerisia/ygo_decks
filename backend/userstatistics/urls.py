from django.urls import path
from .views import get_deck_statistics

urlpatterns = [
    path('statistics/decks/', get_deck_statistics, name='deck-statistics'),
]