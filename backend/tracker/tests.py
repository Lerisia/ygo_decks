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
