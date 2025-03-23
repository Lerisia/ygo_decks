from django.urls import path
from .views import TournamentCreateView, TournamentListView, TournamentDetailView

urlpatterns = [
    path("tournament/create/", TournamentCreateView.as_view(), name="tournament-create"),
    path("tournament/", TournamentListView.as_view(), name="tournament-list"),
    path("tournament/<int:pk>/", TournamentDetailView.as_view(), name='tournament-detail'),
]