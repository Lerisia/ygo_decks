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
        for c in (self.ash, self.link):   # in Master Duel (the others are, being on its list)
            MdPrint.objects.create(md_id=c.id, card=c)
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


class DeckBanlistTest(TestCase):
    """The 금제 a deck is checked by, picked and kept with it (참혈 2026-10-16): Master Duel's, the OCG's or the TCG's
    newest — following the next one when it comes — or one held to by its day, or one of ours by its code. What it
    is told follows that list: more of a card than it allows, and cards not out yet then."""

    def setUp(self):
        self.me = User.objects.create_user(email="me@test.com", username="me", password="pass1234")
        self.c = APIClient()
        self.c.force_authenticate(self.me)
        self.ash = card(1, "재와 유령")
        self.pot = card(2, "강욕한 항아리", category="spell", frame="spell")
        self.link = card(3, "링크 몬스터", frame="link")
        self.newer = card(5, "새 카드")
        Card.objects.filter(id__in=[1, 2, 3]).update(ocg_date=date(2019, 1, 1))
        Card.objects.filter(id=5).update(ocg_date=date(2021, 6, 1))
        for c in (self.ash, self.pot, self.link):
            MdPrint.objects.create(md_id=c.id, card=c, first_seen=date(2022, 1, 19))
        MdPrint.objects.create(md_id=5, card=self.newer, first_seen=date(2022, 5, 9))
        jan = Banlist.objects.create(format="md", effective=date(2022, 1, 19))
        may = Banlist.objects.create(format="md", effective=date(2022, 5, 9))
        BanlistEntry.objects.create(banlist=jan, card=self.pot, name="강욕한 항아리", status="forbidden")
        BanlistEntry.objects.create(banlist=may, card=self.ash, name="재와 유령", status="limited")
        ocg = Banlist.objects.create(format="ocg", effective=date(2020, 1, 1))
        BanlistEntry.objects.create(banlist=ocg, card=self.ash, name="재와 유령", status="semi_limited")

    def body(self, **kw):
        return {"name": "재록", "description": "", "main": [1, 1, 2, 5], "extra": [3], **kw}

    def test_a_new_deck_follows_master_duels_newest(self):
        r = self.c.post("/api/decklists/", self.body(), format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["banlist"], "md")
        self.assertEqual(r.json()["issues"], ["메인 덱이 40장보다 적습니다 (4/40).", "재와 유령: 제한 카드는 1장까지입니다 (2장)."])
        self.assertEqual(self.c.get("/api/decklists/").json()["decks"][0]["banlist"], "md")

    def test_one_saved_on_the_newest_moves_on_with_the_next(self):
        code = self.c.post("/api/decklists/", self.body(), format="json").json()["code"]
        later = Banlist.objects.create(format="md", effective=date(2022, 8, 1))
        BanlistEntry.objects.create(banlist=later, card=self.ash, name="재와 유령", status="semi_limited")
        r = self.c.get(f"/api/decklists/{code}/").json()
        self.assertEqual(r["banlist"], "md")
        self.assertEqual(r["issues"], ["메인 덱이 40장보다 적습니다 (4/40)."])   # 2 of a semi-limited card are fine now

    def test_kept_and_checked_by_the_list_picked(self):
        r = self.c.post("/api/decklists/", self.body(banlist="md:2022-01-19"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["banlist"], "md:2022-01-19")
        # January's list: the pot forbidden, the ash free, the new card not out yet
        self.assertEqual(r.json()["issues"], ["메인 덱이 40장보다 적습니다 (4/40).", "강욕한 항아리: 금지 카드입니다.", "새 카드: 미출시 카드입니다."])
        r = self.c.put(f"/api/decklists/{code}/", self.body(banlist="ocg:2020-01-01"), format="json")
        self.assertEqual(r.json()["issues"][1:], ["새 카드: 미출시 카드입니다."])   # 2 of a semi-limited card are fine
        r = self.c.put(f"/api/decklists/{code}/", self.body(banlist="tcg"), format="json")
        # no TCG list yet: nothing limited, and none of these out in the TCG
        self.assertEqual(r.json()["banlist"], "tcg")
        self.assertEqual(r.json()["issues"][1:], [f"{n}: 미출시 카드입니다." for n in ("강욕한 항아리", "링크 몬스터", "새 카드", "재와 유령")])
        # a page from before it keeps the deck's own
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(), format="json").json()["banlist"], "tcg")

    def test_a_list_that_is_not_there(self):
        code = self.c.post("/api/decklists/", self.body(), format="json").json()["code"]
        bad = {
            "a day without a list": "md:2022-01-20",
            "no such game": "xx",
            "not a day": "ocg:someday",
            "not a string": 3,
            "a code of ours (none yet)": "custom:ours",
            "an empty code": "custom:",
        }
        for why, key in bad.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(banlist=key), format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        r = self.c.put(f"/api/decklists/{code}/", self.body(banlist="custom:ours"), format="json")
        self.assertEqual(r.json()["error"], "없는 금제 코드입니다.")
        self.assertEqual(DeckList.objects.get(code=code).banlist, "md")

    def test_no_banlist(self):
        """무금제 (참혈 2026-10-17): nothing limited and nothing 미출시, kept as "none"."""
        r = self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 2, 2, 5], banlist="none"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual((r.json()["banlist"], r.json()["issues"]), ("none", ["메인 덱이 40장보다 적습니다 (6/40)."]))
        self.assertEqual(self.c.get("/api/banlists/none/latest/").status_code, 404)

    def test_a_deck_may_hold_more_than_its_list_allows(self):
        """A deck goes in over its 금제 and is saved so, only told (참혈 2026-10-17); 3 of a name stays a rule."""
        r = self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 2, 2, 2]), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual(r.json()["issues"][1:], ["재와 유령: 제한 카드는 1장까지입니다 (3장)."])
        r = self.c.post("/api/decklists/", self.body(main=[1, 2, 2, 2], banlist="md:2022-01-19"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual(r.json()["issues"][1:], ["강욕한 항아리: 금지 카드입니다."])
        self.assertEqual(self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 1]), format="json").status_code, 400)

    def test_a_list_gone_since_falls_back_to_its_games_newest(self):
        d = DeckList.objects.create(owner=self.me, code="old00001", name="옛 덱", main=[1, 1], extra=[], banlist="md:2021-01-01")
        self.assertEqual(self.c.get(f"/api/decklists/{d.code}/").json()["issues"][1:], ["재와 유령: 제한 카드는 1장까지입니다 (2장)."])

    def test_a_tournament_entry_stays_on_master_duels_newest(self):
        """A tournament's copy (kind "entry") is made without a list: Master Duel's newest, as before."""
        entry = DeckList.objects.create(owner=self.me, code="entry001", kind=DeckList.Kind.ENTRY, name="대회 덱", main=[1, 1], extra=[])
        self.assertEqual(entry.banlist, "md")
        got = self.c.get(f"/api/decklists/{entry.code}/").json()
        self.assertEqual((got["banlist"], got["issues"][1:]), ("md", ["재와 유령: 제한 카드는 1장까지입니다 (2장)."]))
