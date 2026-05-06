"""Fetch card metadata (attribute, race, level, atk, def, archetype, etc.)
from the YGOPRODeck API and populate the Card table.

Usage:
    python manage.py import_card_details                # all cards
    python manage.py import_card_details --limit 100    # first 100 cards
    python manage.py import_card_details --missing      # only cards missing attribute
"""

import time

import requests
from django.core.management.base import BaseCommand
from django.db import transaction

from card.models import Card

API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"


def card_id_to_passcode(card_id: str) -> int:
    """Our card_id is passcode * 100 + alt_art_suffix. Strip the suffix."""
    return int(card_id) // 100


class Command(BaseCommand):
    help = "Import card metadata from YGOPRODeck API"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=None, help="Limit number of cards to fetch")
        parser.add_argument("--missing", action="store_true", help="Only update cards missing attribute field")
        parser.add_argument("--dry-run", action="store_true", help="Don't save changes")

    def handle(self, *args, **options):
        qs = Card.objects.all()
        if options["missing"]:
            qs = qs.filter(attribute__isnull=True)
        if options["limit"]:
            qs = qs[: options["limit"]]

        total = qs.count()
        self.stdout.write(f"Processing {total} cards...")

        updated = 0
        skipped = 0
        errors = 0

        # Fetch all cards from API in one request (it's cached on their side)
        self.stdout.write("Fetching all cards from YGOPRODeck API...")
        try:
            resp = requests.get(API_URL, timeout=60)
            resp.raise_for_status()
            api_data = resp.json()
        except Exception as e:
            self.stderr.write(f"Failed to fetch API: {e}")
            return

        # Build lookup by passcode
        api_by_passcode = {}
        for card in api_data.get("data", []):
            api_by_passcode[card["id"]] = card

        self.stdout.write(f"Got {len(api_by_passcode)} cards from API.")

        for i, card in enumerate(qs.iterator(), 1):
            try:
                passcode = card_id_to_passcode(card.card_id)
            except (ValueError, TypeError):
                skipped += 1
                continue

            data = api_by_passcode.get(passcode)
            if not data:
                skipped += 1
                continue

            card.card_type = data.get("type") or None
            card.frame_type = data.get("frameType") or None
            card.attribute = data.get("attribute") or None
            card.race = data.get("race") or None
            card.archetype = data.get("archetype") or None
            card.level = data.get("level")
            card.atk = data.get("atk")
            card.def_value = data.get("def")
            card.pendulum_scale = data.get("scale")
            card.link_value = data.get("linkval")
            card.link_markers = data.get("linkmarkers") or None
            card.description = data.get("desc") or None

            if not options["dry_run"]:
                card.save(update_fields=[
                    "card_type", "frame_type", "attribute", "race", "archetype",
                    "level", "atk", "def_value", "pendulum_scale", "link_value",
                    "link_markers", "description",
                ])
            updated += 1

            if i % 500 == 0:
                self.stdout.write(f"  ... {i}/{total}")

        self.stdout.write(self.style.SUCCESS(
            f"Done. updated={updated}, skipped={skipped}, errors={errors}"
        ))
