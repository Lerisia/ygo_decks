from django.test import TestCase
from rest_framework.test import APIClient

from .gems import NotEnoughGems, change_gems
from .models import GemTransaction, User


class GemsTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="a@test.com", username="duelist", password="pass1234")

    def test_change_and_log(self):
        self.assertEqual(change_gems(self.user, 1000, "admin_grant", "시험"), 1000)
        self.assertEqual(change_gems(self.user, -300, "pack_purchase", "팩 3"), 700)
        self.user.refresh_from_db()
        self.assertEqual(self.user.gems, 700)
        log = list(GemTransaction.objects.filter(user=self.user).order_by("created_at", "id").values_list("amount", "kind", "balance_after"))
        self.assertEqual(log, [(1000, "admin_grant", 1000), (-300, "pack_purchase", 700)])

    def test_spending_more_than_held_changes_nothing(self):
        change_gems(self.user, 50, "admin_grant")
        with self.assertRaises(NotEnoughGems):
            change_gems(self.user, -100, "pack_purchase")
        self.user.refresh_from_db()
        self.assertEqual(self.user.gems, 50)
        self.assertEqual(GemTransaction.objects.count(), 1)


class GemApiTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="a@test.com", username="duelist", password="pass1234")
        self.admin = User.objects.create_user(email="b@test.com", username="boss", password="pass1234", is_staff=True)
        self.client = APIClient()

    def test_admin_grants_and_takes_back(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post("/api/manage/gems/grant/", {"username": "duelist", "amount": 3000, "note": "시험용"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["user"]["gems"], 3000)
        r = self.client.post("/api/manage/gems/grant/", {"username": "duelist", "amount": -5000, "note": "회수"}, format="json")
        self.assertEqual(r.json()["user"]["gems"], 0)   # never below zero
        self.assertEqual(list(GemTransaction.objects.order_by("id").values_list("amount", flat=True)), [3000, -3000])

    def test_only_staff_grant(self):
        self.client.force_authenticate(user=self.user)
        r = self.client.post("/api/manage/gems/grant/", {"username": "duelist", "amount": 10}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_history(self):
        change_gems(self.user, 500, "admin_grant", "환영")
        self.client.force_authenticate(user=self.user)
        r = self.client.get("/api/user/gems/history/").json()
        self.assertEqual(r["gems"], 500)
        self.assertEqual([(t["amount"], t["kind_label"], t["note"]) for t in r["results"]], [(500, "관리자 지급", "환영")])
