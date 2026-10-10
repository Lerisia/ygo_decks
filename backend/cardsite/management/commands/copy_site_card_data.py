from django.core.management.base import BaseCommand

from cardsite.copy import copy_site_data


class Command(BaseCommand):
    help = "Copy the site-made card data (YGOPRODeck theme, Yugipedia lists, effect tags) from the old cards onto the new card ids through LegacyCard; base-art rows (card_id ending 00) win."

    def handle(self, *args, **opts):
        self.stdout.write(str(copy_site_data()))
