import shutil
import tempfile
from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from . import banlist
from .models import Banlist, BanlistEntry, BanStatus, Card, MdPrint


def page(day, prev="", next="", cards=(), medium="Yu-Gi-Oh! Master Duel"):
    """A Yugipedia list page as it is written: the infobox, then the status list (name; status[; previous])."""
    lines = "\n".join(cards)
    return f"""{{{{Infobox Limited list
| effective_date = {day}
| medium         = {medium}
| prev           = {prev}
| next           = {next}
}}}}
These are the '''Forbidden and Limited Lists''' in effect since {day}.

{{{{Master Duel Limitation status list
| date      = {day}
| cards     =
{lines}
}}}}

{{{{Statuses and status lists}}}}
"""


class ParsePageTest(SimpleTestCase):
    def test_page(self):
        p = banlist.parse_page(page(
            "January 10, 2024", prev="December 2023 Lists (Master_Duel)", next="February 2024 Lists (Master Duel)",
            cards=["Agido the Ancient Sentinel; Forbidden", "Chaos Ruler, the Chaotic Magical Dragon; Forbidden; Unlimited",
                   "", "Card of Demise; Semi-Limited; Did not exist", "Pot of Desires; Unlimited; Limited"]))
        self.assertEqual(p.effective, date(2024, 1, 10))
        self.assertEqual(p.medium, "Yu-Gi-Oh! Master Duel")
        # a link written with underscores is the same page
        self.assertEqual((p.prev, p.next), ("December 2023 Lists (Master Duel)", "February 2024 Lists (Master Duel)"))
        self.assertEqual(p.entries, [
            ("Agido the Ancient Sentinel", BanStatus.FORBIDDEN, ""),
            ("Chaos Ruler, the Chaotic Magical Dragon", BanStatus.FORBIDDEN, BanStatus.UNLIMITED),
            # "did not exist": the card came out with this list, 미출시 before it
            ("Card of Demise", BanStatus.SEMI_LIMITED, BanStatus.UNRELEASED),
            ("Pot of Desires", BanStatus.UNLIMITED, BanStatus.LIMITED),
        ])

    def test_last_page_has_no_next(self):
        p = banlist.parse_page(page("October 6, 2026", prev="September 2026 Lists (Master Duel)"))
        self.assertEqual((p.next, p.entries), ("", []))

    def test_unknown_status_is_an_error(self):
        with self.assertRaises(ValueError):
            banlist.parse_page(page("October 6, 2026", cards=["Some Card; Limited 2"]))


class MatchTest(TestCase):
    def setUp(self):
        for cid, en in ((1, "Pot of Desires"), (2, "Amazoness Archer (Updated from: Amazon Archer)"),
                        (3, "Maliss  Dormouse"), (4, "Maliss  White Rabbit")):
            Card.objects.create(id=cid, category="monster", name_ja=en, name_en=en, frame="effect")
        self.index = banlist.CardIndex()

    def test_names(self):
        self.assertEqual(self.index.match("Pot of Desires"), 1)
        self.assertEqual(self.index.match("pot of desires"), 1)
        # our English names carry a note on some cards and lost the bracketed letter on others
        self.assertEqual(self.index.match("Amazoness Archer"), 2)
        self.assertEqual(self.index.match("Maliss ＜P＞ Dormouse"), 3)
        self.assertEqual(self.index.match("Maliss <P> White Rabbit"), 4)
        self.assertIsNone(self.index.match("Card That Is Not Here"))


class ImportBanlistsTest(TestCase):
    PAGES = {
        "January 2022 Lists (Master Duel)": page(
            "January 19, 2022", next="May 2022 Lists (Master Duel)",
            cards=["Pot of Greed; Forbidden", "Pot of Desires; Limited", "Lost Card; Semi-Limited"]),
        "May 2022 Lists (Master Duel)": page(
            "May 9, 2022", prev="January 2022 Lists (Master Duel)",
            cards=["Pot of Greed; Forbidden", "Pot of Desires; Unlimited; Limited", "New Card; Limited; Did not exist",
                   "Lost Card; Semi-Limited"]),
    }

    def setUp(self):
        cache = tempfile.mkdtemp()   # never the live cache
        self.addCleanup(shutil.rmtree, cache)
        ctx = override_settings(BANLIST_CACHE=cache)
        ctx.enable()
        self.addCleanup(ctx.disable)
        self.pages = dict(self.PAGES)
        self.fetched = []
        for patcher in (mock.patch.object(banlist, "fetch_wikitext", side_effect=self.fetch),
                        mock.patch("carddb.management.commands.import_banlists.PAUSE", 0)):
            patcher.start()
            self.addCleanup(patcher.stop)
        for cid, en in ((10, "Pot of Greed"), (11, "Pot of Desires"), (12, "New Card")):
            Card.objects.create(id=cid, category="spell", name_ja=en, name_en=en, frame="spell")

    def fetch(self, title):
        self.fetched.append(title)
        return self.pages[title]

    def run_import(self):
        out = StringIO()
        call_command("import_banlists", "--format", "md", stdout=out)
        return out.getvalue()

    def test_import(self):
        out = self.run_import()
        self.assertEqual(self.fetched, ["January 2022 Lists (Master Duel)", "May 2022 Lists (Master Duel)"])   # once each
        lists = list(Banlist.objects.order_by("effective").values_list("format", "effective", "source"))
        self.assertEqual(lists, [("md", date(2022, 1, 19), "January 2022 Lists (Master Duel)"),
                                 ("md", date(2022, 5, 9), "May 2022 Lists (Master Duel)")])
        may = Banlist.objects.get(effective=date(2022, 5, 9))
        self.assertEqual(sorted(may.entries.values_list("name", "card_id", "status", "previous")), [
            ("Lost Card", None, "semi_limited", ""),           # kept by its name though no card is found
            ("New Card", 12, "limited", "unreleased"),
            ("Pot of Desires", 11, "unlimited", "limited"),
            ("Pot of Greed", 10, "forbidden", ""),
        ])
        self.assertIn("Lost Card", out)                        # named in the report

    def test_again_changes_nothing_and_reads_the_cache(self):
        self.run_import()
        self.fetched.clear()
        self.run_import()
        self.assertEqual(Banlist.objects.count(), 2)
        self.assertEqual(BanlistEntry.objects.count(), 7)
        # only the newest page is asked again: its "next" is how a new list is found
        self.assertEqual(self.fetched, ["May 2022 Lists (Master Duel)"])

    def test_a_new_list_is_found_from_the_last(self):
        self.run_import()
        self.pages["May 2022 Lists (Master Duel)"] = self.pages["May 2022 Lists (Master Duel)"].replace(
            "| next           = \n", "| next           = July 2022 Lists (Master Duel)\n")
        self.pages["July 2022 Lists (Master Duel)"] = page(
            "July 11, 2022", prev="May 2022 Lists (Master Duel)", cards=["Pot of Greed; Limited; Forbidden"])
        self.run_import()
        july = Banlist.objects.get(effective=date(2022, 7, 11))
        self.assertEqual(list(july.entries.values_list("card_id", "status")), [(10, "limited")])

    def test_a_card_found_later_is_linked(self):
        self.run_import()
        Card.objects.create(id=13, category="spell", name_ja="Lost Card", name_en="Lost Card", frame="spell")
        self.run_import()
        self.assertEqual(set(BanlistEntry.objects.filter(name="Lost Card").values_list("card_id", flat=True)), {13})

    def test_another_game_page_is_refused(self):
        self.pages["January 2022 Lists (Master Duel)"] = page("January 19, 2022", medium="Yu-Gi-Oh! Duel Links")
        with self.assertRaises(Exception):
            self.run_import()
        self.assertFalse(Banlist.objects.exists())


class StatusOnTest(TestCase):
    """A card's status on a day: the last list on or before it, unlimited when it is not on it, 미출시 before the
    card came to the game."""

    def setUp(self):
        def card(cid, md_day):
            c = Card.objects.create(id=cid, category="spell", name_ja=str(cid), name_en=str(cid), frame="spell")
            if md_day is not False:
                MdPrint.objects.create(md_id=cid, card=c, first_seen=md_day)
            return c
        self.old, self.new, self.paper, self.undated = card(1, date(2022, 1, 19)), card(2, date(2022, 5, 9)), card(3, False), card(4, None)
        jan = Banlist.objects.create(format="md", effective=date(2022, 1, 19))
        may = Banlist.objects.create(format="md", effective=date(2022, 5, 9))
        BanlistEntry.objects.create(banlist=jan, card=self.old, name="1", status="forbidden")
        BanlistEntry.objects.create(banlist=may, card=self.old, name="1", status="limited", previous="forbidden")
        BanlistEntry.objects.create(banlist=may, card=self.new, name="2", status="semi_limited", previous="unreleased")

    def test_status_on(self):
        on = banlist.status_on
        self.assertEqual(on(self.old, date(2022, 1, 19)), BanStatus.FORBIDDEN)
        self.assertEqual(on(self.old, date(2022, 5, 8)), BanStatus.FORBIDDEN)
        self.assertEqual(on(self.old, date(2022, 5, 9)), BanStatus.LIMITED)
        self.assertEqual(on(self.new, date(2022, 2, 1)), BanStatus.UNRELEASED)
        self.assertEqual(on(self.new, date(2022, 5, 9)), BanStatus.SEMI_LIMITED)
        self.assertEqual(on(self.old, date(2021, 12, 1)), BanStatus.UNRELEASED)   # before the game itself
        self.assertEqual(on(self.paper, date(2023, 1, 1)), BanStatus.UNRELEASED)  # never came to Master Duel
        self.assertEqual(on(self.undated, date(2023, 1, 1)), BanStatus.UNLIMITED)  # in the game, its day unknown

    def test_history(self):
        # every list's status of a card, oldest first: what a card's 금제 history shows
        self.assertEqual(banlist.history(self.new), [(date(2022, 1, 19), BanStatus.UNRELEASED),
                                                     (date(2022, 5, 9), BanStatus.SEMI_LIMITED)])
        self.assertEqual(banlist.history(self.old), [(date(2022, 1, 19), BanStatus.FORBIDDEN),
                                                     (date(2022, 5, 9), BanStatus.LIMITED)])
