"""Solo Duchmind — single-player async drawing/guessing board.

A user picks one of 3 offered cards, draws it (100s time limit), and
posts the drawing to a public board. Other users get 3 guess attempts
per drawing. Both the drawer and correct guessers earn points (capped
to prevent farming).
"""
from django.conf import settings
from django.db import models

# Solo-mode tunables. Drawing time limit is 100s (longer than multiplayer
# defaults — the drawer has no competitive pressure / no timer hint, so
# extra patience is fine).
SOLO_DRAW_SECONDS = 100
# Guessing itself is unlimited, but a correct answer only earns points if it
# lands within this many attempts — try a 4th time and you can still mark it
# solved, just for zero points.
SOLO_POINT_ATTEMPT_LIMIT = 3
# Unified daily points ceiling. Covers BOTH drawer rewards and guesser
# rewards combined — once a user has earned this much from Solo Duchmind in
# one day, further solves/draws pay nothing. No per-day drawing-count limit.
SOLO_DAILY_POINTS_CAP = 100
SOLO_DRAWING_LIFESPAN_DAYS = 3
SOLO_DRAWER_FIRST_POINTS = 5
SOLO_DRAWER_NEXT_POINTS = 1
SOLO_DRAWER_MAX_POINTS = 10
SOLO_GUESSER_FIRST_POINTS = 5
SOLO_GUESSER_NEXT_POINTS = 1


class SoloDrawing(models.Model):
    """One drawing posted to the solo board."""

    drawer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="solo_drawings",
    )
    # Card the drawer chose to draw. Word snapshot in `word` so renames of
    # the underlying card don't invalidate old drawings.
    card = models.ForeignKey(
        "card.Card",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="solo_drawings",
    )
    word = models.CharField(max_length=200, help_text="정답 (스냅샷)")
    # The canvas stroke buffer (same DmStrokePayload[] shape the multi-
    # player drawer pushes). Stored as JSON.
    strokes_json = models.JSONField(default=list)
    # Canvas width/height ratio the drawing was made at. Strokes are
    # normalized 0..1, so viewers must replay onto a canvas of the SAME
    # aspect or the drawing stretches — phones draw landscape (~1.6), but
    # a tablet held portrait can submit a tall ratio.
    aspect_ratio = models.FloatField(default=1.6, help_text="캔버스 가로/세로 비율")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True, help_text="3일 후 자동 만료")
    # Cached counters for fast board queries (incremented on guess/recommend).
    solver_count = models.PositiveIntegerField(default=0)
    recommend_count = models.PositiveIntegerField(default=0, db_index=True)
    # Drawer points already paid out for this drawing (cap 10).
    drawer_points_earned = models.PositiveIntegerField(default=0)
    # Soft-delete: drawer can hide their own drawing before expiry.
    is_hidden = models.BooleanField(default=False)
    # Banner of "first solved" — fast filter for unsolved-first sort.
    first_solved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-recommend_count", "-created_at"]),
            models.Index(fields=["expires_at", "is_hidden"]),
        ]

    def __str__(self):
        return f"#{self.id} {self.drawer_id} · {self.word}"


class SoloDrawingGuess(models.Model):
    """A guesser's attempts on one drawing. One row per (drawing, guesser);
    `attempts_used` increments up to 3, `solved=True` flips on correct."""

    drawing = models.ForeignKey(SoloDrawing, on_delete=models.CASCADE, related_name="guesses")
    guesser = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="solo_guesses",
    )
    attempts_used = models.PositiveSmallIntegerField(default=0)
    solved = models.BooleanField(default=False)
    solved_at = models.DateTimeField(null=True, blank=True)
    points_earned = models.PositiveIntegerField(default=0)
    # Per-user "give up" — the answer is revealed (like solving) but no
    # points are paid out and further guesses are blocked. Permanent.
    gave_up = models.BooleanField(default=False)
    gave_up_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["drawing", "guesser"], name="unique_drawing_guesser"),
        ]
        indexes = [
            models.Index(fields=["guesser", "-created_at"]),
        ]


class SoloDrawingRecommend(models.Model):
    """Per-user recommendation toggle on a drawing. Drawers can't
    self-recommend."""

    drawing = models.ForeignKey(SoloDrawing, on_delete=models.CASCADE, related_name="recommends")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="solo_recommends",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["drawing", "user"], name="unique_drawing_recommender"),
        ]


SOLO_SOURCE_DUCHMIND = "duchmind"
SOLO_SOURCE_TWENTY = "twenty"


class SoloDailyPoints(models.Model):
    """Per-source daily ledger enforcing the SOLO_DAILY_POINTS_CAP per game
    mode. Originally a unified cap (one row per user+date) — now split by
    `source` so each solo game can be capped independently (e.g. 100P from
    duchmind + 100P from twenty per day).

    `drawings_created` and `pending_offer_*` only apply to the duchmind
    source; they're harmlessly unused on the twenty row.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="solo_daily_points",
    )
    date = models.DateField(db_index=True)
    source = models.CharField(
        max_length=16,
        default=SOLO_SOURCE_DUCHMIND,
        choices=[
            (SOLO_SOURCE_DUCHMIND, "솔로 듀치마인드"),
            (SOLO_SOURCE_TWENTY, "솔로 딱무고개"),
        ],
        db_index=True,
    )
    points_earned = models.PositiveIntegerField(default=0, help_text="오늘 이 게임 모드로 번 포인트")
    drawings_created = models.PositiveSmallIntegerField(default=0, help_text="오늘 만든 그림 수 (duchmind 통계용)")
    # The currently-offered 3 card choices, persisted so a refresh / re-open
    # can't re-roll the deal until the user actually submits a drawing.
    # Cleared on submit; a new day's row naturally starts empty.
    pending_offer_cards = models.JSONField(default=list, blank=True, help_text="현재 제시된 카드 3장 (리롤 방지)")
    pending_offer_token = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "date", "source"], name="unique_user_date_source_solo"),
        ]


# Solo 딱무고개 (Twenty Questions) tunables.
SOLO_TW_QUESTION_BUDGET = 20  # questions per game (including the guess-attempts)
# (used_count, points) ladder — score tiers based on questions consumed when
# the player lands the correct guess. Above the last threshold = 0 points.
SOLO_TW_SCORE_LADDER = [
    (10, 20),  # 1~10질문 → 20P
    (12, 19),  # 11~12질문 → 19P
    (14, 18),  # 13~14질문 → 18P
    (16, 17),  # 15~16질문 → 17P
    (18, 16),  # 17~18질문 → 16P
    (20, 15),  # 19~20질문 → 15P
    (21, 15),  # 21번째(최후의 시도) → 15P 보장 — 맞추기만 하면 15점
]
# Hint usage penalties — cumulative. 1st hint: -1P, 2nd: -2P, 3rd: -2P.
# Total max penalty = 5P (so even 3-hint + 21st-guess wins still pay ≥10P).
SOLO_TW_HINT_PENALTIES = [0, 1, 3, 5]
SOLO_TW_MAX_HINTS = 3


class SoloTwentyGame(models.Model):
    """Solo 딱무고개 — single-player twenty-questions vs a secret card.

    The server picks a card from the 중급 word pack at start, then answers
    a sequence of structured yes/no questions (frame_type / attribute /
    race / level / atk/def / archetype / tuner / extra_deck). A guess
    attempt also costs one question; correct guess wins, otherwise the
    game ends when the question budget is empty."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="solo_tw_games",
    )
    card = models.ForeignKey(
        "card.Card",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="solo_tw_games",
    )
    # Korean name snapshot so a card rename can't rewrite history.
    card_name_snapshot = models.CharField(max_length=200, default="")
    # Pool used for card selection. Matches DuchMindWordPack.name. Empty
    # string = legacy games (pre-difficulty); treat as "중급".
    difficulty = models.CharField(max_length=16, default="중급", db_index=True)
    # How many hints the player has consumed (0..SOLO_TW_MAX_HINTS).
    # Each hint reveals one dimension of the secret card and reduces the
    # win reward per SOLO_TW_HINT_PENALTIES.
    hints_used = models.PositiveSmallIntegerField(default=0)
    # Player chose to exclude Spell/Trap cards from the pool at game start.
    # When True, the pool is monsters-only and the FE hides ST-related
    # menu questions (몬스터/마법/함정/마함 분기, spell_kind, trap_kind).
    exclude_st = models.BooleanField(default=False)
    questions_used = models.PositiveSmallIntegerField(default=0)
    # Turn history. Each entry: {kind: "ask" | "guess",
    #   q_type, q_value, q_text, answer (bool), choice_name (guess only)}.
    history = models.JSONField(default=list)
    status = models.CharField(
        max_length=16,
        choices=[("active", "진행 중"), ("won", "정답"), ("lost", "실패")],
        default="active", db_index=True,
    )
    points_awarded = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "status"])]
