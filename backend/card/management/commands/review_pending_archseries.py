"""Inspect archseries flagged as pending Korean translation. Run after a
DB refresh to see whether any pending entry has gained Korean-named
cards — that's the signal to promote it out of the pending list and
into _ARCHETYPE_LABEL_OVERRIDES (or REMOVE).

  python manage.py review_pending_archseries
"""

from django.core.management.base import BaseCommand

from card.models import Card


class Command(BaseCommand):
    help = "Print stats for each archseries on the pending-Korean watchlist."

    def handle(self, *args, **opts):
        # Import lazily so this command never fails on a fresh checkout
        # where the engine module might be importing card models.
        from solo.twenty_engine import _ARCHETYPE_PENDING_KOREAN

        if not _ARCHETYPE_PENDING_KOREAN:
            self.stdout.write("(빈 목록)")
            return

        # SQLite has no JSONField __contains lookup, so filter in Python
        # over the (relatively small) set of cards that have any archseries.
        for arch in sorted(_ARCHETYPE_PENDING_KOREAN):
            cards = [
                c for c in Card.objects.exclude(yugipedia_archseries=[])
                .only("card_id", "name", "korean_name", "created_at", "yugipedia_archseries")
                if arch in (c.yugipedia_archseries or [])
            ]
            total = len(cards)
            with_kr = [c for c in cards if c.korean_name and c.korean_name != c.name]
            recent = sum(1 for c in cards if c.created_at and c.created_at.year != 2020)
            self.stdout.write(f"\n=== {arch}  (total={total}, kr={len(with_kr)}, new_in_db={recent})")
            for c in cards[:5]:
                kr = c.korean_name if (c.korean_name and c.korean_name != c.name) else "(no KR)"
                self.stdout.write(f"  {c.card_id}  {c.name!r:60}  →  {kr}")
            if total > 5:
                self.stdout.write(f"  ...{total - 5} more")
            if with_kr and len(with_kr) >= max(2, total // 3):
                self.stdout.write(self.style.WARNING(
                    f"  ⚡ {len(with_kr)}/{total} 카드가 한국어 번역됨 — 프로모션 검토 추천"
                ))
