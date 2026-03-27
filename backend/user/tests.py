from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from django.core.management import call_command
from user.models import User
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
