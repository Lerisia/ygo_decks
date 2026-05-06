"""Scrape Korean effect text and archetype from Konami's official Korean card DB.

This is slow (one HTTP request per card with rate limiting), so designed
to be resumable: only fetches cards missing korean_description.

Usage:
    python manage.py import_korean_effects                    # all missing
    python manage.py import_korean_effects --limit 100        # batch
    python manage.py import_korean_effects --delay 1.0        # rate limit
    python manage.py import_korean_effects --konami-id 17785  # single card
"""

import time
import re

import requests
from bs4 import BeautifulSoup
from django.core.management.base import BaseCommand

from card.models import Card

URL_TEMPLATE = (
    "https://www.db.yugioh-card.com/yugiohdb/card_search.action"
    "?ope=2&cid={cid}&request_locale=ko"
)
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


def parse_card_page(html):
    """Return dict with korean_description if found."""
    soup = BeautifulSoup(html, "lxml")
    out = {"korean_description": None}

    # Effect text — first item_box_text contains "카드 텍스트" prefix + body.
    for div in soup.find_all("div", class_="item_box_text"):
        text = div.get_text(" ", strip=True)
        if text.startswith("카드 텍스트"):
            out["korean_description"] = text.replace("카드 텍스트", "", 1).strip()
            break

    return out


class Command(BaseCommand):
    help = "Import Korean effect text from Konami DB"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=None)
        parser.add_argument("--delay", type=float, default=1.0, help="Seconds between requests")
        parser.add_argument("--konami-id", type=str, default=None, help="Single card by konami_id")
        parser.add_argument("--all", action="store_true", help="Re-fetch even if already filled")

    def handle(self, *args, **options):
        qs = Card.objects.exclude(konami_id="").exclude(konami_id__isnull=True)
        if options["konami_id"]:
            qs = qs.filter(konami_id=options["konami_id"])
        elif not options["all"]:
            qs = qs.filter(korean_description__isnull=True)
        if options["limit"]:
            qs = qs[: options["limit"]]

        total = qs.count()
        self.stdout.write(f"Processing {total} cards (delay={options['delay']}s)...")

        # Group by konami_id so alt arts share one request
        seen_konami = {}
        for card in qs.iterator():
            seen_konami.setdefault(card.konami_id, []).append(card)

        unique_count = len(seen_konami)
        self.stdout.write(f"Unique konami_ids: {unique_count}")

        ok = 0
        empty = 0
        errors = 0

        for i, (konami_id, cards) in enumerate(seen_konami.items(), 1):
            url = URL_TEMPLATE.format(cid=konami_id)
            try:
                resp = requests.get(url, headers=HEADERS, timeout=20)
                resp.raise_for_status()
                data = parse_card_page(resp.text)
            except Exception as e:
                errors += 1
                self.stderr.write(f"  [{konami_id}] error: {e}")
                time.sleep(options["delay"])
                continue

            kdesc = data["korean_description"]

            if not kdesc:
                empty += 1
            else:
                ok += 1
                # Apply to all alt arts sharing this konami_id
                for card in cards:
                    card.korean_description = kdesc
                    card.save(update_fields=["korean_description"])

            if i % 100 == 0:
                self.stdout.write(f"  ... {i}/{unique_count} (ok={ok}, empty={empty}, errors={errors})")

            time.sleep(options["delay"])

        self.stdout.write(self.style.SUCCESS(
            f"Done. unique={unique_count}, ok={ok}, empty={empty}, errors={errors}"
        ))
