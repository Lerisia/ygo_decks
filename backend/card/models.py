import os
import requests
from django.db import models
from django.core.files.base import ContentFile
from django.conf import settings

class Card(models.Model):
    class _Limit_Regulation(models.IntegerChoices):
        UNLIMITED = 0, '무제한'
        SEMI_LIMITED = 1, '준제한'
        LIMITED = 2, '제한'
        FORBIDDEN = 3, '금지'
        
    card_id = models.IntegerField(unique=True)
    konami_id = models.IntegerField()
    name = models.CharField(max_length=255)
    korean_name = models.CharField(max_length=255, null=True, blank=True)
    limit_regulation = models.IntegerField(choices=_Limit_Regulation.choices, default=_Limit_Regulation.UNLIMITED)

    image_url = models.URLField(blank=True, null=True)
    card_image = models.ImageField(upload_to='card_images/', blank=True, null=True, help_text="Upload a card image.")

    def save(self, *args, **kwargs):
        if self.image_url and not self.card_image:
            self.download_and_save_image()

        super().save(*args, **kwargs)

    def download_and_save_image(self):
        if not self.image_url:
            return

        try:
            response = requests.get(self.image_url, stream=True)
            if response.status_code == 200:
                file_name = f"{self.card_id}.jpg"
                file_path = os.path.join("card_images", file_name)

                self.card_image.save(file_path, ContentFile(response.content), save=False)

                self.image_url = f"{settings.MEDIA_URL}{file_path}"

        except requests.RequestException as e:
            print(f"❌ Failed to download image: {e}")

    def get_image(self):
        return self.image_url if self.image_url else None

    def __str__(self):
        return f"{self.name} (ID: {self.card_id})"