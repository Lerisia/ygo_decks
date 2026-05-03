from django.db import models
from django.conf import settings


class Border(models.Model):
    """A circular border that wraps a user's avatar icon."""

    key = models.SlugField(max_length=40, unique=True, help_text="programmatic identifier")
    name = models.CharField(max_length=60)
    color = models.CharField(max_length=20, default="#ffffff", help_text="CSS color for the ring (used when no image)")
    image = models.ImageField(upload_to="border_assets/", blank=True, null=True, help_text="optional ring asset (square PNG with transparent center)")
    is_default = models.BooleanField(default=False, help_text="auto-grant to all users when they sign up")
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.name} ({self.key})"


class UserBorderUnlock(models.Model):
    """Tracks which borders a user has unlocked."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="border_unlocks")
    border = models.ForeignKey(Border, on_delete=models.CASCADE, related_name="user_unlocks")
    granted_at = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "border"], name="unique_user_border_unlock"),
        ]

    def __str__(self):
        return f"{self.user_id} unlocked {self.border.key}"


class UserIconUnlock(models.Model):
    """Tracks which CardIcons a user has unlocked / can equip."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="icon_unlocks")
    icon = models.ForeignKey("avatar.CardIcon", on_delete=models.CASCADE, related_name="user_unlocks")
    granted_at = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "icon"], name="unique_user_icon_unlock"),
        ]

    def __str__(self):
        return f"{self.user_id} unlocked icon {self.icon_id}"


class CardIcon(models.Model):
    """A circular crop of a card illustration, usable as a user avatar.

    Crop is stored as relative coordinates (0~1) on top of the card's
    `card_illust` image, so it's resolution-independent and easy to re-edit.
    """

    card = models.ForeignKey(
        "card.Card",
        on_delete=models.CASCADE,
        related_name="icons",
    )
    title = models.CharField(max_length=80, blank=True, default="")
    center_x = models.FloatField(help_text="Crop center X (0~1)")
    center_y = models.FloatField(help_text="Crop center Y (0~1)")
    radius = models.FloatField(help_text="Crop radius (0~1, of image min(w,h))")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="created_card_icons",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or f"icon for card {self.card_id}"
