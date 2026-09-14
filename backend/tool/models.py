from django.db import models
from user.models import User
from deck.models import Deck
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, MaxValueValidator

RANK_CHOICES = [
    ("rookie2", "루키 2"),
    ("rookie1", "루키 1"),

    ("bronze5", "브론즈 5"),
    ("bronze4", "브론즈 4"),
    ("bronze3", "브론즈 3"),
    ("bronze2", "브론즈 2"),
    ("bronze1", "브론즈 1"),

    ("silver5", "실버 5"),
    ("silver4", "실버 4"),
    ("silver3", "실버 3"),
    ("silver2", "실버 2"),
    ("silver1", "실버 1"),

    ("gold5", "골드 5"),
    ("gold4", "골드 4"),
    ("gold3", "골드 3"),
    ("gold2", "골드 2"),
    ("gold1", "골드 1"),

    ("platinum5", "플래티넘 5"),
    ("platinum4", "플래티넘 4"),
    ("platinum3", "플래티넘 3"),
    ("platinum2", "플래티넘 2"),
    ("platinum1", "플래티넘 1"),

    ("diamond5", "다이아 5"),
    ("diamond4", "다이아 4"),
    ("diamond3", "다이아 3"),
    ("diamond2", "다이아 2"),
    ("diamond1", "다이아 1"),

    ("master5", "마스터 5"),
    ("master4", "마스터 4"),
    ("master3", "마스터 3"),
    ("master2", "마스터 2"),
    ("master1", "마스터 1"),
]

class RecordGroup(models.Model):
    KIND_CHOICES = [("solo", "개인 시트"), ("shared", "공유 시트")]

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    is_deleted = models.BooleanField(default=False)
    is_public = models.BooleanField(default=False)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default="solo")
    invite_code = models.CharField(max_length=12, blank=True, default="", db_index=True)

    def __str__(self):
        return f"{self.user.username} - {self.name}"


class RecordGroupMember(models.Model):
    """Someone other than the owner who may use a shared sheet."""
    ROLE_CHOICES = [("editor", "기록 가능"), ("viewer", "보기 전용")]

    record_group = models.ForeignKey(RecordGroup, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="record_group_memberships")
    role = models.CharField(max_length=8, choices=ROLE_CHOICES, default="editor")
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["record_group", "user"], name="uniq_record_group_member")]
        verbose_name = "시트 멤버"
        verbose_name_plural = "시트 멤버"

    def __str__(self):
        return f"{self.record_group.name}: {self.user.username} ({self.role})"

class MatchRecord(models.Model):
    record_group = models.ForeignKey("RecordGroup", on_delete=models.CASCADE, related_name="matches")
    recorded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="recorded_matches",
                                    help_text="이 기록을 넣은 사람 (공유 시트에서 기여자 구분)")
    deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="player_matches",)
    opponent_deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="opponent_matches", blank=True, null=True)
    opponent_deck_name = models.CharField(max_length=100, blank=True, null=True)
    is_deleted = models.BooleanField(default=False)

    first_or_second = models.CharField(
        max_length=10,
        choices=[('first', '선공'), ('second', '후공')]
    )
    
    result = models.CharField(
        max_length=10,
        choices=[('win', '승리'), ('lose', '패배')]
    )

    coin_toss_result = models.CharField(
        max_length=10,
        choices=[('win', '코인토스 승리'), ('lose', '코인토스 패배')],
    )

    rank = models.CharField(
        max_length=20,
        choices=RANK_CHOICES,
        blank=True,
        null=True,
        help_text="플래티넘 1, 마스터 3 등"
    )
    
    wins = models.IntegerField(
        blank=True,
        null=True,
        validators=[MinValueValidator(-3), MaxValueValidator(4)],
        help_text="-3부터 4 사이의 승수만 입력 가능합니다. -4면 강등, +5면 승급입니다."
    )
    
    SCORE_TYPE_CHOICES = [
        ("rating", "레이팅"),
        ("duelist_cup", "듀얼리스트 컵"),
        ("other", "기타"),
    ]

    score = models.PositiveIntegerField(
        blank=True,
        null=True,
        help_text="숫자로 된 점수"
    )
    score_type = models.CharField(
        max_length=20,
        choices=SCORE_TYPE_CHOICES,
        blank=True,
        null=True,
    )

    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        super().clean()

        has_rank = bool(self.rank)
        has_score = bool(self.score)
        has_wins = bool(self.wins)

        if has_rank:
            if has_score and has_wins:
                raise ValidationError("랭크를 입력한 경우 승수 또는 점수만 입력할 수 있습니다. 둘 다 입력할 수 없습니다.")
            elif has_score and not self.wins:
                raise ValidationError("랭크가 입력된 경우 승수를 입력할 수 있습니다.")

        if has_score and has_wins:
            raise ValidationError("점수와 승수는 동시에 입력할 수 없습니다.")

    def __str__(self):
        return f"{self.record_group} - {self.deck} vs {self.opponent_deck} ({self.result})"


class SiteConfig(models.Model):
    key = models.CharField(max_length=50, unique=True)
    value = models.TextField()

    def __str__(self):
        return f"{self.key}: {self.value}"

    @classmethod
    def get(cls, key, default=None):
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            return default
