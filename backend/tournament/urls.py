from django.urls import path

from .views import (check_in, complete_tournament, confirm_match,
                    create_tournament, dispute_match, kick, list_tournaments,
                    next_round, override_match, register, report_match,
                    standings, start_tournament, tournament_detail, withdraw)

urlpatterns = [
    path("create/", create_tournament),
    path("", list_tournaments),
    path("<int:tournament_id>/", tournament_detail),
    path("<int:tournament_id>/register/", register),
    path("<int:tournament_id>/withdraw/", withdraw),
    path("<int:tournament_id>/check-in/", check_in),
    path("<int:tournament_id>/kick/", kick),
    path("<int:tournament_id>/start/", start_tournament),
    path("<int:tournament_id>/next-round/", next_round),
    path("<int:tournament_id>/complete/", complete_tournament),
    path("<int:tournament_id>/standings/", standings),
    path("matches/<int:match_id>/report/", report_match),
    path("matches/<int:match_id>/confirm/", confirm_match),
    path("matches/<int:match_id>/dispute/", dispute_match),
    path("matches/<int:match_id>/override/", override_match),
]
