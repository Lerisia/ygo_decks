from django.core.management.base import BaseCommand

from carddb.groups import compute, save
from carddb.md import decrypt, parse_named


class Command(BaseCommand):
    help = "Work out every 카드군 and its members from the card DB; staff edits are kept."

    def add_arguments(self, parser):
        parser.add_argument("--md-named", help="Master Duel ja-jp_card_named.bytes, to mark groups that match one of its lists.")

    def handle(self, *args, **opts):
        named = None
        if opts["md_named"]:
            with open(opts["md_named"], "rb") as f:
                named = parse_named(decrypt(f.read()))
        self.stdout.write(str(save(compute(named))))
