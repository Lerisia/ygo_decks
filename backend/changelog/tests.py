from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import ChangelogEntry


class ChangelogApiTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.old = ChangelogEntry.objects.create(
            title="첫 업데이트",
            body="처음 배포",
            published_at=now - timedelta(days=3),
        )
        self.newest = ChangelogEntry.objects.create(
            title="최신 업데이트",
            body="**굵게**",
            published_at=now - timedelta(hours=1),
        )
        self.future = ChangelogEntry.objects.create(
            title="예약",
            body="아직 안 보임",
            published_at=now + timedelta(days=1),
        )

    def test_list_returns_visible_entries_newest_first(self):
        res = self.client.get(reverse("changelog-list"))
        self.assertEqual(res.status_code, 200)
        titles = [e["title"] for e in res.json()]
        self.assertEqual(titles, ["최신 업데이트", "첫 업데이트"])

    def test_list_excludes_future_entries(self):
        res = self.client.get(reverse("changelog-list"))
        titles = [e["title"] for e in res.json()]
        self.assertNotIn("예약", titles)

    def test_latest_returns_newest_visible(self):
        res = self.client.get(reverse("changelog-latest"))
        self.assertEqual(res.status_code, 200)
        entry = res.json()["entry"]
        self.assertEqual(entry["title"], "최신 업데이트")
        self.assertEqual(entry["body"], "**굵게**")
        self.assertIn("published_at", entry)

    def test_latest_returns_null_when_no_visible(self):
        ChangelogEntry.objects.all().delete()
        res = self.client.get(reverse("changelog-latest"))
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json()["entry"])

    def test_endpoints_are_public(self):
        # No auth — must still work.
        self.client.logout()
        self.assertEqual(self.client.get(reverse("changelog-list")).status_code, 200)
        self.assertEqual(self.client.get(reverse("changelog-latest")).status_code, 200)
