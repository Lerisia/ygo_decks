import os
import requests
from django.db import models
from django.core.files.base import ContentFile
from django.conf import settings

class RegulationStatus(models.IntegerChoices):
    UNLIMITED = 0, '무제한'
    SEMI_LIMITED = 1, '준제한'
    LIMITED = 2, '제한'
    FORBIDDEN = 3, '금지'

class Card(models.Model):
    card_id = models.CharField(max_length=100, unique=True)
    konami_id = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    korean_name = models.CharField(max_length=255, null=True, blank=True, db_index=True)

    image_url = models.URLField(blank=True, null=True)
    card_illust = models.ImageField(upload_to='card_illusts/', blank=True, null=True, help_text="Upload a card image.")
    card_image = models.ImageField(upload_to='card_images/', blank=True, null=True, help_text="Upload a card image.")

    # YGOPRODeck-sourced metadata (English values; Korean shown via translation maps)
    card_type = models.CharField(max_length=50, blank=True, null=True, help_text="Effect Monster / Spell Card / Trap Card / ...")
    frame_type = models.CharField(max_length=20, blank=True, null=True, help_text="effect, synchro, xyz, link, spell, trap, ...")
    attribute = models.CharField(max_length=10, blank=True, null=True, db_index=True, help_text="DARK, LIGHT, WATER, FIRE, EARTH, WIND, DIVINE")
    race = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="Fiend, Dragon, Spellcaster, ... or Spell/Trap subcategory")
    archetype = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    korean_archetype = models.CharField(max_length=100, blank=True, null=True, db_index=True)

    level = models.IntegerField(blank=True, null=True, help_text="Level for normal/effect, Rank for XYZ")
    atk = models.IntegerField(blank=True, null=True, help_text="-1 means '?'")
    def_value = models.IntegerField(blank=True, null=True, db_column='def_value', help_text="-1 means '?'")
    pendulum_scale = models.IntegerField(blank=True, null=True)
    link_value = models.IntegerField(blank=True, null=True)
    link_markers = models.JSONField(blank=True, null=True, help_text="['Top','Left',...]")

    description = models.TextField(blank=True, null=True, help_text="English effect text from API")
    korean_description = models.TextField(blank=True, null=True, help_text="Korean effect text (separate source)")

    def get_image(self):
        return self.image_url if self.image_url else None

    def __str__(self):
        return f"{self.korean_name} (ID: {self.card_id})"

class LimitRegulation(models.Model):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class LimitRegulationEntry(models.Model):
    entry = models.ForeignKey(LimitRegulation, on_delete=models.CASCADE, related_name="entries")  
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="limit_regulation_entries")
    regulation_status = models.IntegerField(choices=RegulationStatus.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["entry", "card"], name="unique_entry_card")
        ]

    def __str__(self):
        return f"{self.entry.name} - {self.card.name}: {self.get_regulation_status_display()}"

class QuizHighScore(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_high_scores',
    )
    score = models.PositiveIntegerField()
    streak = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-score', '-streak', 'created_at']

    def __str__(self):
        return f"{self.user.username}: {self.score}pts ({self.streak} streak)"


class QuizMonthlyAward(models.Model):
    """End-of-month payout record for the top-3 solo Card Quiz scorers.
    Acts as the idempotency key for the `award_quiz_monthly_top3` command —
    re-running for the same (year, month) is a no-op."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_monthly_awards',
    )
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    rank = models.PositiveSmallIntegerField()
    score = models.PositiveIntegerField()
    points_awarded = models.PositiveIntegerField()
    awarded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year', '-month', 'rank']
        unique_together = [('year', 'month', 'rank')]

    def __str__(self):
        return f"{self.year}.{self.month:02d} #{self.rank} {self.user.username}: +{self.points_awarded}P"


class UploadRecord(models.Model):
    uploaded_image = models.ImageField(upload_to='uploads/')
    detected_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )

class CardDetection(models.Model):
    record = models.ForeignKey(UploadRecord, on_delete=models.CASCADE)
    card = models.ForeignKey(Card, on_delete=models.CASCADE)
    confidence = models.FloatField()
    illust_image = models.ImageField(upload_to='illusts/')
