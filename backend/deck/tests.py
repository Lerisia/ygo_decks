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
from .models import DeckFeaturedVideo


class FeaturedVideoTest(TestCase):
    """2026-09-12 엘리스: 덱마다 영미권/일본 최다 조회 대표 영상을 걸기."""

    def setUp(self):
        self.client = APIClient()
        self.deck = _create_deck(name="대표덱")

    def test_featured_video_is_returned_and_counted(self):
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/videos/").json()["featured"], None)
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 0)
        DeckFeaturedVideo.objects.create(deck=self.deck, video_id="feat1", title="Best combo", channel="Pro Player", lang="en", view_count=120000, duration=600, published_at=datetime(2026, 5, 3).date())
        body = self.client.get(f"/api/deck/{self.deck.id}/videos/").json()
        self.assertEqual(body["featured"]["url"], "https://www.youtube.com/watch?v=feat1")
        self.assertEqual(body["featured"]["lang_label"], "영어권")
        self.assertEqual(body["featured"]["channel"], "Pro Player")
        self.assertEqual(body["featured"]["published_at"], "2026-05-03")
        self.assertEqual(body["featured"]["thumbnail_url"], "https://i.ytimg.com/vi/feat1/hqdefault.jpg")
        self.assertNotIn("videos", body)
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 1)


from .models import DeckNote


class DeckNotesTest(TestCase):
    """2026-09-12 엘리스: 덱별 한국어 강의노트 섹션 (유료 표시 포함)."""

    def setUp(self):
        self.client = APIClient()
        self.deck = _create_deck(name="노트덱")

    def test_free_notes_listed_paid_and_inactive_hidden(self):
        """2026-09-13 특이점: 유료 노트는 도감에 노출하지 않음(데이터는 유지)."""
        DeckNote.objects.create(deck=self.deck, title="입문 노트", author="A", url="https://www.postype.com/@a/post/1", source="postype", is_paid=True, price="3,000원", published_at=datetime(2026, 4, 1).date(), sort_order=1)
        DeckNote.objects.create(deck=self.deck, title="정보글 모음", author="B", url="https://gall.dcinside.com/mgallery/board/view/?id=x&no=1", source="dcinside", published_at=datetime(2026, 3, 1).date(), sort_order=0)
        DeckNote.objects.create(deck=self.deck, title="숨김", url="https://example.com/x", is_active=False)
        body = self.client.get(f"/api/deck/{self.deck.id}/notes/").json()
        self.assertEqual([n["title"] for n in body["notes"]], ["정보글 모음"])
        free = body["notes"][0]
        self.assertFalse(free["is_paid"]); self.assertEqual(free["source_label"], "디시인사이드"); self.assertEqual(free["published_at"], "2026-03-01")
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["note_count"], 1)

    def test_unknown_deck_404(self):
        self.assertEqual(self.client.get("/api/deck/999999/videos/").status_code, 404)

    def test_series_parts_come_together_and_count_once(self):
        """2026-10-01 특이점: 1편·2편·3편으로 나눠 올린 공략은 하나의 공략으로 묶어 보여 줌."""
        base = "https://gall.dcinside.com/mgallery/board/view/?id=masterduel&no="
        for part, label in [(2, "범용마함1"), (1, "버제스토마")]:
            DeckNote.objects.create(deck=self.deck, title=f"버제스토마란 무엇일까…{part}편", author="M", url=f"{base}{part}",
                                    source="dcinside", series="버제스토마란 무엇일까…", part=part, part_label=label)
        DeckNote.objects.create(deck=self.deck, title="단편 공략", url=f"{base}9", source="dcinside")
        notes = self.client.get(f"/api/deck/{self.deck.id}/notes/").json()["notes"]
        parts = [n for n in notes if n["series"]]
        self.assertEqual([(n["part"], n["part_label"]) for n in parts], [(1, "버제스토마"), (2, "범용마함1")])
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["note_count"], 2)

    def test_detail_video_count_ignores_channel_videos(self):
        """2026-09-12 엘리스: 김빠방·한국 유튜버 영상은 버튼 활성 기준에서 제외."""
        self.assertEqual(self.client.get(f"/api/deck/{self.deck.id}/").json()["video_count"], 0)


from .models import DeckFeaturedVideo




class UntaggedDeckSaveTest(TestCase):
    """2026-09-13 특이점: '해당 없음' 태그를 없앤 뒤 관리자에서 태그 없이 저장하면 오류가 나던 문제."""

    def test_admin_form_accepts_empty_tag_selection(self):
        from django.forms import modelform_factory
        deck = _create_deck(name="무태그덱")
        Form = modelform_factory(Deck, fields=["name", "performance_tags", "aesthetic_tags"])
        form = Form({"name": "무태그덱", "performance_tags": [], "aesthetic_tags": []}, instance=deck)
        self.assertTrue(form.is_valid(), form.errors)
        form.save()
        deck.refresh_from_db()
        self.assertEqual(deck.performance_tags.count(), 0)


import io
import shutil
import tempfile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image as PILImage


def _png(size):
    buf = io.BytesIO()
    PILImage.new("RGB", size, (200, 30, 30)).save(buf, "PNG")
    return SimpleUploadedFile("cover.png", buf.getvalue(), content_type="image/png")


class ListCoverImageTest(TestCase):
    """The deck database list shows a 480px thumbnail scaled down from the original, never the 200px one stretched up."""

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def test_save_makes_list_thumbnail_from_original(self):
        deck = _create_deck(cover_image=_png((1024, 1024)))
        self.assertTrue(deck.cover_image_list)
        with PILImage.open(deck.cover_image_list.path) as im:
            self.assertEqual(im.size, (480, 480))
        self.assertTrue(deck.cover_image_list.path.startswith(self.media))
        self.assertTrue(deck.cover_image_small.path.startswith(self.media))

    def test_small_original_is_not_upscaled(self):
        deck = _create_deck(cover_image=_png((375, 375)))
        with PILImage.open(deck.cover_image_list.path) as im:
            self.assertEqual(im.size, (375, 375))

    def test_list_api_serves_list_thumbnail(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        data = Client().get("/api/deck/").json()["decks"][0]
        self.assertEqual(data["cover_image"], deck.cover_image_list.url)

    def test_detail_keeps_original(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        data = Client().get(f"/api/deck/{deck.id}/").json()
        self.assertEqual(data["cover_image"], deck.cover_image.url)


import json as _json
from .hyeol import parse_archive, store_archive
from .models import DeckHyeol

_ARCHIVE = "window.HYEOL_V2 = " + _json.dumps({
    "meta": {"report_date": "2026-09-29"},
    "handtraps": [
        {"id": "droll", "name": "드롤 & 로크 버드", "short": "드롤", "group": "draw_search"},
        {"id": "maxxc", "name": "증식의 G", "short": "G", "group": "draw_search"},
        {"id": "ash", "name": "하루 우라라", "short": "우라라", "group": "handtrap"},
        {"id": "ogre", "name": "유령토끼", "short": "토끼", "group": "handtrap"},
        {"id": "gamma", "name": "PSY프레임기어 감마", "short": "감마", "group": "handtrap"},
    ],
    "cards": {"22570": {"n": "크라운 클랜 『말라바리즘』", "desc": "①: 덱에서 특수 소환한다."}},
    "decks": {
        "ygo-{ID}": {"report_deck": "혈자리덱", "curated_at": "2026-09-29", "admin_saved_at": "2026-09-30T23:58:29", "stale": False,
                     "legacy_view": {
                         "overview": [{"t": "droll", "level": "high", "label": "아픔", "note": "엔진 안에 드롤 대처가 없음"},
                                      {"t": "maxxc", "level": "conditional", "label": "할만함", "note": ""}],
                         "sections": [{"handtrap": "ash", "name": "하루우라라 · 퍼지", "hint": "서치·덱 특소", "note": "",
                                       "cards": [{"sev": "Y", "card": 22571, "label": "두 번째", "timing": "", "text": "후속"},
                                                 {"sev": "R", "card": 22570, "label": "", "timing": "우라라 1순위", "text": "2체 특소를 막음", "basis": "SOURCE"}]},
                                      {"handtrap": "ogre", "name": "유령토끼", "cards": [{"sev": "R", "card": 22570, "text": "파괴"}]},
                                      {"handtrap": "gamma", "name": "PSY프레임기어 감마", "cards": [{"sev": "Y", "card": 22570, "text": "무효"}]}]}},
        "namu-abc": {"report_deck": "도감에 없는 덱", "legacy_view": {"overview": [], "sections": []}},
    },
}, ensure_ascii=False) + ";\r\n"


class DeckHyeolTest(TestCase):
    """2026-10-02 특이점: 듀얼 아카이브(Hort)의 혈자리 자료를 덱 문서에 요약해 보여 줌 (허락받음)."""

    def setUp(self):
        self.deck = _create_deck(name="혈자리덱")
        self.text = _ARCHIVE.replace("{ID}", str(self.deck.id))

    def test_parse_keeps_only_our_decks_and_orders_cards_by_priority(self):
        data = parse_archive(self.text)
        self.assertEqual(list(data), [self.deck.id])
        d = data[self.deck.id]
        self.assertEqual(d["overview"][0]["short"], "드롤")
        cards = d["sections"][0]["cards"]
        self.assertEqual([c["sev"] for c in cards], ["R", "Y"])
        self.assertEqual(cards[0]["name"], "크라운 클랜 『말라바리즘』")   # empty label falls back to the card table
        self.assertEqual(d["source_url"], f"https://mdarchive.pages.dev/#hyeol/ygo-{self.deck.id}")
        # 특이점 2026-10-02: 크로우·비스테드, 메타 카드, 감마는 빼고, 토끼는 '유령토끼'로
        self.assertEqual([s["short"] for s in d["sections"]], ["우라라", "유령토끼"])
        self.assertEqual([o["short"] for o in d["overview"]], ["드롤", "증식의 G"])

    def test_api_serves_stored_summary_and_detail_flags_it(self):
        self.assertEqual(store_archive(parse_archive(self.text)), 1)
        body = APIClient().get(f"/api/deck/{self.deck.id}/hyeol/").json()
        self.assertEqual(body["sections"][0]["cards"][0]["timing"], "우라라 1순위")
        self.assertTrue(APIClient().get(f"/api/deck/{self.deck.id}/").json()["has_hyeol"])

    def test_deck_without_data(self):
        self.assertEqual(APIClient().get(f"/api/deck/{self.deck.id}/hyeol/").status_code, 404)
        self.assertFalse(APIClient().get(f"/api/deck/{self.deck.id}/").json()["has_hyeol"])
