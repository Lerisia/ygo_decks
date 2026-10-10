from django.core.management.base import BaseCommand

from carddb.importer import map_legacy_cards


class Command(BaseCommand):
    help = "Link every old card.Card row to a new card: by Konami id, then unique Korean name, then unique English name; rows set by hand (how=manual) are kept."

    def handle(self, *args, **opts):
        self.stdout.write(str(map_legacy_cards()))
