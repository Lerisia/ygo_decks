import json
import os
import time

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from solo import names_views as nv
from solo.models import SkillNameScore
from user.models import User


def log(*names, gap=2000):
    return [{"name": n, "ms": (i + 1) * gap} for i, n in enumerate(names)]


class SkillNameRankingTest(TestCase):
    def setUp(self):
        cache.clear()   # the per-address throttle counts across tests otherwise
        self.c = APIClient()

    def token(self, age_seconds=600):
        """A start token as the server would have issued it `age_seconds` ago."""
        return signing.dumps({"g": f"game{time.time_ns()}", "t": time.time() - age_seconds}, salt=nv.TOKEN_SALT)

    def submit(self, client=None, **body):
        return (client or self.c).post("/api/solo/names/submit/", body, format="json")

    def test_data_matches_the_copy_the_page_ships(self):
        front = os.path.join(settings.BASE_DIR, "..", "frontend", "src", "data", "lolSkills.json")
        with open(front, encoding="utf-8") as f, open(nv.DATA_PATH, encoding="utf-8") as b:
            self.assertEqual(json.load(f), json.load(b))

    def test_normalize_matches_the_page(self):
        self.assertEqual(nv.normalize(" Z 드라이브  공진 "), "z드라이브공진")
        self.assertEqual(nv.normalize("돌겨어어억!!!"), "돌겨어어억")
        self.assertEqual(nv.normalize("９０구경　투망"), "90구경투망")

    def test_start_gives_a_token(self):
        r = self.c.post("/api/solo/names/start/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("g", signing.loads(r.data["token"], salt=nv.TOKEN_SALT))

    def test_guest_leaves_a_record_under_a_nickname(self):
        r = self.submit(token=self.token(), nickname="  롤충 ", answers=log("여우불", "매혹", "현혹의구슬"))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["count"], 3)
        self.assertEqual(r.data["rank"], 1)
        s = SkillNameScore.objects.get()
        self.assertEqual((s.user, s.nickname, s.count), (None, "롤충", 3))

    def test_guest_needs_a_nickname(self):
        r = self.submit(token=self.token(), answers=log("여우불"))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(SkillNameScore.objects.count(), 0)
        r = self.submit(token=self.token(), nickname="가" * 13, answers=log("여우불"))
        self.assertEqual(r.status_code, 400)

    def test_member_is_recorded_under_the_account(self):
        u = User.objects.create_user(email="a@example.com", username="회원", password="x")
        c = APIClient(); c.force_authenticate(u)
        r = self.submit(c, token=self.token(), nickname="무시됨", answers=log("여우불", "매혹"))
        self.assertEqual(r.status_code, 200, r.data)
        s = SkillNameScore.objects.get()
        self.assertEqual((s.user, s.nickname, s.count), (u, "", 2))

    def test_one_game_is_recorded_once(self):
        t = self.token()
        self.submit(token=t, nickname="롤충", answers=log("여우불"))
        r = self.submit(token=t, nickname="롤충", answers=log("여우불", "매혹"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(SkillNameScore.objects.count(), 1)
        self.assertEqual(SkillNameScore.objects.get().count, 1)

    def test_refuses_a_made_up_game(self):
        bad = [
            dict(token="nonsense", answers=log("여우불")),                                   # no real start
            dict(token=self.token(), answers=log("여우불", "파이어볼")),                       # not a skill
            dict(token=self.token(), answers=log("여우불", "여우 불")),                        # the same skill twice
            dict(token=self.token(), answers=[{"name": "여우불", "ms": 25000}]),              # the clock had run out
            dict(token=self.token(), answers=[{"name": "여우불", "ms": 1000}, {"name": "매혹", "ms": 23000}]),
            dict(token=self.token(), answers=[{"name": "여우불", "ms": 1000}, {"name": "매혹", "ms": 1100}]),  # faster than typing
            dict(token=self.token(age_seconds=3), answers=log("여우불", "매혹", "현혹의 구슬", gap=10000)),   # 30s of play in 3s
            dict(token=self.token(), answers=[]),
            dict(token=self.token(), answers="여우불"),
        ]
        for body in bad:
            r = self.submit(nickname="롤충", **body)
            self.assertEqual(r.status_code, 400, body)
        self.assertEqual(SkillNameScore.objects.count(), 0)

    def test_an_address_cannot_flood_the_ranking(self):
        codes = {self.c.post("/api/solo/names/start/").status_code for _ in range(121)}
        self.assertEqual(codes, {200, 429})

    def test_leaderboard_keeps_each_player_s_best(self):
        u = User.objects.create_user(email="a@example.com", username="회원", password="x")
        c = APIClient(); c.force_authenticate(u)
        self.submit(c, token=self.token(), answers=log("여우불"))
        self.submit(c, token=self.token(), answers=log("여우불", "매혹", "혼령 질주"))
        self.submit(token=self.token(), nickname="롤충", answers=log("여우불", "매혹"))
        self.submit(token=self.token(), nickname="롤충", answers=log("여우불"))
        self.submit(token=self.token(), nickname="뉴비", answers=log("여우불"))
        r = c.get("/api/solo/names/leaderboard/")
        rows = [(e["name"], e["count"], e["guest"]) for e in r.data["leaderboard"]]
        self.assertEqual(rows, [("회원", 3, False), ("롤충", 2, True), ("뉴비", 1, True)])
        self.assertEqual(r.data["my_best"], 3)
        self.assertIsNone(self.c.get("/api/solo/names/leaderboard/").data["my_best"])
