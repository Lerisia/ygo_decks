from django.urls import path
from .views import get_deck_result, get_all_decks, get_popular_decks, get_deck_data, get_tags, update_wiki_content, recommend_step, get_deck_videos, get_deck_notes, get_deck_hyeol, edit_deck_info, create_deck, replace_deck_cover

urlpatterns = [
    path("deck/result", get_deck_result),
    path("deck/recommend/step", recommend_step, name="recommend-step"),
    path("deck/", get_all_decks, name="all-decks"),
    path("deck/popular/", get_popular_decks, name="popular-decks"),
    path("deck/<int:deck_id>/", get_deck_data, name="deck-detail"),
    path("deck/<int:deck_id>/videos/", get_deck_videos, name="deck-videos"),
    path("deck/<int:deck_id>/notes/", get_deck_notes, name="deck-notes"),
    path("deck/<int:deck_id>/hyeol/", get_deck_hyeol, name="deck-hyeol"),
    path("tags/", get_tags, name="get-tags"),
    path("deck/<int:deck_id>/update_wiki/", update_wiki_content, name="update_wiki_content"),
    path("deck/<int:deck_id>/edit/", edit_deck_info, name="edit-deck-info"),
    path("deck/<int:deck_id>/cover/", replace_deck_cover, name="replace-deck-cover"),
    path("deck/create/", create_deck, name="create-deck"),
]
