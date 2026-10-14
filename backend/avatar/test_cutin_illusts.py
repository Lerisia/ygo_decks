import io
import json
import shutil
import tempfile
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from avatar.cutin_illusts import ALIGN, align, compose, illust_name, make, save_illust
from avatar.models import CustomIllust
from carddb.models import Card, MdArt, MdPrint

MEDIA = tempfile.mkdtemp(prefix="cutin-tests-")


def drawn_art(seed, size=512, height=None):
    """A card art stand-in with corners for the matcher to hold on to: coloured shapes on a soft noise ground."""
    rng = np.random.default_rng(seed)
    height = height or size
    img = cv2.resize(rng.integers(60, 200, (16, 16, 3), dtype=np.uint8), (size, height), interpolation=cv2.INTER_CUBIC)
    for _ in range(60 * height // size):
        x, y = int(rng.integers(0, size)), int(rng.integers(0, height))
        w, h = (int(v) for v in rng.integers(10, 60, 2))
        colour = tuple(int(v) for v in rng.integers(0, 255, 3))
        if rng.random() < 0.5:
            cv2.rectangle(img, (x, y), (x + w, y + h), colour, -1)
        else:
            cv2.ellipse(img, (x, y), (w, h), int(rng.integers(0, 180)), 0, 360, colour, -1)
    return img


def figure_from(art, size=ALIGN, box=(96, 96, 416, 416)):
    """The art's `box`, enlarged four times (at ALIGN px; in step with `size`), inside an ellipse on a transparent
    square: a cut-in drawn from the art. On the ALIGN square it lies at (128, 128), so the figure's pixel x maps to
    the 1024-px art's 0.5 x + 128."""
    k = size / ALIGN
    x0, y0, x1, y1 = box
    piece = cv2.resize(art[y0:y1, x0:x1], None, fx=4 * k, fy=4 * k, interpolation=cv2.INTER_CUBIC)
    h, w = piece.shape[:2]
    at = round(128 * k)
    fig = np.zeros((size, size, 4), np.uint8)
    fig[at:at + h, at:at + w, :3] = piece
    mask = np.zeros((h, w), np.uint8)
    cv2.ellipse(mask, (w // 2, h // 2), (w // 2 - 4, h // 2 - 4), 0, 0, 360, 255, -1)
    fig[at:at + h, at:at + w, 3] = mask
    return fig


def webp_bytes(colour):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), colour).save(buf, "WEBP", lossless=True)
    return buf.getvalue()


class AlignTest(SimpleTestCase):
    def test_finds_where_the_figure_lies_on_the_art(self):
        art = drawn_art(1)
        found = align(figure_from(art), art)
        self.assertIsNotNone(found)
        self.assertTrue(found.fits())
        self.assertAlmostEqual(found.scale, 0.5, delta=0.01)
        self.assertAlmostEqual(found.rotation, 0, delta=0.5)
        np.testing.assert_allclose(found.M[:, 2], [128, 128], atol=3)

    def test_a_pendulum_monster_s_taller_art_keeps_its_shape(self):
        art = drawn_art(1, height=653)
        found = align(figure_from(art, box=(96, 200, 416, 520)), art)
        self.assertIsNotNone(found)
        self.assertTrue(found.fits())
        # the longer side is 1024 in the matching: 653 -> 1024, so the figure's 4x piece lands at 1024/653/4
        self.assertAlmostEqual(found.scale, 1024 / 653 / 4, delta=0.01)
        self.assertAlmostEqual(found.rotation, 0, delta=0.5)
        picture, covered, cover = compose(figure_from(art, box=(96, 200, 416, 520)), found.M, art, out=1024)
        self.assertEqual(picture.shape, (1024, 803, 3))
        self.assertLess(covered, 0.03)

    def test_a_figure_from_another_art_does_not_fit(self):
        found = align(figure_from(drawn_art(2)), drawn_art(1))
        self.assertTrue(found is None or not found.fits())


class ComposeTest(SimpleTestCase):
    def test_takes_the_figure_where_the_art_shows_it_and_keeps_what_the_art_paints_over_it(self):
        art = drawn_art(1)
        art[140:170, 140:170] = (50, 60, 70)
        figure = figure_from(art)
        figure[:, :, :3] = np.clip(figure[:, :, :3].astype(int) + 8, 0, 255)   # the sharp figure, told apart by a shade
        art[200:300, 200:300] = (255, 255, 255)                                # a splash the art paints over the monster
        M = np.float32([[0.5, 0, 128], [0, 0.5, 128]])
        img, covered, cover = compose(figure, M, art, out=1024)
        self.assertEqual(img.shape, (1024, 1024, 3))
        np.testing.assert_allclose(img[310, 310], (58, 68, 78), atol=2)        # the figure, where the art agrees
        np.testing.assert_allclose(img[500, 500], (255, 255, 255), atol=2)     # the splash, kept
        self.assertTrue(0.08 < covered < 0.2, covered)                          # the splash's share of the figure
        self.assertTrue(0.25 < cover < 0.35, cover)                             # the figure's share of the picture


@override_settings(MEDIA_ROOT=MEDIA)
class IllustTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, True)

    def setUp(self):
        card = Card.objects.create(id=4007, category="monster", name_ja="青眼の白龍", name_ko="푸른 눈의 백룡", frame="normal")
        self.print = MdPrint.objects.create(md_id=4007, card=card)
        self.alt = MdPrint.objects.create(md_id=23002, card=card, is_alt_art=True)

    def with_art(self, md_id, art, version="common"):
        folder = Path(MEDIA, "cards/art", version)
        folder.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(folder / f"{md_id}.webp"), art, [cv2.IMWRITE_WEBP_QUALITY, 100])
        MdArt.objects.create(md_print_id=md_id, version=version, image=f"cards/art/{version}/{md_id}.webp")

    def test_names(self):
        self.assertEqual(illust_name(self.print), "푸른 눈의 백룡 (고화질)")
        self.assertEqual(illust_name(self.alt), "푸른 눈의 백룡 다른 일러스트 (고화질)")
        self.print.card.name_ko = ""
        self.assertEqual(illust_name(self.print), "青眼の白龍 (고화질)")

    def test_saves_once_and_makes_the_picture_again_only_on_request(self):
        obj, created = save_illust(self.print, webp_bytes((255, 0, 0)))
        self.assertTrue(created)
        self.assertEqual((obj.name, obj.source_tweet_id), ("푸른 눈의 백룡 (고화질)", "cutin:4007"))
        self.assertEqual(Image.open(obj.image.path).getpixel((0, 0)), (255, 0, 0))
        again, created = save_illust(self.print, webp_bytes((0, 255, 0)))
        self.assertFalse(created)
        self.assertEqual(again.id, obj.id)
        self.assertEqual(Image.open(again.image.path).getpixel((0, 0)), (255, 0, 0))
        redone, created = save_illust(self.print, webp_bytes((0, 255, 0)), replace=True)
        self.assertFalse(created)
        self.assertEqual(redone.id, obj.id)
        self.assertEqual(Image.open(redone.image.path).getpixel((0, 0)), (0, 255, 0))
        self.assertEqual(CustomIllust.objects.count(), 1)

    def test_a_fitting_cut_in_becomes_a_clean_illustration(self):
        art = drawn_art(3)
        self.with_art(4007, art)
        sizes = []

        def render(size):
            sizes.append(size)
            return figure_from(art, size)

        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out, True)
        row = make(4007, render, out)
        self.assertEqual((row["verdict"], row["name"]), ("clean", "푸른 눈의 백룡 (고화질)"))
        self.assertLess(row["covered"], 0.03)
        self.assertEqual(sizes, [3072])   # the figure is drawn larger than it will be shown: no second, larger render
        self.assertEqual(cv2.imread(str(out / "4007.webp")).shape, (2048, 2048, 3))

    def test_the_ocg_art_stands_in_when_there_is_no_shared_one(self):
        art = drawn_art(3)
        self.with_art(4007, art, "ocg")
        self.with_art(4007, drawn_art(5), "tcg")
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out, True)
        self.assertEqual(make(4007, lambda size: figure_from(art, size), out)["verdict"], "clean")

    def test_a_cut_in_that_does_not_lie_on_the_art_is_left_out(self):
        self.with_art(4007, drawn_art(3))
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out, True)
        row = make(4007, lambda size: figure_from(drawn_art(4), size), out)
        self.assertEqual(row["verdict"], "unaligned")
        self.assertFalse((out / "4007.webp").exists())

    def test_a_print_without_art_is_left_out(self):
        self.assertEqual(make(4007, lambda size: None, Path(MEDIA))["verdict"], "no_art")

    def test_the_command_reports_and_saves_the_clean_ones(self):
        art = drawn_art(3)
        self.with_art(4007, art)
        Path(MEDIA, "md_ui/cutin").mkdir(parents=True, exist_ok=True)
        Path(MEDIA, "md_ui/cutin/index.json").write_text(json.dumps({"4007": {"anim": "animation", "v": 3}, "23002": {"anim": "animation", "v": 3}}))
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out, True)

        class FakeRenderer:
            def __init__(self, work):
                self.calls = []

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

            def render(self, md_id, version, size):
                self.calls.append((md_id, version, size))
                return figure_from(art, size)

        with mock.patch("avatar.management.commands.cutin_illusts.PoseRenderer", FakeRenderer):
            call_command("cutin_illusts", out=str(out), save=True, verbosity=0)
        report = json.loads((out / "report.json").read_text())
        self.assertEqual(report["4007"]["verdict"], "clean")
        self.assertEqual(report["23002"]["verdict"], "no_art")
        illust = CustomIllust.objects.get(source_tweet_id="cutin:4007")
        self.assertEqual(report["4007"]["illust"], illust.id)
        self.assertEqual(Image.open(illust.image.path).size, (2048, 2048))
        # done prints are not done again
        with mock.patch("avatar.management.commands.cutin_illusts.PoseRenderer", FakeRenderer):
            call_command("cutin_illusts", out=str(out), save=True, verbosity=0)
        self.assertEqual(CustomIllust.objects.count(), 1)
