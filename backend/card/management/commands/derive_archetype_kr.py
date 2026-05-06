"""Derive Korean archetype names by finding common substrings in
the Korean names of cards belonging to each archetype.

For each archetype, we look at all cards' korean_name and find the
longest common substring that appears in most cards.

Usage:
    python manage.py derive_archetype_kr
    python manage.py derive_archetype_kr --threshold 0.7   # 70% of cards must contain
    python manage.py derive_archetype_kr --dry-run
"""

from collections import Counter
from django.core.management.base import BaseCommand

from card.models import Card


def all_substrings(s, min_len=2, max_len=10):
    out = set()
    n = len(s)
    for i in range(n):
        for j in range(i + min_len, min(n, i + max_len) + 1):
            out.add(s[i:j])
    return out


def find_common_substring(names, threshold=0.6):
    """Return the longest substring that appears in at least `threshold` of names."""
    if not names:
        return None
    target_count = max(2, int(len(names) * threshold))
    counter = Counter()
    for name in names:
        for sub in all_substrings(name):
            counter[sub] += 1

    candidates = [(sub, cnt) for sub, cnt in counter.items() if cnt >= target_count]
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-len(x[0]), -x[1]))
    return candidates[0][0]


class Command(BaseCommand):
    help = "Derive Korean archetype names from card name commonalities"

    def add_arguments(self, parser):
        parser.add_argument("--threshold", type=float, default=0.6, help="Min ratio of cards containing substring")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        threshold = options["threshold"]
        archetypes = (
            Card.objects.exclude(archetype__isnull=True).exclude(archetype="")
            .values_list("archetype", flat=True).distinct()
        )

        derived = {}
        skipped = 0

        for arch in archetypes:
            cards = Card.objects.filter(archetype=arch).exclude(korean_name__isnull=True).exclude(korean_name="")
            names = list(cards.values_list("korean_name", flat=True))
            if len(names) < 2:
                skipped += 1
                continue
            common = find_common_substring(names, threshold)
            if common:
                derived[arch] = (common, len(names))

        self.stdout.write(f"Derived {len(derived)} archetype mappings (skipped {skipped})")

        for arch, (kr, n) in sorted(derived.items()):
            self.stdout.write(f"  {arch:30s} → {kr} ({n} cards)")

        if options["dry_run"]:
            return

        for arch, (kr, _) in derived.items():
            Card.objects.filter(archetype=arch).update(korean_archetype=kr)

        self.stdout.write(self.style.SUCCESS(f"Updated korean_archetype for {len(derived)} archetypes."))
