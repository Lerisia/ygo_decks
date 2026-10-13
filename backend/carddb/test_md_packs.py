from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from . import md_packs
from .models import Card, MdPack, MdPackCard, MdPrint


def mdm_set(sid, name, kind="Secret Pack", release="2026-10-06T09:00:00.000Z"):
    return {"_id": sid, "type": kind, "name": name, "release": release}


def mdm_card(game_id, rarity, *sets, alt=False, amount=1, release=None):
    """A card as masterduelmeta lists it: its print id, rarity, and the sets it comes in. An alternate art is listed
    under its base print's id, with the day that art came."""
    return {"gameId": game_id, "rarity": rarity, "alternateArt": alt, "release": release,
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
        # 융합: two other arts, from two bundles (other arts have no day of their own in the card DB)
        card(3, (3, False, "N", date(2022, 1, 19)), (30, True, "UR", None), (31, True, "UR", None))
        # 블랙 매지션: three other arts, one of them in a pack
        card(4, (4, False, "UR", date(2022, 1, 19)), (40, True, "UR", None), (41, True, "UR", None), (42, True, "UR", None))

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
        # MDM lists 융합's other arts under the base print, each with the day it came: in that order they are our
        # other-art prints in print order, though an old pack got one later in an event
        md_packs.sync([mdm_set("b1", "Masked Hero", release="2026-08-05T00:00:00.000Z"),
                       mdm_set("b2", "The First Heroes", release="2022-01-19T00:00:00.000Z"),
                       mdm_set("b3", "WCS", release="2026-02-27T00:00:00.000Z"),
                       mdm_set("b4", "Later Bundle", release="2026-09-01T00:00:00.000Z")],
                      [mdm_card(3, "UR", "b1", "b2", alt=True, release="2024-04-30T08:00:00.000Z"),
                       mdm_card(3, "UR", "b3", alt=True, release="2026-02-28T08:00:00.000Z"),
                       mdm_card(3, "UR", "b4", alt=True),
                       mdm_card(3, "N", "b1")])
        got = {p: sorted(MdPack.objects.get(mdm_id=p).cards.values_list("md_print_id", "rarity")) for p in ("b1", "b2", "b3", "b4")}
        self.assertEqual(got["b1"], [(3, "N"), (30, "UR")])
        self.assertEqual(got["b2"], [(30, "UR")])
        self.assertEqual(got["b3"], [(31, "UR")])
        self.assertEqual(got["b4"], [(31, "UR")])   # no day of its own: after those with one

    def test_fewer_other_arts_in_packs_than_prints(self):
        md_packs.sync([mdm_set("w", "WCS 2026")], [mdm_card(4, "UR", "w", alt=True, release="2026-08-19T04:00:00.000Z")])
        self.assertEqual(list(MdPack.objects.get().cards.values_list("md_print_id", flat=True)), [42])

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


class PackMapTest(TestCase):
    """What the game itself says of a pack (storage/md/packs/pack_map.json): its number, Korean name and covers. A
    cover showing an other art (오버프레임 or new art, a campaign MDM leaves out) is that pack's cover, and the
    card comes in the pack as that art (엘리스 2026-10-13)."""

    MAP = {"packs": [
        {"pack_id": "2116", "ko_name": "싱귤러 스트라이크 오버스로", "mdm_set_id": "s1", "image": "03_13668",
         "other_images": [{"image": "03_3899"}, {"image": "03_13999"}]},
        {"pack_id": "2009", "ko_name": "워리어즈 유나이트", "mdm_set_id": "s2", "image": "03_17614",
         "other_images": [{"image": "03_13172"}]},
        {"pack_id": "1001", "ko_name": "리바이벌", "mdm_set_id": "s3", "image": None},
        {"pack_id": "1039", "ko_name": "마이티 컨텐더즈", "mdm_set_id": "s4", "image": None},
    ], "images": {
        "03_13668": {"file_card_id": 13668}, "03_3899": {"file_card_id": 3899, "alt_art": True, "pack_ids": ["2116"]},
        "03_13999": {"file_card_id": 13999, "alt_art": True, "pack_ids": ["2116"]},
        "03_17614": {"file_card_id": 17614}, "03_13172": {"file_card_id": 13172},
    }}

    def setUp(self):
        kagari = Card.objects.create(id=13668, category="monster", name_ja="k", name_en="k", frame="link")
        MdPrint.objects.create(md_id=13668, card=kagari, rarity="SR")
        MdPrint.objects.create(md_id=3899, card=kagari, is_alt_art=True, rarity="UR")
        other = Card.objects.create(id=5, category="spell", name_ja="o", name_en="o", frame="spell")
        MdPrint.objects.create(md_id=5, card=other, rarity="N")

    def sync(self):
        return md_packs.sync([mdm_set("s1", "Singular Strike Overthrow"), mdm_set("s2", "Warriors Unite!"),
                              mdm_set("s3", "Revival of Legends", kind="Selection Pack"),
                              mdm_set("s4", "Mighty Contenders", kind="Normal Pack")],
                             [mdm_card(13668, "SR", "s1"), mdm_card(5, "N", "s1", "s2")],
                             pack_map=md_packs.load_pack_map(self.MAP))

    def test_names_and_covers(self):
        self.sync()
        got = {p.mdm_id: (p.game_id, p.name_ko, p.cover) for p in MdPack.objects.all()}
        self.assertEqual(got["s1"], (2116, "싱귤러 스트라이크 오버스로", "03_3899"))   # the campaign cover
        self.assertEqual(got["s2"], (2009, "워리어즈 유나이트", "03_17614"))          # a plain second cover: the usual one
        self.assertEqual(got["s3"], (1001, "리바이벌", ""))
        # MDM calls it a normal pack; the game numbers it a selection pack
        self.assertEqual(MdPack.objects.get(mdm_id="s4").kind, MdPack.Kind.SELECTION)

    def test_the_cover_art_comes_in_the_pack(self):
        self.sync()
        self.assertEqual(sorted(MdPack.objects.get(mdm_id="s1").cards.values_list("md_print_id", "rarity")),
                         [(5, "N"), (3899, "UR")])
        # and stays so when MDM is read again
        self.assertEqual(self.sync()["changed"] + self.sync()["added"], 0)


class CampaignTest(TestCase):
    """An other art that came for a while in every pack holding the card (Yugipedia: "Master Packs / Selection Packs /
    Secret Packs") makes a version of each selection and secret pack on sale then, beside its usual one; the master
    pack keeps its usual arts; one from a set named for it is in that set (엘리스 2026-10-13)."""

    PAGE = """{{Master Duel card
| rarity      = UR
| alternate_art = 2; February 7, 2024 - April 11, 2024 * February 5, 2026 - April 9, 2026; 1st Anniversary Bundle
3; February 5, 2026 - April 28, 2026
4; August 19, 2026 - October 6, 2026; WCS 2026 Special Collection
| extended_art = 1; August 5, 2026 - October 6, 2026
| ja_name     = ブラック・マジシャン

| fr_name     = x
}}"""

    def test_parse(self):
        got = md_packs.parse_campaigns("Dark Magician (Master Duel)", self.PAGE)
        self.assertEqual([(g["overframe"], g["art"], g["source"]) for g in got],
                         [(False, 2, "1st Anniversary Bundle"), (False, 3, ""), (False, 4, "WCS 2026 Special Collection"),
                          (True, 1, "")])
        self.assertEqual(got[0]["spans"], [("2024-02-07", "2024-04-11"), ("2026-02-05", "2026-04-09")])
        self.assertEqual((got[0]["card"], got[0]["ja"]), ("Dark Magician", "ブラック・マジシャン"))

    def setUp(self):
        def card(cid, name):
            c = Card.objects.create(id=cid, category="monster", name_ja=name, name_en=name, frame="effect")
            MdPrint.objects.create(md_id=cid, card=c, rarity="UR")
            MdPrint.objects.create(md_id=cid * 10, card=c, is_alt_art=True, rarity="UR")
        card(5, "Knight")    # in packs on sale then and not
        card(7, "Magician")  # its art came from a set named for it
        self.sets = [
            mdm_set("m", "Master Pack", kind="Normal Pack", release="2022-01-19T00:00:00.000Z"),
            dict(mdm_set("on", "On Sale", kind="Selection Pack", release="2026-01-08T00:00:00.000Z"), expires="2026-03-01T00:00:00.000Z"),
            dict(mdm_set("off", "Long Gone", kind="Selection Pack", release="2024-05-09T00:00:00.000Z"), expires="2024-07-11T00:00:00.000Z"),
            mdm_set("sec", "Old Secret", release="2022-01-19T00:00:00.000Z"),
            mdm_set("late", "Later Secret", release="2026-06-01T00:00:00.000Z"),
            dict(mdm_set("wcs", "WCS 2026 Special Collection", kind="Selection Pack", release="2026-08-19T00:00:00.000Z"),
                 expires="2026-10-06T00:00:00.000Z"),
        ]
        self.cards = [mdm_card(5, "UR", "m", "on", "off", "sec", "late"), mdm_card(7, "UR", "sec", "wcs")]

    def sync(self, campaigns, pack_map=None):
        md_packs.sync(self.sets, self.cards, pack_map=pack_map, campaigns=campaigns)
        return {p.mdm_id: (sorted(p.cards.values_list("md_print_id", flat=True)),
                           [(str(v.start), str(v.end), v.swaps) for v in p.versions.all()]) for p in MdPack.objects.all()}

    def test_versions_of_the_packs_on_sale_then(self):
        got = self.sync({50: {"spans": [("2024-06-01", "2024-06-30"), ("2026-02-05", "2026-04-09")], "source": ""}})
        self.assertEqual(got["on"], ([5], [("2026-02-05", "2026-03-01", {"5": 50})]))   # until its sale ended
        self.assertEqual(got["sec"][1], [("2024-06-01", "2024-06-30", {"5": 50}), ("2026-02-05", "2026-04-09", {"5": 50})])
        self.assertEqual(got["sec"][0], [5, 7])                          # the usual pack keeps the usual art
        self.assertEqual(got["off"][1], [("2024-06-01", "2024-06-30", {"5": 50})])
        self.assertEqual((got["late"][1], got["m"]), ([], ([5], [])))  # not out yet; the master pack is left alone

    def test_a_set_named_for_it(self):
        got = self.sync({70: {"spans": [("2026-08-19", "2026-10-06")], "source": "WCS 2026 Special Collection"}})
        self.assertEqual((got["wcs"], got["sec"][0]), (([70], []), [5, 7]))

    def test_versions_follow_the_source(self):
        self.sync({50: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}})
        got = self.sync({})
        self.assertEqual(got["on"], ([5], []))

    def test_a_cover_never_puts_a_campaign_art_in_the_usual_pack(self):
        # Yugipedia's days rule an art it records: a pack out after them keeps the usual art though a cover shows it
        # (엘리스 10/13: 마스카레나's 2023 art stood in 스타는 가면 속에서 웃는다's usual pack, so its 2026 art had no card to
        # stand in for)
        pack_map = {"late": {"game_id": 2300, "name_ko": "", "cover": "03_5", "arts": [("03_50", 50)]}}
        got = self.sync({50: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}}, pack_map=pack_map)
        self.assertEqual(got["late"], ([5], []))
        # a pack on sale then that shows it: a version, with that cover
        pack_map = {"sec": {"game_id": 2001, "name_ko": "", "cover": "03_1", "arts": [("03_50", 50)]}}
        self.sync({50: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}}, pack_map=pack_map)
        v = MdPack.objects.get(mdm_id="sec").versions.get()
        self.assertEqual((v.swaps, v.cover), ({"5": 50}, "03_50"))

    def test_a_pack_out_the_day_a_campaign_ends(self):
        # out on the campaign's last day: it was not sold with that art
        self.sets.append(dict(mdm_set("new", "Out That Day", kind="Selection Pack", release="2026-04-09T07:00:00.000Z"),
                              expires="2026-09-03T00:00:00.000Z"))
        self.cards = [mdm_card(5, "UR", "new")]
        got = self.sync({50: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}})
        self.assertEqual(got["new"], ([5], []))

    def test_days_within_the_packs_sale(self):
        got = self.sync({50: {"spans": [("2025-12-01", "2026-02-15")], "source": ""}})
        self.assertEqual(got["on"][1], [("2026-01-08", "2026-02-15", {"5": 50})])   # from its release
        got = self.sync({50: {"spans": [("2026-02-01", "2026-06-30")], "source": ""}})
        self.assertEqual(got["on"][1], [("2026-02-01", "2026-03-01", {"5": 50})])   # to its end

    def test_an_art_mdm_puts_in_the_pack_comes_in_its_version(self):
        # MDM lists the campaign art as the pack's own; Yugipedia says when it came: the usual art in the usual pack
        self.cards = [mdm_card(5, "UR", "on", alt=True, release="2026-02-01T00:00:00.000Z")]
        got = self.sync({50: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}})
        self.assertEqual(got["on"], ([5], [("2026-02-05", "2026-03-01", {"5": 50})]))

    def test_an_art_mdm_lists_beside_the_usual_one_comes_in_its_version(self):
        # MDM lists the usual card and the campaign's art both: the usual pack holds the usual one, at its own rarity,
        # under its own cover (엘리스 10/13: 아르테미스's 2026 art, a UR, stood in 지식을 통괄하는 마도왕 of 2022)
        c = Card.objects.create(id=9, category="monster", name_ja="Maiden", name_en="Maiden", frame="effect")
        MdPrint.objects.create(md_id=9, card=c, rarity="SR")
        MdPrint.objects.create(md_id=90, card=c, is_alt_art=True, rarity="UR")
        pack_map = {"sec": {"game_id": 2001, "name_ko": "", "cover": "03_9", "arts": [("03_90", 90)]}}
        camp = {90: {"spans": [("2026-10-06", "2026-12-04")], "source": ""}}
        art = mdm_card(9, "UR", "sec", alt=True, release="2026-10-06T00:00:00.000Z")
        for listed in ([mdm_card(9, "SR", "sec"), art], [art]):
            self.cards = listed
            got = self.sync(camp, pack_map=pack_map)
            self.assertEqual(got["sec"], ([9], [("2026-10-06", "2026-12-04", {"9": 90})]))
            p = MdPack.objects.get(mdm_id="sec")
            self.assertEqual((p.cover, p.versions.get().cover, p.cards.get().rarity), ("03_9", "03_90", "SR"))

    def test_a_pack_sold_only_while_it_ran(self):
        # the campaign ran the whole time the pack was sold: there was never a usual one (엘리스 10/13: 파워업 셀렉션)
        got = self.sync({50: {"spans": [("2026-01-08", "2026-03-01")], "source": ""}})
        self.assertEqual(got["on"], ([50], []))
        got = self.sync({50: {"spans": [("2025-12-01", "2026-05-01")], "source": ""}})
        self.assertEqual(got["on"], ([50], []))

    def test_resolve_names_to_prints(self):
        MdPrint.objects.create(md_id=52, card_id=5, is_alt_art=True, rarity="UR")
        got = md_packs.campaign_prints(
            [{"card": "Knight", "ja": "", "overframe": False, "art": 3, "spans": [("2026-02-05", "2026-04-09")], "source": ""},
             {"card": "Nobody", "ja": "Magician", "overframe": False, "art": 2, "spans": [], "source": "x"},
             {"card": "Nobody", "ja": "", "overframe": False, "art": 2, "spans": [], "source": ""}],
            overframe=lambda md_id: False)
        self.assertEqual(got, {52: {"spans": [("2026-02-05", "2026-04-09")], "source": ""}, 70: {"spans": [], "source": "x"}})


class LineupTest(TestCase):
    """A secret pack whose cards changed: Yugipedia notes each card added or removed and when; each lineup sold before
    today's is a version of the pack, and today's lineup dates from its last change (엘리스 2026-10-13: "내용물이 변경된
    카드팩은 모든 버전을 수록")."""

    PAGE = """{{Infobox Master Duel set
| type            = [[Secret Pack]]
| internal_number = 2120
| release_date    = January 19, 2022
}}

== List ==
{{Master Duel set list|print=reprint|columns=Notes|
Alpha (Master Duel); Ultra Rare
Beta  (Master Duel) ; Super Rare; New
Gamma (Updated) (Master Duel);Rare
Delta (Master Duel); Ultra Rare// @Notes::Added on June 4, 2026
Future (Master Duel); Common // @Notes::Added on January 1, 2099
}}

=== Removed cards ===
{{Master Duel set list|columns=Notes|
Epsilon (Master Duel); Common // @Notes::Removed on June 4, 2026
Zeta (Master Duel); Rare // @Notes::Added on May 9, 2025. Removed on November 7, 2025
}}
"""

    def test_parse(self):
        game_id, entries = md_packs.parse_set_list(self.PAGE)
        self.assertEqual(game_id, 2120)
        self.assertEqual([(e["card"], e["rarity"], e["added"], e["removed"]) for e in entries], [
            ("Alpha", "UR", None, None), ("Beta", "SR", None, None), ("Gamma (Updated)", "R", None, None),
            ("Delta", "UR", "2026-06-04", None), ("Future", "N", "2099-01-01", None),
            ("Epsilon", "N", None, "2026-06-04"), ("Zeta", "R", "2025-05-09", "2025-11-07")])

    def setUp(self):
        for cid, name, rarity in ((1, "Alpha", "UR"), (2, "Beta", "SR"), (3, "Gamma (Updated) (Updated from: Gamma)", "R"),
                                  (4, "Delta", "UR"), (5, "Epsilon", "N"), (6, "Zeta", "R"), (7, "Future", "N")):
            c = Card.objects.create(id=cid, category="monster", name_ja=name, name_en=name, frame="effect")
            MdPrint.objects.create(md_id=cid, card=c, rarity=rarity)
        MdPrint.objects.create(md_id=20, card_id=2, is_alt_art=True, rarity="UR")
        self.sets = [mdm_set("sec", "Old Secret", release="2022-01-19T00:00:00.000Z")]
        self.cards = [mdm_card(i, r, "sec") for i, r in ((1, "UR"), (2, "SR"), (3, "R"), (4, "UR"))]
        self.pack_map = {"sec": {"game_id": 2120, "name_ko": "", "cover": "03_1", "arts": []}}
        self.lineups = {2120: md_packs.parse_set_list(self.PAGE)[1]}

    def sync(self, campaigns=None):
        out = md_packs.sync(self.sets, self.cards, pack_map=self.pack_map, campaigns=campaigns, lineups=self.lineups)
        p = MdPack.objects.get(mdm_id="sec")
        return out, p, [(str(v.start), str(v.end), v.swaps, v.missing, v.extra, v.cover) for v in p.versions.all()]

    def test_each_lineup_sold_before_today_is_a_version(self):
        out, p, versions = self.sync()
        self.assertEqual(sorted(p.cards.values_list("md_print_id", flat=True)), [1, 2, 3, 4])   # today's, as MDM lists it
        self.assertEqual(str(p.changed), "2026-06-04")
        self.assertEqual(versions, [
            ("2022-01-19", "2025-05-09", {}, [4], {"5": "N"}, "03_1"),
            ("2025-05-09", "2025-11-07", {}, [4], {"5": "N", "6": "R"}, "03_1"),
            ("2025-11-07", "2026-06-04", {}, [4], {"5": "N"}, "03_1")])
        self.assertEqual(out["lineups"], 1)

    def test_names_yugipedia_spells_otherwise_are_reported_and_left_out(self):
        self.lineups[2120].append({"card": "Nobody", "rarity": "N", "added": "2026-06-04", "removed": None})
        out, p, versions = self.sync()
        self.assertEqual(out["unresolved"], ["Nobody"])
        self.assertEqual(versions[0][3:5], ([4], {"5": "N"}))

    def test_a_card_with_no_english_name_by_its_japanese_one(self):
        c = Card.objects.create(id=8, category="monster", name_ja="紅き龍", name_en="", frame="effect")
        MdPrint.objects.create(md_id=8, card=c, rarity="UR")
        self.cards.append(mdm_card(8, "UR", "sec"))
        self.lineups[2120].append({"card": "Crimson Dragon", "ja": "紅き 龍", "rarity": "UR", "added": "2026-06-04", "removed": None})
        out, p, versions = self.sync()
        self.assertEqual((out["unresolved"], versions[0][3]), ([], [4, 8]))

    def test_an_older_lineup_from_the_day_it_sold_plain(self):
        # a campaign from the day the cards changed: that lineup without the arts sold from when it ended (엘리스 10/13:
        # 마술의 탐구자들's lineup of 2025-09-10 sold plain from 10/28)
        out, p, versions = self.sync({20: {"spans": [("2025-05-09", "2025-06-01")], "source": ""}})
        self.assertEqual(versions[1:3], [("2025-05-09", "2025-06-01", {"2": 20}, [4], {"5": "N", "6": "R"}, "03_1"),
                                         ("2025-06-01", "2025-11-07", {}, [4], {"5": "N", "6": "R"}, "03_1")])

    def test_a_lineup_sold_only_while_a_campaign_ran(self):
        # 엘리스 10/13: 챌린저즈 컬렉션's cards changed on 6/4, the day its 오버프레임 came, which ran till the pack ended;
        # today's lineup was never sold without it
        self.sets.append(dict(mdm_set("sel", "Short Selection", kind="Selection Pack", release="2026-01-08T00:00:00.000Z"),
                              expires="2026-03-01T00:00:00.000Z"))
        self.cards = [mdm_card(i, r, "sel") for i, r in ((1, "UR"), (2, "SR"), (4, "UR"))]
        self.pack_map["sel"] = {"game_id": 1100, "name_ko": "", "cover": "02_1", "arts": []}
        self.lineups[1100] = [{"card": "Alpha", "rarity": "UR", "added": None, "removed": None},
                              {"card": "Beta", "rarity": "SR", "added": None, "removed": None},
                              {"card": "Delta", "rarity": "UR", "added": "2026-02-01", "removed": None},
                              {"card": "Epsilon", "rarity": "N", "added": None, "removed": "2026-02-01"}]
        md_packs.sync(self.sets, self.cards, pack_map=self.pack_map, lineups=self.lineups,
                      campaigns={20: {"spans": [("2026-02-01", "2026-04-09")], "source": ""}})
        p = MdPack.objects.get(mdm_id="sel")
        self.assertEqual(sorted(p.cards.values_list("md_print_id", flat=True)), [1, 4, 20])
        self.assertEqual([(str(v.start), str(v.end), v.swaps, v.missing, v.extra) for v in p.versions.all()],
                         [("2026-01-08", "2026-02-01", {}, [4], {"5": "N"})])

    def test_fetch(self):
        # the pack pages in the two categories, then the card pages of names the card DB lacks, for their Japanese names
        pages = {"Old Secret": self.PAGE.replace("Delta (Master Duel)", "Crimson Dragon (Master Duel)"),
                 "Crimson Dragon": "{{CardTable2\n| ja_name = {{Ruby|紅|あか}}き龍\n}}"}
        def get(url, params, **kw):
            if params.get("list") == "categorymembers":
                body = {"query": {"categorymembers": [{"title": "Old Secret"}] if "Secret" in params["cmtitle"] else []}}
            else:
                body = {"query": {"pages": {t: {"title": t, "revisions": [{"*": pages[t]}]} for t in params["titles"].split("|")}}}
            return mock.Mock(json=lambda: body, raise_for_status=lambda: None)
        got = md_packs.fetch_set_lists(get=get, pause=0)
        self.assertEqual([(e["card"], e.get("ja")) for e in got[2120] if e["added"] == "2026-06-04"], [("Crimson Dragon", "紅き龍")])

    def test_a_pack_that_never_changed_has_no_lineup_versions(self):
        self.lineups = {}
        out, p, versions = self.sync()
        self.assertEqual((p.changed, versions), (None, []))

    def test_a_campaign_comes_in_the_lineup_sold_then(self):
        out, p, versions = self.sync({20: {"spans": [("2024-08-08", "2024-10-10"), ("2026-05-01", "2026-07-01")], "source": ""}})
        self.assertIn(("2024-08-08", "2024-10-10", {"2": 20}, [4], {"5": "N"}, "03_1"), versions)
        # one running when the lineup changed: a version for each lineup
        self.assertIn(("2026-05-01", "2026-06-04", {"2": 20}, [4], {"5": "N"}, "03_1"), versions)
        self.assertIn(("2026-06-04", "2026-07-01", {"2": 20}, [], {}, "03_1"), versions)


class MasterListTest(TestCase):
    """The master pack holds what AppMedia's list of it holds (엘리스 2026-10-13: "appmedia를 따라갑시다"), besides what
    MDM lists — MDM leaves out many cards the game put in it later."""

    HTML = """<tr><td data-val1='S：Pリトルナイト' data-val2='x'>
        <img src='https://appmedia.jp/wp-content/themes/appmedia/lib/yugioh/yugioh_md_img/ur.png'><a>S：Pリトルナイト</a></td></tr>
        <tr><td data-val1='灰流うらら' data-val5='効果'>
        <img src='https://appmedia.jp/x/yugioh_md_img/ur.png'><a>灰流うらら</a></td></tr>
        <tr><td data-val1='知らないカード'><img src='https://appmedia.jp/x/yugioh_md_img/n.png'></td></tr>"""

    def test_parse(self):
        self.assertEqual(md_packs.parse_master_list(self.HTML),
                         {"S：Pリトルナイト": "UR", "灰流うらら": "UR", "知らないカード": "N"})

    def test_the_master_pack_takes_them(self):
        knight = Card.objects.create(id=19188, category="monster", name_ja="Ｓ：Ｐリトルナイト", name_en="S:P Little Knight", frame="link")
        MdPrint.objects.create(md_id=19188, card=knight, rarity="UR")
        MdPrint.objects.create(md_id=22747, card=knight, is_alt_art=True, rarity="UR")
        Card.objects.create(id=1, category="spell", name_ja="1", name_en="1", frame="spell")
        MdPrint.objects.create(md_id=1, card_id=1, rarity="N")
        master = md_packs.master_list_prints({"S：Pリトルナイト": "UR", "知らないカード": "N"})
        self.assertEqual(master, {19188: "UR"})
        md_packs.sync([mdm_set("m", "Master Pack", kind="Normal Pack"), mdm_set("s", "Secret")],
                      [mdm_card(1, "N", "m"), mdm_card(19188, "UR", "s")], master=master)
        self.assertEqual(sorted(MdPack.objects.get(mdm_id="m").cards.values_list("md_print_id", "rarity")), [(1, "N"), (19188, "UR")])
        self.assertEqual(list(MdPack.objects.get(mdm_id="s").cards.values_list("md_print_id", flat=True)), [19188])


class CommandTest(TestCase):
    def setUp(self):
        import shutil
        import tempfile
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def test_command(self):
        Card.objects.create(id=1, category="spell", name_ja="1", name_en="1", frame="spell")
        MdPrint.objects.create(md_id=1, card_id=1, rarity="R")
        out = StringIO()
        with override_settings(MD_PACK_MAP="/nonexistent/pack_map.json", MD_ALT_CAMPAIGNS=f"{self.dir}/campaigns.json",
                               MD_MASTER_LIST=f"{self.dir}/master.json", MD_SET_LISTS=f"{self.dir}/set_lists.json"), \
             mock.patch.object(md_packs, "fetch_set_lists", return_value={}), \
             mock.patch.object(md_packs, "fetch_sets", return_value=[mdm_set("s1", "Pack")]), \
             mock.patch.object(md_packs, "fetch_cards", return_value=[mdm_card(1, "R", "s1")]), \
             mock.patch.object(md_packs, "fetch_campaigns", return_value=[]), \
             mock.patch.object(md_packs, "fetch_master_list", return_value={}):
            call_command("import_md_packs", stdout=out)
        self.assertIn("md packs: 1 packs, 1 cards", out.getvalue())
        self.assertEqual(MdPackCard.objects.count(), 1)

    def test_set_lists_kept_for_when_yugipedia_is_away(self):
        import requests
        path = f"{self.dir}/set_lists.json"
        with mock.patch.object(md_packs, "fetch_set_lists", return_value={2120: [{"card": "x"}]}):
            self.assertEqual(md_packs.load_set_lists(path), {2120: [{"card": "x"}]})
        with mock.patch.object(md_packs, "fetch_set_lists", side_effect=requests.ConnectionError):
            self.assertEqual(md_packs.load_set_lists(path), {2120: [{"card": "x"}]})
            self.assertEqual(md_packs.load_set_lists(f"{self.dir}/none.json"), {})

    def test_campaigns_kept_for_when_yugipedia_is_away(self):
        import requests
        path = f"{self.dir}/campaigns.json"
        entry = {"card": "x", "ja": "", "overframe": False, "art": 2, "spans": [["2026-02-05", "2026-04-09"]], "source": ""}
        with mock.patch.object(md_packs, "fetch_campaigns", return_value=[entry]):
            self.assertEqual(md_packs.load_campaigns(path), [entry])
        with mock.patch.object(md_packs, "fetch_campaigns", side_effect=requests.ConnectionError):
            self.assertEqual(md_packs.load_campaigns(path), [entry])
            self.assertEqual(md_packs.load_campaigns(f"{self.dir}/none.json"), [])


class PackApiTest(TestCase):
    def setUp(self):
        import tempfile
        from django.test import override_settings
        from . import packs
        self.media = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, self.media)
        over = override_settings(MEDIA_ROOT=self.media, MEDIA_URL="/media/")
        over.enable()
        self.addCleanup(over.disable)
        packs._cache.update(key=None)
        import os
        os.makedirs(os.path.join(self.media, "cards/face_thumb"))
        os.makedirs(os.path.join(self.media, "md_ui/packs"))
        for cid, rarity in ((1, "UR"), (2, "N"), (3, "R")):
            c = Card.objects.create(id=cid, category="spell", name_ja=f"j{cid}", name_ko=f"카드{cid}", frame="spell")
            MdPrint.objects.create(md_id=cid, card=c, rarity=rarity)
            if cid != 3:   # a print with no face drawn yet is left out
                open(os.path.join(self.media, f"cards/face_thumb/{cid}.webp"), "wb").close()
        os.makedirs(os.path.join(self.media, "md_ui/packs/hd"))
        for rel in ("md_ui/packs/03_8039.webp", "md_ui/packs/hd/03_8039.webp"):
            open(os.path.join(self.media, rel), "wb").close()
        md_packs.sync([mdm_set("m", "Master Pack", kind="Normal Pack", release="2022-01-19T00:00:00.000Z"),
                       mdm_set("s", "Cell", release="2026-10-06T00:00:00.000Z"),
                       mdm_set("d", "Deck", kind="Structure Deck"), mdm_set("b", "Xyz Reward", kind="Bonus Pack")],
                      [mdm_card(1, "UR", "m", "s", "b"), mdm_card(2, "N", "m", "s", "d"), mdm_card(3, "R", "s")])
        MdPack.objects.filter(mdm_id="s").update(game_id=2001, name_ko="세포 A", cover="03_8039")

    def test_list(self):
        r = self.client.get("/api/carddb/packs/").json()["packs"]
        self.assertEqual([p["name"] for p in r], ["세포 A", "Master Pack"])   # newest first, openable only
        self.assertEqual(r[0]["counts"], {"UR": 1, "SR": 0, "R": 1, "N": 1})
        self.assertEqual(r[0]["image"], "/media/md_ui/packs/03_8039.webp")
        self.assertEqual((r[0]["master"], r[1]["master"], r[1]["image"]), (False, True, None))

    def test_pack(self):
        s = MdPack.objects.get(mdm_id="s")
        r = self.client.get(f"/api/carddb/packs/{s.id}/").json()
        self.assertEqual(r["master_pack"], MdPack.objects.get(mdm_id="m").id)
        self.assertEqual(r["image_hd"], "/media/md_ui/packs/hd/03_8039.webp")
        self.assertEqual(sorted((c["print"], c["rarity"], c["name"]) for c in r["cards"]), [(1, "UR", "카드1"), (2, "N", "카드2")])
        self.assertTrue(r["cards"][0]["thumb"].startswith("/media/cards/face_thumb/"))

    def test_not_openable(self):
        d = MdPack.objects.get(mdm_id="d")
        self.assertEqual(self.client.get(f"/api/carddb/packs/{d.id}/").status_code, 404)
