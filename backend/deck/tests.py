from django.test import TestCase, Client
from rest_framework.test import APIClient
from .models import Deck, SummoningMethod, PerformanceTag, AestheticTag, DeckAlias
from .views import parse_answer_key
from userstatistics.models import UserResponse
from user.models import User


class ParseAnswerKeyTest(TestCase):
    def test_basic_integer_fields(self):
        result = parse_answer_key("strength=1|difficulty=2|deck_type=0|art_style=3")
        self.assertEqual(result, {
            "strength": 1,
            "difficulty": 2,
            "deck_type": 0,
            "art_style": 3,
        })

    def test_summoning_methods_parsed_as_int_list(self):
        result = parse_answer_key("summoning_methods=1,3,6")
        self.assertEqual(result["summoning_methods"], [1, 3, 6])

    def test_tags_parsed_as_string_list(self):
        result = parse_answer_key("performance_tags=원턴킬,묘지소환|aesthetic_tags=드래곤")
        self.assertEqual(result["performance_tags"], ["원턴킬", "묘지소환"])
        self.assertEqual(result["aesthetic_tags"], ["드래곤"])

    def test_empty_pairs_ignored(self):
        result = parse_answer_key("strength=1||difficulty=2")
        self.assertEqual(result["strength"], 1)
        self.assertEqual(result["difficulty"], 2)


def _create_deck(**kwargs):
    defaults = {
        "name": "테스트 덱",
        "strength": 0,
        "difficulty": 0,
        "deck_type": 0,
        "art_style": 0,
    }
    defaults.update(kwargs)
    return Deck.objects.create(**defaults)


class GetDeckResultTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.sm_fusion = SummoningMethod.objects.create(id=1, method=1)
        self.sm_synchro = SummoningMethod.objects.create(id=3, method=3)
        self.ptag = PerformanceTag.objects.create(name="원턴킬")
        self.atag = AestheticTag.objects.create(name="드래곤")

        self.deck1 = _create_deck(name="융합덱", strength=0, difficulty=0, deck_type=0, art_style=0)
        self.deck1.summoning_methods.add(self.sm_fusion)
        self.deck1.performance_tags.add(self.ptag)
        self.deck1.aesthetic_tags.add(self.atag)

        self.deck2 = _create_deck(name="싱크로덱", strength=1, difficulty=1, deck_type=1, art_style=1)
        self.deck2.summoning_methods.add(self.sm_synchro)

    def test_missing_key_returns_400(self):
        resp = self.client.get("/api/deck/result")
        self.assertEqual(resp.status_code, 400)

    def test_filter_by_strength(self):
        resp = self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "융합덱")

    def test_filter_by_summoning_method(self):
        resp = self.client.get("/api/deck/result", {"key": "summoning_methods=3"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "싱크로덱")

    def test_no_match_returns_404(self):
        resp = self.client.get("/api/deck/result", {"key": "strength=9"})
        self.assertEqual(resp.status_code, 404)

    def test_response_increments_num_views(self):
        self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.deck1.refresh_from_db()
        self.assertEqual(self.deck1.num_views, 1)

    def test_duplicate_response_does_not_increment(self):
        self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.deck1.refresh_from_db()
        self.assertEqual(self.deck1.num_views, 1)
        self.assertEqual(UserResponse.objects.count(), 1)

    def test_user_response_created(self):
        self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.assertEqual(UserResponse.objects.count(), 1)
        response = UserResponse.objects.first()
        self.assertEqual(response.deck, self.deck1)

    def test_owned_deck_excluded_when_custom_lookup(self):
        user = User.objects.create_user(email="test@test.com", username="tester", password="pass1234")
        user.use_custom_lookup = True
        user.save()
        user.owned_decks.add(self.deck1)

        api_client = APIClient()
        api_client.force_authenticate(user=user)
        resp = api_client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
        self.assertEqual(resp.status_code, 404)


class GetAllDecksTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.deck = _create_deck(name="테스트")
        DeckAlias.objects.create(deck=self.deck, name="별칭")

    def test_returns_all_decks(self):
        resp = self.client.get("/api/deck/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["decks"]), 1)
        self.assertEqual(data["decks"][0]["name"], "테스트")

    def test_includes_aliases(self):
        resp = self.client.get("/api/deck/")
        self.assertIn("별칭", resp.json()["decks"][0]["aliases"])


class GetDeckDataTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.deck = _create_deck(name="상세덱")

    def test_returns_deck_detail(self):
        resp = self.client.get(f"/api/deck/{self.deck.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "상세덱")

    def test_nonexistent_deck_returns_404(self):
        resp = self.client.get("/api/deck/99999/")
        self.assertEqual(resp.status_code, 404)

    def test_deck_stats_in_response(self):
        deck = _create_deck(
            name="스탯덱",
            stat_consistency=4,
            stat_breakthrough=3,
            stat_interruption=5,
            stat_recovery=2,
            stat_deck_space=3,
        )
        resp = self.client.get(f"/api/deck/{deck.id}/")
        data = resp.json()
        self.assertEqual(data["stats"]["consistency"], 4)
        self.assertEqual(data["stats"]["breakthrough"], 3)
        self.assertEqual(data["stats"]["interruption"], 5)
        self.assertEqual(data["stats"]["recovery"], 2)
        self.assertEqual(data["stats"]["deck_space"], 3)

    def test_deck_stats_default_to_null(self):
        resp = self.client.get(f"/api/deck/{self.deck.id}/")
        data = resp.json()
        for key in ["consistency", "breakthrough", "interruption", "recovery", "deck_space"]:
            self.assertIsNone(data["stats"][key])


class GetTagsTest(TestCase):
    def setUp(self):
        self.client = Client()
        AestheticTag.objects.create(name="드래곤")
        PerformanceTag.objects.create(name="원턴킬")

    def test_returns_tags(self):
        resp = self.client.get("/api/tags/")
        data = resp.json()
        self.assertIn("드래곤", data["aesthetic_tags"])
        self.assertIn("원턴킬", data["performance_tags"])


class UpdateWikiContentTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.deck = _create_deck(name="위키덱")
        self.admin = User.objects.create_superuser(email="admin@test.com", username="admin", password="admin1234")

    def test_admin_can_update_wiki(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.put(
            f"/api/deck/{self.deck.id}/update_wiki/",
            data={"wiki_content": "<p>테스트 위키</p>"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.wiki_content, "<p>테스트 위키</p>")

    def test_non_admin_cannot_update_wiki(self):
        user = User.objects.create_user(email="user@test.com", username="user", password="pass1234")
        self.client.force_authenticate(user=user)
        resp = self.client.put(
            f"/api/deck/{self.deck.id}/update_wiki/",
            data={"wiki_content": "hack"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


