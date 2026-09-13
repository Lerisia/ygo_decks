from django.db import models

from user.models import User


class TrackerPendingMatch(models.Model):
    """A duel captured by the PC tracker, waiting for the user to confirm it on the record page."""
    STATUS_CHOICES = [("pending", "확인 대기"), ("confirmed", "기록됨"), ("discarded", "버림")]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tracker_pending")
    did = models.CharField(max_length=32, help_text="Master Duel duel id (dedup key)")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="pending", db_index=True)
    payload = models.JSONField(default=dict, help_text="tracker capture + server inference")
    match = models.OneToOneField("tool.MatchRecord", on_delete=models.SET_NULL, null=True, blank=True, related_name="tracker_pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["user", "did"], name="uniq_tracker_pending_user_did")]
        verbose_name = "트래커 확인 대기 게임"
        verbose_name_plural = "트래커 확인 대기 게임"

    def __str__(self):
        return f"{self.user.username} {self.did} ({self.status})"


class TrackerDeckMap(models.Model):
    """Which site deck the user said their Master Duel deck is — learned from confirmations."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tracker_deck_maps")
    md_deck_id = models.CharField(max_length=32)
    deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "md_deck_id"], name="uniq_tracker_deck_map")]

    def __str__(self):
        return f"{self.user.username}: {self.md_deck_id} → {self.deck.name}"
