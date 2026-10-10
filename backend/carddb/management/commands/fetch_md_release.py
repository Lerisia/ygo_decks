from datetime import date, timedelta

from django.core.management.base import BaseCommand

from carddb import md_release
from carddb.models import MdPrint


class Command(BaseCommand):
    help = ("Fill MdPrint.first_seen, the day each print came to Master Duel, from masterduelmeta.com (taken over our "
            "own first-seen day). --if-needed skips the fetch unless a print still lacks a date or is under 30 days old.")

    def add_arguments(self, parser):
        parser.add_argument("--if-needed", action="store_true")
        parser.add_argument("--pause", type=float, default=1.0)

    def handle(self, *args, **opts):
        if opts["if_needed"]:
            recent = date.today() - timedelta(days=30)
            if not MdPrint.objects.filter(first_seen__isnull=True).exists() and not MdPrint.objects.filter(first_seen__gte=recent).exists():
                self.stdout.write("md release: nothing to check")
                return
        releases = md_release.fetch_releases(pause=opts["pause"])
        changed = []
        for p in MdPrint.objects.filter(md_id__in=releases):
            if p.first_seen != releases[p.md_id]:
                p.first_seen = releases[p.md_id]
                changed.append(p)
        MdPrint.objects.bulk_update(changed, ["first_seen"], batch_size=1000)
        missing = MdPrint.objects.filter(first_seen__isnull=True).count()
        self.stdout.write(f"md release: {len(releases)} listed, {len(changed)} prints dated, {missing} still without a date")
