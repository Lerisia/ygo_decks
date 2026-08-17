"""Fetch Korean names from yugioh-card.com (Konami official)."""

from django.core.management.base import BaseCommand
from card.utils import update_korean_names


class Command(BaseCommand):
    help = "Update Korean names by scraping the official Konami DB."

    def add_arguments(self, parser):
        parser.add_argument(
            "--revalidate",
            action="store_true",
            help="Also re-query cards that already have a Korean name; overwrite if Konami returns something different.",
        )

    def handle(self, *args, **options):
        update_korean_names(revalidate=options["revalidate"])
