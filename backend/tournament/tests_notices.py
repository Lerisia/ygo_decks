from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import User
from .models import Announcement, Entrant, Tournament

URL = "/api/tournaments/my-announcements/"


def _user(tag):
    return User.objects.create_user(email=f"{tag}@n.com", username=tag, password="pass1234")


def _client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class MyAnnouncementsTest(TestCase):
    """특이점 2026-10-10: 주최자가 룸 코드 같은 공지를 올리면 참가자에게 사이트 팝업으로 알린다."""

    def setUp(self):
        self.host = _user("nhost")
        self.t = Tournament.objects.create(name="공지컵", host=self.host, format="single_elim",
                                           event_date=timezone.now() + timedelta(hours=2))
        self.player = _user("nplayer")
        Entrant.objects.create(tournament=self.t, user=self.player, name="nplayer", md_uid="100000001")
        self.gone = _user("ngone")
        Entrant.objects.create(tournament=self.t, user=self.gone, name="ngone", md_uid="100000002", status="withdrawn")
        self.stranger = _user("nstranger")

    def post(self, content):
        res = _client(self.host).post(f"/api/tournaments/{self.t.id}/announcements/", {"content": content}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()["id"]

    def test_entrants_get_the_host_notice(self):
        self.post("룸 코드 1234")
        rows = _client(self.player).get(URL).json()
        self.assertEqual([r["content"] for r in rows], ["룸 코드 1234"])
        self.assertEqual(rows[0]["tournament_name"], "공지컵")

    def test_outsiders_withdrawn_and_host_get_nothing(self):
        self.post("룸 코드 1234")
        for user in (self.stranger, self.gone, self.host):
            self.assertEqual(_client(user).get(URL).json(), [])

    def test_after_returns_only_newer_and_old_ones_drop(self):
        first = self.post("첫 공지")
        self.post("두 번째 공지")
        self.assertEqual([r["content"] for r in _client(self.player).get(f"{URL}?after={first}").json()], ["두 번째 공지"])
        Announcement.objects.update(created_at=timezone.now() - timedelta(days=2))
        self.assertEqual(_client(self.player).get(URL).json(), [])

    def test_finished_tournaments_stay_quiet(self):
        self.post("끝난 대회 공지")
        Tournament.objects.filter(id=self.t.id).update(status="completed")
        self.assertEqual(_client(self.player).get(URL).json(), [])

    def test_login_required(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)
