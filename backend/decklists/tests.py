from datetime import date

from django.contrib.admin.models import LogEntry
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from carddb.models import Banlist, BanlistEntry, Card, MdPrint
from notification.models import Notification
from user.models import User

from .models import DeckList, DeckListCard, DeckListComment


def card(cid, name, frame="effect", category="monster"):
    return Card.objects.create(id=cid, category=category, name_ja=name, name_ko=name, frame=frame)


def fillers(n=12, start=100):
    """Cards to bring a main deck to 40: three copies each of n plain monsters, as a list of ids."""
    return [c.id for c in (card(start + i, f"채움 {i:02d}") for i in range(n)) for _ in range(3)]


def as_user(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


class DeckListApiTest(TestCase):
    """A deck list posted on the board (덱 구축, 엘리스 2026-10-14: "저장과 규칙부터"; on the board from 2026-10-17):
    the rules a deck may not break, and the ones it is only told about."""

    def setUp(self):
        self.me = User.objects.create_user(email="me@test.com", username="me", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.c = as_user(self.me)
        self.ash = card(1, "재와 유령")
        self.pot = card(2, "강욕한 항아리", category="spell", frame="spell")
        self.link = card(3, "링크 몬스터", frame="link")
        self.token = card(4, "토큰", frame="token")
        self.limited = card(5, "제한 카드")
        self.fill = fillers()   # 36

    def body(self, **kw):
        return {"name": "재록", "description": "", "main": [1] * 3 + [2] * 3 + self.fill, "extra": [3], **kw}

    def test_post_read_change_and_delete_my_deck(self):
        r = self.c.post("/api/decklists/", self.body(), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        self.assertEqual(len(code), 8)
        got = self.c.get(f"/api/decklists/{code}/").json()
        self.assertEqual((got["name"], got["main"], got["extra"]), ("재록", [1, 1, 1, 2, 2, 2] + self.fill, [3]))
        listed = self.c.get("/api/decklists/").json()["results"]
        self.assertEqual([(d["code"], d["main_count"], d["extra_count"]) for d in listed], [(code, 42, 1)])
        r = self.c.put(f"/api/decklists/{code}/", self.body(name="재록 2", main=[1, 1] + [2] * 3 + self.fill), format="json")
        self.assertEqual((r.status_code, r.json()["name"], r.json()["main"][:5]), (200, "재록 2", [1, 1, 2, 2, 2]))
        self.assertEqual(self.c.delete(f"/api/decklists/{code}/").status_code, 204)
        # gone from the board and the page, the row kept (its comments, the log)
        self.assertTrue(DeckList.objects.get(code=code).is_deleted)
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").status_code, 404)
        self.assertEqual(self.c.get("/api/decklists/").json()["results"], [])

    def test_an_entry_deck_is_read_by_its_owner_but_kept_elsewhere(self):
        """A tournament's copy of a deck (kind "entry", 2026-10-15): not on the board, readable by its owner alone,
        not changed or deleted from the builder."""
        entry = DeckList.objects.create(owner=self.me, code="entry001", kind=DeckList.Kind.ENTRY, name="대회 덱 1", main=[1], extra=[3])
        DeckList.objects.create(owner=self.me, code="own00001", name="내 덱", main=[1, 2, 3], extra=[])
        self.assertEqual([d["code"] for d in self.c.get("/api/decklists/").json()["results"]], ["own00001"])
        self.assertEqual(self.c.get("/api/decklists/entry001/").json()["kind"], "entry")
        self.assertEqual(as_user(self.other).get("/api/decklists/entry001/").status_code, 404)
        self.assertEqual(self.c.put("/api/decklists/entry001/", self.body(), format="json").status_code, 403)
        self.assertEqual(self.c.delete("/api/decklists/entry001/").status_code, 403)
        self.assertTrue(DeckList.objects.filter(code="entry001").exists())
        self.assertNotIn(DeckList.new_code(), ("new", "comments"))

    def test_anyone_reads_only_the_author_writes(self):
        code = self.c.post("/api/decklists/", self.body(), format="json").json()["code"]
        guest = as_user()
        self.assertEqual(guest.get("/api/decklists/").json()["total"], 1)
        got = guest.get(f"/api/decklists/{code}/").json()
        self.assertEqual((got["author"]["name"], got["mine"]), ("me", False))
        self.assertIn("avatar_icon", got["author"])
        self.assertIn("border", got["author"])
        self.assertIn(guest.post("/api/decklists/", self.body(), format="json").status_code, (401, 403))
        self.assertIn(guest.put(f"/api/decklists/{code}/", self.body(), format="json").status_code, (401, 403))
        other = as_user(self.other)
        self.assertEqual(other.get(f"/api/decklists/{code}/").status_code, 200)
        self.assertEqual(other.put(f"/api/decklists/{code}/", self.body(), format="json").status_code, 403)
        self.assertEqual(other.delete(f"/api/decklists/{code}/").status_code, 403)
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["mine"], True)

    def test_rules_a_deck_may_not_break(self):
        bad = {
            "a name": self.body(name="  "),
            "4 of a name": self.body(main=[1] * 4 + self.fill),
            "a token": self.body(main=[4] + self.fill + [1] * 3),
            "an extra deck card in the main": self.body(main=[3] + self.fill + [1] * 3),
            "a main deck card in the extra": self.body(extra=[1]),
            "no such card": self.body(main=[999] + self.fill + [1] * 3),
            "61 in the main": self.body(main=[1, 1, 1] + [2] * 58),
            "a 2,001-letter description": self.body(description="가" * 2001),
        }
        for why, body in bad.items():
            r = self.c.post("/api/decklists/", body, format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        self.assertEqual(self.c.post("/api/decklists/", self.body(main=[1, 1, 1] + self.fill + [2]), format="json").status_code, 201)
        self.assertEqual(DeckList.objects.count(), 1)

    def test_a_deck_short_of_forty_is_posted_and_told(self):
        """엘리스 2026-10-18: a deck still being built goes up as it is, marked 40장 미만 (the 2026-10-17 rule that
        held it back is gone)."""
        r = self.c.post("/api/decklists/", self.body(main=[1, 1, 1] + self.fill), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual(r.json()["issues"][0], "메인 덱이 40장보다 적습니다 (39/40).")
        self.assertEqual(self.c.get("/api/decklists/").json()["results"][0]["main_count"], 39)
        self.assertEqual(self.c.post("/api/decklists/", self.body(main=[], extra=[]), format="json").status_code, 201)

    def test_what_it_is_only_told(self):
        # more of a card than today's Master Duel list allows: posted, and said
        for cid in [1, 3] + sorted(set(self.fill)):   # in Master Duel (the others are, being on its list)
            MdPrint.objects.create(md_id=cid, card_id=cid)
        bl = Banlist.objects.create(format=Banlist.Format.MD, effective=date(2026, 1, 1))
        BanlistEntry.objects.create(banlist=bl, card=self.limited, name="제한 카드", status="limited")
        BanlistEntry.objects.create(banlist=bl, card=self.pot, name="강욕한 항아리", status="forbidden")
        r = self.c.post("/api/decklists/", self.body(main=self.fill + [1, 5, 5, 2]), format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["issues"], ["강욕한 항아리: 금지 카드입니다.", "제한 카드: 제한 카드는 1장까지입니다 (2장)."])

    def test_cover_cards(self):
        """Up to 3 of the deck's own cards stand for it, in the order picked (대표 카드, 참혈 2026-10-16)."""
        r = self.c.post("/api/decklists/", self.body(cover_cards=[3, 1]), format="json")
        self.assertEqual(r.status_code, 201)
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["cover_cards"], [3, 1])
        self.assertEqual(self.c.get("/api/decklists/").json()["results"][0]["cover_cards"], [3, 1])
        bad = {
            "4 of them": [1, 2, 3, 100],
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
        n = 42
        def main_looks(**at):
            row = [None] * n
            for i, look in at.items():
                row[int(i)] = look
            return row
        looks = {"main": main_looks(**{"1": {"face": 9001, "finish": "royal"}, "2": {"face": 1, "finish": "shine"}, "5": {"face": 2, "finish": "royal"}}),
                 "extra": [None]}
        r = self.c.post("/api/decklists/", self.body(looks=looks), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["looks"], looks)
        # its own print in 일반 is kept as none; all plain is kept as nothing
        plain = {"main": main_looks(**{"0": {"face": 1, "finish": "normal"}}), "extra": [None]}
        r = self.c.put(f"/api/decklists/{code}/", self.body(looks=plain), format="json")
        self.assertEqual(r.json()["looks"], {"main": [None] * n, "extra": [None]})
        self.assertEqual(DeckList.objects.get(code=code).looks, {})
        bad = {
            "not lined up": {"main": [None] * (n - 1), "extra": [None]},
            "another card's print": {"main": main_looks(**{"0": {"face": 2, "finish": "normal"}})},
            "no such print": {"main": main_looks(**{"0": {"face": 9002, "finish": "normal"}})},
            "로얄 on an R print": {"main": main_looks(**{"0": {"face": 1, "finish": "royal"}})},
            "no such finish": {"main": main_looks(**{"0": {"face": 1, "finish": "gold"}})},
            "not a look": {"main": main_looks(**{"0": 1})},
            "not a dict": [None],
        }
        for why, looks in bad.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(looks=looks), format="json")
            self.assertEqual(r.status_code, 400, why)
            self.assertTrue(r.json().get("error"), why)
        # a page from before looks keeps them while the cards stay as they were, and lets them go when they change
        self.c.put(f"/api/decklists/{code}/", self.body(looks={"main": main_looks(**{"5": {"face": 2, "finish": "shine"}})}), format="json")
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(), format="json").json()["looks"]["main"][5], {"face": 2, "finish": "shine"})
        changed = [2, 1] + self.fill + [1, 1]
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(main=changed), format="json").json()["looks"],
                         {"main": [None] * len(changed), "extra": [None]})
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
        self.assertEqual(self.c.get("/api/decklists/").json()["results"][0]["cover_copies"], [2, 0])
        for why, copies in {"a 4th copy": [3, 0], "not lined up": [0], "not a number": ["0", 0], "below 0": [-1, 0]}.items():
            r = self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[1, 3], cover_copies=copies), format="json")
            self.assertEqual(r.status_code, 400, why)
        # 대표 카드 sent without copies are the first ones; none sent keeps the deck's, a copy gone moving to the last
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[3, 1]), format="json").json()["cover_copies"], [0, 0])
        self.c.put(f"/api/decklists/{code}/", self.body(cover_cards=[1], cover_copies=[2]), format="json")
        r = self.c.put(f"/api/decklists/{code}/", self.body(main=[1, 1, 2, 2] + self.fill), format="json")
        self.assertEqual((r.json()["cover_cards"], r.json()["cover_copies"]), ([1], [1]))


class DeckBanlistTest(TestCase):
    """The 금제 a deck is checked by, picked and kept with it (참혈 2026-10-16): Master Duel's, the OCG's or the TCG's
    newest — following the next one when it comes — or one held to by its day, or one of ours by its code. What it
    is told follows that list: more of a card than it allows, and cards not out yet then."""

    def setUp(self):
        self.me = User.objects.create_user(email="me@test.com", username="me", password="pass1234")
        self.c = as_user(self.me)
        self.ash = card(1, "재와 유령")
        self.pot = card(2, "강욕한 항아리", category="spell", frame="spell")
        self.link = card(3, "링크 몬스터", frame="link")
        self.newer = card(5, "새 카드")
        self.fill = fillers()
        Card.objects.filter(id__in=[1, 2, 3] + self.fill).update(ocg_date=date(2019, 1, 1))
        Card.objects.filter(id=5).update(ocg_date=date(2021, 6, 1))
        for cid in [1, 2, 3] + sorted(set(self.fill)):
            MdPrint.objects.create(md_id=cid, card_id=cid, first_seen=date(2022, 1, 19))
        MdPrint.objects.create(md_id=5, card=self.newer, first_seen=date(2022, 5, 9))
        jan = Banlist.objects.create(format="md", effective=date(2022, 1, 19))
        may = Banlist.objects.create(format="md", effective=date(2022, 5, 9))
        BanlistEntry.objects.create(banlist=jan, card=self.pot, name="강욕한 항아리", status="forbidden")
        BanlistEntry.objects.create(banlist=may, card=self.ash, name="재와 유령", status="limited")
        ocg = Banlist.objects.create(format="ocg", effective=date(2020, 1, 1))
        BanlistEntry.objects.create(banlist=ocg, card=self.ash, name="재와 유령", status="semi_limited")

    def body(self, **kw):
        return {"name": "재록", "description": "", "main": [1, 1, 2, 5] + self.fill, "extra": [3], **kw}

    def test_a_new_deck_follows_master_duels_newest(self):
        r = self.c.post("/api/decklists/", self.body(), format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["banlist"], "md")
        self.assertEqual(r.json()["issues"], ["재와 유령: 제한 카드는 1장까지입니다 (2장)."])
        self.assertEqual(self.c.get("/api/decklists/").json()["results"][0]["banlist"], "md")

    def test_one_saved_on_the_newest_moves_on_with_the_next(self):
        code = self.c.post("/api/decklists/", self.body(), format="json").json()["code"]
        later = Banlist.objects.create(format="md", effective=date(2022, 8, 1))
        BanlistEntry.objects.create(banlist=later, card=self.ash, name="재와 유령", status="semi_limited")
        r = self.c.get(f"/api/decklists/{code}/").json()
        self.assertEqual(r["banlist"], "md")
        self.assertEqual(r["issues"], [])   # 2 of a semi-limited card are fine now

    def test_kept_and_checked_by_the_list_picked(self):
        r = self.c.post("/api/decklists/", self.body(banlist="md:2022-01-19"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        code = r.json()["code"]
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["banlist"], "md:2022-01-19")
        # January's list: the pot forbidden, the ash free, the new card not out yet
        self.assertEqual(r.json()["issues"], ["강욕한 항아리: 금지 카드입니다.", "새 카드: 미출시 카드입니다."])
        r = self.c.put(f"/api/decklists/{code}/", self.body(banlist="ocg:2020-01-01"), format="json")
        self.assertEqual(r.json()["issues"], ["새 카드: 미출시 카드입니다."])   # 2 of a semi-limited card are fine
        r = self.c.put(f"/api/decklists/{code}/", self.body(banlist="tcg"), format="json")
        # no TCG list yet: nothing limited, and none of these out in the TCG (the fillers after, by name)
        self.assertEqual(r.json()["banlist"], "tcg")
        self.assertEqual(r.json()["issues"][:4], [f"{n}: 미출시 카드입니다." for n in ("강욕한 항아리", "링크 몬스터", "새 카드", "재와 유령")])
        self.assertEqual(len(r.json()["issues"]), 4 + 12)
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
        r = self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 2, 2, 5] + self.fill, banlist="none"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual((r.json()["banlist"], r.json()["issues"]), ("none", []))
        self.assertEqual(self.c.get("/api/banlists/none/latest/").status_code, 404)

    def test_a_deck_may_hold_more_than_its_list_allows(self):
        """A deck goes in over its 금제 and is posted so, only told (참혈 2026-10-17); 3 of a name stays a rule."""
        r = self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 2, 2, 2] + self.fill), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual(r.json()["issues"], ["재와 유령: 제한 카드는 1장까지입니다 (3장)."])
        r = self.c.post("/api/decklists/", self.body(main=[1, 2, 2, 2] + self.fill, banlist="md:2022-01-19"), format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual(r.json()["issues"], ["강욕한 항아리: 금지 카드입니다."])
        self.assertEqual(self.c.post("/api/decklists/", self.body(main=[1, 1, 1, 1] + self.fill), format="json").status_code, 400)

    def test_a_list_gone_since_falls_back_to_its_games_newest(self):
        d = DeckList.objects.create(owner=self.me, code="old00001", name="옛 덱", main=[1, 1], extra=[], banlist="md:2021-01-01")
        self.assertEqual(self.c.get(f"/api/decklists/{d.code}/").json()["issues"][1:], ["재와 유령: 제한 카드는 1장까지입니다 (2장)."])

    def test_a_tournament_entry_stays_on_master_duels_newest(self):
        """A tournament's copy (kind "entry") is made without a list: Master Duel's newest, as before; short of 40,
        which only such a copy can be, it is told so."""
        entry = DeckList.objects.create(owner=self.me, code="entry001", kind=DeckList.Kind.ENTRY, name="대회 덱", main=[1, 1], extra=[])
        self.assertEqual(entry.banlist, "md")
        got = self.c.get(f"/api/decklists/{entry.code}/").json()
        self.assertEqual((got["banlist"], got["issues"]), ("md", ["메인 덱이 40장보다 적습니다 (2/40).", "재와 유령: 제한 카드는 1장까지입니다 (2장)."]))


class DeckBoardTest(TestCase):
    """The deck list board (엘리스 2026-10-17: every deck list is posted there, there is no 마이덱), on the inquiry
    board's base: pages of the newest, narrowed by 금제, author, card and name; comments with a note to the author,
    opens counted; staff deletions logged; floods held off."""

    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user(email="me@test.com", username="me", password="pass1234")
        self.other = User.objects.create_user(email="o@test.com", username="other", password="pass1234")
        self.staff = User.objects.create_user(email="s@test.com", username="staffer", password="pass1234", is_staff=True)
        self.c, self.o, self.s, self.g = as_user(self.me), as_user(self.other), as_user(self.staff), as_user()
        self.ash = card(1, "재와 유령")
        self.pot = card(2, "강욕한 항아리", category="spell", frame="spell")
        self.link = card(3, "링크 몬스터", frame="link")
        self.fill = fillers()
        self.first = self.post(self.c, name="첫 덱", main=[1, 1, 1] + self.fill + [2])
        self.second = self.post(self.c, name="둘째 덱", main=[2, 2] + self.fill + [1, 1], banlist="ocg")
        self.theirs = self.post(self.o, name="남의 덱", main=[2, 2, 2] + self.fill + [1], extra=[3])

    def post(self, client, **kw):
        body = {"name": "덱", "description": "", "main": [1] * 3 + [2] * 3 + self.fill, "extra": [], **kw}
        r = client.post("/api/decklists/", body, format="json")
        self.assertEqual(r.status_code, 201, r.json())
        return r.json()["code"]

    def board(self, client=None, **params):
        r = (client or self.g).get("/api/decklists/", params)
        self.assertEqual(r.status_code, 200, r.json())
        return r.json()

    def test_everyones_posts_newest_first_with_their_authors(self):
        page = self.board()
        self.assertEqual((page["total"], page["page"], page["pages"]), (3, 1, 1))
        self.assertEqual([d["code"] for d in page["results"]], [self.theirs, self.second, self.first])
        row = page["results"][0]
        self.assertEqual((row["author"]["name"], row["comment_count"], row["view_count"], row["mine"]), ("other", 0, 0, False))
        self.assertEqual({"avatar_icon", "border"} - set(row["author"]), set())
        self.assertEqual([d["mine"] for d in self.board(self.c)["results"]], [False, True, True])
        # a change doesn't lift a deck: the board keeps the order posted
        self.c.put(f"/api/decklists/{self.first}/", {"name": "첫 덱 고침", "main": [1, 1, 1] + self.fill + [2], "extra": []}, format="json")
        self.assertEqual([d["code"] for d in self.board()["results"]], [self.theirs, self.second, self.first])

    def test_narrowed_by_author_card_name_and_banlist(self):
        self.assertEqual([d["code"] for d in self.board(author="me")["results"]], [self.second, self.first])
        self.assertEqual([d["code"] for d in self.board(card=3)["results"]], [self.theirs])
        self.assertEqual(self.board(card="x")["total"], 0)
        self.assertEqual([d["code"] for d in self.board(q="둘째")["results"]], [self.second])
        self.assertEqual([d["code"] for d in self.board(banlist="ocg")["results"]], [self.second])
        self.assertEqual(self.board(banlist="md")["total"], 2)
        self.assertEqual(self.board(banlist="xx")["total"], 3)
        # the card rows the search runs on follow a change
        self.c.put(f"/api/decklists/{self.first}/", {"name": "첫 덱", "main": [1, 1, 1] + self.fill + [2], "extra": [3]}, format="json")
        self.assertEqual(self.board(card=3)["total"], 2)
        self.assertEqual(set(DeckListCard.objects.filter(deck_list__code=self.first).values_list("card_id", "copies")) >= {(1, 3), (2, 1), (3, 1)}, True)

    def test_pages_of_twenty(self):
        for i in range(19):
            DeckList.objects.create(owner=self.me, code=f"more{i:04d}", name=f"덱 {i}", main=[1] * 40, extra=[])
        page = self.board()
        self.assertEqual((page["total"], page["pages"], len(page["results"])), (22, 2, 20))
        self.assertEqual(len(self.board(page=2)["results"]), 2)
        self.assertEqual(self.board(page="x")["page"], 1)

    def test_opens_are_counted_once_per_viewer(self):
        for _ in range(2):
            self.o.get(f"/api/decklists/{self.first}/")
        self.c.get(f"/api/decklists/{self.first}/")   # the author's own don't count
        self.g.get(f"/api/decklists/{self.first}/", HTTP_X_FORWARDED_FOR="10.0.0.1")
        self.g.get(f"/api/decklists/{self.first}/", HTTP_X_FORWARDED_FOR="10.0.0.1")
        self.g.get(f"/api/decklists/{self.first}/", HTTP_X_FORWARDED_FOR="10.0.0.2")
        self.assertEqual(DeckList.objects.get(code=self.first).view_count, 3)
        self.assertEqual(self.board()["results"][-1]["view_count"], 3)

    def test_comments(self):
        r = self.o.post(f"/api/decklists/{self.first}/comments/", {"body": "좋은 덱이네요"}, format="json")
        self.assertEqual(r.status_code, 201, r.json())
        self.assertEqual((r.json()["author"]["name"], r.json()["body"], r.json()["mine"]), ("other", "좋은 덱이네요", True))
        # the author hears of it; their own comment says nothing
        note = Notification.objects.get(user=self.me)
        self.assertEqual((note.kind, note.action_url), ("deck_list_comment", f"/decklists/{self.first}"))
        self.assertIn("other", note.body)
        self.c.post(f"/api/decklists/{self.first}/comments/", {"body": "고마워요"}, format="json")
        self.assertEqual(Notification.objects.count(), 1)
        got = self.g.get(f"/api/decklists/{self.first}/").json()
        self.assertEqual([(c["author"]["name"], c["body"], c["mine"]) for c in got["comments"]], [("other", "좋은 덱이네요", False), ("me", "고마워요", False)])
        self.assertEqual(got["comment_count"], 2)
        self.assertEqual(self.board()["results"][-1]["comment_count"], 2)
        for why, body in {"empty": "", "too long": "가" * 3001}.items():
            self.assertEqual(self.o.post(f"/api/decklists/{self.first}/comments/", {"body": body}, format="json").status_code, 400, why)
        self.assertIn(self.g.post(f"/api/decklists/{self.first}/comments/", {"body": "x"}, format="json").status_code, (401, 403))
        self.assertEqual(self.o.post("/api/decklists/nosuch00/comments/", {"body": "x"}, format="json").status_code, 404)
        # gone: by its writer; by staff, with a log; not by another member
        first, second = DeckListComment.objects.order_by("id")
        self.assertEqual(self.c.delete(f"/api/decklists/comments/{first.id}/").status_code, 403)
        self.assertEqual(self.o.delete(f"/api/decklists/comments/{first.id}/").status_code, 204)
        self.assertEqual(self.s.delete(f"/api/decklists/comments/{second.id}/").status_code, 204)
        self.assertEqual(self.g.get(f"/api/decklists/{self.first}/").json()["comments"], [])
        self.assertEqual(LogEntry.objects.filter(user=self.staff).count(), 1)
        self.assertEqual(self.o.delete(f"/api/decklists/comments/{first.id}/").status_code, 404)

    def test_staff_delete_a_deck_with_a_log(self):
        self.assertEqual(self.s.delete(f"/api/decklists/{self.first}/").status_code, 204)
        self.assertTrue(DeckList.objects.get(code=self.first).is_deleted)
        self.assertEqual(LogEntry.objects.filter(user=self.staff).count(), 1)
        self.assertEqual(self.g.get(f"/api/decklists/{self.first}/").status_code, 404)
        self.assertEqual(self.board()["total"], 2)
        # a member deleting their own leaves no log
        self.assertEqual(self.c.delete(f"/api/decklists/{self.second}/").status_code, 204)
        self.assertEqual(LogEntry.objects.count(), 1)

    def test_floods_are_held_off(self):
        for i in range(3):   # 5 in 10 minutes with the two posted
            DeckList.objects.create(owner=self.me, code=f"fast{i:04d}", name="덱", main=[1] * 40, extra=[])
        r = self.c.post("/api/decklists/", {"name": "하나 더", "main": [1] * 3 + self.fill + [2], "extra": []}, format="json")
        self.assertEqual(r.status_code, 429)
        for i in range(15):
            DeckListComment.objects.create(post=DeckList.objects.get(code=self.first), author=self.other, body=f"{i}")
        self.assertEqual(self.o.post(f"/api/decklists/{self.first}/comments/", {"body": "x"}, format="json").status_code, 429)

    def test_a_private_deck_is_its_authors_alone(self):
        """비공개 (엘리스 2026-10-17): posted so, or made so later; its author sees it on the board and its page as any
        other, with the mark; everyone else finds nothing there — not its page, 추천 or comments."""
        code = self.post(self.c, name="비밀 덱", is_private=True)
        self.assertEqual([(d["code"], d["is_private"]) for d in self.board(self.c)["results"]][0], (code, True))
        self.assertEqual([d["code"] for d in self.board(self.c, author="me")["results"]], [code, self.second, self.first])
        self.assertNotIn(code, [d["code"] for d in self.board()["results"]])
        self.assertNotIn(code, [d["code"] for d in self.board(self.o)["results"]])
        self.assertEqual(self.c.get(f"/api/decklists/{code}/").json()["is_private"], True)
        for client in (self.g, self.o, self.s):
            self.assertEqual(client.get(f"/api/decklists/{code}/").status_code, 404)
        self.assertEqual(self.o.post(f"/api/decklists/{code}/comments/", {"body": "x"}, format="json").status_code, 404)
        # made public, then private again; a page sending nothing keeps it
        body = {"name": "비밀 덱", "main": [1] * 3 + [2] * 3 + self.fill, "extra": []}
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", {**body, "is_private": False}, format="json").json()["is_private"], False)
        self.assertEqual(self.g.get(f"/api/decklists/{code}/").status_code, 200)
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", {**body, "is_private": True}, format="json").json()["is_private"], True)
        self.assertEqual(self.c.put(f"/api/decklists/{code}/", body, format="json").json()["is_private"], True)
        self.assertEqual(self.g.get(f"/api/decklists/{code}/").status_code, 404)
        self.assertEqual(self.board()["results"][0]["is_private"], False)
