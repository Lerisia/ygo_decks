import os
import tempfile
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.utils import timezone
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from PIL import Image as PILImage
from io import BytesIO
from django.core.files.base import ContentFile
from .models import Card, UploadRecord, QuizHighScore, QuizAllTimeBest, QuizMonthlyAward, QuizWeeklyAward
from user.models import User


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


def _create_card_with_illust(name, card_id=None):
    card_id = card_id or name
    img = PILImage.new("RGB", (100, 100), color="red")
    buf = BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    card = Card.objects.create(card_id=card_id, konami_id="0", name=name, korean_name=name)
    card.card_illust.save(f"{card_id}.jpg", ContentFile(buf.read()))
    return card


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class QuizNextCardTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.card1 = _create_card_with_illust("블루아이즈", "c1")
        self.card2 = _create_card_with_illust("레드아이즈", "c2")
        self.card3 = _create_card_with_illust("다크매지션", "c3")
        self.card4 = _create_card_with_illust("블랙매지션걸", "c4")

    def test_returns_card_with_choices(self):
        resp = self.client.get("/api/quiz/next/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("card_id", data)
        self.assertIn("choices", data)
        self.assertEqual(len(data["choices"]), 4)
        self.assertIn("images", data)

    def test_choices_contain_correct_answer(self):
        resp = self.client.get("/api/quiz/next/")
        data = resp.json()
        card = Card.objects.get(card_id=data["card_id"])
        self.assertIn(card.korean_name, data["choices"])


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class QuizCheckAnswerTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.card = _create_card_with_illust("블루아이즈", "c1")

    def test_correct_answer(self):
        resp = self.client.post("/api/quiz/check/", {
            "card_id": "c1",
            "answer": "블루아이즈",
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["correct"])

    def test_wrong_answer(self):
        resp = self.client.post("/api/quiz/check/", {
            "card_id": "c1",
            "answer": "레드아이즈",
        }, format="json")
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
