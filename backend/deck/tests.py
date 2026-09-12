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


class DeckEngineFlagTest(TestCase):
    """'용병 덱' flag: decks mostly splashed into other decks rather than played alone."""

    def setUp(self):
        self.client = APIClient()
        self.main = _create_deck(name="메인덱")
        self.engine = _create_deck(name="용병엔진", is_engine=True)

    def test_list_exposes_flag(self):
        decks = {d["name"]: d for d in self.client.get("/api/deck/").json()["decks"]}
        self.assertFalse(decks["메인덱"]["is_engine"])
        self.assertTrue(decks["용병엔진"]["is_engine"])

    def test_detail_exposes_flag(self):
        self.assertTrue(self.client.get(f"/api/deck/{self.engine.id}/").json()["is_engine"])
        self.assertFalse(self.client.get(f"/api/deck/{self.main.id}/").json()["is_engine"])

    def test_default_is_false(self):
        self.assertFalse(Deck.objects.get(id=self.main.id).is_engine)


class EngineExcludedFromRecommendationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.main = _create_deck(name="메인", strength=0, difficulty=0, deck_type=0, art_style=0)
        self.engine = _create_deck(name="엔진", strength=0, difficulty=0, deck_type=0, art_style=0, is_engine=True)

    def test_step_ignores_engine_decks(self):
        data = self.client.get("/api/deck/recommend/step").json()
        self.assertEqual(data["candidate_count"], 1)
        self.assertTrue(data["resolved"])

    def test_result_never_returns_engine_deck(self):
        for _ in range(5):
            resp = self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["name"], "메인")

    def test_empty_key_random_pick_skips_engine_decks(self):
        for _ in range(5):
            resp = self.client.get("/api/deck/result", {"key": "empty"})
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["name"], "메인")


class PlayVideoUrlTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_detail_exposes_play_video_url(self):
        plain = _create_deck(name="영상없음")
        with_video = _create_deck(name="영상있음", play_video_url="https://www.youtube.com/watch?v=abc123")
        self.assertEqual(self.client.get(f"/api/deck/{plain.id}/").json()["play_video_url"], "")
        self.assertEqual(self.client.get(f"/api/deck/{with_video.id}/").json()["play_video_url"], "https://www.youtube.com/watch?v=abc123")


from datetime import datetime, timedelta, timezone as dt_timezone
from .models import ChannelVideo
from .youtube import hashtag_tokens, title_matches, deck_keys, videos_for_deck, sync_channel_videos


def _video(video_id, title, published_at=None, position=0, **kw):
    return ChannelVideo.objects.create(video_id=video_id, title=title, published_at=published_at, position=position, **kw)


class YoutubeTitleMatchingTest(TestCase):
    def test_hashtag_tokens_strip_deck_suffix_and_spaces(self):
        self.assertEqual(hashtag_tokens("설명 #사이버드래곤 덱 - 유희왕 플레이 영상"), ["사이버드래곤"])
        self.assertEqual(hashtag_tokens("#낙인상검 덱 #ABC 덱"), ["낙인상검", "abc"])
        self.assertEqual(hashtag_tokens("해시태그 없음"), [])

    def test_space_insensitive_name_match(self):
        deck = _create_deck(name="사이버 드래곤")
        self.assertTrue(title_matches("16000 공격력 #사이버드래곤 덱 - 유희왕 플레이 영상", deck_keys(deck)))

    def test_alias_match(self):
        deck = _create_deck(name="드래곤테일")
        DeckAlias.objects.create(deck=deck, name="드테")
        self.assertTrue(title_matches("낙인 용병 #드테 덱 - 유희왕 플레이 영상", deck_keys(deck)))

    def test_hybrid_hashtag_matches_each_component_deck(self):
        keys_a, keys_b = deck_keys(_create_deck(name="낙인")), deck_keys(_create_deck(name="상검"))
        title = "인맥 총동원 #낙인상검 덱 - 유희왕 플레이 영상"
        self.assertTrue(title_matches(title, keys_a))
        self.assertTrue(title_matches(title, keys_b))

    def test_prose_does_not_match_when_hashtag_present(self):
        keys = deck_keys(_create_deck(name="제왕"))
        self.assertFalse(title_matches("황제왕의 귀환 #크라운클랜 덱 - 유희왕 플레이 영상", keys))

    def test_no_hashtag_falls_back_to_title_with_long_keys_only(self):
        self.assertTrue(title_matches("A Crazy Theme - Materiactor", deck_keys(_create_deck(name="Materiactor"))))
        self.assertFalse(title_matches("황제왕의 귀환", deck_keys(_create_deck(name="제왕"))))

    def test_one_character_keys_are_ignored(self):
        deck = _create_deck(name="숲")
        self.assertEqual(deck_keys(deck), set())
        self.assertEqual(videos_for_deck(deck), [])


class DeckVideosEndpointTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.deck = _create_deck(name="크라운 클랜")
        _create_deck(name="십이수")
        t0 = datetime(2026, 9, 1, tzinfo=dt_timezone.utc)
        _video("old", "구축 #크라운클랜 덱 - 유희왕 플레이 영상", t0, position=2, view_count=10, duration=700, thumbnail_url="https://i.ytimg.com/vi/old/hqdefault.jpg")
        _video("new", "도파민 #크라운클랜 덱 - 유희왕 플레이 영상", t0 + timedelta(days=5), position=0)
        _video("nodate", "옛날 #크라운클랜 덱", None, position=1)
        _video("other", "우승 #십이수 덱 - 유희왕 플레이 영상", t0 + timedelta(days=9), position=3)

    def test_lists_only_matching_videos_newest_first_dateless_last(self):
        res = self.client.get(f"/api/deck/{self.deck.id}/videos/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual([v["video_id"] for v in body["videos"]], ["new", "old", "nodate"])
        self.assertEqual(body["channel"]["name"], "김빠방")
        old = body["videos"][1]
        self.assertEqual(old["url"], "https://www.youtube.com/watch?v=old")
        self.assertEqual(old["view_count"], 10)
        self.assertEqual(old["duration"], 700)
        self.assertTrue(old["published_at"].startswith("2026-09-01"))

    def test_unknown_deck_404(self):
        self.assertEqual(self.client.get("/api/deck/999999/videos/").status_code, 404)

    def test_detail_exposes_video_count(self):
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 3)
        empty = _create_deck(name="영상없는덱")
        self.assertEqual(self.client.get(f"/api/deck/{empty.id}/").json()["video_count"], 0)


class SyncChannelVideosTest(TestCase):
    def test_creates_updates_and_removes(self):
        _video("gone", "삭제될 영상", position=0)
        _video("kept", "옛 제목", datetime(2026, 1, 1, tzinfo=dt_timezone.utc), position=1)
        listing = lambda: [
            {"id": "fresh", "title": "새 영상 #덱 덱", "duration": 600},
            {"id": "kept", "title": "새 제목", "duration": 500},
        ]
        calls = []
        def details(vid):
            calls.append(vid)
            return {"published_at": datetime(2026, 9, 6, tzinfo=dt_timezone.utc), "view_count": 42, "duration": 601, "thumbnail_url": "https://i.ytimg.com/vi/fresh/maxresdefault.jpg"}
        created, updated, removed = sync_channel_videos(fetch_listing=listing, fetch_details=details)
        self.assertEqual((created, updated, removed), (1, 1, 1))
        self.assertEqual(calls, ["fresh"])  # existing dated rows are not refetched
        fresh = ChannelVideo.objects.get(video_id="fresh")
        self.assertEqual((fresh.position, fresh.view_count, fresh.duration), (0, 42, 601))
        self.assertEqual(fresh.published_at.date().isoformat(), "2026-09-06")
        kept = ChannelVideo.objects.get(video_id="kept")
        self.assertEqual((kept.title, kept.position), ("새 제목", 1))
        self.assertFalse(ChannelVideo.objects.filter(video_id="gone").exists())

    def test_detail_failure_still_creates_row_with_default_thumbnail(self):
        def boom(vid):
            raise RuntimeError("blocked")
        created, _, _ = sync_channel_videos(fetch_listing=lambda: [{"id": "x1", "title": "t", "duration": 30}], fetch_details=boom)
        self.assertEqual(created, 1)
        row = ChannelVideo.objects.get(video_id="x1")
        self.assertEqual(row.thumbnail_url, "https://i.ytimg.com/vi/x1/hqdefault.jpg")
        self.assertEqual(row.duration, 30)
        self.assertIsNone(row.published_at)

    def test_empty_listing_leaves_cache_untouched(self):
        _video("keep", "유지")
        with self.assertRaises(RuntimeError):
            sync_channel_videos(fetch_listing=lambda: [], fetch_details=lambda v: {})
        self.assertTrue(ChannelVideo.objects.filter(video_id="keep").exists())


class LooserTitleMatchingTest(TestCase):
    """2026-09-07: 특이점 asked for a more lenient filter so more videos show up."""

    def _match(self, deck, title):
        return [v for v in videos_for_deck(deck, [ChannelVideo(video_id="t", title=title)])]

    def test_hashtag_contained_in_deck_name(self):
        deck = _create_deck(name="천년 엑조디아")
        self.assertTrue(self._match(deck, "전설의 카드 #엑조디아 덱 - 유희왕 플레이 영상"))

    def test_hybrid_abbreviation_hashtag_resolves_each_component(self):
        a, b = _create_deck(name="섬도희"), _create_deck(name="천배룡")
        title = "접점이 없는 두 테마 #섬도천배 덱 - 유희왕 플레이 영상"
        self.assertTrue(self._match(a, title))
        self.assertTrue(self._match(b, title))

    def test_generic_piece_lets_rest_of_hashtag_resolve(self):
        deck = _create_deck(name="식물GS")
        _create_deck(name="식물족비트")  # makes '식물' prefix ambiguous → only full-key path works
        plant = _create_deck(name="식물")
        self.assertTrue(self._match(plant, "#식물링크 덱"))
        self.assertFalse(self._match(deck, "#식물링크 덱"))

    def test_ambiguous_prefix_does_not_match(self):
        tail, maid = _create_deck(name="드래곤테일"), _create_deck(name="드래곤메이드")
        self.assertFalse(self._match(tail, "돌아온 킬러 #드래그마 덱 - 유희왕 플레이 영상"))
        self.assertFalse(self._match(maid, "돌아온 킬러 #드래그마 덱 - 유희왕 플레이 영상"))

    def test_partially_decomposable_hashtag_does_not_match(self):
        deck = _create_deck(name="메탈화")
        self.assertFalse(self._match(deck, "#메탈포제 덱 - 유희왕 플레이 영상"))

    def test_prose_mention_next_to_another_hashtag_does_not_match(self):
        """2026-09-07 특이점: '맬리스' 목록에 '#제외사이킥' 영상이 섞임 — 해시태그가 분류 기준."""
        malice = _create_deck(name="M∀LICE")
        DeckAlias.objects.create(deck=malice, name="맬리스")
        psychic = _create_deck(name="제외 사이킥")
        title = "맬리스보다 강한 제외 테마? #제외사이킥 덱 - 유희왕 플레이 영상"
        self.assertFalse(self._match(malice, title))
        self.assertTrue(self._match(psychic, title))
        tiara = _create_deck(name="티아라멘츠")
        self.assertFalse(self._match(tiara, "티아라멘츠 전용 낙인 융합? #브릴퓨티아라 덱 - 유희왕 플레이 영상"))

    def test_punctuation_in_deck_name_is_ignored(self):
        """2026-09-09 특이점: '#FA' 영상이 F.A.(포뮬러 애슬리트)에 안 붙던 문제."""
        fa = _create_deck(name="F.A.")
        DeckAlias.objects.create(deck=fa, name="포뮬러 애슬리트")
        self.assertTrue(self._match(fa, "서킷의 지배자 #FA 덱 - 유희왕 플레이 영상"))
        race = _create_deck(name="R-ACE")
        self.assertTrue(self._match(race, "#RACE 덱 - 유희왕 플레이 영상"))

    def test_two_char_key_in_prose_still_ignored(self):
        deck = _create_deck(name="제왕")
        self.assertFalse(self._match(deck, "황제왕의 귀환 #크라운클랜 덱 - 유희왕 플레이 영상"))


from .models import DeckFeaturedVideo


class FeaturedVideoTest(TestCase):
    """2026-09-12 엘리스: 덱마다 영미권/일본 최다 조회 대표 영상을 걸기."""

    def setUp(self):
        self.client = APIClient()
        self.deck = _create_deck(name="대표덱")

    def test_featured_video_is_returned_and_counted(self):
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/videos/").json()["featured"], None)
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 0)
        DeckFeaturedVideo.objects.create(deck=self.deck, video_id="feat1", title="Best combo", channel="Pro Player", lang="en", view_count=120000, duration=600)
        body = self.client.get(f"/api/deck/{self.deck.id}/videos/").json()
        self.assertEqual(body["featured"]["url"], "https://www.youtube.com/watch?v=feat1")
        self.assertEqual(body["featured"]["lang_label"], "영어권")
        self.assertEqual(body["featured"]["channel"], "Pro Player")
        self.assertEqual(body["featured"]["thumbnail_url"], "https://i.ytimg.com/vi/feat1/hqdefault.jpg")
        self.assertEqual(body["videos"], [])
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 1)
