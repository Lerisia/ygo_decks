from django.conf import settings
from django.db import models


class PageView(models.Model):
    """One SPA page visit. `visitor_id` is a random id kept in the browser's
    localStorage (no fingerprinting); `duration_sec` is reported by the
    client when the user leaves the page."""
    visitor_id = models.CharField(max_length=64, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    path = models.CharField(max_length=200)
    duration_sec = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def __str__(self):
        return f"{self.path} ({self.visitor_id[:8]})"
