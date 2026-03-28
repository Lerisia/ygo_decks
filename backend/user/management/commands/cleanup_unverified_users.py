from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from user.models import User


class Command(BaseCommand):
    help = "Delete unverified users (48h) and pending deletion users (30d)."

    def handle(self, *args, **options):
        now = timezone.now()

        unverified = User.objects.filter(
            is_active=False,
            is_staff=False,
            pending_deletion=False,
            date_joined__lt=now - timedelta(hours=48),
        )
        unverified_count = unverified.count()
        unverified.delete()

        pending = User.objects.filter(
            pending_deletion=True,
            deletion_requested_at__lt=now - timedelta(days=30),
        )
        pending_count = pending.count()
        pending.delete()

        self.stdout.write(
            f"Deleted {unverified_count} unverified user(s), "
            f"{pending_count} pending deletion user(s)."
        )
