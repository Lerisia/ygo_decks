"""Delete RoomLog rows (and cascading ChatLog/GameLog/TurnLog) older than
the retention threshold. Default: 7 days.

Run via cron, e.g.:
    0 4 * * * cd /home/elyss/ygo_decks/backend && /home/elyss/ygo_decks/backend/venv/bin/python manage.py prune_room_logs
"""
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete audit RoomLog rows older than N days (default 7)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7, help="Retention threshold in days")

    def handle(self, *args, **opts):
        from multiplayer.models import RoomLog
        cutoff = timezone.now() - timedelta(days=opts["days"])
        qs = RoomLog.objects.filter(created_at__lt=cutoff)
        n = qs.count()
        deleted, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(
            f"pruned {n} RoomLog row(s) older than {opts['days']} day(s); "
            f"cascade deleted {deleted} total objects"
        ))
