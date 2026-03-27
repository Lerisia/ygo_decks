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
