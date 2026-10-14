from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from carddb.models import Banlist, BanlistEntry, Card
from user.models import User

from .models import DeckList


def card(cid, name, frame="effect", category="monster"):
    return Card.objects.create(id=cid, category=category, name_ja=name, name_ko=name, frame=frame)


class DeckListApiTest(TestCase):
    """A member's deck lists, kept on the server (덱 구축, 엘리스 2026-10-14: "저장과 규칙부터"): theirs alone to read
    and change for now; the rules a deck may not break, and the ones it is only told about."""

    def setUp(self):
        self.me = User.objects.create_user(email="me@test.com", username="me", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.c = APIClient()
        self.c.force_authenticate(self.me)
        self.ash = card(1, "재와 유령")
        self.pot = card(2, "강욕한 항아리", category="spell", frame="spell")
        self.link = card(3, "링크 몬스터", frame="link")
        self.token = card(4, "토큰", frame="token")
        self.limited = card(5, "제한 카드")

    def body(self, **kw):
        return {"name": "재록", "description": "", "main": [1] * 3 + [2] * 3, "extra": [3], **kw}

    def test_save_read_change_and_delete_my_deck(self):
        r = self.c.post("/api/decklists/", self.body(), format="json")
        self.assertEqual(r.status_code, 201)
        code = r.json()["code"]
        self.assertEqual(len(code), 8)
        got = self.c.get(f"/api/decklists/{code}/").json()
        self.assertEqual((got["name"], got["main"], got["extra"]), ("재록", [1, 1, 1, 2, 2, 2], [3]))
        listed = self.c.get("/api/decklists/").json()["decks"]
        self.assertEqual([(d["code"], d["main_count"], d["extra_count"]) for d in listed], [(code, 6, 1)])
        r = self.c.put(f"/api/decklists/{code}/", self.body(name="재록 2", main=[1, 1]), format="json")
        self.assertEqual((r.status_code, r.json()["name"], r.json()["main"]), (200, "재록 2", [1, 1]))
        self.assertEqual(self.c.delete(f"/api/decklists/{code}/").status_code, 204)
        self.assertFalse(DeckList.objects.exists())

    def test_guests_and_others_cannot(self):
        code = self.c.post("/api/decklists/", self.body(), format="json").json()["code"]
        guest = APIClient()
        self.assertIn(guest.get("/api/decklists/").status_code, (401, 403))
        self.assertIn(guest.post("/api/decklists/", self.body(), format="json").status_code, (401, 403))
        other = APIClient()
        other.force_authenticate(self.other)
        self.assertEqual(other.get(f"/api/decklists/{code}/").status_code, 404)
        self.assertEqual(other.put(f"/api/decklists/{code}/", self.body(), format="json").status_code, 404)
        self.assertEqual(other.delete(f"/api/decklists/{code}/").status_code, 404)
        self.assertEqual(other.get("/api/decklists/").json()["decks"], [])

    def test_rules_a_deck_may_not_break(self):
        bad = {
            "a name": self.body(name="  "),
            "4 of a name": self.body(main=[1] * 4),
            "a token": self.body(main=[4]),
            "an extra deck card in the main": self.body(main=[3]),
            "a main deck card in the extra": self.body(extra=[1]),
            "no such card": self.body(main=[999]),
            "61 in the main": self.body(main=[1, 1, 1] + [2] * 58),
        }
        for why, body in bad.items():
            r = self.c.post("/api/decklists/", body, format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        self.assertFalse(DeckList.objects.exists())

    def test_what_it_is_only_told(self):
        # fewer than 40 in the main, or more of a card than today's Master Duel list allows: saved, and said
        bl = Banlist.objects.create(format=Banlist.Format.MD, effective=date(2026, 1, 1))
        BanlistEntry.objects.create(banlist=bl, card=self.limited, name="제한 카드", status="limited")
        BanlistEntry.objects.create(banlist=bl, card=self.pot, name="강욕한 항아리", status="forbidden")
        r = self.c.post("/api/decklists/", self.body(main=[1, 5, 5, 2]), format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["issues"], [
            "메인 덱이 40장보다 적습니다 (4/40).",
            "강욕한 항아리: 금지 카드입니다.",
            "제한 카드: 제한 카드는 1장까지입니다 (2장).",
        ])
