from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from carddb.models import Banlist, BanlistEntry, Card, MdPrint
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

    def test_an_entry_deck_is_read_here_but_kept_elsewhere(self):
        """A tournament's copy of a deck (kind "entry", 2026-10-15): not in the list, readable by its owner, not
        changed or deleted from the builder."""
        entry = DeckList.objects.create(owner=self.me, code="entry001", kind=DeckList.Kind.ENTRY, name="대회 덱 1", main=[1], extra=[3])
        DeckList.objects.create(owner=self.me, code="own00001", name="내 덱", main=[1, 2, 3], extra=[])
        self.assertEqual([d["code"] for d in self.c.get("/api/decklists/").json()["decks"]], ["own00001"])
        self.assertEqual(self.c.get("/api/decklists/entry001/").json()["kind"], "entry")
        self.assertEqual(self.c.put("/api/decklists/entry001/", {"name": "x", "main": [1] * 40, "extra": []}, format="json").status_code, 403)
        self.assertEqual(self.c.delete("/api/decklists/entry001/").status_code, 403)
        self.assertTrue(DeckList.objects.filter(code="entry001").exists())
        self.assertNotEqual(DeckList.new_code(), "new")

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

    def test_cover_cards(self):
        """Up to 3 of the deck's own cards stand for it, in the order picked (대표 카드, 참혈 2026-10-16)."""
        r = self.c.post("/api/decklists/", self.body(cover_cards=[3, 1]), format="json")
        self.assertEqual(r.status_code, 201)
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["cover_cards"], [3, 1])
        self.assertEqual(self.c.get("/api/decklists/").json()["decks"][0]["cover_cards"], [3, 1])
        bad = {
            "4 of them": [1, 2, 3, 5],
            "one twice": [1, 1],
            "not in the deck": [5],
            "not a card id": ["1"],
            "not a list": 1,
        }
        for why, covers in bad.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=covers), format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        self.assertEqual(DeckList.objects.get(code=code).cover_cards, [3, 1])
        # a page from before them sends none: the deck keeps those still in it
        r = self.c.put(f"/api/decklists/{code}/", self.body(extra=[]), format="json")
        self.assertEqual((r.status_code, r.json()["cover_cards"]), (200, [1]))
        self.assertEqual(self.c.post("/api/decklists/", self.body(), format="json").json()["cover_cards"], [])

    def test_each_copy_keeps_its_look(self):
        """Each copy's print (its own or a Master Duel alternate art) and finish (일반 / 샤인 / 로얄), lined up with the
        cards (참혈 2026-10-16); 로얄 on an SR / UR print only, as the card page offers it."""
        MdPrint.objects.create(md_id=1, card=self.ash, rarity="R")
        MdPrint.objects.create(md_id=9001, card=self.ash, is_alt_art=True, rarity="UR")
        MdPrint.objects.create(md_id=2, card=self.pot, rarity="SR")
        looks = {"main": [None, {"face": 9001, "finish": "royal"}, {"face": 1, "finish": "shine"}, None, None, {"face": 2, "finish": "royal"}],
                 "extra": [None]}
        r = self.c.post("/api/decklists/", self.body(looks=looks), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["looks"], looks)
        # its own print in 일반 is kept as none; all plain is kept as nothing
        plain = {"main": [{"face": 1, "finish": "normal"}] + [None] * 5, "extra": [None]}
        r = self.c.put(f"/api/decklists/{code}/", self.body(looks=plain), format="json")
        self.assertEqual(r.json()["looks"], {"main": [None] * 6, "extra": [None]})
        self.assertEqual(DeckList.objects.get(code=code).looks, {})
        bad = {
            "not lined up": {"main": [None] * 5, "extra": [None]},
            "another card's print": {"main": [{"face": 2, "finish": "normal"}] + [None] * 5},
            "no such print": {"main": [{"face": 9002, "finish": "normal"}] + [None] * 5},
            "로얄 on an R print": {"main": [{"face": 1, "finish": "royal"}] + [None] * 5},
            "no such finish": {"main": [{"face": 1, "finish": "gold"}] + [None] * 5},
            "not a look": {"main": [1] + [None] * 5},
            "not a dict": [None],
        }
        for why, looks in bad.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(looks=looks), format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        # a page from before looks keeps them while the cards stay as they were, and lets them go when they change
        self.c.put(f"/api/decklists/{code}/", self.body(looks={"main": [None] * 5 + [{"face": 2, "finish": "shine"}]}), format="json")
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(), format="json").json()["looks"]["main"][5], {"face": 2, "finish": "shine"})
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(main=[2, 1]), format="json").json()["looks"], {"main": [None, None], "extra": [None]})
        # a deck saved before looks, or a tournament's copy (cards changed there), reads as all plain
        entry = DeckList.objects.create(owner=self.me, code="entry001", kind=DeckList.Kind.ENTRY, name="대회", main=[1, 2], extra=[], looks={"main": [None]})
        self.assertEqual(self.c.get(f"/api/decklists/{entry.code}/").json()["looks"], {"main": [None, None], "extra": []})

    def test_cover_copies(self):
        """Which copy of each 대표 카드 was pressed (0 the first), so it is drawn in that copy's look (참혈 2026-10-16)."""
        r = self.c.post("/api/decklists/", self.body(cover_cards=[1, 3], cover_copies=[2, 0]), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        got = self.c.get(f"/api/decklists/{code}/").json()
        self.assertEqual((got["cover_cards"], got["cover_copies"]), ([1, 3], [2, 0]))
        self.assertEqual(self.c.get("/api/decklists/").json()["decks"][0]["cover_copies"], [2, 0])
        for why, copies in {"a 4th copy": [3, 0], "not lined up": [0], "not a number": ["0", 0], "below 0": [-1, 0]}.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[1, 3], cover_copies=copies), format="json")
            self.assertEqual(r.status_code, 400, why)
        # 대표 카드 sent without copies are the first ones; none sent keeps the deck's, a copy gone moving to the last
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[3, 1]), format="json").json()["cover_copies"], [0, 0])
        self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[1], cover_copies=[2]), format="json")
        r = self.c.put(f"/api/decklists/{code}/", self.body(main=[1, 1, 2]), format="json")
        self.assertEqual((r.json()["cover_cards"], r.json()["cover_copies"]), ([1], [1]))
