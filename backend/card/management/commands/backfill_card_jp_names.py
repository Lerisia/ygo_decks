"""Backfill Card.name_ja from the YGOPRODeck cardinfo API (language=ja).

Why: the Twitter SAMPLE scraper finds card names in 「」 inside JP tweets,
but our Card rows only carry English/Korean names. Without a JP column
we can't map tweet text → known card. This command fills that gap.

Usage:
    python manage.py backfill_card_jp_names              # only blanks
    python manage.py backfill_card_jp_names --refresh    # overwrite all
    python manage.py backfill_card_jp_names --limit 100  # smoke test

Cooperates with YGOPRODeck's 20 req/sec rate limit by sleeping briefly
between batched requests. The full DB takes a few minutes.
"""
import time

import requests
from django.core.management.base import BaseCommand


API = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
BATCH = 30  # YGOPRODeck accepts comma-separated id list per call
SLEEP = 0.4  # seconds between batches → ~75 cards/sec, well under 20 rps


class Command(BaseCommand):
    help = "Backfill Card.name_ja from YGOPRODeck (language=ja)."

    def add_arguments(self, parser):
        parser.add_argument("--refresh", action="store_true",
                            help="Overwrite existing name_ja values")
        parser.add_argument("--limit", type=int, default=0,
                            help="Process at most N cards (0 = all)")

    def handle(self, *args, **opts):
        from card.models import Card
        qs = Card.objects.all().order_by("id")
        if not opts["refresh"]:
            qs = qs.filter(name_ja__isnull=True) | qs.filter(name_ja="")
            qs = qs.distinct()
        if opts["limit"]:
            qs = qs[:opts["limit"]]
        # Our Card.card_id is YGOPRODeck-ID × 100 (e.g. our '3454186300'
        # is YGOPRODeck '34541863'). Strip the trailing two zeros for the
        # API call, then map back when writing.
        def to_ygopro(cid: str) -> str:
            cid = (cid or "").strip()
            return cid[:-2] if cid.endswith("00") and len(cid) >= 4 else cid

        ids_pairs = [(to_ygopro(c), c) for c in qs.values_list("card_id", flat=True)]
        total = len(ids_pairs)
        self.stdout.write(f"backfilling {total} cards…")
        if not total:
            return

        updated = misses = errors = 0
        for i in range(0, total, BATCH):
            chunk = ids_pairs[i:i + BATCH]
            yg_ids = [p[0] for p in chunk]
            try:
                r = requests.get(
                    API,
                    params={"id": ",".join(yg_ids), "language": "ja"},
                    timeout=20,
                    headers={"User-Agent": "ygodecks-backfill/1.0"},
                )
                if r.status_code == 400:
                    misses += len(chunk)
                    continue
                r.raise_for_status()
                results = r.json().get("data", [])
            except Exception as e:
                self.stderr.write(self.style.WARNING(f"batch {i}: {e}"))
                errors += len(chunk)
                time.sleep(SLEEP)
                continue
            by_id = {str(c["id"]): (c.get("name") or "") for c in results}
            for yg_id, our_id in chunk:
                jp = by_id.get(yg_id, "").strip()
                if not jp:
                    misses += 1
                    continue
                Card.objects.filter(card_id=our_id).update(name_ja=jp)
                updated += 1
            if (i // BATCH) % 10 == 0:
                self.stdout.write(f"  …{i + len(chunk)}/{total} (updated {updated})")
            time.sleep(SLEEP)

        self.stdout.write(self.style.SUCCESS(
            f"done. updated={updated} misses={misses} errors={errors}"
        ))
