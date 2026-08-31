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
