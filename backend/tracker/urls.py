from django.urls import path

from .views import pending_discard, pending_matches, tracker_infer, tracker_snapshot

urlpatterns = [
    path("infer/", tracker_infer, name="tracker-infer"),
    path("snapshot/", tracker_snapshot, name="tracker-snapshot"),
    path("pending/", pending_matches, name="tracker-pending"),
    path("pending/<int:pending_id>/discard/", pending_discard, name="tracker-pending-discard"),
]
