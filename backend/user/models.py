from django.contrib.auth.models import AbstractUser
from django.db import models
from deck.models import Deck

class User(AbstractUser):
    username = models.CharField(max_length=50, unique=True, verbose_name="닉네임")
    email = models.EmailField(unique=True, verbose_name="이메일")

    first_name = None
    last_name = None

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ["username"]

    owned_decks = models.ManyToManyField(Deck, blank=True, related_name="owners")
    
    use_custom_lookup = models.BooleanField(default=False)
    pending_deletion = models.BooleanField(default=False)
    deletion_requested_at = models.DateTimeField(null=True, blank=True)
    avatar_icon = models.ForeignKey(
        "avatar.CardIcon",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="users",
    )
    equipped_border = models.ForeignKey(
        "avatar.Border",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="equipped_by_users",
    )
    points = models.PositiveIntegerField(default=0)
    lifetime_points_earned = models.PositiveIntegerField(default=0, help_text="Cumulative points ever earned (never decreases). Used for border tier unlocks.")
    last_daily_bonus_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.username


class BannedWord(models.Model):
    word = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.word

    class Meta:
        ordering = ['word']


class PointTransaction(models.Model):
    """Audit log of every points change. Positive amount = earn,
    negative = spend. Written by `user.points.award_points()` and the
    spend paths (icon shop). Powers the /mypage/points history page."""
    KIND_CHOICES = [
        ("daily_bonus", "데일리 보너스"),
        ("game_dm", "듀치마인드 플레이"),
        ("game_quiz", "화질구지 퀴즈 플레이"),
        ("game_twenty", "딱무고개 플레이"),
        ("quiz_monthly", "화질구지 퀴즈 월간 보상"),
        ("quiz_weekly", "화질구지 퀴즈 주간 보상"),
        ("icon_purchase", "아이콘 구매"),
        ("border_purchase", "테두리 구매"),
        ("admin_grant", "관리자 지급"),
        ("other", "기타"),
    ]
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="point_transactions"
    )
    amount = models.IntegerField(help_text="양수=획득, 음수=소비")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="other", db_index=True)
    note = models.CharField(max_length=200, blank=True, default="")
    balance_after = models.IntegerField(help_text="이 트랜잭션 적용 후 user.points 스냅샷")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        sign = "+" if self.amount >= 0 else ""
        return f"{self.user.username} {sign}{self.amount}P ({self.kind}) → {self.balance_after}"