import multiprocessing
import os

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connections

from carddb.display import art_names
from carddb.face import face_rel, save_face
from carddb.models import Card


def _draw(card):
    save_face(card)
    return card.id


class Command(BaseCommand):
    help = ("Draw the Korean card faces the card book shows (media/cards/face/<card id>.webp): only missing ones, "
            "every card with --all, or the ids given.")

    def add_arguments(self, parser):
        parser.add_argument("ids", nargs="*", type=int)
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--workers", type=int, default=4)

    def handle(self, *args, **opts):
        ids = set(Card.objects.values_list("id", flat=True)) & set(art_names())
        if opts["ids"]:
            ids &= set(opts["ids"])
        elif not opts["all"]:
            ids = {i for i in ids if not os.path.exists(os.path.join(settings.MEDIA_ROOT, face_rel(i)))}
        cards = list(Card.objects.filter(id__in=ids).order_by("id"))
        if not cards:
            self.stdout.write("0 faces drawn")
            return
        done = 0
        if opts["workers"] <= 1:
            drawn = map(_draw, cards)
            for done, _ in enumerate(drawn, 1):
                pass
        else:
            connections.close_all()   # the workers are forked and draw from memory only
            with multiprocessing.get_context("fork").Pool(opts["workers"]) as pool:
                for done, _ in enumerate(pool.imap_unordered(_draw, cards, chunksize=20), 1):
                    if done % 1000 == 0:
                        self.stdout.write(f"{done}/{len(cards)}")
        self.stdout.write(f"{done} faces drawn")
