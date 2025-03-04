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
    card_image = models.ImageField(upload_to='card_images/', blank=True, null=True, help_text="Upload a card image.")

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
