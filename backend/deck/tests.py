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

    def test_strength_band_covers_two_tiers(self):
        # band 1 = {tier 0, tier 1} — both deck1(tier 0) and deck2(tier 1) should
        # be candidates. Result is randomly one of them, so run multiple times
        # and confirm both names can appear.
        names_seen = set()
        for _ in range(40):
            resp = self.client.get("/api/deck/result", {"key": "strength=1"})
            self.assertEqual(resp.status_code, 200)
            names_seen.add(resp.json()["name"])
            self.client.cookies.clear()  # fresh session each request
        self.assertEqual(names_seen, {"융합덱", "싱크로덱"})

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




# ---------------------------------------------------------------------------
# Per-question recommendation step (replaces the pre-generated lookup table).
# ---------------------------------------------------------------------------
class RecommendStepTest(TestCase):
    STEP_URL = "/api/deck/recommend/step"

    @classmethod
    def setUpTestData(cls):
        for m in (0, 1, 3, 6):
            SummoningMethod.objects.get_or_create(id=m, defaults={"method": m})
        cls.p1 = PerformanceTag.objects.create(name="P1", description="기믹1")
        cls.p2 = PerformanceTag.objects.create(name="P2", description="기믹2")
        cls.a1 = AestheticTag.objects.create(name="A1", description="조건1")
        cls.a2 = AestheticTag.objects.create(name="A2", description="조건2")

        def deck(name, strength, difficulty, deck_type, art_style, sms, ptags, atags):
            d = Deck.objects.create(name=name, strength=strength, difficulty=difficulty,
                                    deck_type=deck_type, art_style=art_style)
            d.summoning_methods.set(SummoningMethod.objects.filter(id__in=sms))
            d.performance_tags.set(ptags)
            d.aesthetic_tags.set(atags)
            return d

        cls.d1 = deck("D1", 0, 0, 0, 0, [1], [cls.p1], [cls.a1])
        cls.d2 = deck("D2", 1, 1, 0, 2, [3, 6], [cls.p1, cls.p2], [cls.a2])
        cls.d3 = deck("D3", 3, 2, 2, 1, [0], [cls.p2], [])

    def setUp(self):
        self.client = APIClient()

    def step(self, key=None):
        params = {"key": key} if key is not None else {}
        resp = self.client.get(self.STEP_URL, params)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_no_answers_lists_every_viable_option(self):
        data = self.step()
        self.assertEqual(data["candidate_count"], 3)
        self.assertFalse(data["resolved"])
        av = data["available"]
        self.assertEqual(av["s"], [0, 1, 2, 3])   # tiers 0,1,3 -> bands (0,1),(1,2),(2,3)
        self.assertEqual(av["d"], [0, 1, 2])
        self.assertEqual(av["t"], [0, 2])
        self.assertEqual(av["a"], [0, 1, 2])
        self.assertEqual(av["sm"], [0, 1, 3, 6])
        self.assertEqual(av["ptag"], sorted([self.p1.id, self.p2.id]))
        self.assertEqual(av["atag"], sorted([self.a1.id, self.a2.id]))

    def test_empty_key_means_no_answers(self):
        self.assertEqual(self.step("empty")["candidate_count"], 3)
        self.assertEqual(self.step("")["candidate_count"], 3)

    def test_answers_narrow_candidates_and_options(self):
        data = self.step("t=0")
        self.assertEqual(data["candidate_count"], 2)
        av = data["available"]
        self.assertEqual(av["d"], [0, 1])
        self.assertEqual(av["s"], [0, 1, 2])
        self.assertEqual(av["a"], [0, 2])
        self.assertEqual(av["sm"], [1, 3, 6])
        self.assertEqual(av["atag"], sorted([self.a1.id, self.a2.id]))
        self.assertEqual(av["t"], [0])   # answered key reflects the candidates

    def test_resolves_when_one_candidate_remains(self):
        data = self.step("d=1|t=0")
        self.assertEqual(data["candidate_count"], 1)
        self.assertTrue(data["resolved"])

    def test_strength_band_overlap(self):
        self.assertEqual(self.step("s=1")["candidate_count"], 2)   # band 1 = tiers 0,1 -> D1, D2
        self.assertEqual(self.step("s=0")["candidate_count"], 1)   # tier 0 only -> D1
        self.assertEqual(self.step("s=2")["candidate_count"], 2)   # band 2 = tiers 1,2,3 -> D2, D3
        self.assertEqual(self.step("s=3")["candidate_count"], 1)   # band 3 = tiers 2,3,4 -> D3
        self.assertEqual(self.step("s=4")["candidate_count"], 0)   # band 4 = tiers 4,5 -> none

    def test_summoning_method_and_tags(self):
        self.assertTrue(self.step("sm=6")["resolved"])
        self.assertEqual(self.step(f"ptag={self.p1.id}")["candidate_count"], 2)
        self.assertTrue(self.step(f"atag={self.a2.id}")["resolved"])

    def test_impossible_combination_yields_zero(self):
        data = self.step("d=2|t=0")
        self.assertEqual(data["candidate_count"], 0)
        self.assertFalse(data["resolved"])
        self.assertTrue(all(v == [] for v in data["available"].values()))

    def test_key_order_does_not_matter(self):
        self.assertEqual(self.step("t=0|d=1"), self.step("d=1|t=0"))

    def test_invalid_value_returns_400(self):
        self.assertEqual(self.client.get(self.STEP_URL, {"key": "s=abc"}).status_code, 400)
        self.assertEqual(self.client.get(self.STEP_URL, {"key": "zzz=1"}).status_code, 400)

    def test_custom_lookup_excludes_owned_decks(self):
        user = User.objects.create_user(email="c@test.com", username="custom", password="pass1234")
        user.use_custom_lookup = True
        user.save()
        user.owned_decks.set([self.d1, self.d2])
        self.client.force_authenticate(user=user)
        data = self.step()
        self.assertEqual(data["candidate_count"], 1)
        self.assertEqual(data["available"]["d"], [2])
        user.owned_decks.add(self.d3)
        self.assertEqual(self.step()["candidate_count"], 0)

    def test_logged_in_without_custom_lookup_sees_everything(self):
        user = User.objects.create_user(email="n@test.com", username="normal", password="pass1234")
        user.owned_decks.set([self.d1, self.d2, self.d3])
        self.client.force_authenticate(user=user)
        self.assertEqual(self.step()["candidate_count"], 3)

    def test_resolved_step_agrees_with_result_endpoint(self):
        """Whatever the step endpoint calls resolved must be servable by /deck/result."""
        mapping = {"s": "strength", "d": "difficulty", "t": "deck_type", "a": "art_style",
                   "sm": "summoning_methods", "ptag": "performance_tags", "atag": "aesthetic_tags"}
        for key, expected in (("d=1|t=0", "D2"), ("s=0", "D1"), ("sm=6", "D2"), (f"atag={self.a2.id}", "D2")):
            self.assertTrue(self.step(key)["resolved"], key)
            long_key = "|".join(f"{mapping[k]}={v}" for k, v in (p.split("=") for p in key.split("|")))
            resp = self.client.get("/api/deck/result", {"key": long_key})
            self.assertEqual(resp.status_code, 200, key)
            self.assertEqual(resp.json()["name"], expected, key)


class SixTierStrengthTest(TestCase):
    """Spec for the 2026-08-31 5->6 tier split (중위권 -> 중상위권/중하위권)."""

    def test_tier_labels(self):
        from .models import Deck
        labels = [label for _, label in Deck._meta.get_field("strength").choices]
        self.assertEqual(labels, ["최상위권", "상위권", "중상위권", "중하위권", "하위권", "최하위권"])

    def test_band_to_tiers(self):
        from .models import STRENGTH_BAND_TO_TIERS
        self.assertEqual(STRENGTH_BAND_TO_TIERS, {
            0: (0,),
            1: (0, 1),
            2: (1, 2, 3),
            3: (2, 3, 4),
            4: (4, 5),
        })

    def test_tier_to_bands_covers_all_six_tiers(self):
        from .models import STRENGTH_TIER_TO_BANDS
        self.assertEqual(set(STRENGTH_TIER_TO_BANDS), set(range(6)))
        self.assertEqual(STRENGTH_TIER_TO_BANDS[2], (2, 3))   # new 중상위권 (old 중위권 slot)
        self.assertEqual(STRENGTH_TIER_TO_BANDS[3], (2, 3))   # new 중하위권 (old 중위권 slot)
        self.assertEqual(STRENGTH_TIER_TO_BANDS[5], (4,))

    def test_migration_remap_semantics(self):
        import importlib
        mig = importlib.import_module("deck.migrations.0010_remap_strength_to_six_tiers")
        d_top = _create_deck(name="탑", strength=0)
        d_upper = _create_deck(name="중상", strength=1)
        d_mid = _create_deck(name="중위", strength=2)
        d_lower = _create_deck(name="중하", strength=3)
        d_bottom = _create_deck(name="최하", strength=4)
        from django.apps import apps
        mig.forwards(apps, None)
        refresh = lambda d: Deck.objects.get(id=d.id).strength
        self.assertEqual(refresh(d_top), 0)      # 최상위권 -> 최상위권
        self.assertEqual(refresh(d_upper), 1)    # 중상위권 -> 상위권
        self.assertEqual(refresh(d_mid), 2)      # 중위권 -> 중상위권
        self.assertEqual(refresh(d_lower), 4)    # 중하위권 -> 하위권
        self.assertEqual(refresh(d_bottom), 5)   # 최하위권 -> 최하위권
