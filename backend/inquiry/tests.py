from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from .models import InquiryComment, InquiryPost

User = get_user_model()


class InquiryBoardTest(TestCase):
    """문의 게시판 (특이점 2026-10-07): anonymous authors, always private, staff-only answers, opt-in answer mail."""

    def setUp(self):
        self.author = User.objects.create_user(email="a@test.com", username="asker", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.staff = User.objects.create_user(email="s@test.com", username="staffer", password="pass1234", is_staff=True)
        self.c = APIClient()

    def _as(self, user):
        c = APIClient()
        if user:
            c.force_authenticate(user=user)
        return c

    def _write(self, **extra):
        body = {"board": "site", "title": "로그인이 안 돼요", "body": "비밀번호를 바꾼 뒤로 로그인이 안 됩니다.", **extra}
        return self._as(self.author).post("/api/inquiry/", body, format="json")

    def test_writing_needs_login_and_defaults_to_private_without_mail(self):
        self.assertEqual(self._as(None).post("/api/inquiry/", {"board": "site", "title": "t", "body": "b"}, format="json").status_code, 401)
        res = self._write()
        self.assertEqual(res.status_code, 201)
        post = InquiryPost.objects.get(id=res.json()["id"])
        self.assertTrue(post.is_private)
        self.assertFalse(post.notify_email)

    def test_board_title_and_body_are_checked(self):
        self.assertEqual(self._write(board="etc").status_code, 400)
        self.assertEqual(self._write(title="  ").status_code, 400)
        self.assertEqual(self._write(body="x" * 5001).status_code, 400)

    def test_list_never_names_the_author_except_to_staff(self):
        self._write(is_private=False)
        rows = self._as(self.other).get("/api/inquiry/?board=site").json()["results"]
        self.assertNotIn("author_name", rows[0])
        self.assertNotIn("asker", str(rows))
        staff_rows = self._as(self.staff).get("/api/inquiry/?board=site").json()
        self.assertEqual(staff_rows["results"][0]["author_name"], "asker")
        self.assertEqual(staff_rows["unanswered"], 1)
        self.assertEqual(self._as(None).get("/api/inquiry/?board=deck").json()["total"], 0)

    def test_private_post_opens_only_for_its_author_and_staff(self):
        pid = self._write().json()["id"]
        locked = self._as(self.other).get(f"/api/inquiry/{pid}/")
        self.assertEqual(locked.status_code, 403)
        self.assertNotIn("body", locked.json())
        self.assertEqual(locked.json()["title"], "문의사항")
        self.assertEqual(self._as(None).get(f"/api/inquiry/{pid}/").status_code, 403)
        self.assertEqual(self._as(self.author).get(f"/api/inquiry/{pid}/").json()["body"], "비밀번호를 바꾼 뒤로 로그인이 안 됩니다.")
        self.assertIn("body", self._as(self.staff).get(f"/api/inquiry/{pid}/").json())
        # the list shows it as locked
        row = self._as(self.other).get("/api/inquiry/?board=site").json()["results"][0]
        self.assertTrue(row["is_private"])
        self.assertFalse(row["can_view"])

    def test_titles_show_only_on_the_post_for_its_author_and_staff(self):
        pid = self._write().json()["id"]
        for who in (None, self.other, self.author, self.staff):
            rows = self._as(who).get("/api/inquiry/?board=site").json()["results"]
            self.assertEqual([r["title"] for r in rows], ["문의사항"])
            self.assertNotIn("로그인이 안 돼요", str(rows))
        self.assertEqual(self._as(self.author).get(f"/api/inquiry/{pid}/").json()["title"], "로그인이 안 돼요")
        self.assertEqual(self._as(self.staff).get(f"/api/inquiry/{pid}/").json()["title"], "로그인이 안 돼요")
        self.assertEqual(self._as(self.other).get(f"/api/inquiry/{pid}/").json()["title"], "문의사항")

    def test_posts_are_always_private(self):
        pid = self._write(is_private=False).json()["id"]
        self.assertTrue(InquiryPost.objects.get(id=pid).is_private)
        self.assertEqual(self._as(None).get(f"/api/inquiry/{pid}/").status_code, 403)
        self.assertEqual(self._as(self.other).get(f"/api/inquiry/{pid}/").status_code, 403)
        # even a row stored as public (from before the rule) stays closed to others
        InquiryPost.objects.filter(id=pid).update(is_private=False)
        self.assertEqual(self._as(self.other).get(f"/api/inquiry/{pid}/").status_code, 403)
        self.assertEqual(self._as(self.author).get(f"/api/inquiry/{pid}/").status_code, 200)

    def test_only_staff_can_answer_and_answers_mark_the_post(self):
        pid = self._write(is_private=False).json()["id"]
        self.assertEqual(self._as(self.author).post(f"/api/inquiry/{pid}/comments/", {"body": "저도요"}, format="json").status_code, 403)
        self.assertEqual(self._as(None).post(f"/api/inquiry/{pid}/comments/", {"body": "?"}, format="json").status_code, 401)
        res = self._as(self.staff).post(f"/api/inquiry/{pid}/comments/", {"body": "확인해 보겠습니다."}, format="json")
        self.assertEqual(res.status_code, 201)
        detail = self._as(self.author).get(f"/api/inquiry/{pid}/").json()
        self.assertTrue(detail["answered"])
        self.assertEqual([c["body"] for c in detail["comments"]], ["확인해 보겠습니다."])
        self.assertNotIn("staffer", str(detail))
        # removing the only answer makes it unanswered again
        self._as(self.staff).delete(f"/api/inquiry/comments/{res.json()['id']}/")
        self.assertFalse(self._as(self.author).get(f"/api/inquiry/{pid}/").json()["answered"])

    def test_answer_mail_goes_out_only_when_asked_for(self):
        quiet = self._write().json()["id"]
        self._as(self.staff).post(f"/api/inquiry/{quiet}/comments/", {"body": "답변"}, format="json")
        self.assertEqual(len(mail.outbox), 0)
        loud = self._write(title="덱 이름 오타", notify_email=True).json()["id"]
        self._as(self.staff).post(f"/api/inquiry/{loud}/comments/", {"body": "고쳤습니다"}, format="json")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["a@test.com"])
        self.assertIn("관리자의 답변이 등록되었습니다", mail.outbox[0].body)
        self.assertIn(f"/inquiry/post/{loud}", mail.outbox[0].body)

    def test_author_or_staff_can_delete_and_deleted_posts_disappear(self):
        pid = self._write(is_private=False).json()["id"]
        self.assertEqual(self._as(self.other).delete(f"/api/inquiry/{pid}/").status_code, 403)
        self.assertEqual(self._as(self.author).delete(f"/api/inquiry/{pid}/").status_code, 204)
        self.assertEqual(self._as(None).get(f"/api/inquiry/{pid}/").status_code, 404)
        self.assertEqual(self._as(None).get("/api/inquiry/?board=site").json()["total"], 0)
        pid2 = self._write(is_private=False).json()["id"]
        self.assertEqual(self._as(self.staff).delete(f"/api/inquiry/{pid2}/").status_code, 204)

    def test_flooding_is_refused(self):
        for _ in range(5):
            self.assertEqual(self._write().status_code, 201)
        self.assertEqual(self._write().status_code, 429)
        self.assertEqual(InquiryPost.objects.count(), 5)
        self.assertEqual(InquiryComment.objects.count(), 0)
