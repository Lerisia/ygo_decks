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
        verbose_name = "레코더 확인 대기 게임"
        verbose_name_plural = "레코더 확인 대기 게임"

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


class TrackerGameQuerySet(models.QuerySet):
    def corrected(self):
        """Saved games whose opponent deck differs from what the server suggested at duel end — the user fixed it.
        '모름/기타' (no deck) is not counted: that is giving up, not a correction."""
        return (self.filter(match__isnull=False, match__is_deleted=False, match__opponent_deck__isnull=False,
                            suggested_opp_deck__isnull=False)
                .exclude(match__opponent_deck=models.F("suggested_opp_deck")))


class TrackerGame(models.Model):
    """Raw capture of every duel the tracker sees — full own decklist and every opponent card revealed —
    kept regardless of whether the user confirmed a record. Card ids are Konami ids (alt arts resolved)."""
    objects = TrackerGameQuerySet.as_manager()
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
    hidden = models.BooleanField(default=False, help_text="captured while the person had recording paused: kept for research, left out of their own stats")
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True, db_index=True)
    match = models.ForeignKey("tool.MatchRecord", on_delete=models.SET_NULL, null=True, blank=True, related_name="tracker_games")
    suggested_opp_deck = models.ForeignKey("deck.Deck", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
                                           help_text="판이 끝났을 때 서버가 제안한 상대 덱 (유저가 다른 덱으로 저장하면 교정)")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-ended_at"]
        constraints = [models.UniqueConstraint(fields=["user", "did"], name="uniq_tracker_game_user_did")]
        verbose_name = "레코더 게임 원본"
        verbose_name_plural = "레코더 게임 원본"

    @property
    def corrected(self):
        m = self.match
        return bool(m and not m.is_deleted and m.opponent_deck_id and self.suggested_opp_deck_id
                    and m.opponent_deck_id != self.suggested_opp_deck_id)

    def __str__(self):
        return f"{self.user.username} {self.did} {self.result}"


class TrackerClient(models.Model):
    """Last PC tracker build a user was seen running (from the X-Tracker-Version header).
    An empty version means a build from before version reporting existed."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="tracker_client")
    version = models.CharField(max_length=20, blank=True, default="")
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "레코더 클라이언트"
        verbose_name_plural = "레코더 클라이언트"

    def __str__(self):
        return f"{self.user.username} {self.version or '(구버전)'}"


class TrackerCardDeckStat(models.Model):
    """How many user-labeled duels showed this opponent card, per opponent deck (konami_id 0 = all labeled duels
    of that deck). Rebuilt nightly by `rebuild_card_deck_stats`; used only when theme votes give no guess."""
    konami_id = models.IntegerField(db_index=True)
    deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="+")
    games = models.IntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["konami_id", "deck"], name="uniq_tracker_card_deck_stat")]
        verbose_name = "카드별 상대 덱 통계"
        verbose_name_plural = "카드별 상대 덱 통계"
