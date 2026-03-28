import os
import tempfile
from datetime import timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from PIL import Image as PILImage
from io import BytesIO
from django.core.files.base import ContentFile
from .models import Card, UploadRecord, QuizHighScore
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
