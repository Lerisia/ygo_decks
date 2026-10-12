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
                              mdm_set("s3", "Revival of Legends", kind="Selection Pack")],
                             [mdm_card(13668, "SR", "s1"), mdm_card(5, "N", "s1", "s2")],
                             pack_map=md_packs.load_pack_map(self.MAP))

    def test_names_and_covers(self):
        self.sync()
        got = {p.mdm_id: (p.game_id, p.name_ko, p.cover) for p in MdPack.objects.all()}
        self.assertEqual(got["s1"], (2116, "싱귤러 스트라이크 오버스로", "03_3899"))   # the campaign cover
        self.assertEqual(got["s2"], (2009, "워리어즈 유나이트", "03_17614"))          # a plain second cover: the usual one
        self.assertEqual(got["s3"], (1001, "리바이벌", ""))

    def test_the_cover_art_comes_in_the_pack(self):
        self.sync()
        self.assertEqual(sorted(MdPack.objects.get(mdm_id="s1").cards.values_list("md_print_id", "rarity")),
                         [(5, "N"), (3899, "UR")])
        # and stays so when MDM is read again
        self.assertEqual(self.sync()["changed"] + self.sync()["added"], 0)


class CommandTest(TestCase):
    @override_settings(MD_PACK_MAP="/nonexistent/pack_map.json")
    def test_command(self):
        Card.objects.create(id=1, category="spell", name_ja="1", name_en="1", frame="spell")
        MdPrint.objects.create(md_id=1, card_id=1, rarity="R")
        out = StringIO()
        with mock.patch.object(md_packs, "fetch_sets", return_value=[mdm_set("s1", "Pack")]), \
             mock.patch.object(md_packs, "fetch_cards", return_value=[mdm_card(1, "R", "s1")]):
            call_command("import_md_packs", stdout=out)
        self.assertIn("md packs: 1 packs, 1 cards", out.getvalue())
        self.assertEqual(MdPackCard.objects.count(), 1)


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
