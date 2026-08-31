from django.conf import settings
from django.db import models


class Tournament(models.Model):
    FORMAT_CHOICES = [
        ("single_elim", "싱글 엘리미네이션"),
        ("swiss", "스위스"),
        ("round_robin", "라운드 로빈"),
    ]
    STATUS_CHOICES = [
        ("recruiting", "모집 중"),
        ("ongoing", "진행 중"),
        ("completed", "종료"),
        ("cancelled", "취소됨"),
    ]

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    cover_image = models.ImageField(upload_to="tournament_covers/", blank=True, null=True)
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hosted_tournaments")
    format = models.CharField(max_length=20, choices=FORMAT_CHOICES)
    # Per-format options (bo, swiss_rounds, ...) plus engine state such as the
    # round-robin schedule materialised at start time.
    format_config = models.JSONField(default=dict, blank=True)
    capacity = models.PositiveIntegerField(default=8)
    event_date = models.DateTimeField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="recruiting")
    current_round = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Entrant(models.Model):
    """Participation unit. Today always a single user; kept separate from the
    user itself so team entrants can slot in later without reshaping brackets."""
    STATUS_CHOICES = [
        ("registered", "신청"),
        ("checked_in", "체크인"),
        ("withdrawn", "기권"),
        ("kicked", "제외됨"),
    ]

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="entrants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.CASCADE, related_name="tournament_entries")
    name = models.CharField(max_length=100)  # display snapshot; team name later
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="registered")
    md_uid = models.CharField(max_length=9, blank=True, default="")  # Master Duel 9-digit UID
    seed = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tournament", "user"], name="unique_tournament_user"),
        ]

    def __str__(self):
        return f"{self.name} @ {self.tournament.name}"


class Round(models.Model):
    STATUS_CHOICES = [("ongoing", "진행 중"), ("completed", "완료")]

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="rounds")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ongoing")
    random_seed = models.CharField(max_length=64, blank=True, default="")  # reproduces the draw
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tournament", "number"], name="unique_tournament_round"),
        ]

    def __str__(self):
        return f"{self.tournament.name} R{self.number}"


class Match(models.Model):
    RESULT_CHOICES = [("p1", "P1 승"), ("p2", "P2 승"), ("draw", "무승부"), ("bye", "부전승")]
    REPORT_STATUS_CHOICES = [
        ("pending", "대기"),
        ("reported", "보고됨"),
        ("confirmed", "확정"),
        ("disputed", "이의 제기"),
    ]

    round = models.ForeignKey(Round, on_delete=models.CASCADE, related_name="matches")
    entrant1 = models.ForeignKey(Entrant, on_delete=models.CASCADE, related_name="matches_as_p1")
    entrant2 = models.ForeignKey(Entrant, null=True, blank=True, on_delete=models.CASCADE, related_name="matches_as_p2")  # None = bye
    bracket_pos = models.PositiveIntegerField(default=0)  # single-elim advancement order
    result = models.CharField(max_length=6, choices=RESULT_CHOICES, null=True, blank=True)
    report_status = models.CharField(max_length=10, choices=REPORT_STATUS_CHOICES, default="pending")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        rival = self.entrant2.name if self.entrant2 else "(부전승)"
        return f"{self.round} {self.entrant1.name} vs {rival}"


class Announcement(models.Model):
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="announcements")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    content = models.TextField()
    pinned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-pinned", "-created_at"]

    def __str__(self):
        return f"[{self.tournament.name}] {self.content[:30]}"


class ChatMessage(models.Model):
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="chat_messages")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    content = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"[{self.tournament.name}] {self.user.username}: {self.content[:30]}"
