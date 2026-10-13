import os
import random
import shutil
import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from user.gems import change_gems
from user.models import GemTransaction, User

from . import pack_draw, packs
from .models import Card, MdPack, MdPackCard, MdPackVersion, MdPrint, PackTally

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

    def test_guests_open_packs_too(self):
        # 엘리스 2026-10-13: open to all; a guest's tally lives in their browser, which says whether a UR is owed
        with mock.patch.object(packs, "_rng", always("N")):
            r = self.client.post(f"/api/carddb/packs/{self.master.id}/open/", {"count": 10}, format="json")
            self.assertEqual(r.status_code, 200)
            self.assertEqual((r.json()["gems"], r.json()["tally"]), (0, {"gems": 0, "packs": 10, "ur": 0, "sr": 1, "owed": True}))
            r = self.client.post(f"/api/carddb/packs/{self.master.id}/open/", {"count": 10, "owed": True}, format="json").json()
        self.assertEqual((r["packs"][9][7]["rarity"], r["tally"]["owed"]), ("UR", False))
        self.assertFalse(PackTally.objects.exists())

    @mock.patch.object(packs, "GEMS_PER_PACK", 100)
    def test_guests_sign_in_when_packs_cost_gems(self):
        r = self.client.post(f"/api/carddb/packs/{self.master.id}/open/", {"count": 1}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_packs_are_free_for_now(self):
        # 엘리스 2026-10-13: 0 gems a pack while the beta is for the thrill alone; still signed in only
        self.client.force_authenticate(self.user)
        r = self.open(self.master, 10, always("N"))
        self.assertEqual(r.status_code, 200)
        r = r.json()
        self.assertEqual((len(r["packs"]), r["gems"]), (10, 0))
        self.assertEqual(r["tally"], {"gems": 0, "packs": 10, "ur": 0, "sr": 1, "owed": True})
        self.assertFalse(GemTransaction.objects.exists())

    @mock.patch.object(packs, "GEMS_PER_PACK", 100)
    def test_not_enough_gems(self):
        self.client.force_authenticate(self.user)
        change_gems(self.user, 50, "admin_grant")
        r = self.open(self.master, 1, always("N"))
        self.assertEqual((r.status_code, r.json()["gems"]), (400, 50))
        self.user.refresh_from_db()
        self.assertEqual(self.user.gems, 50)

    @mock.patch.object(packs, "GEMS_PER_PACK", 100)
    def test_a_pack_costs_gems_and_its_cards_are_not_kept(self):
        # 엘리스 2026-10-13: the beta opens packs for the thrill alone, with no 카드 모음
        self.client.force_authenticate(self.user)
        change_gems(self.user, 1000, "admin_grant")
        r = self.open(self.master, 1, always("N")).json()
        self.assertEqual(r["gems"], 900)
        cards = r["packs"][0]
        self.assertEqual([c["print"] for c in cards], [100] * 7 + [101])
        self.assertFalse(any("new" in c for c in cards))
        self.assertEqual(r["tally"], {"gems": 100, "packs": 1, "ur": 0, "sr": 0, "owed": False})

    @mock.patch.object(packs, "GEMS_PER_PACK", 100)
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

    @mock.patch.object(packs, "GEMS_PER_PACK", 100)
    def test_mine(self):
        r = self.client.get(f"/api/carddb/packs/{self.master.id}/mine/").json()
        self.assertFalse(r["signed_in"])
        self.client.force_authenticate(self.user)
        change_gems(self.user, 1000, "admin_grant")
        self.open(self.master, 1, cycle(BAND["UR"], 0.005, 0))   # all UR, royal
        r = self.client.get(f"/api/carddb/packs/{self.master.id}/mine/").json()
        self.assertEqual((r["gems"], r["tally"]["ur"]), (900, 8))
        self.assertEqual(self.client.get("/api/carddb/packs/collection/").status_code, 404)

    def test_search_by_pickup_cards_not_the_master_packs(self):
        search = lambda q: self.client.get("/api/carddb/packs/search/", {"q": q}).json()["packs"]
        self.assertEqual(search("카드 202"), [{"id": self.secret.id, "cards": ["카드202"], "count": 1}])
        self.assertEqual(search("카드102"), [])
        hit = search("ㅋㄷ")
        self.assertEqual((hit[0]["id"], hit[0]["count"], len(hit[0]["cards"])), (self.secret.id, 4, 3))
        self.assertEqual(search(" "), [])

    def test_the_list_counts_new_arts_and_overframes(self):
        MdPrint.objects.filter(md_id=203).update(is_alt_art=True)
        with mock.patch("carddb.dex._overframe", lambda md_id: False):
            rows = {p["id"]: p for p in self.client.get("/api/carddb/packs/").json()["packs"] if p["version"] is None}
        self.assertEqual(rows[self.secret.id]["arts"], {"new_art": 1, "overframe": 0})
        self.assertEqual(rows[self.master.id]["arts"], {"new_art": 0, "overframe": 0})

    def test_a_campaign_version(self):
        MdPrint.objects.create(md_id=2030, card_id=203, is_alt_art=True, rarity="UR")
        open(os.path.join(self.media, "cards/face_thumb/2030.webp"), "wb").close()
        v = MdPackVersion.objects.create(pack=self.secret, start="2026-02-05", end="2026-04-09", swaps={"203": 2030})
        r = self.client.get(f"/api/carddb/packs/{self.secret.id}/").json()
        self.assertEqual([(x["id"], x["start"], [(a["print"], a["base"]) for a in x["arts"]]) for x in r["versions"]],
                         [(v.id, "2026-02-05", [(2030, 203)])])
        self.assertEqual(sorted(c["print"] for c in r["cards"]), [200, 201, 202, 203])   # the usual pack
        self.client.force_authenticate(self.user)
        change_gems(self.user, 200, "admin_grant")
        with mock.patch.object(packs, "_rng", always("UR")):
            got = self.client.post(f"/api/carddb/packs/{self.secret.id}/open/", {"count": 1, "version": v.id}, format="json").json()
            self.assertEqual([c["print"] for c in got["packs"][0]], [103] * 4 + [2030] * 4)
            bad = self.client.post(f"/api/carddb/packs/{self.secret.id}/open/", {"count": 1, "version": 999}, format="json")
        self.assertEqual(bad.status_code, 400)
        listed = [(p["id"], p["version"], p["released"], p["period"], p["featured"]) for p in self.client.get("/api/carddb/packs/").json()["packs"]
                  if p["id"] == self.secret.id]
        self.assertEqual(listed, [(self.secret.id, v.id, "2026-02-05", ["2026-02-05", "2026-04-09"], ["카드203"]),
                                  (self.secret.id, None, None, None, [])])

    def test_the_usual_pack_from_the_day_it_sold_plain(self):
        # 엘리스 10/13: a campaign from the day the cards changed: the usual pack's tile dates from when it ended, and
        # waits out one still running
        MdPrint.objects.create(md_id=2030, card_id=203, is_alt_art=True, rarity="UR")
        open(os.path.join(self.media, "cards/face_thumb/2030.webp"), "wb").close()
        MdPack.objects.filter(pk=self.secret.pk).update(released="2022-01-19", changed="2026-08-05")
        v = MdPackVersion.objects.create(pack=self.secret, start="2026-08-05", end="2026-10-06", swaps={"203": 2030})
        MdPackVersion.objects.create(pack=self.secret, start="2022-01-19", end="2026-08-05", missing=[203])   # an older lineup
        listed = lambda: [(p["version"], p["released"]) for p in self.client.get("/api/carddb/packs/").json()["packs"]
                          if p["id"] == self.secret.id]
        self.assertEqual(listed(), [(None, "2026-10-06"), (v.id, "2026-08-05"), (v.id + 1, "2022-01-19")])
        v.end = "2099-01-01"
        v.save()
        self.assertEqual([x for x, _ in listed()], [v.id, v.id + 1])

    def test_an_older_lineup(self):
        # sold until 2026-06-04 without 203 (added then) and with 299 (removed then) (엘리스 10/13)
        c = Card.objects.create(id=299, category="spell", name_ja="299", name_ko="카드299", frame="spell")
        MdPrint.objects.create(md_id=299, card=c, rarity="SR")
        open(os.path.join(self.media, "cards/face_thumb/299.webp"), "wb").close()
        MdPack.objects.filter(pk=self.secret.pk).update(released="2022-01-19", changed="2026-06-04")
        v = MdPackVersion.objects.create(pack=self.secret, start="2022-01-19", end="2026-06-04", missing=[203], extra={"299": "SR"})
        rows = [p for p in self.client.get("/api/carddb/packs/").json()["packs"] if p["id"] == self.secret.id]
        self.assertEqual([(p["version"], p["released"], p["period"], p["counts"]["UR"], p["counts"]["SR"]) for p in rows], [
            (None, "2026-06-04", None, 1, 1),   # today's lineup, from its last change
            (v.id, "2022-01-19", ["2022-01-19", "2026-06-04"], 0, 2)])
        r = self.client.get(f"/api/carddb/packs/{self.secret.id}/").json()
        self.assertEqual((r["released"], r["changed"]), ("2022-01-19", "2026-06-04"))
        x = r["versions"][0]
        self.assertEqual((sorted(c["print"] for c in x["cards"]), [c["print"] for c in x["gone"]], x["later"], x["arts"]),
                         ([200, 201, 202, 299], [299], 1, []))
        self.client.force_authenticate(self.user)
        with mock.patch.object(packs, "_rng", always("SR")):
            got = self.client.post(f"/api/carddb/packs/{self.secret.id}/open/", {"count": 1, "version": v.id}, format="json").json()
        self.assertTrue({c["print"] for c in got["packs"][0][4:]} <= {202, 299})
        hit = self.client.get("/api/carddb/packs/search/", {"q": "카드299"}).json()["packs"]
        self.assertEqual([h["id"] for h in hit], [self.secret.id])   # a card the pack once held finds it

    def test_a_campaign_art_at_its_own_rarity(self):
        MdPrint.objects.create(md_id=2020, card_id=202, is_alt_art=True, rarity="UR")   # 202 is the SR
        open(os.path.join(self.media, "cards/face_thumb/2020.webp"), "wb").close()
        MdPackVersion.objects.create(pack=self.secret, start="2026-02-05", end="2026-04-09", swaps={"202": 2020})
        r = self.client.get(f"/api/carddb/packs/{self.secret.id}/").json()
        self.assertEqual([(a["print"], a["rarity"]) for a in r["versions"][0]["arts"]], [(2020, "UR")])
