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


class TrackerGame(models.Model):
    """Raw capture of every duel the tracker sees — full own decklist and every opponent card revealed —
    kept regardless of whether the user confirmed a record. Card ids are Konami ids (alt arts resolved)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tracker_games")
    did = models.CharField(max_length=32)
    game_mode = models.IntegerField(help_text="3 rank, 19 rate")
    result = models.CharField(max_length=8, blank=True, default="")
    finish = models.CharField(max_length=32, blank=True, default="")
    coin_win = models.BooleanField(null=True)
    first = models.BooleanField(null=True)
    my_name = models.CharField(max_length=64, blank=True, default="")
    opp_name = models.CharField(max_length=64, blank=True, default="")
    rank_before = models.JSONField(null=True, blank=True)
    rank_after = models.JSONField(null=True, blank=True)
    rank_code = models.CharField(max_length=16, blank=True, default="")
    wins = models.IntegerField(null=True, blank=True)
    rating_before = models.FloatField(null=True, blank=True)
    rating_after = models.FloatField(null=True, blank=True)
    turn = models.IntegerField(default=0)
    md_deck_id = models.CharField(max_length=32, blank=True, default="")
    my_cards = models.JSONField(default=list, help_text="main+extra card ids as listed by the game")
    opp_cards = models.JSONField(default=list, help_text="[{id, pos, face}] every opponent card the engine revealed")
    turn_times = models.JSONField(null=True, blank=True, help_text="[{turn, me, sec}] wall-clock seconds per turn")
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True, db_index=True)
    match = models.ForeignKey("tool.MatchRecord", on_delete=models.SET_NULL, null=True, blank=True, related_name="tracker_games")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-ended_at"]
        constraints = [models.UniqueConstraint(fields=["user", "did"], name="uniq_tracker_game_user_did")]
        verbose_name = "트래커 게임 원본"
        verbose_name_plural = "트래커 게임 원본"

    def __str__(self):
        return f"{self.user.username} {self.did} {self.result}"


class TrackerClient(models.Model):
    """Last PC tracker build a user was seen running (from the X-Tracker-Version header).
    An empty version means a build from before version reporting existed."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="tracker_client")
    version = models.CharField(max_length=20, blank=True, default="")
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "트래커 클라이언트"
        verbose_name_plural = "트래커 클라이언트"

    def __str__(self):
        return f"{self.user.username} {self.version or '(구버전)'}"
