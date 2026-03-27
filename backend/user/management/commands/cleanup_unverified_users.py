from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from user.models import User


class Command(BaseCommand):
    help = "Delete users who have not verified their email within 48 hours."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(hours=48)
        unverified = User.objects.filter(
            is_active=False,
            is_staff=False,
            date_joined__lt=cutoff,
        )
        count = unverified.count()
        unverified.delete()
        self.stdout.write(f"Deleted {count} unverified user(s).")
