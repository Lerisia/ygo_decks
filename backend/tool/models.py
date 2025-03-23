from django.db import models
from user.models import User
from deck.models import Deck
from django.core.exceptions import ValidationError

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
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.name}"

class MatchRecord(models.Model):
    record_group = models.ForeignKey("RecordGroup", on_delete=models.CASCADE, related_name="matches")
    deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="player_matches",)
    opponent_deck = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="opponent_matches", blank=True, null=True)

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
    score = models.PositiveIntegerField(
        blank=True,
        null=True,
        help_text="숫자로 된 점수 (레이팅, 듀얼리스트 컵, 이벤트 전용)"
    )

    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        super().clean()

        has_rank = bool(self.rank)
        has_score = bool(self.score)

        if has_rank and has_score:
            raise ValidationError("랭크와 점수 중 하나만 입력하세요.")

    def __str__(self):
        return f"{self.record_group} - {self.deck} vs {self.opponent_deck} ({self.result})"