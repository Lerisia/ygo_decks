from django.db import models
from django.conf import settings


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
