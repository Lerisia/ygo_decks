from django.test import TestCase
from rest_framework.test import APIClient

from deck.models import Deck
from user.models import User


def _create_deck(name="테스트 덱", **kwargs):
    defaults = {"strength": 0, "difficulty": 0, "deck_type": 0, "art_style": 0}
    defaults.update(kwargs)
    return Deck.objects.create(name=name, **defaults)


class TrackerInferTest(TestCase):
    """POST /api/tracker/infer/ — card ids → deck candidates for the PC tracker."""

    def setUp(self):
        from card.models import Card
        from deck.models import DeckArchetype
        self.client = APIClient()
        self.user = User.objects.create_user(email="t@test.com", username="tracker", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.blue = _create_deck("푸른 눈")
        self.reso = _create_deck("레조네이터")
        self.dragon_link = _create_deck("드래곤 링크")
        DeckArchetype.objects.create(deck=self.blue, name="Blue-Eyes")
        DeckArchetype.objects.create(deck=self.reso, name="Resonator")
        DeckArchetype.objects.create(deck=self.reso, name="Red Dragon Archfiend")
        DeckArchetype.objects.create(deck=self.dragon_link, name="Blue-Eyes", weight=0.3)
        for kid, name, arch in [("4007", "Blue-Eyes White Dragon", "Blue-Eyes"), ("12292", "Sage with Eyes of Blue", "Blue-Eyes"),
                                ("9015", "Red Lotus King", "Red Dragon Archfiend"), ("19014", "Soul Resonator", "Resonator"),
                                ("9279", "Droll & Lock Bird", None)]:
            Card.objects.create(card_id=f"c{kid}", konami_id=kid, name=name, archetype=arch)

    def test_infer_votes_by_card_copies_and_weight(self):
        res = self.client.post("/api/tracker/infer/",
                               {"my_cards": [4007, 4007, 4007, 12292, 9279], "opp_cards": [9015, 19014]}, format="json")
        self.assertEqual(res.status_code, 200)
        my = res.data["my"]["candidates"]
        self.assertEqual(my[0]["name"], "푸른 눈")
        self.assertEqual(my[0]["score"], 4.0)
        self.assertEqual(my[1]["name"], "드래곤 링크")
        self.assertAlmostEqual(my[1]["score"], 1.2)
        self.assertAlmostEqual(my[0]["share"], 1.0)
        self.assertEqual(res.data["opp"]["candidates"][0]["name"], "레조네이터")
        self.assertEqual(res.data["opp"]["candidates"][0]["score"], 2.0)
        self.assertEqual(res.data["my"]["cards"][0], {"id": 4007, "name": "Blue-Eyes White Dragon", "count": 3})
        self.assertEqual([c["id"] for c in res.data["opp"]["cards"]], [9015, 19014])

    def test_unknown_ids_and_empty(self):
        res = self.client.post("/api/tracker/infer/", {"my_cards": [999999], "opp_cards": []}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["my"]["candidates"], [])
        self.assertEqual(res.data["my"]["unknown_ids"], [999999])
        self.assertEqual(res.data["opp"]["candidates"], [])

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        res = self.client.post("/api/tracker/infer/", {"my_cards": [4007]}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_rank_code(self):
        from .inference import rank_code
        self.assertEqual(rank_code(1, 2), "rookie2")
        self.assertEqual(rank_code(4, 3), "gold3")
        self.assertEqual(rank_code(7, 1), "master1")
        self.assertIsNone(rank_code(9, 1))
        self.assertIsNone(rank_code(2, 0))


class TrackerSnapshotTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_disabled_without_key(self):
        from django.test import override_settings
        with override_settings(TRACKER_SNAPSHOT_KEY=""):
            res = self.client.post("/api/tracker/snapshot/", {"tag": "x"}, format="json", HTTP_X_TRACKER_KEY="")
        self.assertEqual(res.status_code, 403)

    def test_stores_json_with_key(self):
        import os, tempfile, glob
        from django.test import override_settings
        with tempfile.TemporaryDirectory() as tmp, override_settings(TRACKER_SNAPSHOT_KEY="secret", BASE_DIR=tmp):
            res = self.client.post("/api/tracker/snapshot/", {"tag": "duel_result", "sender": "friend", "data": {"a": 1}},
                                   format="json", HTTP_X_TRACKER_KEY="secret")
            self.assertEqual(res.status_code, 201)
            files = glob.glob(os.path.join(tmp, "data", "tracker_snapshots", "*_friend_duel_result_*.json"))
            self.assertEqual(len(files), 1)
            res = self.client.post("/api/tracker/snapshot/", {"tag": "x"}, format="json", HTTP_X_TRACKER_KEY="wrong")
            self.assertEqual(res.status_code, 403)


class TrackerAliasTest(TestCase):
    def test_alt_art_ids_count_as_base_card(self):
        from card.models import Card, CardIdAlias
        from deck.models import DeckArchetype
        from .inference import infer_decks, card_names
        blue = _create_deck("푸른 눈")
        DeckArchetype.objects.create(deck=blue, name="Blue-Eyes")
        bewd = Card.objects.create(card_id="c4007", konami_id="4007", name="Blue-Eyes White Dragon", korean_name="푸른 눈의 백룡", archetype="Blue-Eyes")
        CardIdAlias.objects.create(md_id=3892, card=bewd, note="alt art")
        cands, unknown = infer_decks([3892, 3892, 3891])
        self.assertEqual(cands[0]["name"], "푸른 눈")
        self.assertEqual(cands[0]["score"], 2.0)
        self.assertEqual(unknown, [3891])
        self.assertEqual(card_names([3892, 4007]), [{"id": 4007, "name": "푸른 눈의 백룡", "count": 2}])


class TrackerPendingTest(TestCase):
    """Tracker uploads a captured game → it waits on the record page → saving a record consumes it."""

    def setUp(self):
        from card.models import Card
        from deck.models import DeckArchetype
        from tool.models import RecordGroup
        self.client = APIClient()
        self.user = User.objects.create_user(email="p@test.com", username="pending", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.blue = _create_deck("푸른 눈")
        self.reso = _create_deck("레드 데몬")
        DeckArchetype.objects.create(deck=self.blue, name="Blue-Eyes")
        DeckArchetype.objects.create(deck=self.reso, name="Resonator")
        Card.objects.create(card_id="c4007", konami_id="4007", name="Blue-Eyes White Dragon", korean_name="푸른 눈의 백룡", archetype="Blue-Eyes")
        Card.objects.create(card_id="c19014", konami_id="19014", name="Soul Resonator", korean_name="소울 레조네이터", archetype="Resonator")
        self.group = RecordGroup.objects.create(user=self.user, name="테스트")
        self.capture = {
            "did": "7709189150693852086", "game_mode": 3, "result": "win", "finish": "Surrender", "coin_win": True, "first": True,
            "my_id": 0, "my_name": "Elyss", "opp_name": "gg_", "rank_before": {"rank": 2, "tier": 4}, "rank_after": {"rank": 2, "tier": 3},
            "rank_code": "bronze3", "wins": 0, "turn": 0, "md_deck_id": "28860507",
            "my_cards": [4007, 4007, 4007], "opp_cards": [19014], "started_at": "2026-09-13T23:00:00", "ended_at": "2026-09-13T23:05:00",
        }

    def test_upload_infers_and_lists(self):
        res = self.client.post("/api/tracker/pending/", self.capture, format="json")
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body["suggested_deck"]["name"], "푸른 눈")
        self.assertEqual(body["suggested_deck"]["source"], "inferred")
        self.assertEqual(body["suggested_opp_deck"]["name"], "레드 데몬")
        self.assertEqual(body["opp_card_names"][0]["name"], "소울 레조네이터")
        self.assertEqual(body["rank_code"], "bronze3")
        lst = self.client.get("/api/tracker/pending/").json()
        self.assertEqual([p["did"] for p in lst], [self.capture["did"]])
        # same did again → update, not duplicate
        res2 = self.client.post("/api/tracker/pending/", {**self.capture, "turn": 3}, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["id"], body["id"])
        self.assertEqual(len(self.client.get("/api/tracker/pending/").json()), 1)
        self.assertEqual(self.client.get("/api/tracker/pending/").json()[0]["turn"], 3)

    def test_other_user_cannot_see(self):
        self.client.post("/api/tracker/pending/", self.capture, format="json")
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get("/api/tracker/pending/").json(), [])

    def test_discard(self):
        pid = self.client.post("/api/tracker/pending/", self.capture, format="json").json()["id"]
        res = self.client.post(f"/api/tracker/pending/{pid}/discard/")
        self.assertEqual(res.json()["status"], "discarded")
        self.assertEqual(self.client.get("/api/tracker/pending/").json(), [])

    def test_confirm_via_add_match_consumes_and_remembers_deck(self):
        from tracker.models import TrackerDeckMap, TrackerPendingMatch
        pid = self.client.post("/api/tracker/pending/", self.capture, format="json").json()["id"]
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.blue.id, "opponent_deck": self.reso.id, "first_or_second": "first", "result": "win",
            "coin_toss_result": "win", "rank": "bronze3", "wins": 0, "tracker_pending_id": pid,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        obj = TrackerPendingMatch.objects.get(id=pid)
        self.assertEqual(obj.status, "confirmed")
        self.assertEqual(obj.match_id, res.json()["match_id"])
        self.assertEqual(TrackerDeckMap.objects.get(user=self.user, md_deck_id="28860507").deck, self.blue)
        self.assertEqual(self.client.get("/api/tracker/pending/").json(), [])
        # next capture with the same MD deck → remembered mapping wins over inference
        nxt = self.client.post("/api/tracker/pending/", {**self.capture, "did": "7709189150693852099", "my_cards": []}, format="json").json()
        self.assertEqual(nxt["suggested_deck"], {"deck_id": self.blue.id, "name": "푸른 눈", "source": "remembered"})

    def test_requires_did_and_auth(self):
        self.assertEqual(self.client.post("/api/tracker/pending/", {"result": "win"}, format="json").status_code, 400)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get("/api/tracker/pending/").status_code, 401)


class TrackerGameArchiveTest(TestCase):
    """Every captured duel is archived with its card lists; saving a record links it."""

    def setUp(self):
        from card.models import Card, CardIdAlias
        from tool.models import RecordGroup
        self.client = APIClient()
        self.user = User.objects.create_user(email="g@test.com", username="games", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = _create_deck("푸른 눈")
        self.group = RecordGroup.objects.create(user=self.user, name="테스트")
        bewd = Card.objects.create(card_id="c4007", konami_id="4007", name="Blue-Eyes White Dragon")
        CardIdAlias.objects.create(md_id=3801, card=bewd)
        self.capture = {
            "did": "7709189150693852086", "game_mode": 3, "result": "win", "finish": "Surrender", "coin_win": True, "first": True,
            "my_name": "Elyss", "opp_name": "gg_", "rank_before": {"rank": 2, "tier": 4}, "rank_after": {"rank": 2, "tier": 3},
            "rank_code": "bronze3", "wins": 0, "turn": 2, "md_deck_id": "28860507",
            "my_cards": [4007, 3801, 8933], "opp_cards": [{"id": 9455, "pos": 4097, "face": True}, 19014],
            "started_at": "2026-09-13T23:00:00", "ended_at": "2026-09-13T23:05:00",
        }

    def test_archive_normalizes_alt_arts_and_is_idempotent(self):
        from tracker.models import TrackerGame
        res = self.client.post("/api/tracker/games/", self.capture, format="json")
        self.assertEqual(res.status_code, 201)
        g = TrackerGame.objects.get(user=self.user, did=self.capture["did"])
        self.assertEqual(g.my_cards, [4007, 4007, 8933])          # 3801 (alt art) → 4007
        self.assertEqual(g.opp_cards, [{"id": 9455, "pos": 4097, "face": True}, {"id": 19014}])
        from django.utils import timezone
        self.assertEqual(timezone.localtime(g.ended_at).strftime("%Y-%m-%dT%H:%M"), "2026-09-13T23:05")
        res2 = self.client.post("/api/tracker/games/", {**self.capture, "turn": 5}, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(TrackerGame.objects.filter(user=self.user).count(), 1)
        self.assertEqual(TrackerGame.objects.get(id=g.id).turn, 5)

    def test_add_match_links_the_capture(self):
        from tracker.models import TrackerGame
        self.client.post("/api/tracker/games/", self.capture, format="json")
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.deck.id, "opponent_deck": None, "first_or_second": "first", "result": "win",
            "coin_toss_result": "win", "rank": "bronze3", "wins": 0, "tracker_did": self.capture["did"],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(TrackerGame.objects.get(user=self.user, did=self.capture["did"]).match_id, res.json()["match_id"])

    def test_requires_did(self):
        self.assertEqual(self.client.post("/api/tracker/games/", {"result": "win"}, format="json").status_code, 400)


class TrackerWinBonusTest(TestCase):
    """5P per tracker-recorded win, paid once, only when the capture itself was a win."""

    def setUp(self):
        from tool.models import RecordGroup
        self.client = APIClient()
        self.user = User.objects.create_user(email="w@test.com", username="winner", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = _create_deck("푸른 눈")
        self.group = RecordGroup.objects.create(user=self.user, name="테스트")
        self.base = {"did": "7709189150693852086", "game_mode": 3, "result": "win", "my_cards": [4007], "opp_cards": [],
                     "ended_at": "2026-09-13T23:05:00"}
        self.record = {"deck": self.deck.id, "opponent_deck": None, "first_or_second": "first", "result": "win",
                       "coin_toss_result": "win", "rank": "bronze3", "wins": 0, "tracker_did": self.base["did"]}

    def _points(self):
        return User.objects.get(id=self.user.id).points

    def test_win_awards_five_points_once(self):
        from user.models import PointTransaction
        self.client.post("/api/tracker/games/", self.base, format="json")
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", self.record, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["points_added"], 5)
        self.assertEqual(self._points(), 5)
        self.assertEqual(PointTransaction.objects.filter(user=self.user, kind="tracker_win").count(), 1)
        # saving another record against the same capture pays nothing more
        res2 = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", self.record, format="json")
        self.assertEqual(res2.json()["points_added"], 0)
        self.assertEqual(self._points(), 5)

    def test_forged_win_pays_nothing_but_honest_loss_pays_one(self):
        self.client.post("/api/tracker/games/", {**self.base, "result": "lose"}, format="json")
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", self.record, format="json")  # user says win, capture says lose
        self.assertEqual(res.json()["points_added"], 0)
        self.assertEqual(self._points(), 0)
        self.client.post("/api/tracker/games/", {**self.base, "did": "7709189150693852087", "result": "lose"}, format="json")
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {**self.record, "result": "lose", "tracker_did": "7709189150693852087"}, format="json")
        self.assertEqual(res.json()["points_added"], 1)
        self.assertEqual(self._points(), 1)
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {**self.record, "result": "lose", "tracker_did": "1"}, format="json")  # no capture
        self.assertEqual(res.json()["points_added"], 0)

    def test_pending_confirm_path_also_pays(self):
        self.client.post("/api/tracker/games/", self.base, format="json")
        pid = self.client.post("/api/tracker/pending/", {**self.base, "coin_win": True, "first": True}, format="json").json()["id"]
        res = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {**self.record, "tracker_did": None, "tracker_pending_id": pid}, format="json")
        self.assertEqual(res.json()["points_added"], 5)
        self.assertEqual(self._points(), 5)


class TrackerVersionTest(TestCase):
    """Old builds can't warn themselves, so the site does it from the reported version."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="v@test.com", username="veruser", password="pass1234")
        self.client.force_authenticate(user=self.user)

    def test_version_endpoint_is_public(self):
        self.client.force_authenticate(user=None)
        res = self.client.get("/api/tracker/version/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("latest", res.json())
        self.assertTrue(res.json()["url"].endswith("mdtracker.exe"))

    def test_status_before_any_tracker_use(self):
        body = self.client.get("/api/tracker/client-status/").json()
        self.assertFalse(body["used_tracker"])
        self.assertFalse(body["outdated"])

    def test_header_version_is_remembered_and_compared(self):
        from tracker import version as ver
        self.client.post("/api/tracker/infer/", {"my_cards": [], "opp_cards": []}, format="json",
                         HTTP_X_TRACKER_VERSION="0.0.1")
        body = self.client.get("/api/tracker/client-status/").json()
        self.assertEqual(body["version"], "0.0.1")
        self.assertTrue(body["outdated"])
        self.client.post("/api/tracker/infer/", {"my_cards": [], "opp_cards": []}, format="json",
                         HTTP_X_TRACKER_VERSION=ver.LATEST)
        body = self.client.get("/api/tracker/client-status/").json()
        self.assertEqual(body["version"], ver.LATEST)
        self.assertFalse(body["outdated"])

    def test_site_calls_without_the_header_do_not_clear_a_known_version(self):
        from tracker import version as ver
        self.client.post("/api/tracker/infer/", {"my_cards": [], "opp_cards": []}, format="json",
                         HTTP_X_TRACKER_VERSION=ver.LATEST)
        self.client.get("/api/tracker/pending/")          # the website polls this every 15s
        body = self.client.get("/api/tracker/client-status/").json()
        self.assertEqual(body["version"], ver.LATEST)
        self.assertFalse(body["outdated"])

    def test_build_without_version_header_counts_as_outdated(self):
        self.client.post("/api/tracker/games/", {"did": "1", "game_mode": 3, "result": "win"}, format="json")
        body = self.client.get("/api/tracker/client-status/").json()
        self.assertIsNone(body["version"])
        self.assertTrue(body["used_tracker"])
        self.assertTrue(body["outdated"])


class TrackerStatsTest(TestCase):
    """Matchup record and today's summary shown in the tracker."""

    def setUp(self):
        from tool.models import RecordGroup
        self.client = APIClient()
        self.user = User.objects.create_user(email="s@test.com", username="stats", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.mine = _create_deck("사이버 드래곤")
        self.opp = _create_deck("낙인")
        self.other = _create_deck("열차")
        self.group = RecordGroup.objects.create(user=self.user, name="시트")

    def _match(self, opponent, result, first="first"):
        from tool.models import MatchRecord
        return MatchRecord.objects.create(record_group=self.group, recorded_by=self.user, deck=self.mine,
                                          opponent_deck=opponent, result=result, first_or_second=first,
                                          coin_toss_result="win")

    def test_matchup_splits_by_going_first(self):
        self._match(self.opp, "win", "first")
        self._match(self.opp, "lose", "first")
        self._match(self.opp, "lose", "second")
        self._match(self.other, "win", "first")
        body = self.client.get(f"/api/tracker/matchup/?deck={self.mine.id}&opponent={self.opp.id}").json()
        self.assertEqual(body["deck"], "사이버 드래곤")
        self.assertEqual(body["opponent"], "낙인")
        self.assertEqual(body["matchup"], {"games": 3, "wins": 1, "win_rate": 33.3})
        self.assertEqual(body["first"], {"games": 2, "wins": 1, "win_rate": 50.0})
        self.assertEqual(body["second"], {"games": 1, "wins": 0, "win_rate": 0.0})
        self.assertEqual(body["total"]["games"], 4)

    def test_matchup_without_opponent_returns_deck_total_only(self):
        self._match(self.opp, "win")
        body = self.client.get(f"/api/tracker/matchup/?deck={self.mine.id}").json()
        self.assertEqual(body["total"], {"games": 1, "wins": 1, "win_rate": 100.0})
        self.assertNotIn("matchup", body)

    def test_matchup_requires_a_deck(self):
        self.assertEqual(self.client.get("/api/tracker/matchup/").status_code, 400)

    def test_today_summarizes_tracker_games(self):
        from django.utils import timezone
        from tracker.models import TrackerGame
        now = timezone.now()
        TrackerGame.objects.create(user=self.user, did="1", game_mode=3, result="win", coin_win=True, first=True,
                                   turn=3, rank_code="master5", ended_at=now)
        TrackerGame.objects.create(user=self.user, did="2", game_mode=3, result="lose", coin_win=False, first=False,
                                   turn=1, rank_code="master4", ended_at=now)
        TrackerGame.objects.create(user=self.user, did="3", game_mode=3, result="win", coin_win=True, first=False,
                                   turn=2, rank_code="master4", ended_at=now - timezone.timedelta(days=1))
        body = self.client.get("/api/tracker/today/").json()
        self.assertEqual((body["games"], body["wins"], body["win_rate"]), (2, 1, 50.0))
        self.assertEqual(body["coin_win_rate"], 50.0)
        self.assertEqual(body["first"], {"games": 1, "wins": 1, "win_rate": 100.0})
        self.assertEqual(body["second"], {"games": 1, "wins": 0, "win_rate": 0.0})
        self.assertEqual(body["avg_turns"], 2.0)
        self.assertEqual(body["rank"], {"from": "master5", "to": "master4"})

    def test_today_empty(self):
        body = self.client.get("/api/tracker/today/").json()
        self.assertEqual(body["games"], 0)
        self.assertIsNone(body["win_rate"])
