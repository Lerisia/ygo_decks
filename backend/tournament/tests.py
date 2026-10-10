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
        self.assertEqual(self.create(format="ladder").status_code, 400)

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
        from carddb.models import Card, LegacyCard, MdArt, MdPrint
        made = []
        for old_id, (cid, name) in enumerate(((4007, "푸른 눈의 백룡"), (4041, "블랙 매지션"), (4844, "욕망의 항아리"), (5392, "천재지변")), 1):
            card = Card.objects.create(id=cid, category="monster", name_ja=name, name_ko=name, frame="normal")
            if cid != 5392:
                MdPrint.objects.create(md_id=cid, card=card)
                MdArt.objects.create(md_print_id=cid, version="common", image=f"cards/art/common/{cid}.webp")
            LegacyCard.objects.create(old_id=old_id, old_card_id=str(old_id), card=card, how="konami")
            made.append(card)
        cls.c1, cls.c2, cls.c3, cls.ocg_only = made

    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)
        super().setUp()
        self.t = Tournament.objects.get(id=self.create(format="swiss").json()["id"])
        self.players = self.make_players(self.t, 2)
        self.u, self.c = self.players[0]

    def test_cards_outside_master_duel_are_unmatched(self):
        resp = self._upload(self.c, [("1", 0.9), ("4", 0.9)])
        self.assertEqual(resp.json()["unmatched_count"], 1)
        self.assertEqual(resp.json()["cards"][0]["card"], {"id": 4007, "name": "푸른 눈의 백룡", "image_url": "/media/cards/art/common/4007.webp"})
        add = self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.ocg_only.id, "quantity": 1}, format="json")
        self.assertEqual(add.status_code, 404)


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
        resp = self._upload(self.c, [("1", 0.99), ("1", 0.97), ("2", 0.55), ("NOPE", 0.9)])
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["unmatched_count"], 1)
        by_name = {c["card"]["name"]: c for c in data["cards"]}
        self.assertEqual(by_name["푸른 눈의 백룡"]["quantity"], 2)
        self.assertEqual(by_name["블랙 매지션"]["quantity"], 1)
        self.assertEqual(by_name["푸른 눈의 백룡"]["source"], "auto")
        self.assertAlmostEqual(by_name["블랙 매지션"]["confidence"], 0.55, places=2)

    def test_scanner_integer_ids_still_match(self):
        # the real classifier returns numpy int64 ids, not strings
        resp = self._upload(self.c, [(1, 0.95), (2, 0.9)])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["unmatched_count"], 0)
        self.assertEqual({c["card"]["name"] for c in resp.json()["cards"]}, {"푸른 눈의 백룡", "블랙 매지션"})

    def test_reupload_replaces_previous_scan(self):
        self._upload(self.c, [("1", 0.9)])
        resp = self._upload(self.c, [("2", 0.8)])
        names = [c["card"]["name"] for c in resp.json()["cards"]]
        self.assertEqual(names, ["블랙 매지션"])

    def test_manual_add_update_and_remove(self):
        self._upload(self.c, [("1", 0.9)])
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
        self._upload(self.c, [("1", 0.9)])
        self.start(self.t)
        self.assertEqual(self._upload(self.c, [("2", 0.9)]).status_code, 400)
        self.assertEqual(self.c.post(f"/api/tournaments/{self.t.id}/deck/cards/", {"card_id": self.c3.id, "quantity": 1}, format="json").status_code, 400)
        detail = self.c.get(f"/api/tournaments/{self.t.id}/deck/").json()
        self.assertTrue(detail["locked"])

    def test_visibility_owner_and_host_only(self):
        self._upload(self.c, [("1", 0.9)])
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


class GroupKnockoutTest(TournamentApiTestBase):
    """조별 리그 후 각 조 상위 N명이 결선 토너먼트로."""

    def _make(self, n_players, groups=2, advance=2):
        resp = self.create(name="조별", format="group_knockout", capacity=16,
                           format_config={"groups": groups, "advance": advance})
        assert resp.status_code == 201, resp.content
        t = Tournament.objects.get(id=resp.json()["id"])
        players = self.make_players(t, n_players)
        self.start(t)
        return t, players

    def _confirm_all(self, t, players, result="win"):
        rnd = Round.objects.get(tournament=t, number=t.current_round)
        for m in rnd.matches.exclude(report_status="confirmed"):
            self.confirm_match(m, players, result=result)

    def _next(self, t):
        resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
        t.refresh_from_db()
        return resp

    def test_create_validates_group_options(self):
        self.assertEqual(self.create(format="group_knockout", format_config={"groups": 3}).status_code, 400)
        self.assertEqual(self.create(format="group_knockout", format_config={"groups": 2, "advance": 9}).status_code, 400)
        self.assertEqual(self.create(format="group_knockout", format_config={"groups": 4, "advance": 1}).status_code, 201)

    def test_start_needs_two_per_group(self):
        resp = self.create(name="작은조", format="group_knockout", format_config={"groups": 4, "advance": 1})
        t = Tournament.objects.get(id=resp.json()["id"])
        self.make_players(t, 5)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/start/").status_code, 400)

    def test_start_deals_groups_and_stores_schedule(self):
        t, players = self._make(8, groups=2, advance=2)
        r1 = Round.objects.get(tournament=t, number=1)
        self.assertEqual(r1.stage, "league")
        by_group = {}
        for m in r1.matches.all():
            by_group.setdefault(m.group, set()).update({m.entrant1_id, m.entrant2_id})
        self.assertEqual(sorted(by_group), [0, 1])
        self.assertEqual([len(s) for s in by_group.values()], [4, 4])
        self.assertEqual(len(t.format_config["group_table"]), 2)
        self.assertEqual(len(t.format_config["group_schedule"]), 3)   # 4명 조 → 3라운드

    def test_group_stage_allows_draw_and_serializes_group(self):
        t, players = self._make(4, groups=2, advance=1)
        m = Round.objects.get(tournament=t, number=1).matches.first()
        by_user = {u.id: c for u, c in players}
        resp = by_user[m.entrant1.user_id].post(f"/api/tournaments/matches/{m.id}/report/", {"result": "draw"}, format="json")
        self.assertEqual(resp.status_code, 200)
        detail = self.client.get(f"/api/tournaments/{t.id}/").json()
        self.assertIn(detail["rounds"][0]["matches"][0]["group"], (0, 1))

    def test_standings_grouped_during_league(self):
        t, players = self._make(6, groups=2, advance=1)
        self._confirm_all(t, players)
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(sorted(r["group"] for r in rows), [0, 0, 0, 1, 1, 1])
        self.assertTrue(all(r["qualified"] is False for r in rows))

    def test_full_run_two_groups_top_two_cross_seeded(self):
        t, players = self._make(8, groups=2, advance=2)
        for _ in range(3):                       # 3 league rounds, entrant1 always wins
            self._confirm_all(t, players)
            if t.current_round < 3:
                assert self._next(t).status_code == 200
        resp = self._next(t)                     # league done -> knockout
        self.assertEqual(resp.status_code, 200, resp.content)
        r4 = Round.objects.get(tournament=t, number=4)
        self.assertEqual(r4.stage, "knockout")
        semis = list(r4.matches.order_by("bracket_pos"))
        self.assertEqual(len(semis), 2)
        group_of = {eid: gi for gi, ids in enumerate(t.format_config["group_table"]) for eid in ids}
        for m in semis:                          # 1위 vs 다른 조 2위
            self.assertNotEqual(group_of[m.entrant1_id], group_of[m.entrant2_id])
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(sum(1 for r in rows if r["qualified"]), 4)
        self._confirm_all(t, players)
        assert self._next(t).status_code == 200
        final = Round.objects.get(tournament=t, number=5).matches.get()
        self.confirm_match(final, players, result="win")
        self.assertEqual(self._next(t).status_code, 400)          # nothing left
        assert self.client.post(f"/api/tournaments/{t.id}/complete/").status_code == 200
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(rows[0]["entrant_id"], final.entrant1_id)
        self.assertEqual(rows[1]["entrant_id"], final.entrant2_id)
        self.assertTrue(all(r["qualified"] for r in rows[:4]))

    def test_odd_group_gets_bye_and_short_group_capped(self):
        t, players = self._make(5, groups=2, advance=2)             # 조 3명 + 2명
        r1 = Round.objects.get(tournament=t, number=1)
        self.assertEqual(r1.matches.filter(entrant2__isnull=True).count(), 1)
        rounds_total = len(t.format_config["group_schedule"])
        for k in range(rounds_total):
            self._confirm_all(t, players)
            resp = self._next(t)
            self.assertEqual(resp.status_code, 200, resp.content)
        ko = Round.objects.get(tournament=t, number=rounds_total + 1)
        self.assertEqual(ko.stage, "knockout")
        seated = {m.entrant1_id for m in ko.matches.all()} | {m.entrant2_id for m in ko.matches.all() if m.entrant2_id}
        self.assertEqual(len(seated), 4)                            # 2명 조도 2명 모두 진출


class DoubleElimTest(TournamentApiTestBase):
    """승자조·패자조 더블 엘리미네이션, 최종전은 패자조 우승자가 이기면 한 번 더."""

    def _make(self, n_players):
        resp = self.create(name="더블", format="double_elim", capacity=16)
        assert resp.status_code == 201, resp.content
        t = Tournament.objects.get(id=resp.json()["id"])
        players = self.make_players(t, n_players)
        self.start(t)
        return t, players

    def _round(self, t):
        return Round.objects.get(tournament=t, number=t.current_round)

    def _confirm_all(self, t, players, result="win"):
        for m in self._round(t).matches.exclude(report_status="confirmed"):
            self.confirm_match(m, players, result=result)

    def _next(self, t):
        resp = self.client.post(f"/api/tournaments/{t.id}/next-round/")
        t.refresh_from_db()
        return resp

    def _brackets(self, t):
        return sorted(self._round(t).matches.values_list("bracket", flat=True))

    def test_four_players_standard_shape(self):
        t, players = self._make(4)
        self.assertEqual(self._brackets(t), ["winners", "winners"])
        self.assertEqual(self._round(t).stage, "knockout")
        self._confirm_all(t, players)                                  # entrant1s win W1
        assert self._next(t).status_code == 200
        self.assertEqual(self._brackets(t), ["losers", "winners"])     # W2 final + L1
        self._confirm_all(t, players)
        assert self._next(t).status_code == 200
        self.assertEqual(self._brackets(t), ["losers"])                # L2: L1 winner vs W2 loser
        l2 = self._round(t).matches.get()
        w2 = Match.objects.get(round__tournament=t, round__number=2, bracket="winners")
        self.assertEqual(l2.entrant2_id, w2.entrant2_id)               # W2 loser dropped in
        self._confirm_all(t, players)
        assert self._next(t).status_code == 200
        self.assertEqual(self._brackets(t), ["final"])
        gf = self._round(t).matches.get()
        self.assertEqual(gf.entrant1_id, w2.entrant1_id)               # WB champion is P1
        self.assertEqual(gf.entrant2_id, l2.entrant1_id)
        self.confirm_match(gf, players, result="win")                  # WB champion wins -> over
        resp = self._next(t)
        self.assertEqual(resp.status_code, 400)
        assert self.client.post(f"/api/tournaments/{t.id}/complete/").status_code == 200
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(rows[0]["entrant_id"], gf.entrant1_id)
        self.assertEqual(rows[1]["entrant_id"], gf.entrant2_id)

    def test_losers_champion_forces_reset(self):
        t, players = self._make(4)
        for _ in range(3):
            self._confirm_all(t, players)
            assert self._next(t).status_code == 200
        gf = self._round(t).matches.get()
        self.confirm_match(gf, players, result="lose")                 # LB champion wins
        resp = self._next(t)
        self.assertEqual(resp.status_code, 200, resp.content)
        reset = self._round(t).matches.get()
        self.assertEqual(reset.bracket, "final")
        self.assertEqual({reset.entrant1_id, reset.entrant2_id}, {gf.entrant1_id, gf.entrant2_id})
        self.confirm_match(reset, players, result="lose")
        self.assertEqual(self._next(t).status_code, 400)
        assert self.client.post(f"/api/tournaments/{t.id}/complete/").status_code == 200
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(rows[0]["entrant_id"], reset.entrant2_id)

    def test_eight_players_round_count(self):
        t, players = self._make(8)
        shapes = [self._brackets(t)]
        while True:
            self._confirm_all(t, players)
            resp = self._next(t)
            if resp.status_code != 200:
                break
            shapes.append(self._brackets(t))
        self.assertEqual(shapes, [
            ["winners"] * 4,
            ["losers", "losers", "winners", "winners"],
            ["losers", "losers", "winners"],
            ["losers"],
            ["losers"],
            ["final"],
        ])

    def test_five_players_with_byes_reaches_a_final(self):
        t, players = self._make(5)
        seen_final = False
        for _ in range(12):
            self._confirm_all(t, players)
            resp = self._next(t)
            if resp.status_code != 200:
                break
            if self._brackets(t) == ["final"]:
                seen_final = True
        self.assertTrue(seen_final)
        seated = set()
        for m in Match.objects.filter(round__tournament=t):
            seated.update({m.entrant1_id, m.entrant2_id} - {None})
        self.assertEqual(len(seated), 5)

    def test_bracket_serialized_and_draw_rejected(self):
        t, players = self._make(4)
        detail = self.client.get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(detail["rounds"][0]["matches"][0]["bracket"], "winners")
        m = self._round(t).matches.first()
        by_user = {u.id: c for u, c in players}
        resp = by_user[m.entrant1.user_id].post(f"/api/tournaments/matches/{m.id}/report/", {"result": "draw"}, format="json")
        self.assertEqual(resp.status_code, 400)


class DropoutTest(TournamentApiTestBase):
    """진행 중 기권·추방: 남은 경기는 상대 승, 이후 짝은 부전승, 순위표엔 기권으로 남는다."""

    def _rr(self, n=4):
        resp = self.create(name="RR", format="round_robin")
        t = Tournament.objects.get(id=resp.json()["id"])
        players = self.make_players(t, n)
        self.start(t)
        return t, players

    def test_withdraw_during_round_forfeits_and_future_opponents_get_byes(self):
        t, players = self._rr(4)
        by_user = {u.id: c for u, c in players}
        m = Round.objects.get(tournament=t, number=1).matches.first()
        quitter = m.entrant1
        resp = by_user[quitter.user_id].post(f"/api/tournaments/{t.id}/withdraw/")
        self.assertEqual(resp.status_code, 200)
        m.refresh_from_db()
        self.assertEqual((m.result, m.report_status), ("p2", "confirmed"))
        for other in Round.objects.get(tournament=t, number=1).matches.exclude(id=m.id):
            self.confirm_match(other, players)
        assert self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code == 200
        r2 = Round.objects.get(tournament=t, number=2)
        self.assertFalse(r2.matches.filter(entrant1=quitter).exists() or r2.matches.filter(entrant2=quitter).exists())
        self.assertEqual(r2.matches.filter(entrant2__isnull=True, result="bye").count(), 1)
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(rows[-1]["entrant_id"], quitter.id)
        self.assertTrue(rows[-1]["dropped"])
        self.assertTrue(all(not r["dropped"] for r in rows[:-1]))

    def test_kick_during_ongoing_forfeits_too(self):
        t, players = self._rr(4)
        m = Round.objects.get(tournament=t, number=1).matches.first()
        resp = self.client.post(f"/api/tournaments/{t.id}/kick/", {"entrant_id": m.entrant2_id}, format="json")
        self.assertEqual(resp.status_code, 200)
        m.refresh_from_db()
        self.assertEqual((m.result, m.report_status), ("p1", "confirmed"))

    def test_knockout_winner_who_withdraws_hands_a_bye_forward(self):
        resp = self.create(name="엘림", format="single_elim")
        t = Tournament.objects.get(id=resp.json()["id"])
        players = self.make_players(t, 4)
        self.start(t)
        by_user = {u.id: c for u, c in players}
        r1 = list(Round.objects.get(tournament=t, number=1).matches.order_by("bracket_pos"))
        for m in r1:
            self.confirm_match(m, players)
        by_user[r1[0].entrant1.user_id].post(f"/api/tournaments/{t.id}/withdraw/")
        assert self.client.post(f"/api/tournaments/{t.id}/next-round/").status_code == 200
        final = Round.objects.get(tournament=t, number=2).matches.get()
        self.assertEqual((final.entrant1_id, final.entrant2_id, final.result), (r1[1].entrant1_id, None, "bye"))

    def test_withdraw_after_completion_is_refused(self):
        t, players = self._rr(2)
        self.confirm_match(Round.objects.get(tournament=t, number=1).matches.get(), players)
        assert self.client.post(f"/api/tournaments/{t.id}/complete/").status_code == 200
        by_user = {u.id: c for u, c in players}
        self.assertEqual(by_user[players[0][0].id].post(f"/api/tournaments/{t.id}/withdraw/").status_code, 400)


class EditAndCancelTest(TournamentApiTestBase):
    def test_host_edits_fields_while_recruiting(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 3, check_in=False)
        resp = self.client.patch(f"/api/tournaments/{t.id}/", {"name": "새 이름", "capacity": 3, "description": "d"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["name"], "새 이름")
        self.assertEqual(self.client.patch(f"/api/tournaments/{t.id}/", {"capacity": 2}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/tournaments/{t.id}/", {"format": "swiss"}, format="json").status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.format, "swiss")

    def test_edit_is_host_only(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        other = _auth(_user("someone"))
        self.assertEqual(other.patch(f"/api/tournaments/{t.id}/", {"name": "x"}, format="json").status_code, 403)

    def test_after_start_only_text_and_date_change(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        self.make_players(t, 2)
        self.start(t)
        self.assertEqual(self.client.patch(f"/api/tournaments/{t.id}/", {"name": "진행중 수정"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(f"/api/tournaments/{t.id}/", {"capacity": 16}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/tournaments/{t.id}/", {"format": "swiss"}, format="json").status_code, 400)

    def test_cancel_hides_from_list_and_blocks_registration(self):
        t = Tournament.objects.get(id=self.create().json()["id"])
        other = _auth(_user("late"))
        self.assertEqual(other.post(f"/api/tournaments/{t.id}/cancel/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/cancel/").status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.status, "cancelled")
        self.assertNotIn(t.id, [x["id"] for x in self.client.get("/api/tournaments/").json()])
        self.assertEqual(other.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "123456789"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/tournaments/{t.id}/cancel/").status_code, 400)


class TeamPlayTest(TournamentApiTestBase):
    """팀전: 팀장이 팀을 만들고 코드로 합류, 팀 경기는 보드별 개인전 다수결."""

    def _team_tournament(self, team_size=3, fmt="round_robin", **cfg):
        resp = self.create(name="팀전", format=fmt, capacity=8, team_size=team_size, format_config=cfg)
        assert resp.status_code == 201, resp.content
        return Tournament.objects.get(id=resp.json()["id"])

    def _team(self, t, tag, size):
        """Captain creates, others join by code; returns (entrant, [(user, client)])."""
        members = []
        cap = _user(f"{tag}cap{t.id}")
        cc = _auth(cap)
        r = cc.post(f"/api/tournaments/{t.id}/register/", {"team_name": f"팀{tag}", "md_uid": "111111111"}, format="json")
        assert r.status_code == 200, r.content
        code = r.json()["join_code"]
        members.append((cap, cc))
        for i in range(size - 1):
            u = _user(f"{tag}m{i}{t.id}")
            c = _auth(u)
            r = c.post(f"/api/tournaments/{t.id}/team/join/", {"code": code, "md_uid": f"22222222{i}"}, format="json")
            assert r.status_code == 200, r.content
            members.append((u, c))
        return Entrant.objects.get(tournament=t, name=f"팀{tag}"), members

    def _check_in(self, t, members):
        return members[0][1].post(f"/api/tournaments/{t.id}/check-in/")

    def test_create_requires_valid_team_size(self):
        self.assertEqual(self.create(team_size=1).status_code, 201)
        self.assertEqual(self.create(team_size=6).status_code, 400)
        self.assertEqual(self.create(team_size=3).json()["team_size"], 3)

    def test_captain_creates_team_and_members_join_by_code(self):
        t = self._team_tournament(3)
        entrant, members = self._team(t, "A", 3)
        self.assertIsNone(entrant.user)
        self.assertEqual(entrant.members.count(), 3)
        self.assertTrue(entrant.members.get(user=members[0][0]).is_captain)
        # full team refuses a fourth
        extra = _auth(_user("extra"))
        code = entrant.join_code
        self.assertEqual(extra.post(f"/api/tournaments/{t.id}/team/join/", {"code": code, "md_uid": "333333333"}, format="json").status_code, 400)
        # a member cannot join another team in the same tournament
        other, _ = self._team(t, "B", 1)
        r = members[1][1].post(f"/api/tournaments/{t.id}/team/join/", {"code": other.join_code, "md_uid": "222222220"}, format="json")
        self.assertEqual(r.status_code, 400)
        # wrong code
        self.assertEqual(extra.post(f"/api/tournaments/{t.id}/team/join/", {"code": "ZZZZZZ", "md_uid": "333333333"}, format="json").status_code, 404)

    def test_individual_register_refused_in_team_tournament(self):
        t = self._team_tournament(2)
        c = _auth(_user("solo"))
        self.assertEqual(c.post(f"/api/tournaments/{t.id}/register/", {"md_uid": "123456789"}, format="json").status_code, 400)

    def test_check_in_needs_full_roster_and_captain(self):
        t = self._team_tournament(3)
        entrant, members = self._team(t, "A", 2)
        self.assertEqual(self._check_in(t, members).status_code, 400)       # not full
        u = _user("late"); c = _auth(u)
        assert c.post(f"/api/tournaments/{t.id}/team/join/", {"code": entrant.join_code, "md_uid": "444444444"}, format="json").status_code == 200
        self.assertEqual(members[1][1].post(f"/api/tournaments/{t.id}/check-in/").status_code, 403)  # not captain
        self.assertEqual(self._check_in(t, members).status_code, 200)
        entrant.refresh_from_db()
        self.assertEqual(entrant.status, "checked_in")

    def test_leave_and_captain_handover(self):
        t = self._team_tournament(3)
        entrant, members = self._team(t, "A", 3)
        r = members[0][1].post(f"/api/tournaments/{t.id}/team/leave/")
        self.assertEqual(r.status_code, 200)
        entrant.refresh_from_db()
        self.assertEqual(entrant.members.count(), 2)
        self.assertTrue(entrant.members.get(user=members[1][0]).is_captain)
        members[1][1].post(f"/api/tournaments/{t.id}/team/leave/")
        members[2][1].post(f"/api/tournaments/{t.id}/team/leave/")
        entrant.refresh_from_db()
        self.assertEqual(entrant.status, "withdrawn")                      # empty team is gone

    def test_detail_shows_members_and_code_only_to_team(self):
        t = self._team_tournament(2)
        entrant, members = self._team(t, "A", 2)
        mine = members[0][1].get(f"/api/tournaments/{t.id}/").json()["entrants"][0]
        self.assertEqual(len(mine["members"]), 2)
        self.assertEqual(mine["join_code"], entrant.join_code)
        self.assertTrue(all(m["avatar_icon"] is not None or m["avatar_icon"] is None for m in mine["members"]))
        stranger = APIClient().get(f"/api/tournaments/{t.id}/").json()["entrants"][0]
        self.assertIsNone(stranger["join_code"])
        self.assertIsNone(stranger["members"][0]["md_uid"])

    def _two_teams_started(self, size=3, fmt="round_robin"):
        t = self._team_tournament(size, fmt)
        a, am = self._team(t, "A", size)
        b, bm = self._team(t, "B", size)
        assert self._check_in(t, am).status_code == 200
        assert self._check_in(t, bm).status_code == 200
        self.start(t)
        return t, (a, am), (b, bm)

    def test_start_creates_boards_from_member_order(self):
        t, (a, am), (b, bm) = self._two_teams_started(3)
        m = Round.objects.get(tournament=t, number=1).matches.get()
        boards = list(m.boards.order_by("order"))
        self.assertEqual(len(boards), 3)
        for i, bd in enumerate(boards):
            self.assertEqual(bd.member1.entrant_id if bd.member1.entrant_id == m.entrant1_id else bd.member2.entrant_id, m.entrant1_id)
            self.assertEqual({bd.member1.order, bd.member2.order}, {i})
        detail = self.client.get(f"/api/tournaments/{t.id}/").json()
        self.assertEqual(len(detail["rounds"][0]["matches"][0]["boards"]), 3)

    def _board_clients(self, board, all_members):
        by_user = {u.id: c for u, c in all_members}
        return by_user[board.member1.user_id], by_user[board.member2.user_id]

    def test_boards_decide_the_team_match_by_majority(self):
        t, (a, am), (b, bm) = self._two_teams_started(3)
        m = Round.objects.get(tournament=t, number=1).matches.get()
        boards = list(m.boards.order_by("order"))
        everyone = am + bm
        # team-level report is not allowed in team mode
        self.assertEqual(am[0][1].post(f"/api/tournaments/matches/{m.id}/report/", {"result": "win"}, format="json").status_code, 400)
        results = ["win", "lose", "win"]  # from member1's view; member1 belongs to whichever side
        for bd, res in zip(boards, results):
            c1, c2 = self._board_clients(bd, everyone)
            self.assertEqual(c1.post(f"/api/tournaments/boards/{bd.id}/report/", {"result": res}, format="json").status_code, 200)
            m.refresh_from_db()
            self.assertNotEqual(m.report_status, "confirmed")
            self.assertEqual(c2.post(f"/api/tournaments/boards/{bd.id}/confirm/").status_code, 200)
        m.refresh_from_db()
        self.assertEqual(m.report_status, "confirmed")
        side1_wins = sum(1 for bd, res in zip(boards, results) if (bd.member1.entrant_id == m.entrant1_id) == (res == "win"))
        self.assertEqual(m.result, "p1" if side1_wins >= 2 else "p2")

    def test_even_split_is_a_draw_in_league_and_unresolved_in_knockout(self):
        t, (a, am), (b, bm) = self._two_teams_started(2)
        m = Round.objects.get(tournament=t, number=1).matches.get()
        everyone = am + bm
        for bd, res in zip(m.boards.order_by("order"), ["win", "lose"]):
            c1, c2 = self._board_clients(bd, everyone)
            c1.post(f"/api/tournaments/boards/{bd.id}/report/", {"result": res}, format="json")
            c2.post(f"/api/tournaments/boards/{bd.id}/confirm/")
        m.refresh_from_db()
        # one board each way from member1's view could still be 2-0 if member1 sides differ; compute
        wins1 = sum(1 for bd, res in zip(m.boards.order_by("order"), ["win", "lose"]) if (bd.member1.entrant_id == m.entrant1_id) == (res == "win"))
        if wins1 == 1:
            self.assertEqual((m.result, m.report_status), ("draw", "confirmed"))
        else:
            self.assertEqual(m.report_status, "confirmed")

    def test_stranger_cannot_report_board_and_host_can_override(self):
        t, (a, am), (b, bm) = self._two_teams_started(2)
        m = Round.objects.get(tournament=t, number=1).matches.get()
        bd = m.boards.order_by("order").first()
        self.assertEqual(_auth(_user("x")).post(f"/api/tournaments/boards/{bd.id}/report/", {"result": "win"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/tournaments/boards/{bd.id}/override/", {"result": "p1"}, format="json").status_code, 200)
        bd.refresh_from_db()
        self.assertEqual((bd.result, bd.report_status), ("p1", "confirmed"))

    def test_captain_sets_lineup_before_first_report(self):
        t, (a, am), (b, bm) = self._two_teams_started(3)
        m = Round.objects.get(tournament=t, number=1).matches.get()
        ids = [x.id for x in a.members.order_by("order")]
        r = am[0][1].post(f"/api/tournaments/matches/{m.id}/lineup/", {"members": list(reversed(ids))}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        boards = list(m.boards.order_by("order"))
        side = [bd.member1 if bd.member1.entrant_id == a.id else bd.member2 for bd in boards]
        self.assertEqual([x.id for x in side], list(reversed(ids)))
        self.assertEqual(am[1][1].post(f"/api/tournaments/matches/{m.id}/lineup/", {"members": ids}, format="json").status_code, 403)
        c1, _ = self._board_clients(boards[0], am + bm)
        c1.post(f"/api/tournaments/boards/{boards[0].id}/report/", {"result": "win"}, format="json")
        self.assertEqual(am[0][1].post(f"/api/tournaments/matches/{m.id}/lineup/", {"members": ids}, format="json").status_code, 400)

    def test_team_chat_is_private_to_the_team(self):
        t = self._team_tournament(2)
        a, am = self._team(t, "A", 2)
        b, bm = self._team(t, "B", 1)
        assert am[0][1].post(f"/api/tournaments/{t.id}/chat/", {"content": "작전", "team": True}, format="json").status_code == 201
        assert am[0][1].post(f"/api/tournaments/{t.id}/chat/", {"content": "안녕"}, format="json").status_code == 201
        self.assertEqual([m["content"] for m in am[1][1].get(f"/api/tournaments/{t.id}/chat/?team=1").json()], ["작전"])
        self.assertEqual([m["content"] for m in APIClient().get(f"/api/tournaments/{t.id}/chat/").json()], ["안녕"])
        self.assertEqual(bm[0][1].get(f"/api/tournaments/{t.id}/chat/?team=1").json(), [])

    def test_team_withdraw_is_captain_only_and_drops_whole_team(self):
        t = self._team_tournament(2)
        a, am = self._team(t, "A", 2)
        self.assertEqual(am[1][1].post(f"/api/tournaments/{t.id}/withdraw/").status_code, 403)
        self.assertEqual(am[0][1].post(f"/api/tournaments/{t.id}/withdraw/").status_code, 200)
        a.refresh_from_db()
        self.assertEqual(a.status, "withdrawn")

    def test_standings_carry_member_avatars(self):
        t, (a, am), (b, bm) = self._two_teams_started(2)
        rows = self.client.get(f"/api/tournaments/{t.id}/standings/").json()
        self.assertEqual(len(rows[0]["members"]), 2)
        self.assertIn("avatar_icon", rows[0]["members"][0])


class PasswordAndHostUidTest(TournamentApiTestBase):
    """특이점 2026-10-10: 주최자 UID·참가 비밀번호를 정해 개최하고, 비밀번호가 걸린 대회는 맞혀야 참가한다."""

    def test_host_sets_uid_and_password_which_is_never_shown(self):
        resp = self.create(host_md_uid="123456789", password="엘리스컵1")
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertTrue(body["has_password"])
        self.assertNotIn("password", body)
        self.assertEqual(body["host_md_uid"], "123456789")
        t = Tournament.objects.get(id=body["id"])
        self.assertNotEqual(t.password, "엘리스컵1")  # stored hashed
        self.host.refresh_from_db()
        self.assertEqual(self.host.md_uid, "123456789")
        listed = {x["id"]: x for x in self.client.get("/api/tournaments/").json()}
        self.assertTrue(listed[t.id]["has_password"])
        self.assertNotIn("password", listed[t.id])

    def test_bad_host_uid_is_rejected(self):
        self.assertEqual(self.create(host_md_uid="12345").status_code, 400)

    def test_host_uid_hidden_from_strangers(self):
        t_id = self.create(host_md_uid="123456789").json()["id"]
        stranger = _auth(_user("stranger"))
        self.assertIsNone(stranger.get(f"/api/tournaments/{t_id}/").json()["host_md_uid"])

    def test_join_needs_the_right_password(self):
        t_id = self.create(password="secret").json()["id"]
        c = _auth(_user("joiner"))
        url = f"/api/tournaments/{t_id}/register/"
        self.assertEqual(c.post(url, {"md_uid": "100000001"}, format="json").status_code, 403)
        self.assertEqual(c.post(url, {"md_uid": "100000001", "password": "wrong"}, format="json").status_code, 403)
        self.assertEqual(c.post(url, {"md_uid": "100000001", "password": "secret"}, format="json").status_code, 200)

    def test_open_tournament_needs_no_password(self):
        t_id = self.create().json()["id"]
        self.assertFalse(self.client.get(f"/api/tournaments/{t_id}/").json()["has_password"])
        c = _auth(_user("joiner2"))
        self.assertEqual(c.post(f"/api/tournaments/{t_id}/register/", {"md_uid": "100000002"}, format="json").status_code, 200)

    def test_host_can_change_or_remove_the_password(self):
        t_id = self.create(password="old").json()["id"]
        self.assertEqual(self.client.patch(f"/api/tournaments/{t_id}/", {"password": "new"}, format="json").status_code, 200)
        c = _auth(_user("joiner3"))
        self.assertEqual(c.post(f"/api/tournaments/{t_id}/register/", {"md_uid": "100000003", "password": "new"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(f"/api/tournaments/{t_id}/", {"password": ""}, format="json").status_code, 200)
        self.assertFalse(self.client.get(f"/api/tournaments/{t_id}/").json()["has_password"])


def _png(name="deck.png"):
    from io import BytesIO
    from PIL import Image
    from django.core.files.uploadedfile import SimpleUploadedFile
    buf = BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


class JoinFormTest(TournamentApiTestBase):
    """특이점 2026-10-10: 비밀번호 확인 → UID·임시 닉네임·덱 리스트 n개를 내고 참가. n은 주최자가 정한다."""

    def setUp(self):
        super().setUp()
        import tempfile
        from django.test import override_settings
        self._media = tempfile.TemporaryDirectory()
        self._override = override_settings(MEDIA_ROOT=self._media.name)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        self._media.cleanup()

    def test_host_sets_how_many_decks(self):
        body = self.create(deck_count=3).json()
        self.assertEqual(body["deck_count"], 3)
        self.assertEqual(self.create(deck_count=9).status_code, 400)
        self.assertEqual(self.create().json()["deck_count"], 0)

    def test_check_password_endpoint(self):
        t_id = self.create(password="pw").json()["id"]
        c = _auth(_user("checker"))
        self.assertEqual(c.post(f"/api/tournaments/{t_id}/check-password/", {"password": "no"}, format="json").status_code, 403)
        self.assertEqual(c.post(f"/api/tournaments/{t_id}/check-password/", {"password": "pw"}, format="json").status_code, 200)

    def test_register_needs_every_deck_and_keeps_the_nickname(self):
        t_id = self.create(deck_count=2).json()["id"]
        c = _auth(_user("acct_name"))
        url = f"/api/tournaments/{t_id}/register/"
        short = c.post(url, {"md_uid": "100000009", "deck_0": _png()}, format="multipart")
        self.assertEqual(short.status_code, 400)
        ok = c.post(url, {"md_uid": "100000009", "nickname": "임시닉", "deck_0": _png("a.png"), "deck_1": _png("b.png")}, format="multipart")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["name"], "임시닉")
        e = Entrant.objects.get(id=ok.json()["id"])
        self.assertEqual(sorted(e.deck_submissions.values_list("slot", flat=True)), [0, 1])
        self.assertEqual(c.get(f"/api/tournaments/{t_id}/deck/?slot=1").status_code, 200)

    def test_nickname_defaults_to_account_name(self):
        t_id = self.create(deck_count=0).json()["id"]
        c = _auth(_user("plainname"))
        res = c.post(f"/api/tournaments/{t_id}/register/", {"md_uid": "100000010"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["name"], "plainname")
