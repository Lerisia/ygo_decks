"""Re-fetch card illustrations from ygoprodeck API to upgrade quality.

Only updates cards whose card_id matches the API pattern (base*100+idx where idx 0-9).
Manually-added cards (idx=99) are never matched by the API and are therefore safe.

Usage:
  python manage.py update_card_illusts             # update all auto-generated cards
  python manage.py update_card_illusts --dry-run   # show what would change
  python manage.py update_card_illusts --limit 50  # only N updates (testing)
"""

import os
import requests

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from card.models import Card


YGOPRODECK_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"


class Command(BaseCommand):
    help = "Re-fetch card illustrations from ygoprodeck and overwrite existing files."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Don't write files; just count.")
        parser.add_argument("--limit", type=int, default=0, help="Stop after N updates (0 = no limit).")
        parser.add_argument("--only-illust", action="store_true", help="Only update card_illust (cropped). Skip card_image.")

    def handle(self, *args, **opts):
        dry_run = opts["dry_run"]
        limit = opts["limit"]
        only_illust = opts["only_illust"]

        self.stdout.write("Fetching API list...")
        resp = requests.get(YGOPRODECK_URL, timeout=60)
        if resp.status_code != 200:
            self.stderr.write(f"API returned {resp.status_code}")
            return
        data = resp.json()
        cards = data.get("data", [])
        self.stdout.write(f"API returned {len(cards)} cards")

        # Build lookup: only auto-generated card_ids (idx 0..9) exist as base*100+idx in DB
        # Manual additions use idx=99 and are NOT in the API → automatically untouched.
        existing = {c.card_id: c for c in Card.objects.all()}

        updated = skipped_no_match = skipped_no_change = errors = 0
        for card in cards:
            base_id = card.get("id")
            images = card.get("card_images", [])
            for idx, image in enumerate(images):
                new_id = str(base_id * 100 + idx)
                db_card = existing.get(new_id)
                if not db_card:
                    skipped_no_match += 1
                    continue

                illust_url = image.get("image_url_cropped")
                full_url = image.get("image_url")

                try:
                    if illust_url:
                        if dry_run:
                            self.stdout.write(f"  [dry] would update illust for {new_id} {db_card.name}")
                        else:
                            r = requests.get(illust_url, stream=True, timeout=30)
                            if r.status_code == 200:
                                # Delete old file to avoid Django suffix accumulation
                                if db_card.card_illust:
                                    try:
                                        db_card.card_illust.delete(save=False)
                                    except Exception:
                                        pass
                                db_card.card_illust.save(f"{new_id}_illust.jpg", ContentFile(r.content), save=True)
                                self.stdout.write(self.style.SUCCESS(f"  ✓ illust {new_id} {db_card.name}"))
                            else:
                                errors += 1
                                self.stderr.write(f"  ✗ illust {new_id} HTTP {r.status_code}")
                                continue

                    if not only_illust and full_url:
                        if dry_run:
                            self.stdout.write(f"  [dry] would update image for {new_id}")
                        else:
                            r = requests.get(full_url, stream=True, timeout=30)
                            if r.status_code == 200:
                                if db_card.card_image:
                                    try:
                                        db_card.card_image.delete(save=False)
                                    except Exception:
                                        pass
                                db_card.card_image.save(f"{new_id}.jpg", ContentFile(r.content), save=True)

                    updated += 1
                    if limit and updated >= limit:
                        self.stdout.write(self.style.WARNING(f"Reached limit {limit}, stopping."))
                        self._summary(updated, skipped_no_match, skipped_no_change, errors)
                        return
                except requests.RequestException as e:
                    errors += 1
                    self.stderr.write(f"  ✗ {new_id}: {e}")

        self._summary(updated, skipped_no_match, skipped_no_change, errors)

    def _summary(self, updated, no_match, no_change, errors):
        self.stdout.write(self.style.NOTICE(
            f"Done. updated={updated} no_match_in_db={no_match} no_change={no_change} errors={errors}"
        ))
