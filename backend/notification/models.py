from django.conf import settings
from django.db import models


class Notification(models.Model):
    """A message to one member, shown on My Page until they clear it and kept in their notification history
    (참혈 2026-10-11). `sender` is who it comes from as a plain label: 시스템, 운영자, later the inviting member."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    sender = models.CharField(max_length=50, default="시스템")
    body = models.TextField()
    action_label = models.CharField(max_length=40, blank=True, default="")
    action_url = models.CharField(max_length=200, blank=True, default="", help_text="site path such as /mypage/avatar")
    kind = models.CharField(max_length=30, blank=True, default="", help_text="what raised it, e.g. border_unlock")
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True, help_text="cleared from My Page (X or the action button)")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "read_at"])]

    def __str__(self):
        return f"[{self.sender}] {self.body[:30]}"


def notify(user, body, sender="시스템", action_label="", action_url="", kind=""):
    return Notification.objects.create(
        user=user, body=body, sender=sender[:50], action_label=action_label[:40], action_url=action_url[:200], kind=kind[:30],
    )
