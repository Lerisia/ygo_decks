import os

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = ("Bring the card book up to date with the card DB, every day after the card data is refreshed: Master Duel "
            "release days, 카드군 (staff edits and deck links kept), card faces and thumbnails (only the changed ones).")

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=4)

    def handle(self, *args, **opts):
        try:
            call_command("fetch_md_release", if_needed=True, stdout=self.stdout)
        except Exception as e:   # the outside site being down must not stop the rest
            self.stderr.write(f"md release: {e}")
        named = getattr(settings, "MD_NAMED_PATH", "")
        if named and os.path.exists(named):
            call_command("build_card_groups", md_named=named, stdout=self.stdout)
        else:
            call_command("build_card_groups", stdout=self.stdout)
        call_command("draw_card_faces", workers=opts["workers"], stdout=self.stdout)
        call_command("make_card_thumbs", stdout=self.stdout)
