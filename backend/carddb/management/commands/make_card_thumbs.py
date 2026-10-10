from django.core.management.base import BaseCommand

from carddb.display import art_names, make_thumb
from carddb.models import Card


class Command(BaseCommand):
    help = "Make the 256px webp thumbnails (media/cards/thumb256/<card id>.webp) the card search shows; only missing or older ones unless --all."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true")

    def handle(self, *args, **opts):
        ids = set(Card.objects.values_list("id", flat=True)) & set(art_names())
        made = sum(make_thumb(i, force=opts["all"]) for i in sorted(ids))
        self.stdout.write(f"{made} thumbnails made, {len(ids)} cards with art")
