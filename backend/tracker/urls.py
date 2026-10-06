from django.urls import path

from .views import client_status, public_stats, games, matchup, pending_discard, pending_matches, today, tracker_infer, tracker_snapshot, version_info, test_unlock, test_log

urlpatterns = [
    path("infer/", tracker_infer, name="tracker-infer"),
    path("snapshot/", tracker_snapshot, name="tracker-snapshot"),
    path("games/", games, name="tracker-games"),
    path("version/", version_info, name="tracker-version"),
    path("public-stats/", public_stats, name="tracker-public-stats"),
    path("test/unlock/", test_unlock, name="tracker-test-unlock"),
    path("test/log/", test_log, name="tracker-test-log"),
    path("matchup/", matchup, name="tracker-matchup"),
    path("today/", today, name="tracker-today"),
    path("client-status/", client_status, name="tracker-client-status"),
    path("pending/", pending_matches, name="tracker-pending"),
    path("pending/<int:pending_id>/discard/", pending_discard, name="tracker-pending-discard"),
]
