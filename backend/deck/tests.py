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
        # band 0 = {tier 0, tier 1} (2026-10-03 bands) — both deck1(tier 0) and deck2(tier 1)
        # should be candidates. Result is randomly one of them, so run multiple times
        # and confirm both names can appear.
        names_seen = set()
        for _ in range(40):
            resp = self.client.get("/api/deck/result", {"key": "strength=0"})
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
        self.assertEqual(av["s"], [0, 1, 2, 3])   # tiers 0,1,3 -> bands (0,),(0,1),(2,3)
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
        self.assertEqual(av["s"], [0, 1])   # tiers 0,1 -> bands (0,),(0,1)
        self.assertEqual(av["a"], [0, 2])
        self.assertEqual(av["sm"], [1, 3, 6])
        self.assertEqual(av["atag"], sorted([self.a1.id, self.a2.id]))
        self.assertEqual(av["t"], [0])   # answered key reflects the candidates

    def test_resolves_when_one_candidate_remains(self):
        data = self.step("d=1|t=0")
        self.assertEqual(data["candidate_count"], 1)
        self.assertTrue(data["resolved"])

    def test_strength_band_overlap(self):
        self.assertEqual(self.step("s=0")["candidate_count"], 2)   # band 0 = tiers 0,1 -> D1, D2
        self.assertEqual(self.step("s=1")["candidate_count"], 1)   # band 1 = tiers 1,2 -> D2
        self.assertEqual(self.step("s=2")["candidate_count"], 1)   # band 2 = tiers 2,3 -> D3
        self.assertEqual(self.step("s=3")["candidate_count"], 1)   # band 3 = tiers 3,4 -> D3
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
        for key, expected in (("d=1|t=0", "D2"), ("s=1", "D2"), ("sm=6", "D2"), (f"atag={self.a2.id}", "D2")):
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
        # 특이점 2026-10-03: 선택지마다 이웃한 두 단계 — 최상위·상위 / 상위·중상위 / 중상위·중하위 / 중하위·하위 / 하위·최하위
        from .models import STRENGTH_BAND_TO_TIERS
        self.assertEqual(STRENGTH_BAND_TO_TIERS, {
            0: (0, 1),
            1: (1, 2),
            2: (2, 3),
            3: (3, 4),
            4: (4, 5),
        })

    def test_tier_to_bands_covers_all_six_tiers(self):
        from .models import STRENGTH_TIER_TO_BANDS
        self.assertEqual(STRENGTH_TIER_TO_BANDS, {0: (0,), 1: (0, 1), 2: (1, 2), 3: (2, 3), 4: (3, 4), 5: (4,)})

    def test_survey_labels_match_bands(self):
        labels = [o["label"] for o in Client().get("/api/get_questions/").json()["questions"][1]["options"]]
        self.assertEqual(labels[:5], [
            "최상위~상위권의 강력한 티어 덱",
            "상위~중상위권의 준수한 덱",
            "중상위~중하위권의 무난한 덱",
            "중하위~하위권의 개성있는 덱",
            "하위~최하위권의 도전적인 덱",
        ])

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


class RecommendationDeckPoolTest(TestCase):
    """성향 테스트 추천 범위: 엔진 덱(특이점 10/3, 9/4의 엔진 제외 해제)과 신규 업데이트 덱(10/3 오후, 처음엔 뺐다가 다시 넣음) 모두 나온다."""

    def setUp(self):
        self.client = APIClient()
        self.engine = _create_deck(name="엔진", strength=0, difficulty=0, deck_type=0, art_style=0, is_engine=True)
        self.new = _create_deck(name="신규", strength=0, difficulty=0, deck_type=0, art_style=0, is_upcoming=True)

    def test_step_counts_engine_and_new_update_decks(self):
        self.assertEqual(self.client.get("/api/deck/recommend/step").json()["candidate_count"], 2)

    def test_result_can_be_either(self):
        seen = set()
        for _ in range(30):
            resp = self.client.get("/api/deck/result", {"key": "strength=0|difficulty=0|deck_type=0|art_style=0"})
            self.assertEqual(resp.status_code, 200)
            seen.add(resp.json()["name"])
        self.assertEqual(seen, {"엔진", "신규"})


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
import os
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


class CoverVersionsTest(TestCase):
    """Phones get a 320px list cover and deck pages a 960px webp instead of the multi-megabyte original (2026-10-06),
    and the versions are only rebuilt when the cover itself changes."""

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _size(self, field):
        with PILImage.open(field.path) as im:
            return im.format, im.size

    def test_save_makes_phone_and_detail_webp(self):
        deck = _create_deck(cover_image=_png((2000, 1500)))
        self.assertEqual(self._size(deck.cover_image_phone), ("WEBP", (320, 240)))
        self.assertEqual(self._size(deck.cover_image_detail), ("WEBP", (960, 720)))
        self.assertTrue(deck.cover_image_phone.path.startswith(self.media))
        self.assertTrue(deck.cover_image_detail.path.startswith(self.media))

    def test_save_makes_640_chart_cover(self):
        # The usage donut fills each slice with the deck's art, so it gets a 640px version (특이점 2026-10-10)
        deck = _create_deck(cover_image=_png((2000, 1500)))
        self.assertEqual(self._size(deck.cover_image_chart), ("WEBP", (640, 480)))
        self.assertTrue(deck.cover_image_chart.path.startswith(self.media))
        square = _create_deck(name="정사각", cover_image=_png((1079, 1079)))
        self.assertEqual(self._size(square.cover_image_chart), ("WEBP", (640, 640)))

    def test_small_original_is_not_upscaled(self):
        deck = _create_deck(cover_image=_png((300, 300)))
        self.assertEqual(self._size(deck.cover_image_phone), ("WEBP", (300, 300)))
        self.assertEqual(self._size(deck.cover_image_detail), ("WEBP", (300, 300)))
        self.assertEqual(self._size(deck.cover_image_chart), ("WEBP", (300, 300)))

    def test_counting_a_view_does_not_rebuild_covers(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        paths = [deck.cover_image_small.path, deck.cover_image_list.path, deck.cover_image_phone.path, deck.cover_image_detail.path, deck.cover_image_chart.path]
        os.utime(deck.cover_image.path, (500_000, 500_000))
        for p in paths:
            os.utime(p, (1_000_000, 1_000_000))
        deck.num_views += 1
        deck.save(update_fields=["num_views"])
        deck.name = "이름만 바꿈"
        deck.save()
        self.assertEqual([os.path.getmtime(p) for p in paths], [1_000_000] * 5)

    def test_new_cover_rebuilds_versions(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        deck.cover_image = _png((640, 480))
        deck.save()
        self.assertEqual(self._size(deck.cover_image_detail), ("WEBP", (640, 480)))
        self.assertEqual(self._size(deck.cover_image_phone), ("WEBP", (320, 240)))

    def test_missing_version_is_rebuilt_on_save(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        os.remove(deck.cover_image_detail.path)
        deck.save()
        self.assertTrue(os.path.exists(deck.cover_image_detail.path))

    def test_apis_serve_the_versions(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        row = Client().get("/api/deck/").json()["decks"][0]
        self.assertEqual(row["cover_image"], deck.cover_image_list.url)
        self.assertEqual(row["cover_image_phone"], deck.cover_image_phone.url)
        data = Client().get(f"/api/deck/{deck.id}/").json()
        self.assertEqual(data["cover_image_detail"], deck.cover_image_detail.url)
        popular = Client().get("/api/deck/popular/?limit=1").json()["decks"][0]
        self.assertEqual(popular["cover_image_phone"], deck.cover_image_phone.url)

    def test_result_serves_detail_cover(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        data = Client().get("/api/deck/result", {"key": "strength=0"}).json()
        self.assertEqual(data["cover_image_detail"], deck.cover_image_detail.url)

    def test_deck_without_versions_falls_back(self):
        deck = _create_deck(cover_image=_png((800, 800)))
        Deck.objects.filter(id=deck.id).update(cover_image_phone=None, cover_image_detail=None)
        row = Client().get("/api/deck/").json()["decks"][0]
        self.assertEqual(row["cover_image_phone"], deck.cover_image_list.url)
        data = Client().get(f"/api/deck/{deck.id}/").json()
        self.assertEqual(data["cover_image_detail"], deck.cover_image.url)


import json
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

    def test_parse_keeps_only_draw_search_levels(self):
        data = parse_archive(self.text)
        self.assertEqual(list(data), [self.deck.id])
        d = data[self.deck.id]
        # 특이점 2026-10-02: 드롤·증식의 G·마루챠미 같은 잔존계 정보만 남김 — 패트랩별 카드·순위·이유는 mdarchive에서
        self.assertEqual(d["overview"], [
            {"t": "droll", "short": "드롤", "level": "high", "label": "아픔"},
            {"t": "maxxc", "short": "증식의 G", "level": "conditional", "label": "할만함"},
        ])
        self.assertNotIn("sections", d)
        self.assertNotIn("말라바리즘", json.dumps(d, ensure_ascii=False))
        self.assertEqual(d["source_url"], f"https://mdarchive.pages.dev/#hyeol/ygo-{self.deck.id}")

    def test_api_serves_stored_summary_and_detail_flags_it(self):
        self.assertEqual(store_archive(parse_archive(self.text)), 1)
        from card.models import Card
        Card.objects.create(card_id="9414502100", konami_id="9279", name="Droll & Lock Bird", korean_name="드롤 & 로크 버드",
                            card_illust="card_illusts/9414502100_illust.jpg")
        body = APIClient().get(f"/api/deck/{self.deck.id}/hyeol/").json()
        self.assertEqual(body["overview"][0]["label"], "아픔")
        # 엘리스 2026-10-02: 잔존계 패 트랩마다 카드 그림과 전체 카드 이름
        self.assertEqual(body["overview"][0]["name"], "드롤 & 로크 버드")
        self.assertEqual(body["overview"][0]["image"], "/media/card_illusts/9414502100_illust.jpg")
        self.assertEqual(body["overview"][1]["name"], "증식의 G")
        self.assertIsNone(body["overview"][1]["image"])
        self.assertTrue(APIClient().get(f"/api/deck/{self.deck.id}/").json()["has_hyeol"])

    def test_deck_without_data(self):
        self.assertEqual(APIClient().get(f"/api/deck/{self.deck.id}/hyeol/").status_code, 404)
        self.assertFalse(APIClient().get(f"/api/deck/{self.deck.id}/").json()["has_hyeol"])


class EditDeckInfoTest(TestCase):
    """특이점 2026-10-03: 운영자가 덱 문서에서 스탯과 덱 정보(파워·난이도·태그 등)를 바로 고친다."""

    def setUp(self):
        self.client = APIClient()
        self.fusion = SummoningMethod.objects.create(id=1, method=1)
        self.link = SummoningMethod.objects.create(id=6, method=6)
        self.combo_tag = PerformanceTag.objects.create(name="원턴킬")
        self.grave_tag = PerformanceTag.objects.create(name="묘지소환")
        self.dragon_tag = AestheticTag.objects.create(name="드래곤")
        self.deck = _create_deck(name="수정덱", strength=1, stat_consistency=5)
        self.deck.summoning_methods.add(self.fusion)
        self.deck.performance_tags.add(self.combo_tag)
        self.url = f"/api/deck/{self.deck.id}/edit/"
        self.staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234")
        self.staff.is_staff = True
        self.staff.save()

    def test_staff_gets_current_values_and_options(self):
        self.client.force_authenticate(user=self.staff)
        body = self.client.get(self.url).json()
        self.assertEqual(body["values"]["strength"], 1)
        self.assertEqual(body["values"]["summoning_methods"], [1])
        self.assertEqual(body["values"]["performance_tags"], ["원턴킬"])
        self.assertEqual(body["values"]["stats"]["consistency"], 5)
        self.assertIsNone(body["values"]["stats"]["recovery"])
        self.assertIn({"value": 2, "label": "중상위권"}, body["options"]["strength"])
        self.assertIn({"value": 6, "label": "링크"}, body["options"]["summoning_methods"])
        self.assertEqual(body["options"]["performance_tags"], ["원턴킬", "묘지소환"])
        self.assertEqual(body["options"]["aesthetic_tags"], ["드래곤"])

    def test_staff_updates_info_and_stats(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.put(self.url, data={
            "strength": 2, "difficulty": 2, "deck_type": 3, "art_style": 4, "is_engine": True,
            "summoning_methods": [6], "performance_tags": ["묘지소환"], "aesthetic_tags": ["드래곤"],
            "stats": {"consistency": 7, "breakthrough": 11, "interruption": 0, "recovery": None, "deck_space": 3},
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        self.deck.refresh_from_db()
        self.assertEqual((self.deck.strength, self.deck.difficulty, self.deck.deck_type, self.deck.art_style), (2, 2, 3, 4))
        self.assertTrue(self.deck.is_engine)
        self.assertEqual(list(self.deck.summoning_methods.values_list("method", flat=True)), [6])
        self.assertEqual(list(self.deck.performance_tags.values_list("name", flat=True)), ["묘지소환"])
        self.assertEqual(list(self.deck.aesthetic_tags.values_list("name", flat=True)), ["드래곤"])
        self.assertEqual(
            (self.deck.stat_consistency, self.deck.stat_breakthrough, self.deck.stat_interruption,
             self.deck.stat_recovery, self.deck.stat_deck_space),
            (7, 11, 0, None, 3),
        )
        # 응답은 덱 문서와 같은 모양이라 화면을 바로 갱신할 수 있다
        self.assertEqual(resp.json()["deck"]["strength"], "중상위권")
        self.assertEqual(resp.json()["deck"]["stats"]["breakthrough"], 11)

    def test_partial_update_leaves_other_fields(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.put(self.url, data={"stats": {"recovery": 4}}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.deck.refresh_from_db()
        self.assertEqual((self.deck.stat_recovery, self.deck.stat_consistency, self.deck.strength), (4, 5, 1))
        self.assertEqual(list(self.deck.performance_tags.values_list("name", flat=True)), ["원턴킬"])

    def test_invalid_values_change_nothing(self):
        self.client.force_authenticate(user=self.staff)
        for bad in (
            {"strength": 9, "stats": {"consistency": 8}},
            {"difficulty": "어려움"},
            {"is_engine": "yes"},
            {"stats": {"consistency": 12}},
            {"stats": {"consistency": -1}},
            {"stats": {"power": 3}},
            {"summoning_methods": [42]},
            {"performance_tags": ["없는 태그"]},
        ):
            resp = self.client.put(self.url, data=bad, format="json")
            self.assertEqual(resp.status_code, 400, bad)
        self.deck.refresh_from_db()
        self.assertEqual((self.deck.strength, self.deck.stat_consistency), (1, 5))

    def test_change_is_logged_with_old_and_new_values(self):
        from django.contrib.admin.models import LogEntry
        self.client.force_authenticate(user=self.staff)
        self.client.put(self.url, data={"strength": 3, "stats": {"consistency": 6}}, format="json")
        entry = LogEntry.objects.get(object_id=str(self.deck.id))
        self.assertEqual(entry.user, self.staff)
        self.assertIn("덱 파워 상위권 → 중하위권", entry.change_message)
        self.assertIn("안정성 5 → 6", entry.change_message)

    def test_unchanged_save_logs_nothing(self):
        from django.contrib.admin.models import LogEntry
        self.client.force_authenticate(user=self.staff)
        self.client.put(self.url, data={"strength": 1, "summoning_methods": [1]}, format="json")
        self.assertFalse(LogEntry.objects.exists())

    def test_non_staff_cannot_read_or_edit(self):
        user = User.objects.create_user(email="user@test.com", username="user", password="pass1234")
        self.client.force_authenticate(user=user)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.put(self.url, data={"strength": 0}, format="json").status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.put(self.url, data={"strength": 0}, format="json").status_code, (401, 403))
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.strength, 1)


class CreateDeckTest(TestCase):
    """특이점 2026-10-03: 운영진이 관리자 페이지가 아니라 도감에서 바로 새 덱을 추가하고, 이름·별칭·대표 이미지도 고친다."""

    def setUp(self):
        from django.contrib.admin.models import LogEntry  # noqa: F401 (ensures app is loaded)
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.client = APIClient()
        self.fusion = SummoningMethod.objects.create(id=1, method=1)
        self.link = SummoningMethod.objects.create(id=6, method=6)
        PerformanceTag.objects.create(name="원턴킬")
        AestheticTag.objects.create(name="드래곤")
        self.existing = _create_deck(name="기존덱")
        DeckAlias.objects.create(deck=self.existing, name="기존별칭")
        self.staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234")
        self.staff.is_staff = True
        self.staff.save()
        self.client.force_authenticate(user=self.staff)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _payload(self, **over):
        data = {
            "name": "새덱", "aliases": ["새 별칭", "뉴덱"], "description": "짧은 설명.",
            "strength": 3, "difficulty": 1, "deck_type": 0, "art_style": 2, "is_engine": False,
            "summoning_methods": [6], "performance_tags": ["원턴킬"], "aesthetic_tags": ["드래곤"],
            "stats": {"consistency": 5, "breakthrough": 4, "interruption": 6, "recovery": 3, "deck_space": 11},
        }
        data.update(over)
        return data

    def _post(self, data, cover=None):
        body = {"data": _json.dumps(data, ensure_ascii=False)}
        if cover is not None:
            body["cover_image"] = cover
        return self.client.post("/api/deck/create/", body, format="multipart")

    def test_options_for_a_new_deck(self):
        body = self.client.get("/api/deck/create/").json()
        self.assertIn({"value": 6, "label": "링크"}, body["options"]["summoning_methods"])
        self.assertEqual(body["options"]["performance_tags"], ["원턴킬"])
        self.assertEqual(body["values"]["name"], "")
        self.assertEqual(body["values"]["aliases"], [])

    def test_staff_creates_deck_with_cover(self):
        from django.contrib.admin.models import LogEntry, ADDITION
        res = self._post(self._payload(), cover=_png((900, 900)))
        self.assertEqual(res.status_code, 201, res.content)
        deck = Deck.objects.get(name="새덱")
        self.assertEqual(res.json()["deck"]["id"], deck.id)
        self.assertEqual((deck.strength, deck.difficulty, deck.deck_type, deck.art_style), (3, 1, 0, 2))
        self.assertEqual(list(deck.summoning_methods.values_list("method", flat=True)), [6])
        self.assertEqual(sorted(deck.aliases.values_list("name", flat=True)), ["뉴덱", "새 별칭"])
        self.assertEqual((deck.stat_interruption, deck.stat_deck_space), (6, 11))
        self.assertEqual(deck.description, "짧은 설명.")
        self.assertTrue(deck.cover_image_list.path.startswith(self.media))
        with PILImage.open(deck.cover_image_list.path) as im:
            self.assertEqual(im.size, (480, 480))
        self.assertTrue(LogEntry.objects.filter(object_id=str(deck.id), action_flag=ADDITION, user=self.staff).exists())
        names = [d["name"] for d in Client().get("/api/deck/").json()["decks"]]
        self.assertIn("새덱", names)

    def test_cover_is_optional(self):
        self.assertEqual(self._post(self._payload(name="이미지없는덱")).status_code, 201)

    def test_invalid_input_creates_nothing(self):
        cases = [
            self._payload(name=""),
            self._payload(name="기존덱"),
            self._payload(aliases=["기존별칭"]),
            self._payload(strength=None),
            self._payload(summoning_methods=[]),
            self._payload(stats={"consistency": 12}),
        ]
        for data in cases:
            self.assertEqual(self._post(data).status_code, 400, data)
        bad_image = SimpleUploadedFile("cover.png", b"not an image", content_type="image/png")
        self.assertEqual(self._post(self._payload(name="그림오류"), cover=bad_image).status_code, 400)
        self.assertEqual(Deck.objects.count(), 1)

    def test_non_staff_cannot_create(self):
        user = User.objects.create_user(email="user@test.com", username="user", password="pass1234")
        self.client.force_authenticate(user=user)
        self.assertEqual(self._post(self._payload()).status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertIn(self._post(self._payload()).status_code, (401, 403))
        self.assertEqual(Deck.objects.count(), 1)

    def test_edit_name_aliases_and_short_description(self):
        url = f"/api/deck/{self.existing.id}/edit/"
        values = self.client.get(url).json()["values"]
        self.assertEqual((values["name"], values["aliases"]), ("기존덱", ["기존별칭"]))
        res = self.client.put(url, {"name": "고친덱", "aliases": ["새별칭"], "description": "고친 설명"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.existing.refresh_from_db()
        self.assertEqual(self.existing.name, "고친덱")
        self.assertEqual(list(self.existing.aliases.values_list("name", flat=True)), ["새별칭"])
        self.assertEqual(self.existing.description, "고친 설명")
        other = _create_deck(name="다른덱")
        self.assertEqual(self.client.put(f"/api/deck/{other.id}/edit/", {"name": "고친덱"}, format="json").status_code, 400)

    def test_replace_cover(self):
        url = f"/api/deck/{self.existing.id}/cover/"
        res = self.client.post(url, {"cover_image": _png((600, 600))}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.existing.refresh_from_db()
        self.assertTrue(self.existing.cover_image.path.startswith(self.media))
        self.assertTrue(self.existing.cover_image_list)
        self.assertEqual(res.json()["deck"]["cover_image"], self.existing.cover_image.url)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.post(url, {"cover_image": _png((600, 600))}, format="multipart").status_code, (401, 403))


class DeckUpcomingFlagTest(TestCase):
    """특이점 2026-10-03: 새로 업데이트된 덱을 '신규 업데이트'(파란 U)로 표시하고 거를 수 있게 한다 (처음 이름은 '업데이트 예정')."""

    def setUp(self):
        self.client = APIClient()
        SummoningMethod.objects.create(id=6, method=6)
        self.released = _create_deck(name="출시덱")
        self.upcoming = _create_deck(name="예정덱", is_upcoming=True)
        self.staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234")
        self.staff.is_staff = True
        self.staff.save()

    def test_default_is_false(self):
        self.assertFalse(Deck.objects.get(id=self.released.id).is_upcoming)

    def test_list_and_detail_expose_flag(self):
        decks = {d["name"]: d for d in self.client.get("/api/deck/").json()["decks"]}
        self.assertTrue(decks["예정덱"]["is_upcoming"])
        self.assertFalse(decks["출시덱"]["is_upcoming"])
        self.assertTrue(self.client.get(f"/api/deck/{self.upcoming.id}/").json()["is_upcoming"])

    def test_staff_toggles_flag_and_it_is_logged(self):
        from django.contrib.admin.models import LogEntry
        self.client.force_authenticate(user=self.staff)
        url = f"/api/deck/{self.upcoming.id}/edit/"
        self.assertTrue(self.client.get(url).json()["values"]["is_upcoming"])
        self.assertEqual(self.client.put(url, {"is_upcoming": False}, format="json").status_code, 200)
        self.upcoming.refresh_from_db()
        self.assertFalse(self.upcoming.is_upcoming)
        self.assertIn("신규 업데이트 예 → 아니요", LogEntry.objects.get(object_id=str(self.upcoming.id)).change_message)
        self.assertEqual(self.client.put(url, {"is_upcoming": "yes"}, format="json").status_code, 400)

    def test_new_deck_can_be_marked_upcoming(self):
        self.client.force_authenticate(user=self.staff)
        data = {"name": "신규예정", "strength": 2, "difficulty": 1, "deck_type": 0, "art_style": 0,
                "summoning_methods": [6], "is_upcoming": True}
        res = self.client.post("/api/deck/create/", {"data": _json.dumps(data)}, format="multipart")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(Deck.objects.get(name="신규예정").is_upcoming)
        self.assertTrue(res.json()["deck"]["is_upcoming"])



class PopularDecksTest(TestCase):
    """The home page's deck pillar: the most-viewed decks with a cover, and how many decks the book holds."""

    def setUp(self):
        self.client = Client()
        # Covers are set with update(): Deck.save() would open the image files to make thumbnails.
        for i, views in enumerate([5, 50, 20, 0, 90]):
            d = _create_deck(name=f"덱{i}", num_views=views)
            Deck.objects.filter(id=d.id).update(cover_image=f"deck_covers/{i}.png")
        _create_deck(name="표지 없음", num_views=999)
        up = _create_deck(name="신규 업데이트", num_views=500, is_upcoming=True)
        Deck.objects.filter(id=up.id).update(cover_image="deck_covers/up.png")

    def test_most_viewed_first_with_covers_only(self):
        body = self.client.get("/api/deck/popular/?limit=3").json()
        # 신규 업데이트 덱 are out already (특이점 2026-10-07), so they take part like any other deck
        self.assertEqual([d["name"] for d in body["decks"]], ["신규 업데이트", "덱4", "덱1"])
        self.assertTrue(all(d["cover_image"] for d in body["decks"]))
        self.assertEqual(set(body["decks"][0]), {"id", "name", "cover_image", "cover_image_phone"})

    def test_total_counts_every_deck_in_the_book(self):
        self.assertEqual(self.client.get("/api/deck/popular/").json()["total"], 7)

    def test_limit_is_bounded(self):
        self.assertEqual(len(self.client.get("/api/deck/popular/?limit=999").json()["decks"]), 6)
        self.assertEqual(len(self.client.get("/api/deck/popular/?limit=x").json()["decks"]), 6)


class EditorRoleTest(TestCase):
    """Editors (User.is_editor, 2026-10-10) may edit the deck book and nothing else staff can do."""

    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.client = APIClient()
        SummoningMethod.objects.create(id=6, method=6)
        PerformanceTag.objects.create(name="원턴킬")
        AestheticTag.objects.create(name="드래곤")
        self.deck = _create_deck(name="편집덱")
        self.editor = User.objects.create_user(email="editor@test.com", username="editor", password="pass1234")
        self.editor.is_editor = True
        self.editor.save()
        self.user = User.objects.create_user(email="plain@test.com", username="plain", password="pass1234")

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _edits(self):
        info = {
            "strength": 2, "difficulty": 1, "deck_type": 0, "art_style": 1, "is_engine": False,
            "summoning_methods": [6], "performance_tags": ["원턴킬"], "aesthetic_tags": ["드래곤"],
            "stats": {"consistency": 5, "breakthrough": 4, "interruption": 6, "recovery": 3, "deck_space": 2},
        }
        new = dict(info, name="새편집덱", aliases=[], description="설명.")
        return [
            self.client.put(f"/api/deck/{self.deck.id}/update_wiki/", {"wiki_content": "<p>고침</p>"}, format="json"),
            self.client.get(f"/api/deck/{self.deck.id}/edit/"),
            self.client.put(f"/api/deck/{self.deck.id}/edit/", info, format="json"),
            self.client.post(f"/api/deck/{self.deck.id}/cover/", {"cover_image": _png((600, 600))}, format="multipart"),
            self.client.post("/api/deck/create/", {"data": _json.dumps(new, ensure_ascii=False)}, format="multipart"),
        ]

    def test_editor_can_edit_the_deck_book(self):
        self.client.force_authenticate(user=self.editor)
        self.assertEqual([r.status_code for r in self._edits()], [200, 200, 200, 200, 201])
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.wiki_content, "<p>고침</p>")
        self.assertTrue(Deck.objects.filter(name="새편집덱").exists())

    def test_plain_user_cannot(self):
        self.client.force_authenticate(user=self.user)
        self.assertEqual({r.status_code for r in self._edits()}, {403})

    def test_editor_gets_nothing_else_staff_has(self):
        self.client.force_authenticate(user=self.editor)
        self.assertEqual(self.client.get("/api/analytics/summary/").status_code, 403)
        me = self.client.get("/api/is_admin/").json()
        self.assertEqual(me, {"is_admin": False, "can_edit_dex": True})

    def test_staff_still_can(self):
        staff = User.objects.create_user(email="s2@test.com", username="s2", password="pass1234", is_staff=True)
        self.client.force_authenticate(user=staff)
        self.assertEqual(self.client.get("/api/is_admin/").json(), {"is_admin": True, "can_edit_dex": True})
        self.assertEqual(self.client.put(f"/api/deck/{self.deck.id}/update_wiki/", {"wiki_content": "x"}, format="json").status_code, 200)
