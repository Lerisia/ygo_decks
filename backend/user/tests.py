from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from django.core.management import call_command
from rest_framework.test import APIClient
from user.models import User, BannedWord
from user.utils import contains_banned_word, sanitize_username
from deck.models import Deck


class UserModelTest(TestCase):
    def test_create_user(self):
        user = User.objects.create_user(email="test@test.com", username="tester", password="pass1234")
        self.assertEqual(user.email, "test@test.com")
        self.assertEqual(user.username, "tester")
        self.assertTrue(user.check_password("pass1234"))

    def test_email_is_username_field(self):
        self.assertEqual(User.USERNAME_FIELD, "email")

    def test_owned_decks(self):
        user = User.objects.create_user(email="test@test.com", username="tester", password="pass1234")
        deck = Deck.objects.create(name="덱A", strength=0, difficulty=0, deck_type=0, art_style=0)
        user.owned_decks.add(deck)
        self.assertEqual(user.owned_decks.count(), 1)
        self.assertEqual(user.owned_decks.first().name, "덱A")

    def test_use_custom_lookup_default_false(self):
        user = User.objects.create_user(email="test@test.com", username="tester", password="pass1234")
        self.assertFalse(user.use_custom_lookup)

    def test_create_superuser(self):
        admin = User.objects.create_superuser(email="admin@test.com", username="admin", password="admin1234")
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)

    def test_str(self):
        user = User.objects.create_user(email="test@test.com", username="tester", password="pass1234")
        self.assertEqual(str(user), "tester")

    def test_unique_email(self):
        User.objects.create_user(email="dup@test.com", username="user1", password="pass1234")
        with self.assertRaises(Exception):
            User.objects.create_user(email="dup@test.com", username="user2", password="pass1234")

    def test_unique_username(self):
        User.objects.create_user(email="a@test.com", username="same", password="pass1234")
        with self.assertRaises(Exception):
            User.objects.create_user(email="b@test.com", username="same", password="pass1234")


class UpdateSettingsLUTTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="a@test.com", username="user1", password="pass1234")
        self.client.force_authenticate(user=self.user)
        self.deck = Deck.objects.create(name="덱A", strength=0, difficulty=0, deck_type=0, art_style=0)
        self.user.owned_decks.add(self.deck)

    def test_toggle_custom_lookup_setting(self):
        resp = self.client.post("/api/user/update-settings/", {"use_custom_lookup": True}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.use_custom_lookup)
        resp = self.client.post("/api/user/update-settings/", {"use_custom_lookup": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.use_custom_lookup)


class DeleteAccountTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="del@test.com", username="delme", password="pass1234")
        self.client.force_authenticate(user=self.user)

    def test_delete_account_deactivates(self):
        resp = self.client.delete("/api/delete-account/")
        self.assertEqual(resp.status_code, 204)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.pending_deletion)

    def test_pending_deletion_user_can_login_and_reactivate(self):
        self.user.is_active = False
        self.user.pending_deletion = True
        self.user.deletion_requested_at = timezone.now()
        self.user.save()
        client = APIClient()
        resp = client.post("/api/token/", {"email": "del@test.com", "password": "pass1234"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertFalse(self.user.pending_deletion)
        self.assertIsNone(self.user.deletion_requested_at)

    def test_unauthenticated_cannot_delete(self):
        client = APIClient()
        resp = client.delete("/api/delete-account/")
        self.assertEqual(resp.status_code, 401)

    def test_cleanup_deletes_expired_pending(self):
        self.user.is_active = False
        self.user.pending_deletion = True
        self.user.deletion_requested_at = timezone.now() - timedelta(days=31)
        self.user.save()

        call_command("cleanup_unverified_users")
        self.assertFalse(User.objects.filter(id=self.user.id).exists())

    def test_cleanup_keeps_recent_pending(self):
        self.user.is_active = False
        self.user.pending_deletion = True
        self.user.deletion_requested_at = timezone.now() - timedelta(days=5)
        self.user.save()

        call_command("cleanup_unverified_users")
        self.assertTrue(User.objects.filter(id=self.user.id).exists())


class PasswordResetTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email="reset@test.com", username="resetuser", password="oldpass1234")
        self.user.is_active = True
        self.user.save()

    def test_request_reset_sends_email(self):
        resp = self.client.post("/api/password-reset/", {"email": "reset@test.com"}, format="json")
        self.assertEqual(resp.status_code, 200)

    def test_request_reset_nonexistent_email_still_200(self):
        resp = self.client.post("/api/password-reset/", {"email": "noone@test.com"}, format="json")
        self.assertEqual(resp.status_code, 200)


class BannedWordTest(TestCase):
    def setUp(self):
        BannedWord.objects.create(word="바보")
        BannedWord.objects.create(word="멍청")

    def test_exact_match(self):
        self.assertTrue(contains_banned_word("바보"))

    def test_partial_match(self):
        self.assertTrue(contains_banned_word("대바보왕"))

    def test_case_insensitive(self):
        BannedWord.objects.create(word="idiot")
        self.assertTrue(contains_banned_word("IDIOT"))

    def test_clean_word(self):
        self.assertFalse(contains_banned_word("좋은닉네임"))

    def test_sanitize_replaces_banned(self):
        result = sanitize_username("대바보왕")
        self.assertEqual(result, "불건전한닉네임")

    def test_sanitize_keeps_clean(self):
        result = sanitize_username("좋은닉네임")
        self.assertEqual(result, "좋은닉네임")

    def test_sanitize_increments_number(self):
        User.objects.create_user(email="a@test.com", username="불건전한닉네임", password="pass1234")
        result = sanitize_username("멍청이")
        self.assertEqual(result, "불건전한닉네임1")


class CleanupUnverifiedUsersTest(TestCase):
    def test_deletes_old_inactive_users(self):
        old = User.objects.create_user(email="old@test.com", username="old", password="pass1234", is_active=False)
        old.date_joined = timezone.now() - timedelta(hours=49)
        old.save(update_fields=["date_joined"])

        call_command("cleanup_unverified_users")
        self.assertFalse(User.objects.filter(id=old.id).exists())

    def test_keeps_recent_inactive_users(self):
        recent = User.objects.create_user(email="new@test.com", username="new", password="pass1234", is_active=False)
        recent.date_joined = timezone.now() - timedelta(hours=1)
        recent.save(update_fields=["date_joined"])

        call_command("cleanup_unverified_users")
        self.assertTrue(User.objects.filter(id=recent.id).exists())

    def test_keeps_active_users(self):
        active = User.objects.create_user(email="active@test.com", username="active", password="pass1234", is_active=True)
        active.date_joined = timezone.now() - timedelta(days=30)
        active.save(update_fields=["date_joined"])

        call_command("cleanup_unverified_users")
        self.assertTrue(User.objects.filter(id=active.id).exists())

    def test_keeps_staff_even_if_inactive(self):
        staff = User.objects.create_user(email="staff@test.com", username="staff", password="pass1234", is_active=False, is_staff=True)
        staff.date_joined = timezone.now() - timedelta(days=30)
        staff.save(update_fields=["date_joined"])

        call_command("cleanup_unverified_users")
        self.assertTrue(User.objects.filter(id=staff.id).exists())


class PointTransactionModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="pt@test.com", username="pt", password="pass1234")

    def test_award_points_creates_transaction(self):
        from user.points import award_points
        from user.models import PointTransaction
        award_points(self.user, 50, kind="daily_bonus", note="첫 보너스")
        tx = PointTransaction.objects.filter(user=self.user).get()
        self.assertEqual(tx.amount, 50)
        self.assertEqual(tx.kind, "daily_bonus")
        self.assertEqual(tx.note, "첫 보너스")
        self.assertEqual(tx.balance_after, 50)

    def test_award_points_balance_after_compounds(self):
        from user.points import award_points
        from user.models import PointTransaction
        award_points(self.user, 30, kind="daily_bonus")
        award_points(self.user, 70, kind="game_dm")
        txs = list(PointTransaction.objects.filter(user=self.user).order_by("created_at"))
        self.assertEqual([t.balance_after for t in txs], [30, 100])

    def test_award_points_zero_or_negative_no_transaction(self):
        from user.points import award_points
        from user.models import PointTransaction
        award_points(self.user, 0, kind="daily_bonus")
        award_points(self.user, -5, kind="daily_bonus")
        self.assertEqual(PointTransaction.objects.filter(user=self.user).count(), 0)

    def test_default_kind_is_other(self):
        from user.points import award_points
        from user.models import PointTransaction
        award_points(self.user, 10)
        tx = PointTransaction.objects.filter(user=self.user).get()
        self.assertEqual(tx.kind, "other")


class IconPurchaseTransactionTest(TestCase):
    def setUp(self):
        from avatar.models import CardIcon
        self.user = User.objects.create_user(email="buyer@test.com", username="buyer", password="pass1234")
        self.user.points = 500
        self.user.save(update_fields=["points"])
        self.icon = CardIcon.objects.create(title="레드드래곤", price=100, category="shop", center_x=0.5, center_y=0.5, radius=0.5)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_purchase_creates_spend_transaction(self):
        from user.models import PointTransaction
        resp = self.client.post(f"/api/avatar/card-icons/{self.icon.id}/purchase/")
        self.assertEqual(resp.status_code, 200)
        tx = PointTransaction.objects.filter(user=self.user).get()
        self.assertEqual(tx.amount, -100)
        self.assertEqual(tx.kind, "icon_purchase")
        self.assertEqual(tx.balance_after, 400)


class PointHistoryAPITest(TestCase):
    def setUp(self):
        from user.points import award_points
        self.user = User.objects.create_user(email="h@test.com", username="hist", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        award_points(self.user, 10, kind="daily_bonus", note="day 1")
        award_points(self.user, 30, kind="game_dm", note="round 1")
        award_points(self.other, 100, kind="daily_bonus", note="other's points")
        self.client = APIClient()

    def test_unauth_returns_401(self):
        resp = self.client.get("/api/user/points/history/")
        self.assertIn(resp.status_code, (401, 403))

    def test_returns_only_own_transactions_newest_first(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/user/points/history/")
        self.assertEqual(resp.status_code, 200)
        results = resp.json().get("results", [])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["kind"], "game_dm")
        self.assertEqual(results[0]["amount"], 30)
        self.assertEqual(results[1]["kind"], "daily_bonus")
        self.assertEqual(results[1]["amount"], 10)

    def test_pagination_metadata_present(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get("/api/user/points/history/")
        body = resp.json()
        self.assertIn("results", body)
        self.assertIn("count", body)


class AdminPointsGrantAPITest(TestCase):
    def setUp(self):
        from user.models import User as U
        self.admin = U.objects.create_user(email="admin@test.com", username="admin", password="x", is_staff=True)
        self.user = U.objects.create_user(email="u@test.com", username="testuser", password="x")
        self.user.points = 100
        self.user.lifetime_points_earned = 100
        self.user.save()
        self.client = APIClient()

    def test_unauth_denied(self):
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": 50, "note": "이벤트 보상"},
            format="json",
        )
        self.assertIn(resp.status_code, (401, 403))

    def test_non_admin_denied(self):
        regular = User.objects.create_user(email="r@test.com", username="reg", password="x")
        self.client.force_authenticate(user=regular)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": 50, "note": "이벤트"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_grant_positive_creates_transaction_and_unlocks_borders(self):
        from user.models import PointTransaction
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": 50, "note": "이벤트 보상"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.points, 150)
        self.assertEqual(self.user.lifetime_points_earned, 150)
        tx = PointTransaction.objects.filter(user=self.user).get()
        self.assertEqual(tx.amount, 50)
        self.assertEqual(tx.kind, "admin_grant")
        self.assertEqual(tx.note, "이벤트 보상")
        self.assertEqual(tx.balance_after, 150)

    def test_deduct_negative_does_not_lower_lifetime(self):
        from user.models import PointTransaction
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": -30, "note": "환불 회수"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.points, 70)
        # Lifetime stays at 100 — deducts don't lower the cumulative tally.
        self.assertEqual(self.user.lifetime_points_earned, 100)
        tx = PointTransaction.objects.filter(user=self.user).get()
        self.assertEqual(tx.amount, -30)
        self.assertEqual(tx.kind, "admin_grant")

    def test_zero_amount_rejected(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": 0, "note": "x"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_unknown_user_rejected(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "nonexistent", "amount": 50, "note": "x"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

    def test_deduct_below_zero_clamps_to_zero(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(
            "/api/manage/points/grant/",
            {"username": "testuser", "amount": -500, "note": "전부 회수"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.user.refresh_from_db()
        # Clamp to 0 so user.points stays a PositiveIntegerField.
        self.assertEqual(self.user.points, 0)
