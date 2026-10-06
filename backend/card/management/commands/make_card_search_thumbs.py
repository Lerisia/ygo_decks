from django.core.management.base import BaseCommand

from card.models import Card
from card.search_thumbs import make_thumb, thumb_stale


class Command(BaseCommand):
    help = "Make the card search's 256px webp thumbnails that are missing or older than their illustration."

    def handle(self, *args, **opts):
        made = failed = 0
        for card in Card.objects.exclude(card_illust="").exclude(card_illust=None).only("id", "card_illust").iterator():
            if not thumb_stale(card):
                continue
            try:
                make_thumb(card)
                made += 1
            except Exception as e:
                failed += 1
                self.stderr.write(f"{card.id} {card.card_illust.name}: {e}")
        self.stdout.write(f"{made} thumbnails made, {failed} failed")
