from django.core.management.base import BaseCommand

from deck.models import Deck


class Command(BaseCommand):
    help = "Build the deck cover versions (200px small, 480px list, 320px phone, 960px detail, 640px chart) that are missing or out of date."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="rebuild every deck, not only out-of-date ones")

    def handle(self, *args, **opts):
        built = failed = 0
        for deck in Deck.objects.exclude(cover_image="").exclude(cover_image=None).order_by("id"):
            if not opts["all"] and not deck.cover_versions_stale():
                continue
            try:
                deck.make_cover_versions()
                built += 1
            except Exception as e:
                failed += 1
                self.stderr.write(f"{deck.id} {deck.name}: {e}")
        self.stdout.write(f"{built} decks rebuilt, {failed} failed")
