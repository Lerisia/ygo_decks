from django.conf import settings
from django.db import models


class Tournament(models.Model):
    FORMAT_CHOICES = [
        ("single_elim", "싱글 엘리미네이션"),
        ("swiss", "스위스"),
        ("round_robin", "라운드 로빈"),
        ("swiss_cut", "스위스 + 결선 토너먼트"),
        ("group_knockout", "조별 리그 + 결선 토너먼트"),
        ("double_elim", "더블 엘리미네이션"),
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
    team_size = models.PositiveSmallIntegerField(default=1)  # 1 = individual; 2+ = every entrant is a team of this many
    event_date = models.DateTimeField()
    # The host's Master Duel UID, so entrants can find them in game; only entrants and the host see it.
    host_md_uid = models.CharField(max_length=9, blank=True, default="")
    # Optional join password, stored hashed; empty means anyone may register (특이점 2026-10-10).
    password = models.CharField(max_length=128, blank=True, default="")
    # How many deck lists each entrant hands in when joining (0 = none); set by the host, the form suggests 1.
    deck_count = models.PositiveSmallIntegerField(default=0)
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
    join_code = models.CharField(max_length=6, blank=True, default="")  # team entrants: what teammates type to join
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tournament", "user"], name="unique_tournament_user"),
        ]

    def __str__(self):
        return f"{self.name} @ {self.tournament.name}"

    @property
    def is_team(self):
        return self.user_id is None


class TeamMember(models.Model):
    """One person inside a team entrant. `order` is the default board order the captain set."""
    entrant = models.ForeignKey(Entrant, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tournament_team_memberships")
    md_uid = models.CharField(max_length=9, blank=True, default="")
    is_captain = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["entrant", "user"], name="unique_team_member"),
        ]

    def __str__(self):
        return f"{self.user.username} in {self.entrant.name}"


class Round(models.Model):
    STATUS_CHOICES = [("ongoing", "진행 중"), ("completed", "완료")]
    STAGE_CHOICES = [("swiss", "스위스"), ("knockout", "결선"), ("league", "리그"), ("main", "기본")]

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="rounds")
    number = models.PositiveIntegerField()
    stage = models.CharField(max_length=10, choices=STAGE_CHOICES, default="main")
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
    group = models.PositiveSmallIntegerField(null=True, blank=True)  # group-stage index (0 = A조); None elsewhere
    BRACKET_CHOICES = [("", "-"), ("winners", "승자조"), ("losers", "패자조"), ("final", "최종전")]
    bracket = models.CharField(max_length=8, choices=BRACKET_CHOICES, blank=True, default="")  # double elimination only
    result = models.CharField(max_length=6, choices=RESULT_CHOICES, null=True, blank=True)
    report_status = models.CharField(max_length=10, choices=REPORT_STATUS_CHOICES, default="pending")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        rival = self.entrant2.name if self.entrant2 else "(부전승)"
        return f"{self.round} {self.entrant1.name} vs {rival}"


class Board(models.Model):
    """One duel inside a team match: member of entrant1 vs member of entrant2, same board order."""
    RESULT_CHOICES = [("p1", "P1 승"), ("p2", "P2 승")]

    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="boards")
    order = models.PositiveSmallIntegerField()
    member1 = models.ForeignKey(TeamMember, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    member2 = models.ForeignKey(TeamMember, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    result = models.CharField(max_length=6, choices=RESULT_CHOICES, null=True, blank=True)
    report_status = models.CharField(max_length=10, choices=Match.REPORT_STATUS_CHOICES, default="pending")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"{self.match} board {self.order + 1}"


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
    team = models.ForeignKey(Entrant, null=True, blank=True, on_delete=models.CASCADE, related_name="+")  # set = visible to that team only
    content = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"[{self.tournament.name}] {self.user.username}: {self.content[:30]}"


class DeckSubmission(models.Model):
    """One deck per entrant (per member in team play): screenshot in, scanned card list out, manual fixes on top."""
    entrant = models.ForeignKey(Entrant, on_delete=models.CASCADE, related_name="deck_submissions")
    member = models.ForeignKey(TeamMember, null=True, blank=True, on_delete=models.CASCADE, related_name="deck_submissions")
    image = models.ImageField(upload_to="tournament_decks/", null=True, blank=True)
    slot = models.PositiveSmallIntegerField(default=0)  # which of the tournament's deck_count lists this is
    unmatched_count = models.PositiveIntegerField(default=0)  # scanner crops with no DB match
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["entrant", "member", "slot"], name="unique_deck_per_member_slot"),
        ]

    def __str__(self):
        return f"Deck of {self.member or self.entrant}"


class DeckSubmissionCard(models.Model):
    SOURCE_CHOICES = [("auto", "스캐너"), ("manual", "수동")]

    submission = models.ForeignKey(DeckSubmission, on_delete=models.CASCADE, related_name="cards")
    card = models.ForeignKey("card.Card", on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    new_card = models.ForeignKey("carddb.Card", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    quantity = models.PositiveIntegerField(default=1)
    confidence = models.FloatField(null=True, blank=True)  # null for manual entries
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES, default="manual")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["submission", "new_card"], name="unique_submission_new_card"),
        ]
