import os
import tempfile
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase, override_settings, SimpleTestCase
from django.utils import timezone
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from PIL import Image as PILImage
from io import BytesIO, StringIO
from django.core.files.base import ContentFile
from .models import Card, UploadRecord, QuizHighScore, QuizAllTimeBest, QuizMonthlyAward, QuizWeeklyAward
from user.models import User


class CardBoxTest(SimpleTestCase):
    """Which boxes the deck scanner's detector finds are cropped as cards (detector v2, 엘리스 10/11)."""

    def test_keep_card_box(self):
        from card.crop import CARD_CONF, keep_card_box
        self.assertTrue(keep_card_box((0, 0, 70, 100), 0.93))
        self.assertFalse(keep_card_box((0, 0, 70, 100), CARD_CONF - 0.01))   # other games' cards, badges
        self.assertFalse(keep_card_box((0, 0, 10, 14), 0.99))               # too small to cut the art from
        self.assertFalse(keep_card_box((0, 0, 20, 100), 0.99))              # a sliver at the screen's edge
        self.assertTrue(keep_card_box((0, 0, 70, 100), 0.85, min_conf=0.8))

    def test_detector_settings(self):
        from card.crop import detector_settings
        self.assertEqual(detector_settings({0: "card"}, {"imgsz": 640}), (0, 640))
        names = {0: "card", 1: "deck_panel", 2: "head_main", 3: "head_extra", 4: "head_side"}
        self.assertEqual(detector_settings(names, {"imgsz": 1024}), (0, 1024))
        self.assertEqual(detector_settings({0: "deck_panel", 1: "card"}, {}), (1, 640))


class CleanupUploadsTest(TestCase):
    def _create_upload(self, days_ago=0):
        img = SimpleUploadedFile("test.jpg", b"\xff\xd8\xff\xe0", content_type="image/jpeg")
        record = UploadRecord.objects.create(uploaded_image=img)
        record.detected_at = timezone.now() - timedelta(days=days_ago)
        record.save(update_fields=["detected_at"])
        return record

    def test_deletes_old_uploads(self):
        old = self._create_upload(days_ago=8)
        old_path = old.uploaded_image.path

        call_command("cleanup_uploads")

        self.assertFalse(UploadRecord.objects.filter(id=old.id).exists())
        self.assertFalse(os.path.exists(old_path))

    def test_keeps_recent_uploads(self):
        recent = self._create_upload(days_ago=3)

        call_command("cleanup_uploads")

        self.assertTrue(UploadRecord.objects.filter(id=recent.id).exists())

    def test_deletes_uploads_at_boundary(self):
        boundary = self._create_upload(days_ago=7)

        call_command("cleanup_uploads")

        self.assertFalse(UploadRecord.objects.filter(id=boundary.id).exists())


def _create_card_with_art(name, cid):
    """A new-DB card with Master Duel art saved under the current MEDIA_ROOT."""
    from django.conf import settings
    from carddb.models import Card as NewCard, MdArt, MdPrint
    card = NewCard.objects.create(id=cid, category="monster", name_ja=name, name_ko=name, frame="normal")
    MdPrint.objects.create(md_id=cid, card=card)
    rel = f"cards/art/common/{cid}.webp"
    os.makedirs(os.path.join(settings.MEDIA_ROOT, "cards/art/common"), exist_ok=True)
    PILImage.new("RGB", (512, 512), color="red").save(os.path.join(settings.MEDIA_ROOT, rel), "WEBP")
    MdArt.objects.create(md_print_id=cid, version="common", image=rel)
    return card


class FreshArt:
    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)
        super().setUp()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class QuizNextCardTest(FreshArt, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        for i, name in enumerate(("블루아이즈", "레드아이즈", "다크매지션", "블랙매지션걸")):
            _create_card_with_art(name, 4000 + i)
        from carddb.models import Card as NewCard
        NewCard.objects.create(id=5392, category="spell", name_ja="天変地異", name_ko="천재지변", frame="spell")

    def test_returns_card_with_choices(self):
        resp = self.client.get("/api/quiz/next/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["choices"]), 4)
        self.assertNotIn("천재지변", data["choices"])
        cid = data["card_id"]
        self.assertEqual(data["images"]["original"], f"/media/cards/art/common/{cid}.webp")
        self.assertEqual(data["images"]["8x8"], f"/media/cards/quiz/8x8/{cid}.jpg")

    def test_choices_contain_correct_answer(self):
        from carddb.models import Card as NewCard
        data = self.client.get("/api/quiz/next/").json()
        self.assertIn(NewCard.objects.get(id=data["card_id"]).name_ko, data["choices"])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class QuizCheckAnswerTest(FreshArt, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        _create_card_with_art("블루아이즈", 4007)

    def test_correct_answer(self):
        resp = self.client.post("/api/quiz/check/", {"card_id": 4007, "answer": "블루아이즈"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"correct": True, "correct_answer": "블루아이즈"})

    def test_wrong_answer(self):
        resp = self.client.post("/api/quiz/check/", {"card_id": 4007, "answer": "레드아이즈"}, format="json")
        self.assertFalse(resp.json()["correct"])

    def test_missing_params(self):
        resp = self.client.post("/api/quiz/check/", {}, format="json")
        self.assertEqual(resp.status_code, 400)


class QuizScoreAndLeaderboardTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="player1", password="pass1234")
        self.user2 = User.objects.create_user(email="b@test.com", username="player2", password="pass1234")

    def test_submit_score_requires_auth(self):
        resp = self.client.post("/api/quiz/submit-score/", {"score": 10, "streak": 3}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_submit_score(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post("/api/quiz/submit-score/", {"score": 10, "streak": 3}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["is_new_record"])
        self.assertEqual(QuizHighScore.objects.count(), 1)

    def test_lower_score_not_saved(self):
        self.client.force_authenticate(user=self.user)
        self.client.post("/api/quiz/submit-score/", {"score": 20, "streak": 5}, format="json")
        resp = self.client.post("/api/quiz/submit-score/", {"score": 10, "streak": 3}, format="json")
        self.assertFalse(resp.json()["is_new_record"])
        self.assertEqual(QuizHighScore.objects.filter(user=self.user).count(), 1)

    def test_leaderboard(self):
        QuizHighScore.objects.create(user=self.user, score=20, streak=5)
        QuizHighScore.objects.create(user=self.user2, score=15, streak=4)

        resp = self.client.get("/api/quiz/leaderboard/")
        data = resp.json()["leaderboard"]
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["username"], "player1")
        self.assertEqual(data[0]["score"], 20)
        self.assertEqual(data[1]["username"], "player2")

    def test_leaderboard_includes_period(self):
        resp = self.client.get("/api/quiz/leaderboard/")
        self.assertIn("period", resp.json())

    @patch("card.quiz_views._kst_now")
    def test_leaderboard_excludes_old_month_scores_in_may(self, mock_kst_now):
        from datetime import datetime
        from django.utils import timezone as real_tz

        # Pre-cutover: May 2026 → monthly window. April scores excluded.
        mock_kst_now.return_value = datetime(2026, 5, 15, 12, 0, 0)

        old = QuizHighScore.objects.create(user=self.user, score=99, streak=10)
        old.created_at = real_tz.make_aware(datetime(2026, 4, 20, 12, 0, 0))
        old.save(update_fields=["created_at"])

        new = QuizHighScore.objects.create(user=self.user2, score=10, streak=2)
        new.created_at = real_tz.make_aware(datetime(2026, 5, 10, 12, 0, 0))
        new.save(update_fields=["created_at"])

        resp = self.client.get("/api/quiz/leaderboard/")
        body = resp.json()
        self.assertEqual(body["cadence"], "monthly")
        data = body["leaderboard"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["username"], "player2")

    @patch("card.quiz_views._kst_now")
    def test_leaderboard_uses_weekly_window_from_june_1(self, mock_kst_now):
        from datetime import datetime
        from django.utils import timezone as real_tz

        # 2026-06-03 is Wed; current week is Mon 2026-06-01 ~ Sun 2026-06-07.
        mock_kst_now.return_value = datetime(2026, 6, 3, 12, 0, 0)

        in_week = QuizHighScore.objects.create(user=self.user, score=42, streak=3)
        in_week.created_at = real_tz.make_aware(datetime(2026, 6, 2, 9, 0, 0))
        in_week.save(update_fields=["created_at"])

        # Score from Sunday 2026-05-31 (prior week) must NOT appear.
        last_week = QuizHighScore.objects.create(user=self.user2, score=200, streak=20)
        last_week.created_at = real_tz.make_aware(datetime(2026, 5, 31, 23, 0, 0))
        last_week.save(update_fields=["created_at"])

        resp = self.client.get("/api/quiz/leaderboard/")
        body = resp.json()
        self.assertEqual(body["cadence"], "weekly")
        self.assertEqual(len(body["leaderboard"]), 1)
        self.assertEqual(body["leaderboard"][0]["username"], "player1")

    def test_submit_creates_and_updates_all_time_best(self):
        self.client.force_authenticate(user=self.user)
        self.client.post("/api/quiz/submit-score/", {"score": 10, "streak": 2}, format="json")
        atb = QuizAllTimeBest.objects.get(user=self.user)
        self.assertEqual(atb.score, 10)

        # Improve → updated.
        self.client.post("/api/quiz/submit-score/", {"score": 25, "streak": 5}, format="json")
        atb.refresh_from_db()
        self.assertEqual(atb.score, 25)

        # Lower → unchanged.
        self.client.post("/api/quiz/submit-score/", {"score": 5, "streak": 1}, format="json")
        atb.refresh_from_db()
        self.assertEqual(atb.score, 25)

    @patch("card.quiz_views._kst_now")
    def test_submit_resets_weekly_after_cutover(self, mock_kst_now):
        from datetime import datetime
        from django.utils import timezone as real_tz

        self.client.force_authenticate(user=self.user)

        # First play: Wednesday 2026-06-03 in the 06-01 week. Score=30.
        mock_kst_now.return_value = datetime(2026, 6, 3, 10, 0, 0)
        self.client.post("/api/quiz/submit-score/", {"score": 30, "streak": 5}, format="json")
        best = QuizHighScore.objects.get(user=self.user)
        self.assertEqual(best.score, 30)
        # Backdate created_at so subsequent same-period checks work.
        best.created_at = real_tz.make_aware(datetime(2026, 6, 3, 10, 0, 0))
        best.save(update_fields=["created_at"])

        # Next Monday (2026-06-08, new week). A score LOWER than the prior
        # week's must still reset (this is the whole point of weekly reset).
        mock_kst_now.return_value = datetime(2026, 6, 8, 9, 0, 0)
        resp = self.client.post("/api/quiz/submit-score/", {"score": 10, "streak": 2}, format="json")
        self.assertTrue(resp.json()["is_new_record"])
        best.refresh_from_db()
        self.assertEqual(best.score, 10)

    @patch("card.quiz_views._kst_now")
    def test_submit_keeps_monthly_semantics_before_cutover(self, mock_kst_now):
        from datetime import datetime
        from django.utils import timezone as real_tz

        self.client.force_authenticate(user=self.user)

        # May 5 (week of 05-04 Mon).
        mock_kst_now.return_value = datetime(2026, 5, 5, 10, 0, 0)
        self.client.post("/api/quiz/submit-score/", {"score": 50, "streak": 8}, format="json")
        best = QuizHighScore.objects.get(user=self.user)
        best.created_at = real_tz.make_aware(datetime(2026, 5, 5, 10, 0, 0))
        best.save(update_fields=["created_at"])

        # May 25 (different week, same month). Lower score must NOT overwrite.
        mock_kst_now.return_value = datetime(2026, 5, 25, 10, 0, 0)
        resp = self.client.post("/api/quiz/submit-score/", {"score": 30, "streak": 4}, format="json")
        self.assertFalse(resp.json()["is_new_record"])
        best.refresh_from_db()
        self.assertEqual(best.score, 50)


class QuizMonthlyAwardCommandTest(TestCase):
    def setUp(self):
        self.u1 = User.objects.create_user(email="m1@t.com", username="m1", password="x")
        self.u2 = User.objects.create_user(email="m2@t.com", username="m2", password="x")
        self.u3 = User.objects.create_user(email="m3@t.com", username="m3", password="x")

    def _make_score(self, user, score, when):
        s = QuizHighScore.objects.create(user=user, score=score, streak=1)
        s.created_at = when
        s.save(update_fields=["created_at"])

    def test_may_2026_uses_special_prizes(self):
        from datetime import datetime
        may_dt = timezone.make_aware(datetime(2026, 5, 15, 12, 0, 0))
        self._make_score(self.u1, 100, may_dt)
        self._make_score(self.u2, 80, may_dt)
        self._make_score(self.u3, 60, may_dt)

        call_command("award_quiz_monthly_top3", "--year=2026", "--month=5")
        awards = list(QuizMonthlyAward.objects.filter(year=2026, month=5).order_by("rank"))
        self.assertEqual([a.points_awarded for a in awards], [1000, 500, 300])

    def test_post_may_2026_refuses(self):
        from datetime import datetime
        jun_dt = timezone.make_aware(datetime(2026, 6, 15, 12, 0, 0))
        self._make_score(self.u1, 100, jun_dt)
        call_command("award_quiz_monthly_top3", "--year=2026", "--month=6")
        self.assertEqual(QuizMonthlyAward.objects.filter(year=2026, month=6).count(), 0)


class QuizWeeklyAwardCommandTest(TestCase):
    def setUp(self):
        self.u1 = User.objects.create_user(email="w1@t.com", username="w1", password="x")
        self.u2 = User.objects.create_user(email="w2@t.com", username="w2", password="x")
        self.u3 = User.objects.create_user(email="w3@t.com", username="w3", password="x")
        self.u4 = User.objects.create_user(email="w4@t.com", username="w4", password="x")

    def _make_score(self, user, score, when):
        s = QuizHighScore.objects.create(user=user, score=score, streak=1)
        s.created_at = when
        s.save(update_fields=["created_at"])

    def test_weekly_top3_prizes_500_300_200(self):
        from datetime import datetime
        # Week of 2026-06-01 Mon ~ 2026-06-07 Sun.
        in_week = timezone.make_aware(datetime(2026, 6, 3, 10, 0, 0))
        out_of_week = timezone.make_aware(datetime(2026, 5, 31, 23, 0, 0))
        self._make_score(self.u1, 100, in_week)
        self._make_score(self.u2, 80, in_week)
        self._make_score(self.u3, 60, in_week)
        # Excluded by date — bigger score but outside the target week.
        self._make_score(self.u4, 999, out_of_week)

        call_command("award_quiz_weekly_top3", "--week-start=2026-06-01")
        rows = list(QuizWeeklyAward.objects.filter(week_start_date="2026-06-01").order_by("rank"))
        self.assertEqual([r.user_id for r in rows], [self.u1.id, self.u2.id, self.u3.id])
        self.assertEqual([r.points_awarded for r in rows], [500, 300, 200])

    def test_weekly_idempotent(self):
        from datetime import datetime
        in_week = timezone.make_aware(datetime(2026, 6, 3, 10, 0, 0))
        self._make_score(self.u1, 100, in_week)
        call_command("award_quiz_weekly_top3", "--week-start=2026-06-01")
        call_command("award_quiz_weekly_top3", "--week-start=2026-06-01")
        # Re-run should NOT duplicate.
        self.assertEqual(QuizWeeklyAward.objects.filter(week_start_date="2026-06-01").count(), 1)

    def test_week_start_must_be_monday(self):
        # Tuesday → command refuses (no rows created).
        call_command("award_quiz_weekly_top3", "--week-start=2026-06-02")
        self.assertEqual(QuizWeeklyAward.objects.count(), 0)


class QuizAllTimeBestBackfillTest(TestCase):
    """The data migration that seeds QuizAllTimeBest from QuizHighScore at
    cutover ran before this test method via Django's normal migration
    plumbing — but for explicit coverage, simulate the same behavior on the
    real models so refactors of either model stay safe."""
    def test_backfill_idempotent_one_per_user(self):
        u = User.objects.create_user(email="b1@t.com", username="b1", password="x")
        QuizHighScore.objects.create(user=u, score=77, streak=9)
        QuizAllTimeBest.objects.create(user=u, score=77, streak=9, achieved_at=timezone.now())
        # OneToOne — second insert must fail.
        with self.assertRaises(Exception):
            QuizAllTimeBest.objects.create(user=u, score=10, streak=1, achieved_at=timezone.now())


from tracker.version import MIN_SUPPORTED


class CardThumbTests(TestCase):
    """Tracker overlay thumbnails: cut once from the illustration, then served from media."""

    def test_thumb_is_generated_and_redirected(self):
        from PIL import Image
        from carddb import display
        from carddb.models import Card as NewCard, MdArt, MdPrint
        display.forget_art()
        self.addCleanup(display.forget_art)
        with tempfile.TemporaryDirectory() as media:
            with override_settings(MEDIA_ROOT=media):
                card = NewCard.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", name_ko="블랙 매지션", frame="normal")
                MdPrint.objects.create(md_id=4041, card=card)
                MdPrint.objects.create(md_id=23487, card=card, is_alt_art=True)
                os.makedirs(os.path.join(media, "cards/art/common"))
                Image.new("RGB", (512, 653), (200, 30, 30)).save(os.path.join(media, "cards/art/common/4041.webp"), "WEBP")
                MdArt.objects.create(md_print_id=4041, version="common", image="cards/art/common/4041.webp")
                res = self.client.get("/api/card-thumb/4041/?v=" + MIN_SUPPORTED)
                self.assertEqual(res.status_code, 302)
                self.assertTrue(res["Location"].endswith("/card_thumbs_md/4041_48.jpg"))
                out = os.path.join(media, "card_thumbs_md", "4041_48.jpg")
                self.assertEqual(Image.open(out).size, (48, 48))
                # an alt-art id resolves to the same base card
                self.assertEqual(self.client.get("/api/card-thumb/23487/?v=" + MIN_SUPPORTED)["Location"], res["Location"])
                self.assertEqual(self.client.get("/api/card-thumb/999999/?v=" + MIN_SUPPORTED).status_code, 404)

    def test_thumb_is_refused_to_a_build_the_site_no_longer_supports(self):
        # Builds up to 0.6.11 ask without saying who they are: refused, so an old build's card lists lose their pictures too.
        with patch("tracker.version.MIN_SUPPORTED", "0.6.12"):
            self.assertEqual(self.client.get("/api/card-thumb/4041/").status_code, 426)
            self.assertEqual(self.client.get("/api/card-thumb/4041/?v=0.6.11").status_code, 426)
            self.assertEqual(self.client.get("/api/card-thumb/4041/?v=junk").status_code, 426)
            self.assertEqual(self.client.get("/api/card-thumb/4041/?v=0.6.12").status_code, 404)   # let through: no such card here
            self.assertEqual(self.client.get("/api/card-thumb/4041/?v=0.7.0").status_code, 404)


class CardSearchThumbTests(TestCase):
    """Card search reads the new card DB: Korean names, Master Duel art (OCG original first) and 256px thumbnails."""

    def setUp(self):
        from card import views
        from carddb import display
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        views._CARD_SEARCH_INDEX = None
        display.forget_art()

    def tearDown(self):
        from card import views
        from carddb import display
        import shutil
        views._CARD_SEARCH_INDEX = None
        display.forget_art()
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def _card(self, cid, name, versions=("common",)):
        from carddb.models import Card as NewCard, MdArt, MdPrint
        card = NewCard.objects.create(id=cid, category="monster", name_ja=name, name_ko=name, frame="normal")
        MdPrint.objects.create(md_id=cid, card=card)
        for v in versions:
            rel = f"cards/art/{v}/{cid}.webp"
            os.makedirs(os.path.join(self.media, os.path.dirname(rel)), exist_ok=True)
            PILImage.new("RGB", (512, 512), (30, 90, 200)).save(os.path.join(self.media, rel), "WEBP")
            MdArt.objects.create(md_print_id=cid, version=v, image=rel)
        return card

    def test_command_makes_webp_thumbs_once(self):
        self._card(4041, "블랙 매지션")
        call_command("make_card_thumbs", stdout=open(os.devnull, "w"))
        path = os.path.join(self.media, "cards", "thumb256", "4041.webp")
        with PILImage.open(path) as im:
            self.assertEqual((im.format, im.size), ("WEBP", (256, 256)))
        os.utime(path, (2_000_000_000, 2_000_000_000))
        call_command("make_card_thumbs", stdout=open(os.devnull, "w"))
        self.assertEqual(os.path.getmtime(path), 2_000_000_000)

    def test_search_returns_new_ids_original_art_and_thumbs(self):
        self._card(4441, "워터 걸", versions=("ocg", "tcg"))
        self._card(4442, "워터 걸 2")
        call_command("make_card_thumbs", stdout=open(os.devnull, "w"))
        os.remove(os.path.join(self.media, "cards", "thumb256", "4442.webp"))
        rows = {r["name"]: r for r in self.client.get("/api/search/", {"q": "워터 걸"}).json()["results"]}
        self.assertEqual(rows["워터 걸"]["id"], 4441)
        self.assertEqual(rows["워터 걸"]["image_url"], "/media/cards/art/ocg/4441.webp")
        self.assertEqual(rows["워터 걸"]["thumb_url"], "/media/cards/thumb256/4441.webp")
        self.assertIsNone(rows["워터 걸 2"]["thumb_url"])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class DeckScannerTest(FreshArt, TestCase):
    """The identifier names each cut card by its nearest print (card/identify.py); results name the site's card, and
    a card outside Master Duel or a picture past knowing is Unknown."""

    def setUp(self):
        super().setUp()
        from carddb.models import Card as NewCard
        self.user = User.objects.create_user(email="scan@test.com", username="scanner", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        _create_card_with_art("블랙 매지션", 4041)
        NewCard.objects.create(id=5392, category="spell", name_ja="天変地異", name_ko="천재지변", frame="spell")

    @staticmethod
    def fake_crop(image_path, card_output_dir, illust_output_dir, boxed_image_path, min_conf=None):
        for i in range(3):
            PILImage.new("RGB", (10, 10)).save(os.path.join(illust_output_dir, f"illust_{i:02}.jpg"))
            PILImage.new("RGB", (10, 14)).save(os.path.join(card_output_dir, f"card_{i:02}.jpg"))
        PILImage.new("RGB", (10, 10)).save(boxed_image_path)

    def photo(self):
        buf = BytesIO()
        PILImage.new("RGB", (20, 20)).save(buf, "JPEG")
        return SimpleUploadedFile("deck.jpg", buf.getvalue(), content_type="image/jpeg")

    def test_deck_photo_names_cards_from_master_duel(self):
        from .identify import Match
        found = [Match(4041, 4041, 0.93), Match(5392, 5392, 0.9), Match(None, None, 0.31)]
        with patch("card.views.crop_cards_and_draw_boxes", side_effect=self.fake_crop), \
                patch("card.views.identify", return_value=found) as identify:
            r = self.client.post("/api/classify-deck/", {"image": self.photo()}, format="multipart")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(identify.call_args[0][0]), 3)   # the whole cut cards, in order
        self.assertEqual([x["card_name"] for x in r.json()["result"]], ["블랙 매지션", "Unknown", "Unknown"])
        self.assertEqual([x["confidence"] for x in r.json()["result"]], [93.0, 90.0, 31.0])
        # the card's id too, so a card search can open what it found (/dev/cards, 참혈 2026-10-14)
        self.assertEqual([x["card_id"] for x in r.json()["result"]], [4041, None, None])
        from .models import CardDetection
        self.assertEqual(list(CardDetection.objects.order_by("id").values_list("new_card_id", flat=True)), [4041, None, None])

    def test_guests_scan_once_per_ten_seconds_per_address(self):
        from django.core.cache import cache
        from .identify import Match
        cache.clear()
        guest, other = APIClient(REMOTE_ADDR="203.0.113.7"), APIClient(REMOTE_ADDR="203.0.113.8")
        with patch("card.views.crop_cards_and_draw_boxes", side_effect=self.fake_crop), \
                patch("card.views.identify", return_value=[Match(4041, 4041, 0.93)] * 3):
            r = guest.post("/api/classify-deck/", {"image": self.photo()}, format="multipart")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["result"][0]["card_name"], "블랙 매지션")
            self.assertEqual(guest.post("/api/classify-deck/", {"image": self.photo()}, format="multipart").status_code, 429)
            self.assertEqual(other.post("/api/classify-deck/", {"image": self.photo()}, format="multipart").status_code, 200)
        from .models import UploadRecord
        self.assertEqual(UploadRecord.objects.filter(user__isnull=True).count(), 2)

    def test_a_picture_with_no_card_found_is_read_whole(self):
        """One card filling the picture, or its art alone: the detector finds nothing, the identifier reads it all."""
        from .identify import Match

        def nothing(image_path, card_output_dir, illust_output_dir, boxed_image_path, min_conf=None):
            PILImage.new("RGB", (10, 10)).save(boxed_image_path)

        with patch("card.views.crop_cards_and_draw_boxes", side_effect=nothing), \
                patch("card.views.identify", return_value=[Match(4041, 4041, 0.88)]):
            r = self.client.post("/api/classify-deck/", {"image": self.photo()}, format="multipart")
        self.assertEqual([x["card_name"] for x in r.json()["result"]], ["블랙 매지션"])
        with patch("card.views.crop_cards_and_draw_boxes", side_effect=nothing), \
                patch("card.views.identify", return_value=[Match(None, None, 0.2)]):
            r = self.client.post("/api/classify-deck/", {"image": self.photo()}, format="multipart")
        self.assertEqual(r.json()["result"], [])

    def test_the_single_card_scanner_is_gone(self):
        self.assertEqual(self.client.post("/api/predict-card/", {"image": self.photo()}, format="multipart").status_code, 404)


class IdentifyTest(SimpleTestCase):
    def test_nearest_print_and_unknown(self):
        import torch
        import torch.nn.functional as F
        from .identify import UNKNOWN, nearest
        emb = torch.eye(3, 512)                               # three prints, two of one card
        q = torch.zeros(3, 512)
        q[0, 0], q[0, 1] = 0.9, 0.1                           # close to the first print
        q[1, 2], q[1, 0] = 0.95, 0.3                          # the third
        q[2] = 1.0                                            # like none of them
        m = nearest(F.normalize(q, dim=1), [10, 11, 12], [100, 100, 200], emb)
        self.assertEqual([(x.card_id, x.md_id) for x in m], [(100, 10), (200, 12), (None, None)])
        self.assertLess(m[2].similarity, UNKNOWN)
        self.assertEqual(nearest(torch.zeros(0, 512), [10], [100], emb[:1]), [])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class CardGalleryCommandTest(FreshArt, TestCase):
    """build_card_gallery adds the prints the gallery lacks and drops those gone, in a gallery of its own here."""

    def test_adds_missing_and_drops_gone(self):
        import torch
        import torch.nn.functional as F
        from carddb.models import MdArt
        from . import identify
        base = tempfile.mkdtemp()
        os.makedirs(os.path.join(base, "card"))
        for name, cid in (("가", 4041), ("나", 4042)):
            _create_card_with_art(name, cid)
        fake = lambda faces: F.normalize(torch.rand(len(faces), 512), dim=1)
        open(os.path.join(base, "card", "card_id.pt"), "wb").close()   # a model is there (never read: fingerprints are faked)
        with override_settings(BASE_DIR=base), \
                patch("card.management.commands.build_card_gallery.draw_face", return_value=PILImage.new("RGB", (704, 1024))), \
                patch("card.identify.face_fingerprints", side_effect=fake) as fp:
            call_command("build_card_gallery", stdout=StringIO())
            g = torch.load(identify.gallery_path(), weights_only=True)
            self.assertEqual((sorted(g["md_ids"]), g["emb"].shape), ([4041, 4042], torch.Size([2, 512])))
            fp.reset_mock()
            MdArt.objects.filter(md_print_id=4042).delete()
            _create_card_with_art("다", 4043)
            call_command("build_card_gallery", stdout=StringIO())
            g = torch.load(identify.gallery_path(), weights_only=True)
            self.assertEqual(sorted(g["md_ids"]), [4041, 4043])
            self.assertEqual(sum(len(c.args[0]) for c in fp.call_args_list), 1)   # only the new print was drawn
            # the site's processes see the new gallery without a restart; nothing new leaves the file as it is
            self.assertEqual(sorted(identify._gallery()[0]), [4041, 4043])
            before = os.stat(identify.gallery_path()).st_mtime_ns
            out = StringIO()
            call_command("build_card_gallery", stdout=out)
            self.assertIn("nothing new", out.getvalue())
            self.assertEqual(os.stat(identify.gallery_path()).st_mtime_ns, before)
            identify.forget()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class EffectTagAdminTest(FreshArt, TestCase):
    """Effect tags are site data on the new card ids (cardsite.EffectTag)."""

    def setUp(self):
        super().setUp()
        from carddb.models import CardText
        from cardsite.models import EffectTag
        self.admin = User.objects.create_user(email="tag@test.com", username="tagger", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        ash = _create_card_with_art("하루 우라라", 14558)
        CardText.objects.create(card=ash, lang="ko", effect="①: 덱에서 카드를 서치하는 효과를 무효로 한다.")
        EffectTag.objects.create(card=ash, hand_trap=True, negates=True)
        plain = _create_card_with_art("통상 몬스터", 4041)
        CardText.objects.create(card=plain, lang="ko", flavor="그냥 몬스터.")
        _create_card_with_art("효과문 없음", 4042)

    def test_list_and_filter(self):
        body = self.client.get("/api/admin/effect-tags/").json()
        self.assertEqual([r["card_pk"] for r in body["results"]], [4041, 14558])
        row = body["results"][1]
        self.assertEqual((row["korean_name"], row["image_url"], row["tags"]["hand_trap"]),
                         ("하루 우라라", "/media/cards/art/common/14558.webp", True))
        self.assertIn("무효", row["description"])
        self.assertEqual(body["per_tag_count"]["hand_trap"], 1)
        only = self.client.get("/api/admin/effect-tags/", {"tag": "hand_trap"}).json()["results"]
        self.assertEqual([r["card_pk"] for r in only], [14558])
        self.assertEqual([r["card_pk"] for r in self.client.get("/api/admin/effect-tags/", {"q": "우라라"}).json()["results"]], [14558])

    def test_update_marks_reviewed(self):
        from cardsite.models import EffectTag
        r = self.client.patch("/api/admin/effect-tags/4041/", {"cat_destroy_monster": True}, format="json")
        self.assertEqual(r.status_code, 200)
        tag = EffectTag.objects.get(card_id=4041)
        self.assertEqual((tag.cat_destroy_monster, tag.manually_reviewed), (True, True))


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ScanSampleApiTest(TestCase):
    """Scanner test set: staff check the boxes on real uploads (카드, 덱 칸, 머리글) through /api/scanner/samples/."""

    def setUp(self):
        from .models import ScanSample
        self.staff = User.objects.create_user(username="staff", email="staff@x.com", password="pw", is_staff=True)
        self.user = User.objects.create_user(username="user", email="user@x.com", password="pw")
        buf = BytesIO()
        PILImage.new("RGB", (400, 200), "white").save(buf, "JPEG")
        self.sample = ScanSample.objects.create(source="upload:1", kind="wide", width=400, height=200,
                                                boxes=[{"c": "card", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.5}])
        self.sample.image.save("1.jpg", ContentFile(buf.getvalue()))
        self.client = APIClient()

    def test_staff_only(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/scanner/samples/").status_code, 403)

    def test_list_and_counts(self):
        self.client.force_authenticate(self.staff)
        body = self.client.get("/api/scanner/samples/").json()
        self.assertEqual((len(body["results"]), body["counts"]["todo"], body["results"][0]["boxes"]), (1, 1, 1))
        self.assertEqual([c["key"] for c in body["classes"]], ["card", "deck_panel", "head_main", "head_extra", "head_side"])
        self.assertEqual(self.client.get("/api/scanner/samples/?status=done").json()["results"], [])

    def test_save_boxes(self):
        self.client.force_authenticate(self.staff)
        boxes = [{"c": "deck_panel", "x": 0, "y": 0, "w": 1, "h": 1}, {"c": "card", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.2}]
        body = self.client.put(f"/api/scanner/samples/{self.sample.id}/", {"boxes": boxes, "status": "done"}, format="json").json()
        self.assertEqual((body["status"], len(body["boxes"]), body["reviewed_by"]), ("done", 2, "staff"))
        # boxes are clipped to the picture and anything else is refused
        body = self.client.put(f"/api/scanner/samples/{self.sample.id}/",
                               {"boxes": [{"c": "card", "x": 0.9, "y": -0.1, "w": 0.3, "h": 0.5}]}, format="json").json()
        self.assertEqual(body["boxes"], [{"c": "card", "x": 0.9, "y": 0.0, "w": 0.1, "h": 0.4}])
        for bad in ([{"c": "dragon", "x": 0, "y": 0, "w": 0.1, "h": 0.1}], [{"c": "card", "x": 0, "y": 0, "w": 0, "h": 0.1}], "x"):
            self.assertEqual(self.client.put(f"/api/scanner/samples/{self.sample.id}/", {"boxes": bad}, format="json").status_code, 400)
        self.assertEqual(self.client.put(f"/api/scanner/samples/{self.sample.id}/", {"status": "nope"}, format="json").status_code, 400)

    def test_kind_of(self):
        from .scan_samples import kind_of
        self.assertEqual([kind_of(w, h, n) for w, h, n in ((850, 392, 30), (1080, 2340, 70), (400, 580, 0), (850, 814, 0),
                                                            (850, 659, 15), (850, 935, 55), (850, 478, 89))],
                         ["wide", "tall", "single", "none", "few", "deck", "many"])


class MakeScanTestsetTest(TestCase):
    def test_picks_each_kind_and_fills_in_cards(self):
        from .models import ScanSample
        media = tempfile.mkdtemp()
        for i, size, found in ((1, (850, 392), 30), (2, (400, 580), 0), (3, (850, 935), 55), (4, (850, 935), 55)):
            os.makedirs(os.path.join(media, f"upload_{i}", "cards"))
            for k in range(found):
                open(os.path.join(media, f"upload_{i}", "cards", f"card_{k}.jpg"), "w").close()
            PILImage.new("RGB", size, (i, 0, 0)).save(os.path.join(media, f"upload_{i}", "input.jpg"))
        os.makedirs(os.path.join(media, "upload_5"))
        with open(os.path.join(media, "upload_5", "input.jpg"), "wb") as f:   # a truncated upload
            buf = BytesIO()
            PILImage.new("RGB", (850, 392)).save(buf, "JPEG")
            f.write(buf.getvalue()[:300])
        box = [{"c": "card", "x": 0.1, "y": 0.1, "w": 0.1, "h": 0.2}]
        with override_settings(MEDIA_ROOT=media), patch("card.scan_samples.load_detector", return_value=None), \
                patch("card.scan_samples.detect_cards", return_value=box):
            out = StringIO()
            call_command("make_scan_testset", per_kind='{"wide": 5, "single": 5, "deck": 1}', stdout=out)
            self.assertEqual(sorted(ScanSample.objects.values_list("kind", flat=True)), ["deck", "single", "wide"])
            self.assertEqual(ScanSample.objects.get(kind="wide").boxes, box)
            self.assertFalse(ScanSample.objects.filter(source="upload:5").exists())
            call_command("make_scan_testset", per_kind='{"wide": 5}', stdout=StringIO())   # nothing picked twice
            self.assertEqual(ScanSample.objects.count(), 3)


class ScanLayoutTest(TestCase):
    """Deck picture layout from card boxes: sections, their headings and the deck panel."""

    @staticmethod
    def grid(x, y, cols, n, w=50, h=72, gap=4):
        return [(x + (i % cols) * (w + gap), y + (i // cols) * (h + gap), x + (i % cols) * (w + gap) + w,
                 y + (i // cols) * (h + gap) + h) for i in range(n)]

    @staticmethod
    def reader(texts):
        texts = list(texts)

        def read(crop, psm, langs=None):
            return [(texts.pop(0), (0, 0, crop.width, crop.height))] if texts else []
        return read

    def test_headings_and_order(self):
        from .scan_layout import heading_of
        self.assertEqual([heading_of(t) for t in ("8메인덱42", "口エクストラデッキ:15枚", "E사이드型:15", "|メインデッキ:42枚",
                                                  "m.dcinside.com", "마듀 바다", "Extra Deck 15", "EXデッキ",
                                                  "主牌組 40", "額外牌組 15", "Deck Principale", "Deck Adicional",
                                                  "Основная колода", "Экстра-колода", "Side Deck 15")],
                         ["head_main", "head_extra", "head_side", "head_main", None, None, "head_extra", "head_extra",
                          "head_main", "head_extra", "head_main", "head_extra", "head_main", "head_extra", "head_side"])

    def test_a_deck_with_main_and_extra(self):
        from .scan_layout import layout, as_boxes
        boxes = self.grid(10, 40, 10, 40) + self.grid(10, 40 + 4 * 76 + 40, 10, 15)
        img = PILImage.new("RGB", (600, 600))
        r = layout(img, boxes, read=self.reader(["메인 덱 40", "엑스트라 덱 15"]))
        self.assertTrue(r["sure"])
        self.assertEqual([c for c, _ in r["headings"]], ["head_main", "head_extra"])
        self.assertEqual(len(r["cards"]), 55)
        self.assertLess(r["panel"][1], 40)   # the panel takes in the main heading
        kinds = [b["c"] for b in as_boxes(r, 600, 600)]
        self.assertEqual((kinds.count("card"), kinds.count("deck_panel"), kinds[-2:]), (55, 1, ["head_main", "head_extra"]))

    def test_a_missed_card_or_unread_heading_is_not_sure(self):
        from .scan_layout import layout
        boxes = self.grid(10, 40, 10, 40) + self.grid(10, 40 + 4 * 76 + 40, 10, 15)
        img = PILImage.new("RGB", (600, 600))
        self.assertFalse(layout(img, boxes[:13] + boxes[14:], read=self.reader(["메인 덱", "엑스트라 덱"]))["sure"])
        self.assertFalse(layout(img, boxes, read=self.reader(["메인 덱"]))["sure"])
        self.assertFalse(layout(img, boxes, read=self.reader(["엑스트라 덱", "메인 덱"]))["sure"])   # out of order

    def test_the_deck_beside_the_collection(self):
        from .scan_layout import layout
        deck = self.grid(10, 40, 6, 24)
        collection = self.grid(500, 10, 4, 20)
        img = PILImage.new("RGB", (800, 600))
        texts = iter(["메인 덱 40"] + [""] * 50)
        r = layout(img, deck + collection, read=lambda crop, psm, langs=None: [(next(texts), (0, 0, crop.width, crop.height))])
        self.assertEqual(len(r["cards"]), 44)
        self.assertLess(r["panel"][2], 500)   # the panel is the deck only


class ScanDatasetTest(TestCase):
    """Pieces of the detector's training set: cutting windows by the labelling rule, YOLO lines, composed cards."""

    def test_windows_keep_cards_half_in_view_and_whole_height_headings(self):
        from .scan_dataset import window_labels
        labels = [("card", (0, 0, 100, 140)), ("card", (110, 0, 210, 140)), ("head_main", (0, -30, 300, -5)),
                  ("head_extra", (0, 150, 300, 175)), ("deck_panel", (0, -30, 300, 400))]
        got = window_labels(labels, (40, 0, 200, 180))
        self.assertEqual([c for c, _ in got], ["card", "card", "head_extra", "deck_panel"])
        self.assertEqual(got[0][1], (0, 0, 60, 140))   # 60% of the first card: kept, in window coordinates
        self.assertEqual([c for c, _ in window_labels(labels, (70, 0, 200, 160))], ["card", "deck_panel"])   # 30%: dropped
        self.assertEqual([c for c, _ in window_labels(labels, (0, 160, 300, 400))], ["deck_panel"])   # heading cut in height

    def test_yolo_lines(self):
        from .scan_dataset import yolo_lines
        self.assertEqual(yolo_lines([("head_side", (0, 0, 50, 20)), ("card", (10, 10, 10, 30))], 100, 200),
                         ["4 0.250000 0.050000 0.500000 0.100000"])
        self.assertEqual(yolo_lines([("card", (90, -2, 100.4, 20))], 100, 200), ["0 0.950000 0.050000 0.100000 0.100000"])

    def test_composed_cards_sit_inside_the_picture(self):
        import random
        from .scan_dataset import compose_cards, plain_background
        rng = random.Random(3)
        face = PILImage.new("RGB", (704, 1024), "orange")
        for _ in range(30):
            img, labels = compose_cards([face] * 4, plain_background(rng, (640, 480)), rng)
            self.assertTrue(1 <= len(labels) <= 4)
            for _, (x0, y0, x1, y1) in labels:
                self.assertTrue(0 <= x0 < x1 <= 640 and 0 <= y0 < y1 <= 480, (x0, y0, x1, y1))
                self.assertGreater((x1 - x0) * (y1 - y0), 400)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class PrefillScanLayoutTest(TestCase):
    def test_adds_panel_and_headings_to_unchecked_pictures(self):
        from .models import ScanSample
        boxes = [{"c": "card", "x": round(0.1 + (i % 5) * 0.16, 5), "y": round(0.2 + (i // 5) * 0.3, 5), "w": 0.15, "h": 0.28}
                 for i in range(10)]
        made = []
        for status in ("todo", "done"):
            s = ScanSample.objects.create(source=f"upload:{status}", kind="deck", width=500, height=500, boxes=boxes, status=status)
            buf = BytesIO()
            PILImage.new("RGB", (500, 500)).save(buf, "JPEG")
            s.image.save(f"{status}.jpg", ContentFile(buf.getvalue()))
            made.append(s)
        with patch("card.scan_layout.ocr_lines", side_effect=lambda crop, psm, langs=None: [("메인 덱 10", (0, 0, crop.width, crop.height))]):
            call_command("prefill_scan_layout", stdout=StringIO())
        todo, done = (ScanSample.objects.get(id=s.id) for s in made)
        self.assertEqual(sorted({b["c"] for b in todo.boxes}), ["card", "deck_panel", "head_main"])
        self.assertEqual(sum(b["c"] == "card" for b in todo.boxes), 10)
        self.assertEqual(done.boxes, boxes)   # checked pictures are never touched
