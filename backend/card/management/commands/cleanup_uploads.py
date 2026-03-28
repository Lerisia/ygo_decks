import os
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from card.models import UploadRecord


class Command(BaseCommand):
    help = "Delete uploaded images older than 7 days."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=7)
        old_records = UploadRecord.objects.filter(detected_at__lt=cutoff)
        count = 0

        for record in old_records:
            if record.uploaded_image and os.path.exists(record.uploaded_image.path):
                os.remove(record.uploaded_image.path)
            record.delete()
            count += 1

        self.stdout.write(f"Deleted {count} upload(s).")
