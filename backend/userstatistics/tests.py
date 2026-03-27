from datetime import timedelta

from django.test import TestCase, Client
from django.utils.timezone import now
from deck.models import Deck
from .models import UserResponse


def _create_deck(name="테스트 덱", **kwargs):
    defaults = {"strength": 0, "difficulty": 0, "deck_type": 0, "art_style": 0}
    defaults.update(kwargs)
    return Deck.objects.create(name=name, **defaults)


class GetDeckStatisticsTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.deck1 = _create_deck(name="덱A")
        self.deck2 = _create_deck(name="덱B")

    def test_returns_current_month_period(self):
        resp = self.client.get("/api/statistics/decks/")
        today = now()
        self.assertEqual(resp.json()["period"], f"{today.year}.{today.month:02d}")

    def test_counts_only_current_month(self):
        today = now()
        UserResponse.objects.create(session_id="a", deck=self.deck1, answers={})
        UserResponse.objects.create(session_id="b", deck=self.deck1, answers={})
        old = UserResponse.objects.create(session_id="c", deck=self.deck1, answers={})
        last_month = today.replace(day=1) - timedelta(days=1)
        UserResponse.objects.filter(pk=old.pk).update(date=last_month)

        resp = self.client.get("/api/statistics/decks/")
        data = resp.json()
        self.assertEqual(data["total_views"], 2)

    def test_sorted_by_views_descending(self):
        today = now()
        UserResponse.objects.create(session_id="a", deck=self.deck1, answers={}, date=today)
        UserResponse.objects.create(session_id="b", deck=self.deck2, answers={}, date=today)
        UserResponse.objects.create(session_id="c", deck=self.deck2, answers={}, date=today)

        resp = self.client.get("/api/statistics/decks/")
        decks = resp.json()["decks"]
        self.assertEqual(decks[0]["name"], "덱B")
        self.assertEqual(decks[0]["num_views"], 2)
        self.assertEqual(decks[1]["name"], "덱A")
        self.assertEqual(decks[1]["num_views"], 1)

    def test_percentage_calculation(self):
        today = now()
        for _ in range(3):
            UserResponse.objects.create(session_id=f"s{_}", deck=self.deck1, answers={}, date=today)
        UserResponse.objects.create(session_id="x", deck=self.deck2, answers={}, date=today)

        resp = self.client.get("/api/statistics/decks/")
        decks = resp.json()["decks"]
        self.assertEqual(decks[0]["percentage"], 75.0)
        self.assertEqual(decks[1]["percentage"], 25.0)

    def test_empty_month_returns_zero(self):
        resp = self.client.get("/api/statistics/decks/")
        data = resp.json()
        self.assertEqual(data["total_views"], 0)
        self.assertEqual(data["decks"], [])

    def test_total_decks_counts_all(self):
        resp = self.client.get("/api/statistics/decks/")
        self.assertEqual(resp.json()["total_decks"], 2)
