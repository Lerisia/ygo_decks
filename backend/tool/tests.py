from django.test import TestCase
from rest_framework.test import APIClient
from deck.models import Deck
from user.models import User
from .models import RecordGroup, MatchRecord


def _create_deck(name="테스트 덱", **kwargs):
    defaults = {"strength": 0, "difficulty": 0, "deck_type": 0, "art_style": 0}
    defaults.update(kwargs)
    return Deck.objects.create(name=name, **defaults)


def _create_match(group, deck, opponent_deck=None, **kwargs):
    defaults = {
        "record_group": group,
        "deck": deck,
        "opponent_deck": opponent_deck,
        "first_or_second": "first",
        "result": "win",
        "coin_toss_result": "win",
    }
    defaults.update(kwargs)
    return MatchRecord.objects.create(**defaults)


class RecordGroupCRUDTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)

    def test_create_record_group(self):
        resp = self.client.post("/api/record-groups/create/", {"name": "시즌1"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["name"], "시즌1")

    def test_create_without_name_returns_400(self):
        resp = self.client.post("/api/record-groups/create/", {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_list_record_groups(self):
        RecordGroup.objects.create(user=self.user, name="그룹A")
        RecordGroup.objects.create(user=self.user, name="그룹B")
        resp = self.client.get("/api/record-groups/")
        self.assertEqual(len(resp.json()), 2)

    def test_deleted_groups_hidden(self):
        RecordGroup.objects.create(user=self.user, name="삭제됨", is_deleted=True)
        RecordGroup.objects.create(user=self.user, name="살아있음")
        resp = self.client.get("/api/record-groups/")
        self.assertEqual(len(resp.json()), 1)

    def test_update_group_name(self):
        group = RecordGroup.objects.create(user=self.user, name="이전이름")
        resp = self.client.patch(f"/api/record-groups/{group.id}/update-name/", {"name": "새이름"}, format="json")
        self.assertEqual(resp.status_code, 200)
        group.refresh_from_db()
        self.assertEqual(group.name, "새이름")

    def test_soft_delete_group(self):
        group = RecordGroup.objects.create(user=self.user, name="삭제대상")
        _create_match(group, _create_deck())
        resp = self.client.delete(f"/api/record-groups/{group.id}/delete/")
        self.assertEqual(resp.status_code, 204)
        group.refresh_from_db()
        self.assertTrue(group.is_deleted)
        self.assertTrue(group.matches.first().is_deleted)

    def test_unauthenticated_returns_401(self):
        client = APIClient()
        resp = client.post("/api/record-groups/create/", {"name": "test"}, format="json")
        self.assertEqual(resp.status_code, 401)


class MatchRecordCRUDTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = _create_deck(name="내덱")
        self.opp_deck = _create_deck(name="상대덱")
        self.group = RecordGroup.objects.create(user=self.user, name="시즌1")

    def test_add_match(self):
        resp = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.deck.id,
            "opponent_deck": self.opp_deck.id,
            "first_or_second": "first",
            "result": "win",
            "coin_toss_result": "win",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(MatchRecord.objects.count(), 1)

    def test_add_match_with_null_opponent(self):
        resp = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.deck.id,
            "opponent_deck": None,
            "first_or_second": "second",
            "result": "lose",
            "coin_toss_result": "lose",
        }, format="json")
        self.assertEqual(resp.status_code, 201)

    def test_update_match(self):
        match = _create_match(self.group, self.deck)
        resp = self.client.patch(f"/api/match-records/{match.id}/update/", {"result": "lose"}, format="json")
        self.assertEqual(resp.status_code, 200)
        match.refresh_from_db()
        self.assertEqual(match.result, "lose")

    def test_soft_delete_match(self):
        match = _create_match(self.group, self.deck)
        resp = self.client.delete(f"/api/match-records/{match.id}/delete/")
        self.assertEqual(resp.status_code, 204)
        match.refresh_from_db()
        self.assertTrue(match.is_deleted)

    def test_add_match_with_score_type(self):
        resp = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.deck.id,
            "opponent_deck": self.opp_deck.id,
            "first_or_second": "first",
            "result": "win",
            "coin_toss_result": "win",
            "score": 1612,
            "score_type": "rating",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        match = MatchRecord.objects.get(id=resp.json()["match_id"])
        self.assertEqual(match.score_type, "rating")
        self.assertEqual(match.score, 1612)

    def test_score_type_default_is_null(self):
        match = _create_match(self.group, self.deck)
        self.assertIsNone(match.score_type)

    def test_add_match_with_custom_opponent_name(self):
        resp = self.client.post(f"/api/record-groups/{self.group.id}/add-match/", {
            "deck": self.deck.id,
            "opponent_deck": None,
            "opponent_deck_name": "스네이크아이",
            "first_or_second": "first",
            "result": "win",
            "coin_toss_result": "win",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        match = MatchRecord.objects.get(id=resp.json()["match_id"])
        self.assertIsNone(match.opponent_deck)
        self.assertEqual(match.opponent_deck_name, "스네이크아이")

    def test_update_opponent_deck_via_fk(self):
        match = _create_match(self.group, self.deck)
        resp = self.client.patch(f"/api/match-records/{match.id}/update/", {
            "opponent_deck": self.opp_deck.id,
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        match.refresh_from_db()
        self.assertEqual(match.opponent_deck_id, self.opp_deck.id)

    def test_update_opponent_deck_name(self):
        match = _create_match(self.group, self.deck, self.opp_deck)
        resp = self.client.patch(f"/api/match-records/{match.id}/update/", {
            "opponent_deck": None,
            "opponent_deck_name": "커스텀덱",
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        match.refresh_from_db()
        self.assertIsNone(match.opponent_deck)
        self.assertEqual(match.opponent_deck_name, "커스텀덱")

    def test_matches_response_includes_opponent_deck_name(self):
        _create_match(self.group, self.deck, opponent_deck_name="커스텀")
        resp = self.client.get(f"/api/record-groups/{self.group.id}/matches/")
        match_data = resp.json()["matches"][0]
        self.assertEqual(match_data["opponent_deck_name"], "커스텀")

    def test_other_user_cannot_update(self):
        other = User.objects.create_user(email="b@test.com", username="other", password="pass1234")
        other_client = APIClient()
        other_client.force_authenticate(user=other)
        match = _create_match(self.group, self.deck)
        resp = other_client.patch(f"/api/match-records/{match.id}/update/", {"result": "lose"}, format="json")
        self.assertEqual(resp.status_code, 404)


class RecordGroupStatisticsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = _create_deck(name="내덱")
        self.opp = _create_deck(name="상대덱")
        self.group = RecordGroup.objects.create(user=self.user, name="시즌1")

    def test_basic_statistics(self):
        _create_match(self.group, self.deck, self.opp, first_or_second="first", result="win", coin_toss_result="win")
        _create_match(self.group, self.deck, self.opp, first_or_second="first", result="win", coin_toss_result="lose")
        _create_match(self.group, self.deck, self.opp, first_or_second="second", result="lose", coin_toss_result="win")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/")
        data = resp.json()
        self.assertEqual(data["total_games"], 3)
        self.assertAlmostEqual(data["overall_win_rate"], 200 / 3, places=1)
        self.assertEqual(data["first_win_rate"], 100.0)
        self.assertEqual(data["second_win_rate"], 0.0)

    def test_empty_group_statistics(self):
        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/")
        data = resp.json()
        self.assertEqual(data["total_games"], 0)
        self.assertEqual(data["overall_win_rate"], 0)

    def test_deleted_matches_excluded(self):
        _create_match(self.group, self.deck, self.opp, result="win")
        deleted = _create_match(self.group, self.deck, self.opp, result="lose")
        deleted.is_deleted = True
        deleted.save()

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/")
        self.assertEqual(resp.json()["total_games"], 1)


class FullStatisticsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck1 = _create_deck(name="덱A")
        self.deck2 = _create_deck(name="덱B")
        self.opp = _create_deck(name="상대")
        self.group = RecordGroup.objects.create(user=self.user, name="시즌1")

    def test_full_statistics_structure(self):
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck2, self.opp, result="lose")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/")
        data = resp.json()
        self.assertIn("basic", data)
        self.assertIn("my_deck_stats", data)
        self.assertIn("opponent_deck_stats", data)
        self.assertIn("deck_vs_deck_stats", data)
        self.assertEqual(data["basic"]["total_games"], 2)
        self.assertEqual(len(data["my_deck_stats"]), 2)
        self.assertEqual(len(data["opponent_deck_stats"]), 1)

    def test_unknown_opponent_has_null_deck_in_personal_stats(self):
        _create_match(self.group, self.deck1, result="win")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/")
        opp_stats = resp.json()["opponent_deck_stats"]
        unknown = [s for s in opp_stats if s["deck"] is None and not s.get("custom_name")]
        self.assertEqual(len(unknown), 1)
        self.assertEqual(unknown[0]["total_games"], 1)

    def test_custom_opponent_grouped_in_personal_stats(self):
        _create_match(self.group, self.deck1, opponent_deck_name="커스텀A", result="win")
        _create_match(self.group, self.deck1, opponent_deck_name="커스텀A", result="lose")
        _create_match(self.group, self.deck1, opponent_deck_name="커스텀B", result="win")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/")
        opp_stats = resp.json()["opponent_deck_stats"]
        custom_a = [s for s in opp_stats if s.get("custom_name") == "커스텀A"]
        custom_b = [s for s in opp_stats if s.get("custom_name") == "커스텀B"]
        self.assertEqual(len(custom_a), 1)
        self.assertEqual(custom_a[0]["total_games"], 2)
        self.assertEqual(len(custom_b), 1)
        self.assertEqual(custom_b[0]["total_games"], 1)

    def test_deck_id_filter(self):
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck2, self.opp, result="lose")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/", {"deck_id": self.deck1.id})
        data = resp.json()
        self.assertEqual(data["basic"]["total_games"], 2)
        self.assertAlmostEqual(data["basic"]["overall_win_rate"], 100.0)

    def test_deck_id_filter_excludes_other_deck(self):
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck2, self.opp, result="lose")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/", {"deck_id": self.deck2.id})
        data = resp.json()
        self.assertEqual(data["basic"]["total_games"], 1)
        self.assertEqual(len(data["my_deck_stats"]), 1)
        self.assertEqual(data["my_deck_stats"][0]["deck"]["name"], "덱B")

    def test_my_deck_stats_win_rate(self):
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck1, self.opp, result="win")
        _create_match(self.group, self.deck1, self.opp, result="lose")

        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/")
        my_stats = resp.json()["my_deck_stats"]
        deck1_stat = next(s for s in my_stats if s["deck"]["name"] == "덱A")
        self.assertAlmostEqual(deck1_stat["win_rate"], 200 / 3, places=1)


class GetRecordGroupMatchesTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = _create_deck(name="내덱")
        self.group = RecordGroup.objects.create(user=self.user, name="시즌1")

    def test_pagination(self):
        for _ in range(15):
            _create_match(self.group, self.deck)

        resp = self.client.get(f"/api/record-groups/{self.group.id}/matches/", {"page": 1, "page_size": 10})
        data = resp.json()
        self.assertEqual(len(data["matches"]), 10)
        self.assertEqual(data["total_pages"], 2)

    def test_deleted_matches_excluded(self):
        _create_match(self.group, self.deck)
        deleted = _create_match(self.group, self.deck)
        deleted.is_deleted = True
        deleted.save()

        resp = self.client.get(f"/api/record-groups/{self.group.id}/matches/")
        self.assertEqual(len(resp.json()["matches"]), 1)


class RecordGroupVisibilityTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner@test.com", username="owner", password="pass1234")
        self.other = User.objects.create_user(email="other@test.com", username="other", password="pass1234")
        self.deck = _create_deck(name="내덱")
        self.group = RecordGroup.objects.create(user=self.owner, name="시즌1")
        _create_match(self.group, self.deck, result="win")

    def test_default_is_private(self):
        self.assertFalse(self.group.is_public)

    def test_owner_can_toggle_visibility(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        resp = client.patch(
            f"/api/record-groups/{self.group.id}/update-visibility/",
            {"is_public": True}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.group.refresh_from_db()
        self.assertTrue(self.group.is_public)

    def test_non_owner_cannot_toggle_visibility(self):
        client = APIClient()
        client.force_authenticate(user=self.other)
        resp = client.patch(
            f"/api/record-groups/{self.group.id}/update-visibility/",
            {"is_public": True}, format="json"
        )
        self.assertEqual(resp.status_code, 404)

    def test_public_group_matches_accessible_without_auth(self):
        self.group.is_public = True
        self.group.save()
        client = APIClient()
        resp = client.get(f"/api/record-groups/{self.group.id}/matches/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["matches"]), 1)

    def test_private_group_matches_inaccessible_without_auth(self):
        client = APIClient()
        resp = client.get(f"/api/record-groups/{self.group.id}/matches/")
        self.assertEqual(resp.status_code, 403)

    def test_public_group_stats_accessible_without_auth(self):
        self.group.is_public = True
        self.group.save()
        client = APIClient()
        resp = client.get(f"/api/record-groups/{self.group.id}/statistics/")
        self.assertEqual(resp.status_code, 200)

    def test_private_group_stats_inaccessible_by_other(self):
        client = APIClient()
        client.force_authenticate(user=self.other)
        resp = client.get(f"/api/record-groups/{self.group.id}/statistics/")
        self.assertEqual(resp.status_code, 403)

    def test_owner_always_can_access_private(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        resp = client.get(f"/api/record-groups/{self.group.id}/matches/")
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# Regression guard for the statistics refactor: exact values computed by hand
# for a mixed fixture (FK opponent / unknown / custom name / deleted match).
# ---------------------------------------------------------------------------
class FullStatisticsGoldenTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="g@test.com", username="golden", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.a = _create_deck(name="A")
        self.b = _create_deck(name="B")
        self.x = _create_deck(name="X")
        self.y = _create_deck(name="Y")
        self.group = RecordGroup.objects.create(user=self.user, name="골든")
        g = self.group
        _create_match(g, self.a, self.x, first_or_second="first", result="win", coin_toss_result="win")    # 1
        _create_match(g, self.a, self.x, first_or_second="second", result="lose", coin_toss_result="lose")  # 2
        _create_match(g, self.a, self.y, first_or_second="first", result="win", coin_toss_result="lose")   # 3
        _create_match(g, self.b, self.x, first_or_second="second", result="win", coin_toss_result="win")   # 4
        _create_match(g, self.b, None, first_or_second="first", result="lose", coin_toss_result="win")     # 5 unknown
        _create_match(g, self.a, None, opponent_deck_name="커스텀", first_or_second="second", result="win", coin_toss_result="lose")  # 6
        _create_match(g, self.a, self.x, first_or_second="first", result="lose", coin_toss_result="win", is_deleted=True)  # 7 deleted

    def _get(self, **params):
        resp = self.client.get(f"/api/record-groups/{self.group.id}/statistics/full/", params)
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def _by_deck(self, items, name):
        return next(s for s in items if s["deck"] and s["deck"]["name"] == name)

    def test_basic_section(self):
        data = self._get()
        self.assertEqual(data["record_group_name"], "골든")
        basic = data["basic"]
        self.assertEqual(basic["total_games"], 6)
        self.assertAlmostEqual(basic["overall_win_rate"], 400 / 6, places=4)
        self.assertAlmostEqual(basic["first_win_rate"], 200 / 3, places=4)
        self.assertAlmostEqual(basic["second_win_rate"], 200 / 3, places=4)
        self.assertAlmostEqual(basic["first_ratio"], 50.0, places=4)
        self.assertAlmostEqual(basic["coin_toss_win_rate"], 50.0, places=4)
        self.assertAlmostEqual(basic["coin_toss_win_win_rate"], 200 / 3, places=4)
        self.assertAlmostEqual(basic["coin_toss_lose_win_rate"], 200 / 3, places=4)

    def test_my_deck_section(self):
        my = self._get()["my_deck_stats"]
        self.assertEqual(len(my), 2)
        a = self._by_deck(my, "A")
        self.assertEqual(a["count"], 4)
        self.assertAlmostEqual(a["ratio"], 400 / 6, places=4)
        self.assertEqual(a["total_games"], 4)
        self.assertAlmostEqual(a["win_rate"], 75.0, places=4)
        self.assertAlmostEqual(a["first_win_rate"], 100.0, places=4)
        self.assertAlmostEqual(a["second_win_rate"], 50.0, places=4)
        self.assertAlmostEqual(a["coin_toss_win_win_rate"], 100.0, places=4)
        self.assertAlmostEqual(a["coin_toss_lose_win_rate"], 200 / 3, places=4)
        self.assertEqual(set(a["deck"].keys()) >= {"id", "name"}, True)
        b = self._by_deck(my, "B")
        self.assertEqual(b["count"], 2)
        self.assertAlmostEqual(b["ratio"], 200 / 6, places=4)
        self.assertAlmostEqual(b["win_rate"], 50.0, places=4)
        self.assertEqual(b["first_win_rate"], 0)
        self.assertAlmostEqual(b["second_win_rate"], 100.0, places=4)
        self.assertAlmostEqual(b["coin_toss_win_win_rate"], 50.0, places=4)
        self.assertEqual(b["coin_toss_lose_win_rate"], 0)

    def test_opponent_section(self):
        opp = self._get()["opponent_deck_stats"]
        self.assertEqual(len(opp), 4)  # X, Y, unknown, 커스텀
        x = self._by_deck(opp, "X")
        self.assertEqual(x["custom_name"], None)
        self.assertEqual(x["count"], 3)
        self.assertAlmostEqual(x["ratio"], 50.0, places=4)
        self.assertAlmostEqual(x["win_rate"], 200 / 3, places=4)
        self.assertAlmostEqual(x["first_ratio"], 100 / 3, places=4)
        self.assertAlmostEqual(x["first_win_rate"], 100.0, places=4)
        self.assertAlmostEqual(x["second_win_rate"], 50.0, places=4)
        self.assertAlmostEqual(x["coin_toss_win_win_rate"], 100.0, places=4)
        self.assertEqual(x["coin_toss_lose_win_rate"], 0)
        y = self._by_deck(opp, "Y")
        self.assertEqual(y["count"], 1)
        self.assertAlmostEqual(y["ratio"], 100 / 6, places=4)
        self.assertAlmostEqual(y["first_ratio"], 100.0, places=4)
        self.assertIsNone(y["second_win_rate"])   # no second games -> None (not 0)
        self.assertEqual(y["coin_toss_win_win_rate"], 0)
        self.assertAlmostEqual(y["coin_toss_lose_win_rate"], 100.0, places=4)
        unknown = next(s for s in opp if s["deck"] is None and not s["custom_name"])
        self.assertEqual(unknown["count"], 1)
        self.assertEqual(unknown["win_rate"], 0)
        self.assertAlmostEqual(unknown["first_ratio"], 100.0, places=4)
        self.assertEqual(unknown["first_win_rate"], 0)
        self.assertIsNone(unknown["second_win_rate"])
        custom = next(s for s in opp if s["custom_name"] == "커스텀")
        self.assertIsNone(custom["deck"])
        self.assertEqual(custom["count"], 1)
        self.assertAlmostEqual(custom["ratio"], 100 / 6, places=4)
        self.assertAlmostEqual(custom["win_rate"], 100.0, places=4)
        self.assertEqual(custom["first_ratio"], 0)
        self.assertIsNone(custom["first_win_rate"])
        self.assertAlmostEqual(custom["second_win_rate"], 100.0, places=4)
        self.assertEqual(custom["coin_toss_win_win_rate"], 0)
        self.assertEqual(custom["coin_toss_lose_win_rate"], 0)

    def test_deck_vs_deck_section(self):
        pairs = self._get()["deck_vs_deck_stats"]
        self.assertEqual(len(pairs), 5)
        def pair(d, o):
            return next(p for p in pairs if p["deck_id"] == d and p["opponent_deck_id"] == o)
        ax = pair(self.a.id, self.x.id)
        self.assertEqual(ax["total_games"], 2)
        self.assertAlmostEqual(ax["win_rate"], 50.0, places=4)
        self.assertAlmostEqual(ax["first_win_rate"], 100.0, places=4)
        self.assertEqual(ax["second_win_rate"], 0)
        self.assertAlmostEqual(ax["coin_toss_win_win_rate"], 100.0, places=4)
        self.assertEqual(ax["coin_toss_lose_win_rate"], 0)
        ay = pair(self.a.id, self.y.id)
        self.assertEqual(ay["total_games"], 1)
        self.assertEqual(ay["second_win_rate"], 0)   # pairs use 0, not None
        self.assertEqual(ay["coin_toss_win_win_rate"], 0)
        self.assertAlmostEqual(ay["coin_toss_lose_win_rate"], 100.0, places=4)
        bn = pair(self.b.id, None)
        self.assertEqual(bn["total_games"], 1)
        self.assertEqual(bn["win_rate"], 0)
        an = pair(self.a.id, None)   # custom-name match groups under opponent None
        self.assertEqual(an["total_games"], 1)
        self.assertAlmostEqual(an["win_rate"], 100.0, places=4)
        self.assertAlmostEqual(an["second_win_rate"], 100.0, places=4)

    def test_deck_id_filter_golden(self):
        data = self._get(deck_id=self.b.id)
        self.assertEqual(data["basic"]["total_games"], 2)
        self.assertEqual(len(data["my_deck_stats"]), 1)
        self.assertEqual(len(data["opponent_deck_stats"]), 2)   # X + unknown
        self.assertEqual(len(data["deck_vs_deck_stats"]), 2)
        x = self._by_deck(data["opponent_deck_stats"], "X")
        self.assertAlmostEqual(x["ratio"], 50.0, places=4)

    def test_empty_sheet_sections(self):
        empty = RecordGroup.objects.create(user=self.user, name="빈시트")
        resp = self.client.get(f"/api/record-groups/{empty.id}/statistics/full/")
        data = resp.json()
        self.assertEqual(data["basic"]["total_games"], 0)
        self.assertEqual(data["basic"]["overall_win_rate"], 0)
        self.assertEqual(data["my_deck_stats"], [])
        self.assertEqual(data["opponent_deck_stats"], [])
        self.assertEqual(data["deck_vs_deck_stats"], [])


class StatisticsQueryCountTest(TestCase):
    """The rewrite must not scale queries with the number of decks/matches."""
    MAX_QUERIES = 8

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="q@test.com", username="qcount", password="pass1234")
        self.client.force_authenticate(user=self.user)
        decks = [_create_deck(name=f"D{i}") for i in range(4)]
        opps = [_create_deck(name=f"O{i}") for i in range(4)]
        self.groups = [RecordGroup.objects.create(user=self.user, name=f"시트{i}") for i in range(3)]
        for gi, g in enumerate(self.groups):
            for i, d in enumerate(decks):
                for j, o in enumerate(opps):
                    _create_match(g, d, o, result="win" if (i + j + gi) % 2 else "lose",
                                  first_or_second="first" if j % 2 else "second",
                                  coin_toss_result="win" if i % 2 else "lose")
            _create_match(g, decks[0], None, opponent_deck_name="커스텀")
            _create_match(g, decks[1], None)

    def test_per_sheet_query_count(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get(f"/api/record-groups/{self.groups[0].id}/statistics/full/")
        self.assertEqual(resp.status_code, 200)
        self.assertLessEqual(len(ctx.captured_queries), self.MAX_QUERIES, "per-sheet stats issue N+1 queries")

    def test_aggregate_query_count(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/record-groups/statistics/full/")
        self.assertEqual(resp.status_code, 200)
        self.assertLessEqual(len(ctx.captured_queries), self.MAX_QUERIES, "aggregate stats issue N+1 queries")


class AggregateStatisticsTest(TestCase):
    """GET /api/record-groups/statistics/full/ — all of my sheets merged."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="m@test.com", username="me", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.a = _create_deck(name="A")
        self.b = _create_deck(name="B")
        self.x = _create_deck(name="X")
        self.g1 = RecordGroup.objects.create(user=self.user, name="시즌1")
        self.g2 = RecordGroup.objects.create(user=self.user, name="시즌2")
        self.g_deleted = RecordGroup.objects.create(user=self.user, name="삭제됨", is_deleted=True)
        self.g_other = RecordGroup.objects.create(user=self.other, name="남의시트", is_public=True)
        _create_match(self.g1, self.a, self.x, result="win", first_or_second="first")
        _create_match(self.g1, self.a, self.x, result="lose", first_or_second="second")
        _create_match(self.g2, self.b, self.x, result="win", first_or_second="first")
        _create_match(self.g_deleted, self.a, self.x, result="win")
        _create_match(self.g_other, self.a, self.x, result="lose")

    def _get(self, **params):
        resp = self.client.get("/api/record-groups/statistics/full/", params)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_merges_all_my_sheets_only(self):
        data = self._get()
        self.assertEqual(data["basic"]["total_games"], 3)   # deleted + other user's excluded
        self.assertAlmostEqual(data["basic"]["overall_win_rate"], 200 / 3, places=4)
        self.assertEqual(data["group_count"], 2)
        self.assertEqual({g["id"] for g in data["record_groups"]}, {self.g1.id, self.g2.id})
        self.assertEqual({g["name"] for g in data["record_groups"]}, {"시즌1", "시즌2"})
        self.assertNotIn("record_group_name", data)

    def test_ratios_use_merged_total(self):
        data = self._get()
        a = next(s for s in data["my_deck_stats"] if s["deck"]["name"] == "A")
        b = next(s for s in data["my_deck_stats"] if s["deck"]["name"] == "B")
        self.assertEqual(a["count"], 2)
        self.assertAlmostEqual(a["ratio"], 200 / 3, places=4)
        self.assertAlmostEqual(b["ratio"], 100 / 3, places=4)
        x = next(s for s in data["opponent_deck_stats"] if s["deck"] and s["deck"]["name"] == "X")
        self.assertEqual(x["count"], 3)
        self.assertAlmostEqual(x["ratio"], 100.0, places=4)
        self.assertAlmostEqual(x["win_rate"], 200 / 3, places=4)
        pairs = {(p["deck_id"], p["opponent_deck_id"]): p for p in data["deck_vs_deck_stats"]}
        self.assertEqual(pairs[(self.a.id, self.x.id)]["total_games"], 2)
        self.assertEqual(pairs[(self.b.id, self.x.id)]["total_games"], 1)

    def test_group_ids_filter(self):
        self.assertEqual(self._get(group_ids=str(self.g1.id))["basic"]["total_games"], 2)
        data = self._get(group_ids=f"{self.g1.id},{self.g2.id}")
        self.assertEqual(data["basic"]["total_games"], 3)
        self.assertEqual(data["group_count"], 2)

    def test_group_ids_ignores_foreign_deleted_and_unknown(self):
        data = self._get(group_ids=f"{self.g1.id},{self.g_other.id},{self.g_deleted.id},999999")
        self.assertEqual(data["basic"]["total_games"], 2)
        self.assertEqual(data["group_count"], 1)
        self.assertEqual([g["id"] for g in data["record_groups"]], [self.g1.id])

    def test_group_ids_invalid_returns_400(self):
        resp = self.client.get("/api/record-groups/statistics/full/", {"group_ids": "abc"})
        self.assertEqual(resp.status_code, 400)

    def test_deck_id_filter_across_sheets(self):
        data = self._get(deck_id=self.a.id)
        self.assertEqual(data["basic"]["total_games"], 2)
        self.assertEqual(len(data["my_deck_stats"]), 1)
        self.assertEqual(data["group_count"], 2)   # sheet list is not narrowed by deck filter

    def test_no_sheets(self):
        lonely = User.objects.create_user(email="l@test.com", username="lonely", password="pass1234")
        self.client.force_authenticate(user=lonely)
        data = self._get()
        self.assertEqual(data["basic"]["total_games"], 0)
        self.assertEqual(data["group_count"], 0)
        self.assertEqual(data["record_groups"], [])
        self.assertEqual(data["my_deck_stats"], [])

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get("/api/record-groups/statistics/full/")
        self.assertEqual(resp.status_code, 401)

    def test_per_sheet_endpoint_still_works(self):
        resp = self.client.get(f"/api/record-groups/{self.g1.id}/statistics/full/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["basic"]["total_games"], 2)
        self.assertEqual(resp.json()["record_group_name"], "시즌1")
