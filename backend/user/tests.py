from datetime import timedelta
from unittest.mock import patch
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

    @patch("user.views.call_command")
    def test_enabling_custom_lookup_triggers_lut_generation(self, mock_cmd):
        resp = self.client.post("/api/user/update-settings/", {"use_custom_lookup": True}, format="json")
        self.assertEqual(resp.status_code, 200)
        mock_cmd.assert_called_once_with("generate_lookup", user_id=self.user.id)

    @patch("user.views.call_command")
    def test_disabling_custom_lookup_does_not_trigger_lut(self, mock_cmd):
        self.user.use_custom_lookup = True
        self.user.save()
        resp = self.client.post("/api/user/update-settings/", {"use_custom_lookup": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        mock_cmd.assert_not_called()


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
