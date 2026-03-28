import os
import tempfile
from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from .models import UploadRecord


class CleanupUploadsTest(TestCase):
    def _create_upload(self, days_ago=0):
        img = SimpleUploadedFile("test.jpg", b"\xff\xd8\xff\xe0", content_type="image/jpeg")
        record = UploadRecord.objects.create(uploaded_image=img)
        record.detected_at = timezone.now() - timedelta(days=days_ago)
        record.save(update_fields=["detected_at"])
        return record

    def test_deletes_old_uploads(self):
        old = self._create_upload(days_ago=8)
        old_path = old.uploaded_image.path

        call_command("cleanup_uploads")

        self.assertFalse(UploadRecord.objects.filter(id=old.id).exists())
        self.assertFalse(os.path.exists(old_path))

    def test_keeps_recent_uploads(self):
        recent = self._create_upload(days_ago=3)

        call_command("cleanup_uploads")

        self.assertTrue(UploadRecord.objects.filter(id=recent.id).exists())

    def test_deletes_uploads_at_boundary(self):
        boundary = self._create_upload(days_ago=7)

        call_command("cleanup_uploads")

        self.assertFalse(UploadRecord.objects.filter(id=boundary.id).exists())
