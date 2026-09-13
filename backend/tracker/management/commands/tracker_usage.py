"""Who is using the PC tracker: per-user game counts, wins, linked records, first/last game.

usage: manage.py tracker_usage [--days N]
"""
from django.core.management.base import BaseCommand
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from tracker.models import TrackerGame


class Command(BaseCommand):
    help = "Summarize PC tracker usage per user"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=0, help="only games in the last N days (0 = all)")

    def handle(self, *args, **opts):
        qs = TrackerGame.objects.all()
        if opts["days"]:
            qs = qs.filter(ended_at__gte=timezone.now() - timezone.timedelta(days=opts["days"]))
        rows = (qs.values("user__id", "user__username")
                  .annotate(games=Count("id"), wins=Count("id", filter=Q(result="win")),
                            linked=Count("id", filter=Q(match__isnull=False)),
                            rank=Count("id", filter=Q(game_mode=3)), rate=Count("id", filter=Q(game_mode=19)),
                            first=Min("ended_at"), last=Max("ended_at"))
                  .order_by("-last"))
        total = qs.count()
        self.stdout.write(f"tracker games: {total} | users: {len(rows)}")
        self.stdout.write(f"{'user':<20}{'games':>6}{'wins':>6}{'saved':>7}{'rank':>6}{'rate':>6}  first ~ last")
        for r in rows:
            f = timezone.localtime(r["first"]).strftime("%m-%d %H:%M") if r["first"] else "-"
            l = timezone.localtime(r["last"]).strftime("%m-%d %H:%M") if r["last"] else "-"
            self.stdout.write(f"{r['user__username']:<20}{r['games']:>6}{r['wins']:>6}{r['linked']:>7}{r['rank']:>6}{r['rate']:>6}  {f} ~ {l}")
