from django.core.management.base import BaseCommand

from carddb.importer import import_md


class Command(BaseCommand):
    help = "Fill the card DB from Master Duel card data: --ja and --ko folders hold <locale>_card_*.bytes, --md holds md_card_same/md_card_rarity_asset (defaults to --ja)."

    def add_arguments(self, parser):
        parser.add_argument("--ja", required=True)
        parser.add_argument("--ko", required=True)
        parser.add_argument("--md")

    def handle(self, *args, **opts):
        self.stdout.write(str(import_md(opts["ja"], opts["ko"], opts["md"])))
