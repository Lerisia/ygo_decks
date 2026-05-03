"""Fetch Korean names from yugioh-card.com (Konami official) for cards missing it."""

from django.core.management.base import BaseCommand
from card.utils import update_korean_names


class Command(BaseCommand):
    help = "Update missing Korean names by scraping the official Konami DB."

    def handle(self, *args, **options):
        update_korean_names()
