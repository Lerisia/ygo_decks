from django.urls import path
from .views import TournamentCreateView, TournamentListView, TournamentDetailView, create_bracket, \
                   get_bracket_detail, generate_next_pairings, submit_match_result, get_standings, get_bracket_tree

urlpatterns = [
    path("tournament/create/", TournamentCreateView.as_view(), name="tournament-create"),
    path("tournament/", TournamentListView.as_view(), name="tournament-list"),
    path("tournament/<int:pk>/", TournamentDetailView.as_view(), name='tournament-detail'),
    path('brackets/', create_bracket, name='create_bracket'),
    path('brackets/<int:bracket_id>/', get_bracket_detail, name='get_bracket_detail'),
    path('brackets/<int:bracket_id>/pairings/next/', generate_next_pairings, name='generate_next_pairings'),
    path('brackets/<int:bracket_id>/match-result/', submit_match_result, name='submit_match_result'),
    path('brackets/<int:bracket_id>/standings/', get_standings, name='get_standings'),
    path('brackets/<int:bracket_id>/tree/', get_bracket_tree, name='get_bracket_tree'),
]