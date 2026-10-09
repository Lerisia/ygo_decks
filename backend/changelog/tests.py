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


class ChangelogStaffWriteTests(TestCase):
    """특이점 2026-10-03: 운영진이 관리자 페이지가 아니라 사이트에서 바로 공지를 쓰고 고치고 지운다."""

    def setUp(self):
        from rest_framework.test import APIClient
        from user.models import User

        self.client = APIClient()
        self.staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234")
        self.staff.is_staff = True
        self.staff.save()
        self.user = User.objects.create_user(email="user@test.com", username="user", password="pass1234")
        self.entry = ChangelogEntry.objects.create(title="[10/2] 기존", body="본문", published_at=timezone.now() - timedelta(days=1))

    def test_staff_creates_entry_published_now_by_default(self):
        self.client.force_authenticate(self.staff)
        res = self.client.post(reverse("changelog-list"), {"title": "[10/3] 새 공지", "body": "- 기능 추가"}, format="json")
        self.assertEqual(res.status_code, 201)
        entry = ChangelogEntry.objects.get(title="[10/3] 새 공지")
        self.assertLessEqual(abs((entry.published_at - timezone.now()).total_seconds()), 5)
        self.assertEqual(self.client.get(reverse("changelog-latest")).json()["entry"]["title"], "[10/3] 새 공지")

    def test_staff_can_schedule_and_sees_scheduled_entries(self):
        self.client.force_authenticate(self.staff)
        when = (timezone.now() + timedelta(days=2)).isoformat()
        res = self.client.post(reverse("changelog-list"), {"title": "예약 공지", "body": "곧", "published_at": when}, format="json")
        self.assertEqual(res.status_code, 201)
        staff_view = {e["title"]: e for e in self.client.get(reverse("changelog-list")).json()}
        self.assertTrue(staff_view["예약 공지"]["scheduled"])
        self.assertFalse(staff_view["[10/2] 기존"]["scheduled"])
        self.client.force_authenticate(None)
        self.assertNotIn("예약 공지", [e["title"] for e in self.client.get(reverse("changelog-list")).json()])

    def test_staff_updates_and_deletes_entry(self):
        self.client.force_authenticate(self.staff)
        url = reverse("changelog-detail", args=[self.entry.id])
        res = self.client.put(url, {"title": "[10/2] 고친 제목", "body": "고친 본문"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual((self.entry.title, self.entry.body), ("[10/2] 고친 제목", "고친 본문"))
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(ChangelogEntry.objects.filter(id=self.entry.id).exists())

    def test_writes_are_recorded_in_admin_history(self):
        from django.contrib.admin.models import LogEntry

        self.client.force_authenticate(self.staff)
        self.client.post(reverse("changelog-list"), {"title": "기록 공지", "body": "x"}, format="json")
        self.client.delete(reverse("changelog-detail", args=[self.entry.id]))
        self.assertEqual(LogEntry.objects.filter(user=self.staff).count(), 2)

    def test_title_and_body_are_required(self):
        self.client.force_authenticate(self.staff)
        for bad in ({"title": "", "body": "x"}, {"title": "제목", "body": "  "}, {"title": "x" * 201, "body": "x"},
                    {"title": "제목", "body": "x", "published_at": "내일"}):
            self.assertEqual(self.client.post(reverse("changelog-list"), bad, format="json").status_code, 400, bad)
        self.assertEqual(ChangelogEntry.objects.count(), 1)

    def test_non_staff_cannot_write(self):
        url = reverse("changelog-detail", args=[self.entry.id])
        for who in (self.user, None):
            self.client.force_authenticate(who)
            self.assertIn(self.client.post(reverse("changelog-list"), {"title": "t", "body": "b"}, format="json").status_code, (401, 403))
            self.assertIn(self.client.put(url, {"title": "t", "body": "b"}, format="json").status_code, (401, 403))
            self.assertIn(self.client.delete(url).status_code, (401, 403))
        self.assertEqual(ChangelogEntry.objects.count(), 1)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.title, "[10/2] 기존")


class ChangelogKindTests(TestCase):
    """특이점 2026-10-10: 매달 하는 정기 덱 추가 공지는 평소 업데이트와 다른 색으로 보인다."""

    def setUp(self):
        from rest_framework.test import APIClient
        from user.models import User

        self.client = APIClient()
        self.staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234")
        self.staff.is_staff = True
        self.staff.save()

    def test_entries_are_updates_unless_marked(self):
        ChangelogEntry.objects.create(title="업데이트", body="본문", published_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.client.get(reverse("changelog-list")).json()[0]["kind"], "update")

    def test_staff_marks_a_deck_addition_and_keeps_it_on_edit(self):
        self.client.force_authenticate(self.staff)
        res = self.client.post(reverse("changelog-list"), {"title": "[11/1] 새로운 덱 추가 안내", "body": "- 덱", "kind": "deck"}, format="json")
        self.assertEqual(res.status_code, 201)
        entry = ChangelogEntry.objects.get(title="[11/1] 새로운 덱 추가 안내")
        self.assertEqual(entry.kind, "deck")
        self.client.put(reverse("changelog-detail", args=[entry.id]), {"title": "[11/1] 고친 제목", "body": "- 덱"}, format="json")
        entry.refresh_from_db()
        self.assertEqual(entry.kind, "deck")
        self.assertEqual(self.client.get(reverse("changelog-latest")).json()["entry"]["kind"], "deck")

    def test_unknown_kind_is_rejected(self):
        self.client.force_authenticate(self.staff)
        res = self.client.post(reverse("changelog-list"), {"title": "공지", "body": "본문", "kind": "event"}, format="json")
        self.assertEqual(res.status_code, 400)
