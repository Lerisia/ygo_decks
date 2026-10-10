from django.test import TestCase
from rest_framework.test import APIClient

from user.models import User
from .models import Notification, notify


def _user(tag):
    return User.objects.create_user(email=f"{tag}@n.test", username=tag, password="pass1234")


class NotificationApiTest(TestCase):
    """참혈 2026-10-11: 마이페이지 알림 — 지우기 전까지 미확인으로 남고, 지워도 알림 내역에는 남는다."""

    def setUp(self):
        self.me = _user("noti_me")
        self.other = _user("noti_other")
        self.c = APIClient()
        self.c.force_authenticate(self.me)

    def test_unread_list_count_and_dismiss(self):
        a = notify(self.me, "첫 알림", action_label="홈페이지로 이동", action_url="/")
        notify(self.me, "둘째 알림", sender="운영자")
        notify(self.other, "남의 알림")
        self.assertEqual(self.c.get("/api/notifications/unread-count/").json()["count"], 2)
        rows = self.c.get("/api/notifications/?unread=1").json()["notifications"]
        self.assertEqual([r["body"] for r in rows], ["둘째 알림", "첫 알림"])
        self.assertEqual(rows[1]["action_url"], "/")
        self.assertEqual(self.c.post(f"/api/notifications/{a.id}/dismiss/").status_code, 200)
        self.assertEqual(self.c.get("/api/notifications/unread-count/").json()["count"], 1)
        history = self.c.get("/api/notifications/").json()["notifications"]
        self.assertEqual(len(history), 2)
        self.assertTrue(next(r for r in history if r["id"] == a.id)["read"])

    def test_cannot_touch_someone_elses(self):
        theirs = notify(self.other, "남의 알림")
        self.assertEqual(self.c.post(f"/api/notifications/{theirs.id}/dismiss/").status_code, 404)

    def test_login_required(self):
        self.assertEqual(APIClient().get("/api/notifications/").status_code, 401)


class BorderUnlockNotificationTest(TestCase):
    """누적 포인트로 테두리를 얻으면 시스템 알림이 온다."""

    def test_crossing_a_tier_sends_a_notification(self):
        from avatar.models import Border
        from user.points import BORDER_TIERS, award_points
        thr, key = BORDER_TIERS[0]
        Border.objects.update_or_create(key=key, defaults={"name": "아이언", "category": "exclusive"})
        me = _user("noti_tier")
        award_points(me, thr)
        n = Notification.objects.get(user=me)
        self.assertEqual(n.sender, "시스템")
        self.assertEqual(n.body, f"누적 포인트 {thr:,}P를 돌파하여 아이언 아이콘 테두리를 획득하였습니다.")
        self.assertEqual((n.action_label, n.action_url), ("아이콘 설정으로 이동", "/mypage/avatar"))
        award_points(me, 1)  # nothing new crossed
        self.assertEqual(Notification.objects.filter(user=me).count(), 1)
