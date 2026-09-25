"""Rebuild the per-card opponent deck table the tracker falls back on when theme votes give no guess.

usage: manage.py rebuild_card_deck_stats   (cron, nightly)
"""
from django.core.management.base import BaseCommand

from tracker.learned import rebuild_card_deck_stats


class Command(BaseCommand):
    help = "Rebuild TrackerCardDeckStat from user-labeled tracker duels"

    def handle(self, *args, **opts):
        self.stdout.write(f"{rebuild_card_deck_stats()} rows")
