from django.core.management.base import BaseCommand
from PIL import Image

from deck.models import Deck


class Command(BaseCommand):
    help = "Build the 480px deck database list thumbnails from the original covers (scaled down only)."

    def handle(self, *args, **opts):
        n = 0
        for deck in Deck.objects.exclude(cover_image="").exclude(cover_image=None):
            with Image.open(deck.cover_image.path) as img:
                rel = Deck.make_list_cover(img, deck.pk, deck.cover_image.name.rsplit("/", 1)[-1])
            Deck.objects.filter(pk=deck.pk).update(cover_image_list=rel)
            n += 1
        self.stdout.write(f"{n} list covers")
