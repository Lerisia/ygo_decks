from django.core.management.base import BaseCommand

from carddb.importer import fill_new_card_links


class Command(BaseCommand):
    help = "Fill new_card on every model that still links to an old card (icons, DuchMind words, tournament decks, solo drawings and twenty-questions games, scanner detections) through LegacyCard. --all refills rows already set."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true")

    def handle(self, *args, **opts):
        self.stdout.write(str(fill_new_card_links(only_missing=not opts["all"])))
