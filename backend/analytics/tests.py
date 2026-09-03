from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import User
from .models import PageView


class BeaconTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _send(self, **overrides):
        payload = {"visitor_id": "abcdef1234567890", "path": "/records", "duration_ms": 12000}
        payload.update(overrides)
        return self.client.post("/api/analytics/pageview/", payload, format="json")

    def test_anonymous_beacon_is_stored(self):
        resp = self._send()
        self.assertEqual(resp.status_code, 204)
        pv = PageView.objects.get()
        self.assertEqual(pv.path, "/records")
        self.assertEqual(pv.duration_sec, 12)
        self.assertIsNone(pv.user)

    def test_logged_in_beacon_links_user(self):
        u = User.objects.create_user(email="u@t.com", username="u1", password="pass1234")
        self.client.force_authenticate(user=u)
        self._send()
        self.assertEqual(PageView.objects.get().user, u)

    def test_duration_is_capped_and_never_negative(self):
        self._send(duration_ms=99_999_999)
        self.assertEqual(PageView.objects.latest("id").duration_sec, 1800)
        self._send(duration_ms=-5)
        self.assertEqual(PageView.objects.latest("id").duration_sec, 0)

    def test_invalid_payloads_rejected(self):
        self.assertEqual(self._send(visitor_id="short").status_code, 400)
        self.assertEqual(self._send(visitor_id="bad id with spaces!!").status_code, 400)
        self.assertEqual(self._send(path="records").status_code, 400)          # must start with /
        self.assertEqual(self._send(path="/" + "x" * 300).status_code, 400)    # too long
        self.assertEqual(PageView.objects.count(), 0)

    def test_query_string_is_stripped(self):
        self._send(path="/database?tab=1&x=2")
        self.assertEqual(PageView.objects.get().path, "/database")


class SummaryTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = User.objects.create_user(email="s@t.com", username="staff", password="pass1234", is_staff=True)
        self.member = User.objects.create_user(email="m@t.com", username="member", password="pass1234")
        now = timezone.now()
        yesterday = now - timedelta(days=1)

        def pv(visitor, path, dur, when):
            row = PageView.objects.create(visitor_id=visitor, path=path, duration_sec=dur)
            PageView.objects.filter(id=row.id).update(created_at=when)

        pv("v1", "/", 10, now)
        pv("v1", "/records", 30, now)
        pv("v2", "/", 20, now)
        pv("v1", "/", 5, yesterday)
        pv("v3", "/database", 100, yesterday)
        pv("v3", "/database", 50, now - timedelta(days=40))   # outside 14-day window

    def test_requires_staff(self):
        self.assertEqual(self.client.get("/api/analytics/summary/").status_code, 401)
        self.client.force_authenticate(user=self.member)
        self.assertEqual(self.client.get("/api/analytics/summary/").status_code, 403)

    def test_daily_aggregates(self):
        self.client.force_authenticate(user=self.staff)
        data = self.client.get("/api/analytics/summary/", {"days": 14}).json()
        self.assertEqual(data["range_days"], 14)
        self.assertEqual(len(data["daily"]), 14)          # zero-filled, oldest -> newest
        today = data["daily"][-1]
        self.assertEqual(today["visitors"], 2)
        self.assertEqual(today["views"], 3)
        self.assertEqual(today["dwell_sec"], 60)
        self.assertEqual(today["avg_dwell_sec"], 20)
        yday = data["daily"][-2]
        self.assertEqual(yday["visitors"], 2)
        self.assertEqual(yday["views"], 2)
        self.assertEqual(yday["dwell_sec"], 105)
        self.assertEqual(data["daily"][0]["views"], 0)     # empty day present
        self.assertEqual(data["today"], {"visitors": 2, "views": 3, "dwell_sec": 60})

    def test_top_pages_within_range(self):
        self.client.force_authenticate(user=self.staff)
        top = self.client.get("/api/analytics/summary/", {"days": 14}).json()["top_pages"]
        by_path = {p["path"]: p for p in top}
        self.assertEqual(by_path["/"]["views"], 3)
        self.assertEqual(by_path["/"]["visitors"], 2)
        self.assertEqual(by_path["/database"]["views"], 1)   # the 40-day-old view is excluded
        self.assertEqual(top[0]["path"], "/")                 # sorted by views desc

    def test_days_param_is_clamped(self):
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self.client.get("/api/analytics/summary/", {"days": 500}).json()["range_days"], 90)
        self.assertEqual(self.client.get("/api/analytics/summary/", {"days": 0}).json()["range_days"], 1)
        self.assertEqual(self.client.get("/api/analytics/summary/", {"days": "abc"}).json()["range_days"], 14)
