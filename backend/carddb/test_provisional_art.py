"""Stand-in art for cards Master Duel has not released: cut from the published card image, outranked by real art."""
import io
import os
import tempfile
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from . import provisional
from .display import ART_ORDER, art_name, forget_art
from .models import Card, MdArt, MdPrint, ProvisionalArt

BLUE, RED, GREEN = (0, 0, 255), (255, 0, 0), (0, 200, 0)


def card_image(size, box, colour):
    """A card-shaped blue image with the box (fractions) painted `colour`, as bytes."""
    w, h = size
    img = Image.new("RGB", size, BLUE)
    x0, y0, x1, y1 = box
    img.paste(colour, (round(w * x0), round(h * y0), round(w * x1), round(h * y1)))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def colours(img, box):
    return set(img.crop(box).getdata())


class CutArtTest(TestCase):
    def test_the_illustration_is_cut_from_a_480_card_image(self):
        art = provisional.cut_art(Image.open(io.BytesIO(card_image((480, 700), provisional.ART_BOX, RED))), pendulum=False)
        self.assertEqual(art.size, (384, 384))
        self.assertEqual(colours(art, (0, 0, 384, 384)), {RED})

    def test_a_hi_res_scan_is_cut_by_the_same_fractions(self):
        art = provisional.cut_art(Image.open(io.BytesIO(card_image((813, 1185), provisional.ART_BOX, RED))), pendulum=False)
        self.assertEqual(art.size, (651, 651))
        self.assertEqual(colours(art, (0, 0, 651, 651)), {RED})

    def test_a_pendulum_cards_visible_art_sits_atop_master_duels_pendulum_shape(self):
        art = provisional.cut_art(Image.open(io.BytesIO(card_image((480, 700), provisional.PEND_BOX, GREEN))), pendulum=True)
        self.assertEqual(art.size, provisional.PEND_SIZE)
        self.assertEqual(colours(art, (0, 0, 512, 380)), {GREEN})            # what the card shows, scaled to width
        self.assertNotIn(BLUE, colours(art, (0, 400, 512, 653)))              # the rest is the picture carried on,
        self.assertTrue(all(g > r for r, g, b in colours(art, (0, 600, 512, 653))))   # not frame nor blank


class SweepTest(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()        # never the live media folder
        self.addCleanup(self.tmp.cleanup)
        cm = override_settings(MEDIA_ROOT=self.tmp.name)
        cm.enable()
        self.addCleanup(cm.disable)
        forget_art()
        self.addCleanup(forget_art)
        self.unreleased = Card.objects.create(id=23902, category="monster", name_ja="ウルトゥムの魔竜王", frame="effect", ocg_date="2026-10-01")
        self.released = Card.objects.create(id=4007, category="monster", name_ja="青眼の白龍", frame="normal", ocg_date="1999-03-01")
        MdPrint.objects.create(md_id=4007, card=self.released)
        self.images = {"https://img/23902.jpg": card_image((480, 700), provisional.ART_BOX, RED)}

    def fake_lookup(self, konami_id):
        return {"id": 100000000 + konami_id, "image": f"https://img/{konami_id}.jpg"} if konami_id in (23902, 4007) else None

    def fake_fetch(self, url, timeout=30):
        return self.images.get(url)   # no art crop on ygoprodeck for these, no image for cards it does not have

    def run_sweep(self, **kw):
        with mock.patch.object(provisional, "lookup", self.fake_lookup), mock.patch.object(provisional, "fetch_bytes", self.fake_fetch):
            return provisional.sweep(pause=0, **kw)

    def test_only_cards_without_a_master_duel_print_get_a_stand_in(self):
        result = self.run_sweep()
        self.assertEqual((result["fetched"], result["missing"], result["failed"], result["touched"]), (1, 0, 0, [23902]))
        row = ProvisionalArt.objects.get()
        self.assertEqual((row.card_id, row.image.name, row.source_id), (23902, "cards/art/provisional/23902.webp", "100023902"))
        with Image.open(os.path.join(self.tmp.name, row.image.name)) as img:
            self.assertEqual(img.size, (384, 384))
        self.assertEqual(art_name(23902), "cards/art/provisional/23902.webp")
        self.assertIsNone(art_name(4007))

    def test_a_second_sweep_leaves_fetched_cards_alone_unless_refreshing(self):
        self.run_sweep()
        self.assertEqual(self.run_sweep()["fetched"], 0)
        self.assertEqual(self.run_sweep(refresh=True)["fetched"], 1)
        self.assertEqual(self.run_sweep(ids=[23902])["fetched"], 1)

    def test_ygoprodecks_own_art_crop_is_preferred_when_it_has_one(self):
        self.images[provisional.CROPPED.format(100023902)] = card_image((624, 624), (0, 0, 1, 1), GREEN)
        self.run_sweep()
        with Image.open(os.path.join(self.tmp.name, "cards/art/provisional/23902.webp")) as img:
            self.assertEqual(img.size, (624, 624))

    def test_a_card_ygoprodeck_does_not_have_is_counted_and_skipped(self):
        Card.objects.create(id=11455, category="monster", name_ja="牙狼の双王 ロムルス－レムス", frame="effect_pendulum", ocg_date="2014-08-10")
        result = self.run_sweep()
        self.assertEqual((result["fetched"], result["missing"]), (1, 1))
        self.assertFalse(ProvisionalArt.objects.filter(card_id=11455).exists())

    def test_the_stand_in_goes_when_master_duel_art_arrives(self):
        self.run_sweep()
        path = os.path.join(self.tmp.name, "cards/art/provisional/23902.webp")
        self.assertTrue(os.path.exists(path))
        print_ = MdPrint.objects.create(md_id=23902, card=self.unreleased)
        MdArt.objects.create(md_print=print_, version="ocg", image="cards/art/ocg/23902.webp")
        forget_art()
        self.assertEqual(art_name(23902), "cards/art/ocg/23902.webp")   # the real art already outranks it
        result = self.run_sweep()
        self.assertEqual((result["dropped"], result["fetched"]), (1, 0))
        self.assertFalse(os.path.exists(path))
        self.assertFalse(ProvisionalArt.objects.exists())

    def test_master_duel_art_outranks_the_stand_in(self):
        self.assertEqual(ART_ORDER[-1], "provisional")
        print_ = MdPrint.objects.create(md_id=5000, card=Card.objects.create(id=5000, category="spell", name_ja="x", frame="spell"))
        MdArt.objects.create(md_print=print_, version="common", image="cards/art/common/5000.webp")
        ProvisionalArt.objects.create(card_id=5000, image="cards/art/provisional/5000.webp")
        forget_art()
        self.assertEqual(art_name(5000), "cards/art/common/5000.webp")
        self.assertEqual(art_name(5000, "provisional"), "cards/art/provisional/5000.webp")

    def test_the_command_reports_and_can_skip_drawing(self):
        out = io.StringIO()
        with mock.patch.object(provisional, "lookup", self.fake_lookup), mock.patch.object(provisional, "fetch_bytes", self.fake_fetch), \
                mock.patch.object(provisional, "PAUSE", 0):
            call_command("fetch_provisional_art", no_draw=True, stdout=out)
        self.assertIn("'fetched': 1", out.getvalue())
        self.assertIn("23902 ウルトゥムの魔竜王: 384x384", out.getvalue())
