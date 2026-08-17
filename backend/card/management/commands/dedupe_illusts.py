"""Find and remove duplicate Card rows that share the same illust file content
within the same base id (= card_id // 100). Repoints CardDetection FKs to the
keeper before deleting. Safe to run periodically.

Usage:
  python manage.py dedupe_illusts             # apply
  python manage.py dedupe_illusts --dry-run   # preview only
"""
import hashlib
import os
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from card.models import Card, CardDetection


def _md5(card):
    try:
        with open(card.card_illust.path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return None


class Command(BaseCommand):
    help = "Remove duplicate Card rows sharing the same illust within the same base id."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Preview without changes.")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]

        by_base = defaultdict(list)
        for c in Card.objects.exclude(card_illust__isnull=True).exclude(card_illust=""):
            cid = c.card_id
            if not cid.isdigit() or len(cid) < 3:
                continue
            by_base[cid[:-2]].append(c)

        groups = []
        for base, cards in by_base.items():
            if len(cards) <= 1:
                continue
            by_md5 = defaultdict(list)
            for c in cards:
                h = _md5(c)
                if h:
                    by_md5[h].append(c)
            for h, group in by_md5.items():
                if len(group) > 1:
                    group.sort(key=lambda c: c.card_id)
                    groups.append((group[0], group[1:]))

        total_dups = sum(len(d) for _, d in groups)
        self.stdout.write(f"Found {len(groups)} duplicate groups · {total_dups} rows to remove")

        if not groups:
            return

        repointed = 0
        with transaction.atomic():
            for keeper, dups in groups:
                pks = [d.id for d in dups]
                count = CardDetection.objects.filter(card_id__in=pks).count()
                repointed += count
                name = keeper.korean_name or keeper.name
                self.stdout.write(
                    f"  {keeper.card_id} {name}: -{len(dups)} dup(s), repoint {count} detection(s)"
                )
                if not dry:
                    CardDetection.objects.filter(card_id__in=pks).update(card=keeper)
                    for d in dups:
                        for fld in (d.card_illust, getattr(d, "card_image", None)):
                            try:
                                if fld and os.path.exists(fld.path):
                                    os.remove(fld.path)
                            except Exception:
                                pass
                        d.delete()
            if dry:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            f"\n{'DRY-RUN' if dry else 'APPLIED'} · detections repointed={repointed} · rows removed={total_dups}"
        ))
