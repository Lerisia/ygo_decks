import multiprocessing
import os

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connections

from carddb.display import art_names
from carddb.face import face_rel, save_face, save_thumb, thumb_rel
from carddb.models import Card, MdPrint


def _exists(rel):
    return os.path.exists(os.path.join(settings.MEDIA_ROOT, rel))


def _job(job):
    card, md_id, draw = job
    if draw:
        save_face(card, md_id)
    else:
        save_thumb(md_id)
    return md_id


class Command(BaseCommand):
    help = ("Draw the Korean card faces the card book shows (media/cards/face/<print id>.webp, alternate arts too, "
            "and their list thumbnails): only missing ones, every print with --all, or the cards whose ids are given.")

    def add_arguments(self, parser):
        parser.add_argument("ids", nargs="*", type=int)
        parser.add_argument("--all", action="store_true")
        parser.add_argument("--workers", type=int, default=4)

    def handle(self, *args, **opts):
        with_art = set(art_names())
        cards = Card.objects.in_bulk(set(Card.objects.values_list("id", flat=True)) & with_art)
        prints = [(card_id, card_id) for card_id in cards]
        prints += [(card_id, md_id) for md_id, card_id in MdPrint.objects.filter(is_alt_art=True).values_list("md_id", "card_id")
                   if card_id in cards and md_id in with_art]
        if opts["ids"]:
            prints = [p for p in prints if p[0] in set(opts["ids"])]
        jobs = []
        for card_id, md_id in sorted(prints, key=lambda p: p[1]):
            if opts["all"] or opts["ids"] or not _exists(face_rel(md_id)):
                jobs.append((cards[card_id], md_id, True))
            elif not _exists(thumb_rel(md_id)):
                jobs.append((cards[card_id], md_id, False))
        done = 0
        if opts["workers"] <= 1:
            for done, _ in enumerate(map(_job, jobs), 1):
                pass
        elif jobs:
            connections.close_all()   # the workers are forked and draw from memory only
            with multiprocessing.get_context("fork").Pool(opts["workers"]) as pool:
                for done, _ in enumerate(pool.imap_unordered(_job, jobs, chunksize=20), 1):
                    if done % 1000 == 0:
                        self.stdout.write(f"{done}/{len(jobs)}")
        drawn = sum(1 for j in jobs if j[2])
        self.stdout.write(f"{drawn} faces drawn, {len(jobs) - drawn} thumbnails made")
