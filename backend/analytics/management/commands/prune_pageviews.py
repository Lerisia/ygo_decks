from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from analytics.models import PageView


class Command(BaseCommand):
    help = "Delete page views older than --days (default 90)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=90)

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options["days"])
        deleted, _ = PageView.objects.filter(created_at__lt=cutoff).delete()
        self.stdout.write(f"deleted {deleted} page views older than {options['days']} days")
