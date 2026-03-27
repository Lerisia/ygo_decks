from django.test import TestCase, Client
from deck.models import AestheticTag, PerformanceTag


class GetQuestionsTest(TestCase):
    def setUp(self):
        self.client = Client()
        AestheticTag.objects.create(name="드래곤", description="드래곤족 위주의 덱")
        AestheticTag.objects.create(name="해당 없음", description="해당 없음")
        PerformanceTag.objects.create(name="원턴킬", description="한 턴에 승부를 내는 덱")

    def test_returns_questions(self):
        resp = self.client.get("/api/get_questions/")
        self.assertEqual(resp.status_code, 200)
        questions = resp.json()["questions"]
        self.assertEqual(len(questions), 7)

    def test_question_keys(self):
        resp = self.client.get("/api/get_questions/")
        keys = [q["key"] for q in resp.json()["questions"]]
        self.assertEqual(keys, ["atag", "s", "d", "t", "a", "sm", "ptag"])

    def test_aesthetic_tag_excludes_none(self):
        resp = self.client.get("/api/get_questions/")
        atag_q = resp.json()["questions"][0]
        labels = [o["label"] for o in atag_q["options"]]
        self.assertNotIn("해당 없음", labels)
        self.assertIn("드래곤족 위주의 덱", labels)

    def test_performance_tag_included(self):
        resp = self.client.get("/api/get_questions/")
        ptag_q = resp.json()["questions"][6]
        labels = [o["label"] for o in ptag_q["options"]]
        self.assertIn("한 턴에 승부를 내는 덱", labels)
