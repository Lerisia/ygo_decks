from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import User
from .models import Tournament, Entrant, Round, Match


def _user(tag):
    return User.objects.create_user(email=f"{tag}@t.com", username=tag, password="pass1234")


def _auth(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class TournamentApiTestBase(TestCase):
    def setUp(self):
        self.host = _user("host")
        self.client = _auth(self.host)

    def create(self, client=None, **overrides):
        payload = {
            "name": "제1회 엘리스컵",
            "description": "테스트 대회",
            "format": "single_elim",
            "capacity": 8,
            "event_date": (timezone.now() + timedelta(days=1)).isoformat(),
        }
        payload.update(overrides)
        return (client or self.client).post("/api/tournaments/create/", payload, format="json")

    def make_players(self, tournament, n, check_in=True):
        players = []
        for i in range(n):
            u = _user(f"p{i}_{tournament.id}")
            c = _auth(u)
            assert c.post(f"/api/tournaments/{tournament.id}/register/", {"md_uid": f"{100000000 + i}"}, format="json").status_code == 200
            if check_in:
                assert c.post(f"/api/tournaments/{tournament.id}/check-in/").status_code == 200
            players.append((u, c))
        return players

    def start(self, tournament):
        resp = self.client.post(f"/api/tournaments/{tournament.id}/start/")
        assert resp.status_code == 200, resp.content
        tournament.refresh_from_db()
        return resp

    def confirm_match(self, match, players, result="win"):
        """Report as entrant1's user (win/lose/draw from their view), confirm as entrant2's user."""
        by_user = {u.id: c for u, c in players}
        c1 = by_user[match.entrant1.user_id]
        c2 = by_user[match.entrant2.user_id]
        r = c1.post(f"/api/tournaments/matches/{match.id}/report/", {"result": result}, format="json")
        assert r.status_code == 200, r.content
        r = c2.post(f"/api/tournaments/matches/{match.id}/confirm/")
        assert r.status_code == 200, r.content


class CreateAndRecruitTest(TournamentApiTestBase):
    def test_anonymous_cannot_create(self):
        self.assertEqual(self.create(client=APIClient()).status_code, 401)

    def test_any_member_can_create(self):
        resp = self.create(client=_auth(_user("member")))
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(data["status"], "recruiting")
        self.assertEqual(data["host_name"], "member")

    def test_invalid_format_rejected(self):
        self.assertEqual(self.create(format="double_elim").status_code, 400)

    def test_list_and_detail_include_entrant_avatars(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 2, check_in=False)
        listing = APIClient().get("/api/tournaments/").json()
        self.assertEqual(listing[0]["entrant_count"], 2)
        detail = APIClient().get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(len(detail["entrants"]), 2)
        for e in detail["entrants"]:
            self.assertIn("avatar_icon", e)
            self.assertIn("border", e)
            self.assertEqual(e["status"], "registered")

    def test_register_rules(self):
        t = Tournament.objects.get(id=self.create(capacity=2).json()["id"])
        u1, c1 = _user("r1"), None
        c1 = _auth(u1)
        self.assertEqual(APIClient().post(f"/api/tournaments/{t.id}/register/").status_code, 401)
        self.assertEqual(c1.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "111111111"}, format="json").status_code, 200)
        self.assertEqual(c1.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "111111111"}, format="json").status_code, 400)  # duplicate
        c2 = _auth(_user("r2"))
        self.assertEqual(c2.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "222222222"}, format="json").status_code, 200)
        c3 = _auth(_user("r3"))
        self.assertEqual(c3.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "333333333"}, format="json").status_code, 400)  # full

    def test_withdraw_and_rejoin(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        c = _auth(_user("w1"))
        c.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "444444444"}, format="json")
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/withdraw/").status_code, 200)
        self.assertEqual(Entrant.objects.get(tournament=t).status, "withdrawn")
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "444444444"}, format="json").status_code, 200)  # rejoin reuses row
        self.assertEqual(Entrant.objects.get(tournament=t).status, "registered")

    def test_check_in_requires_registration(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        c = _auth(_user("nc"))
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/check-in/").status_code, 400)

    def test_kick_is_host_only(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        (u, c), = self.make_players(t, 1, check_in=False)
        entrant = Entrant.objects.get(tournament=t, user=u)
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/kick/", {"entrant_id": entrant.id}).status_code, 403)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/kick/", {"entrant_id": entrant.id}).status_code, 200)
        entrant.refresh_from_db()
        self.assertEqual(entrant.status, "kicked")


class StartTest(TournamentApiTestBase):
    def test_start_is_host_only(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        players = self.make_players(t, 2)
        self.assertEqual(players[0][1].post(f"/api/tournaments/{t.id}/start/").status_code, 403)

    def test_start_requires_two_checked_in(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 3, check_in=False)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/start/").status_code, 400)

    def test_single_elim_five_players_gets_three_byes(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 5)
        self.start(t)
        self.assertEqual(t.status, "ongoing")
        self.assertEqual(t.current_round, 1)
        matches = Match.objects.filter(round__tournament=t)
        byes = matches.filter(entrant2__isnull=True)
        self.assertEqual(matches.count(), 4)
        self.assertEqual(byes.count(), 3)
        for b in byes:  # byes resolve themselves
            self.assertEqual(b.result, "bye")
            self.assertEqual(b.report_status, "confirmed")
        self.assertTrue(Round.objects.get(tournament=t).random_seed)

    def test_only_checked_in_players_are_seated(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        self.make_players(t, 4)
        lazy = _auth(_user("lazy"))
        lazy.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "555555555"}, format="json")  # never checks in
        self.start(t)
        seated = {m.entrant1_id for m in Match.objects.filter(round__tournament=t)} | \
                 {m.entrant2_id for m in Match.objects.filter(round__tournament=t)}
        self.assertEqual(len({s for s in seated if s}), 4)

    def test_cannot_register_after_start(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 2)
        self.start(t)
        c = _auth(_user("late"))
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "666666666"}, format="json").status_code, 400)


class ReportFlowTest(TournamentApiTestBase):
    def setUp(self):
        super().setUp()
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        self.players = self.make_players(t, 2)
        self.start(t)
        self.t = t
        self.match = Match.objects.get(round__tournament=t)

    def test_stranger_cannot_report(self):
        c = _auth(_user("stranger"))
        resp = c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "win"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_report_then_opponent_confirms(self):
        u1c = dict((u.id, c) for u, c in self.players)[self.match.entrant1.user_id]
        u2c = dict((u.id, c) for u, c in self.players)[self.match.entrant2.user_id]
        resp = u1c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "win"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.match.refresh_from_db()
        self.assertEqual(self.match.report_status, "reported")
        self.assertEqual(self.match.result, "p1")
        # reporter cannot confirm their own report
        self.assertEqual(u1c.post(f"/api/tournaments/matches/{self.match.id}/confirm/").status_code, 403)
        self.assertEqual(u2c.post(f"/api/tournaments/matches/{self.match.id}/confirm/").status_code, 200)
        self.match.refresh_from_db()
        self.assertEqual(self.match.report_status, "confirmed")

    def test_dispute_and_host_override(self):
        u1c = dict((u.id, c) for u, c in self.players)[self.match.entrant1.user_id]
        u2c = dict((u.id, c) for u, c in self.players)[self.match.entrant2.user_id]
        u1c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "win"}, format="json")
        self.assertEqual(u2c.post(f"/api/tournaments/matches/{self.match.id}/dispute/").status_code, 200)
        self.match.refresh_from_db()
        self.assertEqual(self.match.report_status, "disputed")
        resp = self.client.post(f"/api/tournaments/matches/{self.match.id}/override/", {"result": "p2"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.match.refresh_from_db()
        self.assertEqual(self.match.report_status, "confirmed")
        self.assertEqual(self.match.result, "p2")

    def test_override_is_host_only(self):
        u1c = dict((u.id, c) for u, c in self.players)[self.match.entrant1.user_id]
        resp = u1c.post(f"/api/tournaments/matches/{self.match.id}/override/", {"result": "p1"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_report_from_entrant2_perspective(self):
        u2c = dict((u.id, c) for u, c in self.players)[self.match.entrant2.user_id]
        resp = u2c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "win"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.match.refresh_from_db()
        self.assertEqual(self.match.result, "p2")   # reporter-relative mapping

    def test_swiss_allows_draw(self):
        u1c = dict((u.id, c) for u, c in self.players)[self.match.entrant1.user_id]
        resp = u1c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "draw"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.match.refresh_from_db()
        self.assertEqual(self.match.result, "draw")

    def test_invalid_result_value_rejected(self):
        u1c = dict((u.id, c) for u, c in self.players)[self.match.entrant1.user_id]
        resp = u1c.post(f"/api/tournaments/matches/{self.match.id}/report/", {"result": "2-1"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_single_elim_rejects_draw_report(self):
        t2 = Tournament.objects.get(id=self.create(name="엘림", format="single_elim").json()["id"])
        players = self.make_players(t2, 2)
        self.start(t2)
        m = Match.objects.get(round__tournament=t2)
        c = dict((u.id, c) for u, c in players)[m.entrant1.user_id]
        resp = c.post(f"/api/tournaments/matches/{m.id}/report/", {"result": "draw"}, format="json")
        self.assertEqual(resp.status_code, 400)


class RoundProgressionTest(TournamentApiTestBase):
    def test_next_round_blocked_until_all_confirmed(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        self.make_players(t, 4)
        self.start(t)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code, 400)

    def test_single_elim_winners_advance(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        players = self.make_players(t, 4)
        self.start(t)
        r1 = list(Match.objects.filter(round__tournament=t).order_by("bracket_pos"))
        for m in r1:
            self.confirm_match(m, players)  # entrant1 wins each
        resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
        self.assertEqual(resp.status_code, 200, resp.content)
        t.refresh_from_db()
        self.assertEqual(t.current_round, 2)
        r2 = Match.objects.filter(round__tournament=t, round__number=2)
        self.assertEqual(r2.count(), 1)
        winners = {r1[0].entrant1_id, r1[1].entrant1_id}
        m2 = r2.get()
        self.assertEqual({m2.entrant1_id, m2.entrant2_id}, winners)

    def test_swiss_second_round_avoids_rematch(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        players = self.make_players(t, 4)
        self.start(t)
        r1 = list(Match.objects.filter(round__tournament=t))
        first_pairs = {frozenset((m.entrant1_id, m.entrant2_id)) for m in r1}
        for m in r1:
            self.confirm_match(m, players)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code, 200)
        r2 = Match.objects.filter(round__tournament=t, round__number=2)
        for m in r2:
            self.assertNotIn(frozenset((m.entrant1_id, m.entrant2_id)), first_pairs)

    def test_swiss_round_limit(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        players = self.make_players(t, 4)
        self.start(t)  # 4 players -> 2 swiss rounds by default
        for rnd in (1, 2):
            for m in Match.objects.filter(round__tournament=t, round__number=rnd):
                self.confirm_match(m, players)
            resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
            if rnd == 1:
                self.assertEqual(resp.status_code, 200, resp.content)
            else:
                self.assertEqual(resp.status_code, 400)  # no rounds left

    def test_round_robin_full_cycle(self):
        t = Tournament.objects.get(id=self.create(format="round_robin").json()["id"])
        players = self.make_players(t, 4)
        self.start(t)
        seen = set()
        for rnd in (1, 2, 3):
            ms = list(Match.objects.filter(round__tournament=t, round__number=rnd))
            self.assertEqual(len(ms), 2)
            for m in ms:
                seen.add(frozenset((m.entrant1_id, m.entrant2_id)))
                self.confirm_match(m, players)
            resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
            self.assertEqual(resp.status_code, 200 if rnd < 3 else 400, resp.content)
        self.assertEqual(len(seen), 6)  # everyone met everyone once


class StandingsAndCompleteTest(TournamentApiTestBase):
    def test_standings_points_and_bye(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        players = self.make_players(t, 3)
        self.start(t)
        real = Match.objects.get(round__tournament=t, entrant2__isnull=False)
        self.confirm_match(real, players)
        standings = APIClient().get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(len(standings), 3)
        top = standings[0]
        self.assertEqual(top["points"], 3)
        self.assertIn("buchholz", top)
        self.assertIn("avatar_icon", top)
        bye_entrant_ids = set(Match.objects.filter(round__tournament=t, entrant2__isnull=True).values_list("entrant1_id", flat=True))
        bye_row = next(s for s in standings if s["entrant_id"] in bye_entrant_ids)
        self.assertEqual(bye_row["wins"], 1)  # bye counts as a win

    def test_complete_requires_host_and_resolved_round(self):
        t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        players = self.make_players(t, 2)
        self.start(t)
        self.assertEqual(players[0][1].post(f"/api/tournaments/{t.id}/complete/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/complete/").status_code, 400)  # match pending
        self.confirm_match(Match.objects.get(round__tournament=t), players)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/complete/").status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.status, "completed")


class MdUidTest(TournamentApiTestBase):
    def _register(self, client, t, **payload):
        return client.post(f"/api/tournaments/{t.id}/register/", payload, format="json")

    def _tournament(self):
        return Tournament.objects.get(id=self.create().json()["id"])

    def test_register_requires_nine_digit_uid(self):
        t = self._tournament()
        c = _auth(_user("uid1"))
        self.assertEqual(self._register(c, t).status_code, 400)                      # missing
        self.assertEqual(self._register(c, t, md_uid="12345").status_code, 400)      # too short
        self.assertEqual(self._register(c, t, md_uid="1234567890").status_code, 400) # too long
        self.assertEqual(self._register(c, t, md_uid="12345678a").status_code, 400)  # non-digit
        self.assertEqual(self._register(c, t, md_uid="123456789").status_code, 200)
        self.assertEqual(Entrant.objects.get(tournament=t).md_uid, "123456789")

    def test_uid_saved_to_profile_and_reused(self):
        t = self._tournament()
        u = _user("uid2")
        c = _auth(u)
        self.assertEqual(self._register(c, t, md_uid="123123123").status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.md_uid, "123123123")
        t2 = Tournament.objects.get(id=self.create(name="2회").json()["id"])
        self.assertEqual(self._register(c, t2).status_code, 200)  # no uid needed the second time
        self.assertEqual(Entrant.objects.get(tournament=t2).md_uid, "123123123")

    def test_uid_kept_on_rejoin_and_updatable(self):
        t = self._tournament()
        c = _auth(_user("uid3"))
        self._register(c, t, md_uid="987654321")
        c.post(f"/api/tournaments/{t.id}/withdraw/")
        self.assertEqual(self._register(c, t, md_uid="111222333").status_code, 200)
        self.assertEqual(Entrant.objects.get(tournament=t).md_uid, "111222333")

    def test_uid_visible_only_to_participants_and_host(self):
        t = self._tournament()
        u = _user("uid4")
        _auth(u).post(f"/api/tournaments/{t.id}/register/", {"md_uid": "111222333"}, format="json")

        anon = APIClient().get(f"/api/tournaments/{t.id}/").json()
        self.assertIsNone(anon["entrants"][0]["md_uid"])
        outsider = _auth(_user("uid5")).get(f"/api/tournaments/{t.id}/").json()
        self.assertIsNone(outsider["entrants"][0]["md_uid"])
        as_host = self.client.get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(as_host["entrants"][0]["md_uid"], "111222333")
        as_participant = _auth(u).get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(as_participant["entrants"][0]["md_uid"], "111222333")


class AnnouncementTest(TournamentApiTestBase):
    def setUp(self):
        super().setUp()
        self.t = Tournament.objects.get(id=self.create().json()["id"])

    def test_host_only_can_post(self):
        c = _auth(_user("annA"))
        resp = c.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "hi"}, format="json")
        self.assertEqual(resp.status_code, 403)
        resp = self.client.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "1라운드 시작!"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_empty_content_rejected(self):
        resp = self.client.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "  "}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_list_is_public_pinned_first(self):
        self.client.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "일반"}, format="json")
        self.client.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "중요", "pinned": True}, format="json")
        rows = APIClient().get(f"/api/tournaments/{self.t.id}/announcements/").json()
        self.assertEqual([r["content"] for r in rows], ["중요", "일반"])
        self.assertTrue(rows[0]["pinned"])

    def test_host_can_delete(self):
        self.client.post(f"/api/tournaments/{self.t.id}/announcements/", {"content": "삭제될 공지"}, format="json")
        ann_id = APIClient().get(f"/api/tournaments/{self.t.id}/announcements/").json()[0]["id"]
        c = _auth(_user("annB"))
        self.assertEqual(c.delete(f"/api/tournaments/announcements/{ann_id}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/tournaments/announcements/{ann_id}/").status_code, 200)
        self.assertEqual(APIClient().get(f"/api/tournaments/{self.t.id}/announcements/").json(), [])


class ChatTest(TournamentApiTestBase):
    def setUp(self):
        super().setUp()
        self.t = Tournament.objects.get(id=self.create().json()["id"])
        self.u1 = _user("chat1")
        self.c1 = _auth(self.u1)
        self.c1.post(f"/api/tournaments/{self.t.id}/register/", {"md_uid": "123456789"}, format="json")

    def post_chat(self, client, content="gg"):
        return client.post(f"/api/tournaments/{self.t.id}/chat/", {"content": content}, format="json")

    def test_entrant_and_host_can_chat(self):
        self.assertEqual(self.post_chat(self.c1).status_code, 201)
        self.assertEqual(self.post_chat(self.client, "주최자도 참여").status_code, 201)

    def test_outsiders_cannot_chat(self):
        self.assertEqual(self.post_chat(APIClient()).status_code, 401)
        stranger = _auth(_user("chat2"))
        self.assertEqual(self.post_chat(stranger).status_code, 403)

    def test_kicked_entrant_cannot_chat(self):
        entrant = Entrant.objects.get(tournament=self.t, user=self.u1)
        self.client.post(f"/api/tournaments/{self.t.id}/kick/", {"entrant_id": entrant.id})
        self.assertEqual(self.post_chat(self.c1).status_code, 403)

    def test_empty_or_too_long_rejected(self):
        self.assertEqual(self.post_chat(self.c1, "  ").status_code, 400)
        self.assertEqual(self.post_chat(self.c1, "가" * 501).status_code, 400)

    def test_list_public_with_incremental_polling(self):
        for i in range(3):
            self.post_chat(self.c1, f"msg{i}")
        rows = APIClient().get(f"/api/tournaments/{self.t.id}/chat/").json()
        self.assertEqual([r["content"] for r in rows], ["msg0", "msg1", "msg2"])
        self.assertIn("avatar_icon", rows[0])
        after = rows[0]["id"]
        rows2 = APIClient().get(f"/api/tournaments/{self.t.id}/chat/", {"after": after}).json()
        self.assertEqual([r["content"] for r in rows2], ["msg1", "msg2"])


class DeckSubmissionTest(TournamentApiTestBase):
    @classmethod
    def setUpTestData(cls):
        from card.models import Card
        cls.c1 = Card.objects.create(card_id="C001", konami_id="1", name="Blue-Eyes", korean_name="푸른 눈의 백룡")
        cls.c2 = Card.objects.create(card_id="C002", konami_id="2", name="Dark Magician", korean_name="블랙 매지션")
        cls.c3 = Card.objects.create(card_id="C003", konami_id="3", name="Pot of Greed", korean_name="욕망의 항아리")

    def setUp(self):
        super().setUp()
        self.t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        self.players = self.make_players(self.t, 2)
        self.u, self.c = self.players[0]

    def _upload(self, client, scan_result):
        from unittest.mock import patch
        from django.core.files.uploadedfile import SimpleUploadedFile
        img = SimpleUploadedFile("deck.jpg", b"fake-image-bytes", content_type="image/jpeg")
        with patch("tournament.views.scan_deck_image", return_value=scan_result):
            return client.post(f"/api/tournaments/{self.t.id}/deck/", {"image": img}, format="multipart")

    def test_upload_requires_participant(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        img = SimpleUploadedFile("deck.jpg", b"x", content_type="image/jpeg")
        self.assertEqual(APIClient().post(f"/api/tournaments/{self.t.id}/deck/", {"image": img}, format="multipart").status_code, 401)
        self.assertEqual(self._upload(_auth(_user("stranger")), []).status_code, 403)

    def test_upload_scans_and_aggregates_cards(self):
        resp = self._upload(self.c, [("C001", 0.99), ("C001", 0.97), ("C002", 0.55), ("NOPE", 0.9)])
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["unmatched_count"], 1)
        by_name = {c["card"]["name"]: c for c in data["cards"]}
        self.assertEqual(by_name["푸른 눈의 백룡"]["quantity"], 2)
        self.assertEqual(by_name["블랙 매지션"]["quantity"], 1)
        self.assertEqual(by_name["푸른 눈의 백룡"]["source"], "auto")
        self.assertAlmostEqual(by_name["블랙 매지션"]["confidence"], 0.55, places=2)

    def test_reupload_replaces_previous_scan(self):
        self._upload(self.c, [("C001", 0.9)])
        resp = self._upload(self.c, [("C002", 0.8)])
        names = [c["card"]["name"] for c in resp.json()["cards"]]
        self.assertEqual(names, ["블랙 매지션"])

    def test_manual_add_update_and_remove(self):
        self._upload(self.c, [("C001", 0.9)])
        add = self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.c3.id, "quantity": 3}, format="json")
        self.assertEqual(add.status_code, 200, add.content)
        row = next(c for c in add.json()["cards"] if c["card"]["name"] == "욕망의 항아리")
        self.assertEqual(row["quantity"], 3)
        self.assertEqual(row["source"], "manual")
        # adding again updates quantity
        again = self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.c3.id, "quantity": 1}, format="json")
        row = next(c for c in again.json()["cards"] if c["card"]["name"] == "욕망의 항아리")
        self.assertEqual(row["quantity"], 1)
        self.assertEqual(self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.c3.id, "quantity": 4}, format="json").status_code, 400)
        resp = self.c.delete(f"/api/tournaments/{self.t.id}/deck/cards/{row['id']}/")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("욕망의 항아리", [c["card"]["name"] for c in self.c.get(f"/api/tournaments/{self.t.id}/deck/").json()["cards"]])

    def test_locked_after_start(self):
        self._upload(self.c, [("C001", 0.9)])
        self.start(self.t)
        self.assertEqual(self._upload(self.c, [("C002", 0.9)]).status_code, 400)
        self.assertEqual(self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.c3.id, "quantity": 1}, format="json").status_code, 400)
        detail = self.c.get(f"/api/tournaments/{self.t.id}/deck/").json()
        self.assertTrue(detail["locked"])

    def test_visibility_owner_and_host_only(self):
        self._upload(self.c, [("C001", 0.9)])
        entrant_id = Entrant.objects.get(tournament=self.t, user=self.u).id
        self.assertEqual(self.c.get(f"/api/tournaments/{self.t.id}/deck/").status_code, 200)          # owner
        self.assertEqual(self.client.get(f"/api/tournaments/{self.t.id}/deck/", {"entrant_id": entrant_id}).status_code, 200)  # host
        other_c = self.players[1][1]
        self.assertEqual(other_c.get(f"/api/tournaments/{self.t.id}/deck/", {"entrant_id": entrant_id}).status_code, 403)      # peer
        self.assertEqual(other_c.get(f"/api/tournaments/{self.t.id}/deck/").status_code, 404)          # no own submission yet


class CoverImageTest(TournamentApiTestBase):
    @staticmethod
    def _png(name="cover.png"):
        import io
        from PIL import Image as PILImage
        from django.core.files.uploadedfile import SimpleUploadedFile
        buf = io.BytesIO()
        PILImage.new("RGB", (4, 4), (30, 60, 200)).save(buf, format="PNG")
        return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")

    def test_create_with_cover_image(self):
        from django.utils import timezone
        from datetime import timedelta
        resp = self.client.post("/api/tournaments/create/", {
            "name": "커버컵", "format": "swiss", "capacity": 8,
            "event_date": (timezone.now() + timedelta(days=1)).isoformat(),
            "cover_image": self._png(),
        }, format="multipart")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIn("tournament_covers/", resp.json()["cover_image"] or "")

    def test_host_can_update_and_remove_cover(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        resp = self.client.post(f"/api/tournaments/{t.id}/cover/", {"cover_image": self._png("b.png")}, format="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("tournament_covers/", resp.json()["cover_image"])
        resp = self.client.post(f"/api/tournaments/{t.id}/cover/", {}, format="multipart")  # no file = remove
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["cover_image"])

    def test_cover_update_is_host_only(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        c = _auth(_user("nothost"))
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/cover/", {"cover_image": self._png()}, format="multipart").status_code, 403)

    def test_cover_rejects_oversized_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        t = Tournament.objects.get(id=self.create().json()["id"])
        big = SimpleUploadedFile("big.png", b"x" * (5 * 1024 * 1024 + 1), content_type="image/png")
        resp = self.client.post(f"/api/tournaments/{t.id}/cover/", {"cover_image": big}, format="multipart")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("5MB", resp.json()["error"])

    def test_cover_rejects_non_image(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        t = Tournament.objects.get(id=self.create().json()["id"])
        fake = SimpleUploadedFile("evil.png", b"not an image at all", content_type="image/png")
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/cover/", {"cover_image": fake}, format="multipart").status_code, 400)

    def test_create_rejects_oversized_cover(self):
        from datetime import timedelta
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.utils import timezone
        big = SimpleUploadedFile("big.png", b"x" * (5 * 1024 * 1024 + 1), content_type="image/png")
        resp = self.client.post("/api/tournaments/create/", {
            "name": "큰커버컵", "format": "swiss", "capacity": 8,
            "event_date": (timezone.now() + timedelta(days=1)).isoformat(),
            "cover_image": big,
        }, format="multipart")
        self.assertEqual(resp.status_code, 400)

    def test_capacity_bounds(self):
        self.assertEqual(self.create(capacity=1).status_code, 400)
        self.assertEqual(self.create(capacity=129).status_code, 400)
        self.assertEqual(self.create(name="최대", capacity=128).status_code, 201)


class SwissCutTest(TournamentApiTestBase):
    """스위스 예선 후 상위 컷 결선 토너먼트."""

    def _make(self, n_players, swiss_rounds=1, cut=4):
        resp = self.create(name="스컷", format="swiss_cut",
                           format_config={"swiss_rounds": swiss_rounds, "cut": cut})
        assert resp.status_code == 201, resp.content
        t = Tournament.objects.get(id=resp.json()["id"])
        players = self.make_players(t, n_players)
        self.start(t)
        return t, players

    def _confirm_all(self, t, players, winner_picker=None):
        rnd = Round.objects.get(tournament=t, number=t.current_round)
        for m in rnd.matches.exclude(report_status="confirmed"):
            result = winner_picker(m) if winner_picker else "win"
            self.confirm_match(m, players, result=result)

    def test_swiss_stage_then_seeded_cut(self):
        t, players = self._make(5, swiss_rounds=1, cut=4)
        r1 = Round.objects.get(tournament=t, number=1)
        self.assertEqual(r1.stage, "swiss")
        self._confirm_all(t, players)
        resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
        self.assertEqual(resp.status_code, 200, resp.content)
        t.refresh_from_db()
        r2 = Round.objects.get(tournament=t, number=2)
        self.assertEqual(r2.stage, "knockout")
        matches = list(r2.matches.order_by("bracket_pos"))
        self.assertEqual(len(matches), 2)          # cut 4 -> two semifinals
        # seeded: standings 1위 vs 4위, 2위 vs 3위 — 5th player is out
        seated = {m.entrant1_id for m in matches} | {m.entrant2_id for m in matches if m.entrant2_id}
        self.assertEqual(len(seated), 4)

    def test_knockout_rejects_draw_but_swiss_allows(self):
        t, players = self._make(4, swiss_rounds=1, cut=4)
        rnd = Round.objects.get(tournament=t, number=1)
        m = rnd.matches.first()
        by_user = {u.id: c for u, c in players}
        c1 = by_user[m.entrant1.user_id]
        self.assertEqual(c1.post(f"/api/tournaments/matches/{m.id}/report/", {"result": "draw"}, format="json").status_code, 200)
        # finish swiss with wins to reach knockout
        by_user[m.entrant2.user_id].post(f"/api/tournaments/matches/{m.id}/confirm/")
        self._confirm_all(t, players)
        assert self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code == 200
        t.refresh_from_db()
        km = Round.objects.get(tournament=t, number=2).matches.first()
        ck = by_user[km.entrant1.user_id]
        resp = ck.post(f"/api/tournaments/matches/{km.id}/report/", {"result": "draw"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_full_run_and_champion_ranked_first(self):
        t, players = self._make(4, swiss_rounds=1, cut=4)
        self._confirm_all(t, players)                        # swiss: entrant1s win
        assert self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code == 200
        t.refresh_from_db()
        semis = list(Round.objects.get(tournament=t, number=2).matches.order_by("bracket_pos"))
        # 4번 시드(스위스 0점) 쪽이 계속 이기게 해서 승점 역전 상황을 만든다
        def underdog_wins(m):
            return "lose"  # entrant1(높은 시드)이 짐 -> entrant2 승
        for m in semis:
            self.confirm_match(m, players, result="lose")
        assert self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code == 200
        t.refresh_from_db()
        final = Round.objects.get(tournament=t, number=3)
        self.assertEqual(final.stage, "knockout")
        fm = final.matches.get()
        self.confirm_match(fm, players, result="win")        # entrant1이 우승
        champion_id = fm.entrant1_id
        assert self.client.post(f"/api/tournaments/{t.id}/complete/").status_code == 200
        standings = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(standings[0]["entrant_id"], champion_id)   # 결선 결과가 승점보다 우선
        self.assertEqual(standings[1]["entrant_id"], fm.entrant2_id)

    def test_round_stage_serialized(self):
        t, players = self._make(4, swiss_rounds=1, cut=4)
        detail = self.client.get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(detail["rounds"][0]["stage"], "swiss")

    def test_single_elim_rounds_are_knockout_stage(self):
        resp = self.create(name="엘림스테이지", format="single_elim")
        t = Tournament.objects.get(id=resp.json()["id"])
        self.make_players(t, 2)
        self.start(t)
        self.assertEqual(Round.objects.get(tournament=t, number=1).stage, "knockout")
