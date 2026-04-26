from django.db import models
from django.conf import settings
from django.utils import timezone
import secrets


def generate_room_code():
    """6-char alphanumeric room code (excluding ambiguous chars)."""
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not Room.objects.filter(code=code).exists():
            return code


class Room(models.Model):
    STATUS_CHOICES = [
        ("waiting", "대기 중"),
        ("in_game", "게임 진행 중"),
        ("closed", "종료됨"),
    ]

    code = models.CharField(max_length=8, unique=True, db_index=True, default=generate_room_code)
    name = models.CharField(max_length=50)
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="hosted_rooms",
    )
    password = models.CharField(max_length=128, blank=True, default="")
    max_players = models.PositiveSmallIntegerField(default=8)
    allow_guests = models.BooleanField(default=False)
    is_listed = models.BooleanField(default=True, help_text="방 목록 노출 여부")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="waiting")
    current_game = models.CharField(max_length=32, blank=True, default="")
    game_state = models.JSONField(default=dict, blank=True)
    kicked_user_ids = models.JSONField(default=list, blank=True)
    kicked_guest_nicknames = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_activity_at"]

    def __str__(self):
        return f"[{self.code}] {self.name}"

    @property
    def has_password(self):
        return bool(self.password)

    def player_count(self):
        return self.players.count()

    def is_full(self):
        return self.player_count() >= self.max_players


class RoomPlayer(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="players")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="room_memberships",
    )
    guest_nickname = models.CharField(max_length=20, blank=True, default="")
    score = models.IntegerField(default=0)
    is_host = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["joined_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["room", "user"],
                condition=models.Q(user__isnull=False),
                name="unique_user_per_room",
            ),
            models.UniqueConstraint(
                fields=["room", "guest_nickname"],
                condition=models.Q(user__isnull=True),
                name="unique_guest_nick_per_room",
            ),
        ]

    def __str__(self):
        return f"{self.display_name} in {self.room.code}"

    @property
    def display_name(self):
        if self.user:
            return getattr(self.user, "nickname", None) or self.user.username
        return self.guest_nickname

    @property
    def is_guest(self):
        return self.user is None
