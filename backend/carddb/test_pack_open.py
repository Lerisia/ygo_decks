import os
import random
import shutil
import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from user.gems import change_gems
from user.models import User

from . import pack_draw, packs
from .models import Card, MdPack, MdPackCard, MdPrint, PackPull, PackTally

BAND = {"UR": 0.001, "SR": 0.05, "R": 0.3, "N": 0.99}


def cycle(*xs):
    """Each card asks three times: its rarity, its finish, then which card."""
    state = {"i": 0}

    def rng():
        x = xs[state["i"] % len(xs)]
        state["i"] += 1
        return x
    return rng


def always(r, finish=0.99):
    return cycle(BAND[r], finish, 0)


def pool(tag):
    return {r: [f"{tag}-{r}"] for r in ("N", "R", "SR", "UR")}


class DrawTest(SimpleTestCase):
    normal = {"main": pool("m"), "master": None}
    secret = {"main": pool("pick"), "master": pool("master")}

    def test_eight_cards_the_eighth_r_or_higher(self):
        cards = pack_draw.draw_pack(self.normal, always("N"))
        self.assertEqual([c["rarity"] for c in cards], ["N"] * 7 + ["R"])

    def test_secret_first_four_from_the_master_pack(self):
        cards = pack_draw.draw_pack(self.secret, always("SR"))
        self.assertEqual([c["card"] for c in cards], ["master-SR"] * 4 + ["pick-SR"] * 4)

    def test_tenth_pack_and_the_owed_ur(self):
        packs_, owed = pack_draw.draw_ten(self.normal, False, always("N"))
        self.assertEqual(packs_[9][7]["rarity"], "SR")
        self.assertTrue(owed)
        packs_, owed = pack_draw.draw_ten(self.normal, True, always("N"))
        self.assertEqual(packs_[9][7]["rarity"], "UR")
        self.assertFalse(owed)

    def test_royal_for_sr_and_ur_only(self):
        self.assertEqual({c["finish"] for c in pack_draw.draw_pack(self.normal, cycle(BAND["N"], 0.0001, 0))}, {"shine"})
        self.assertEqual({c["finish"] for c in pack_draw.draw_pack(self.normal, cycle(BAND["UR"], 0.0001, 0))}, {"royal"})

    def test_the_published_odds(self):
        rng = random.Random(42).random
        n = {"N": 0, "R": 0, "SR": 0, "UR": 0}
        shine = royal = 0
        for _ in range(30000):
            for c in pack_draw.draw_pack(self.normal, rng)[:7]:
                n[c["rarity"]] += 1
                shine += c["finish"] == "shine"
                royal += c["finish"] == "royal"
        total = 30000 * 7
        for r, p in pack_draw.SLOT.items():
            self.assertAlmostEqual(n[r] / total, p, delta=0.004)
        self.assertAlmostEqual(shine / total, 0.9 * 0.1 + 0.1 * 0.09, delta=0.003)
        self.assertAlmostEqual(royal / total, 0.1 * 0.01, delta=0.0006)


class OpenTest(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media)
        over = override_settings(MEDIA_ROOT=self.media, MEDIA_URL="/media/")
        over.enable()
        self.addCleanup(over.disable)
        packs._cache.update(key=None)
        os.makedirs(os.path.join(self.media, "cards/face_thumb"))
        self.master = MdPack.objects.create(mdm_id="m", kind="normal", name_en="Master Pack", name_ko="마스터 팩")
        self.secret = MdPack.objects.create(mdm_id="s", kind="secret", name_en="Cell", name_ko="세포")
        for i, r in enumerate(("N", "R", "SR", "UR")):
            for pack, base in ((self.master, 100), (self.secret, 200)):
                cid = base + i
                c = Card.objects.create(id=cid, category="spell", name_ja=str(cid), name_ko=f"카드{cid}", frame="spell")
                MdPrint.objects.create(md_id=cid, card=c, rarity=r)
                MdPackCard.objects.create(pack=pack, md_print_id=cid, rarity=r)
                open(os.path.join(self.media, f"cards/face_thumb/{cid}.webp"), "wb").close()
        self.user = User.objects.create_user(email="a@test.com", username="duelist", password="pass1234")
        self.client = APIClient()

    def open(self, pack, count, rng):
        with mock.patch.object(packs, "_rng", rng):
            return self.client.post(f"/api/carddb/packs/{pack.id}/open/", {"count": count}, format="json")

    def test_guests_sign_in_first(self):
        r = self.client.post(f"/api/carddb/packs/{self.master.id}/open/", {"count": 1}, format="json")
        self.assertIn(r.status_code, (401, 403))

    def test_not_enough_gems(self):
        self.client.force_authenticate(self.user)
        change_gems(self.user, 50, "admin_grant")
        r = self.open(self.master, 1, always("N"))
        self.assertEqual((r.status_code, r.json()["gems"]), (400, 50))
        self.assertFalse(PackPull.objects.exists())

    def test_a_pack_costs_gems_and_goes_to_the_collection(self):
        self.client.force_authenticate(self.user)
        change_gems(self.user, 1000, "admin_grant")
        r = self.open(self.master, 1, always("N")).json()
        self.assertEqual(r["gems"], 900)
        cards = r["packs"][0]
        self.assertEqual([c["print"] for c in cards], [100] * 7 + [101])
        self.assertTrue(all(c["new"] for c in cards))
        self.assertEqual(sorted(PackPull.objects.values_list("md_print_id", "finish", "count")), [(100, "basic", 7), (101, "basic", 1)])
        self.assertEqual(r["tally"], {"gems": 100, "packs": 1, "ur": 0, "sr": 0, "owed": False})
        # pulled before: no longer new; counts add up
        r = self.open(self.master, 1, always("N")).json()
        self.assertFalse(any(c["new"] for c in r["packs"][0]))
        self.assertEqual(PackPull.objects.get(md_print_id=100).count, 14)

    def test_ten_without_a_ur_owe_one(self):
        self.client.force_authenticate(self.user)
        change_gems(self.user, 2000, "admin_grant")
        r = self.open(self.master, 10, always("N")).json()
        self.assertEqual((r["gems"], r["tally"]["owed"], r["packs"][9][7]["rarity"]), (1000, True, "SR"))
        r = self.open(self.master, 10, always("N")).json()
        self.assertEqual((r["packs"][9][7]["rarity"], r["tally"]["owed"]), ("UR", False))
        self.assertEqual(PackTally.objects.get().packs, 20)

    def test_a_secret_pack_draws_its_first_four_from_the_master_pack(self):
        self.client.force_authenticate(self.user)
        change_gems(self.user, 100, "admin_grant")
        r = self.open(self.secret, 1, always("SR")).json()
        self.assertEqual([c["print"] for c in r["packs"][0]], [102] * 4 + [202] * 4)

    def test_mine_and_collection(self):
        r = self.client.get(f"/api/carddb/packs/{self.master.id}/mine/").json()
        self.assertFalse(r["signed_in"])
        self.client.force_authenticate(self.user)
        change_gems(self.user, 1000, "admin_grant")
        self.open(self.master, 1, cycle(BAND["UR"], 0.005, 0))   # all UR, royal
        r = self.client.get(f"/api/carddb/packs/{self.master.id}/mine/").json()
        self.assertEqual((r["gems"], r["tally"]["ur"]), (900, 8))
        c = self.client.get("/api/carddb/packs/collection/").json()
        self.assertEqual(c["summary"], {"kinds": 1, "total": 8, "ur": 1, "sr": 0, "shine": 0, "royal": 8, "gems_spent": 100, "packs": 1})
        self.assertEqual((c["cards"][0]["print"], c["cards"][0]["royal"], c["cards"][0]["name"]), (103, 8, "카드103"))
