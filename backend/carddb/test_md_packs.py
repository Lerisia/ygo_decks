from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from . import md_packs
from .models import Card, MdPack, MdPackCard, MdPrint


def mdm_set(sid, name, kind="Secret Pack", release="2026-10-06T09:00:00.000Z"):
    return {"_id": sid, "type": kind, "name": name, "release": release}


def mdm_card(game_id, rarity, *sets, alt=False, amount=1):
    """A card as masterduelmeta lists it: its print id, rarity, and the sets it comes in. An alternate art is listed
    under its base print's id."""
    return {"gameId": game_id, "rarity": rarity, "alternateArt": alt,
            "obtain": [{"source": {"_id": s, "name": s}, "amount": amount, "type": "sets"} for s in sets]
            + [{"source": {"_id": "x", "name": "Duel Result"}, "amount": 1, "type": "otherSources"}]}


class SyncTest(TestCase):
    def setUp(self):
        def card(cid, *prints):
            c = Card.objects.create(id=cid, category="monster", name_ja=str(cid), name_en=str(cid), frame="effect")
            for md_id, alt, rarity, seen in prints:
                MdPrint.objects.create(md_id=md_id, card=c, is_alt_art=alt, rarity=rarity, first_seen=seen)
        card(1, (1, False, "UR", date(2022, 1, 19)))
        card(2, (2, False, "N", date(2022, 1, 19)))
        # 융합: two other arts, from two bundles
        card(3, (3, False, "N", date(2022, 1, 19)), (30, True, "UR", date(2024, 5, 1)), (31, True, "UR", date(2026, 3, 1)))

    def test_packs_and_their_cards(self):
        out = md_packs.sync(
            [mdm_set("s1", "Cell \"A\" Corruption", release="2026-10-06T23:30:00.000Z"),
             mdm_set("m", "Master Pack", kind="Normal Pack", release="2022-01-19T00:00:00.000Z"),
             mdm_set("d", "Structure Deck: X", kind="Structure Deck")],
            [mdm_card(1, "UR", "s1", "m"), mdm_card(2, "N", "s1"), mdm_card(2, "N", "d", amount=3)])
        s1 = MdPack.objects.get(mdm_id="s1")
        self.assertEqual((s1.kind, s1.name_en), (MdPack.Kind.SECRET, 'Cell "A" Corruption'))
        self.assertEqual(s1.released, date(2026, 10, 7))   # the day in Korea
        self.assertEqual(sorted(s1.cards.values_list("md_print_id", "rarity", "amount")), [(1, "UR", 1), (2, "N", 1)])
        self.assertEqual(MdPack.objects.get(mdm_id="m").kind, MdPack.Kind.NORMAL)
        self.assertEqual(list(MdPack.objects.get(mdm_id="d").cards.values_list("md_print_id", "amount")), [(2, 3)])
        self.assertEqual((out["packs"], out["cards"]), (3, 4))

    def test_an_other_art_is_its_own_print(self):
        # MDM lists both bundles' arts under the base print; each is the other art out nearest the bundle, on or after it
        md_packs.sync([mdm_set("b1", "Masked Hero", release="2024-04-30T00:00:00.000Z"),
                       mdm_set("b2", "The First Heroes", release="2026-02-27T00:00:00.000Z"),
                       mdm_set("b3", "Later Bundle", release="2026-09-01T00:00:00.000Z")],
                      [mdm_card(3, "UR", "b1", "b2", "b3", alt=True), mdm_card(3, "N", "b1")])
        got = {p: list(MdPack.objects.get(mdm_id=p).cards.values_list("md_print_id", "rarity")) for p in ("b1", "b2", "b3")}
        self.assertEqual(sorted(got["b1"]), [(3, "N"), (30, "UR")])
        self.assertEqual(got["b2"], [(31, "UR")])
        self.assertEqual(got["b3"], [(31, "UR")])   # none after it: the latest before

    def test_again_follows_the_source(self):
        sets = [mdm_set("s1", "Pack")]
        md_packs.sync(sets, [mdm_card(1, "UR", "s1"), mdm_card(2, "N", "s1")])
        pack_id = MdPack.objects.get().id
        out = md_packs.sync([mdm_set("s1", "Pack (renamed)")], [mdm_card(1, "SR", "s1")])
        pack = MdPack.objects.get()
        self.assertEqual((pack.id, pack.name_en), (pack_id, "Pack (renamed)"))
        self.assertEqual(list(pack.cards.values_list("md_print_id", "rarity")), [(1, "SR")])
        self.assertEqual((out["added"], out["removed"], out["changed"]), (0, 1, 1))

    def test_a_pack_the_source_drops_stays(self):
        # a pack is history: one MDM stops listing keeps its row and cards
        md_packs.sync([mdm_set("s1", "Pack")], [mdm_card(1, "UR", "s1")])
        md_packs.sync([], [])
        self.assertEqual(MdPackCard.objects.count(), 1)

    def test_unknown_prints_and_kinds_are_reported(self):
        out = md_packs.sync([mdm_set("s1", "Pack"), mdm_set("t", "Ticket", kind="Pack Ticket"),
                             mdm_set("n", "No Day", release=None)],
                            [mdm_card(999, "UR", "s1"), mdm_card(1, "UR", "s1", "t", "n")])
        self.assertEqual(out["unknown_prints"], [999])
        self.assertEqual(out["unknown_kinds"], ["Pack Ticket"])
        self.assertFalse(MdPack.objects.filter(mdm_id="t").exists())
        self.assertIsNone(MdPack.objects.get(mdm_id="n").released)


class CommandTest(TestCase):
    def test_command(self):
        Card.objects.create(id=1, category="spell", name_ja="1", name_en="1", frame="spell")
        MdPrint.objects.create(md_id=1, card_id=1, rarity="R")
        out = StringIO()
        with mock.patch.object(md_packs, "fetch_sets", return_value=[mdm_set("s1", "Pack")]), \
             mock.patch.object(md_packs, "fetch_cards", return_value=[mdm_card(1, "R", "s1")]):
            call_command("import_md_packs", stdout=out)
        self.assertIn("md packs: 1 packs, 1 cards", out.getvalue())
        self.assertEqual(MdPackCard.objects.count(), 1)
