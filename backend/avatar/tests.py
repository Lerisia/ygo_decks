import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image, ImageDraw
from rest_framework.test import APIClient

from avatar.models import Border, UserBorderUnlock
from user.models import User

MEDIA = tempfile.mkdtemp(prefix="avatar-tests-")


def frame_png(size=512, hole=0.72, name="frame.png", fmt="PNG", w=None, h=None):
    """A ring on a transparent square, as a designer would hand it in."""
    w, h = w or size, h or size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, w - 1, h - 1), fill=(200, 150, 40, 255))
    m = (1 - hole) / 2
    if hole > 0:
        d.ellipse((w * m, h * m, w * (1 - m), h * (1 - m)), fill=(0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=f"image/{fmt.lower()}")


@override_settings(MEDIA_ROOT=MEDIA)
class BorderUploadTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user(email="admin@example.com", username="운영자", password="x", is_staff=True)
        self.member = User.objects.create_user(email="m@example.com", username="회원", password="x")
        self.c = APIClient(); self.c.force_authenticate(self.admin)
        self.uploaded = Border.objects.filter(key__startswith="img-")   # the site's own borders are seeded alongside

    def create(self, client=None, **data):
        data.setdefault("name", "황금 날개")
        data.setdefault("image", frame_png())
        return (client or self.c).post("/api/avatar/borders/create/", data, format="multipart")

    def test_only_staff_can_upload(self):
        c = APIClient(); c.force_authenticate(self.member)
        self.assertEqual(self.create(c).status_code, 403)
        self.assertEqual(self.create(APIClient()).status_code, 401)
        self.assertEqual(self.uploaded.count(), 0)

    def test_upload_makes_an_unlisted_border_with_a_512_image(self):
        r = self.create(image=frame_png(size=1024))
        self.assertEqual(r.status_code, 201, r.data)
        b = self.uploaded.get()
        self.assertEqual((b.name, b.category, b.price, b.is_default), ("황금 날개", "exclusive", 0, False))
        self.assertTrue(b.key.startswith("img-"))
        with Image.open(b.image.path) as img:
            self.assertEqual((img.size, img.format), ((512, 512), "WEBP"))
            self.assertEqual(img.convert("RGBA").getpixel((256, 256))[3], 0)      # the icon's place stays clear
            self.assertEqual(img.convert("RGBA").getpixel((256, 10))[3], 255)
        self.assertTrue(r.data["image_url"].endswith(".webp"))
        self.assertTrue(r.data["uploaded"])

    def test_upload_can_go_straight_to_the_shop(self):
        r = self.create(category="shop", rarity="epic")
        self.assertEqual((r.data["category"], r.data["rarity"], r.data["price"]), ("shop", "epic", 1000))

    def test_new_borders_sort_after_the_existing_ones(self):
        Border.objects.update_or_create(key="admin", defaults={"name": "관리자", "sort_order": 200})
        self.create()
        self.assertGreater(self.uploaded.get().sort_order, 200)

    def test_refuses_images_that_would_not_work_as_a_border(self):
        bad = {
            "not square": frame_png(w=512, h=400),
            "too small": frame_png(size=200),
            "icon place not clear": frame_png(hole=0),
            "no transparency": SimpleUploadedFile("frame.jpg", self._jpeg(), content_type="image/jpeg"),
            "not an image": SimpleUploadedFile("frame.png", b"hello", content_type="image/png"),
        }
        for why, image in bad.items():
            r = self.create(image=image)
            self.assertEqual(r.status_code, 400, why)
            self.assertIn("error", r.data, why)
        self.assertEqual(self.c.post("/api/avatar/borders/create/", {"name": "이름만"}, format="multipart").status_code, 400)
        self.assertEqual(self.create(name="  ").status_code, 400)
        self.assertEqual(self.uploaded.count(), 0)

    @staticmethod
    def _jpeg():
        buf = io.BytesIO()
        Image.new("RGB", (512, 512), (200, 150, 40)).save(buf, "JPEG")
        return buf.getvalue()

    def test_rename_and_replace_the_image(self):
        b = Border.objects.get(id=self.create().data["id"])
        first = b.image.name
        r = self.c.patch(f"/api/avatar/borders/{b.id}/", {"name": "은빛 날개"}, format="json")
        self.assertEqual(r.data["name"], "은빛 날개")
        r = self.c.post(f"/api/avatar/borders/{b.id}/image/", {"image": frame_png(size=600)}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        b.refresh_from_db()
        self.assertNotEqual(b.image.name, first)   # a new file name, so browsers do not keep showing the old picture
        r = self.c.post(f"/api/avatar/borders/{b.id}/image/", {"image": frame_png(hole=0)}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_built_in_borders_keep_their_look(self):
        b, _ = Border.objects.get_or_create(key="gold", defaults={"name": "골드"})
        r = self.c.post(f"/api/avatar/borders/{b.id}/image/", {"image": frame_png()}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.delete(f"/api/avatar/borders/{b.id}/delete/").status_code, 400)
        self.assertTrue(Border.objects.filter(id=b.id).exists())

    def test_delete_only_while_nobody_has_it(self):
        b = Border.objects.get(id=self.create().data["id"])
        UserBorderUnlock.objects.create(user=self.member, border=b)
        r = self.c.delete(f"/api/avatar/borders/{b.id}/delete/")
        self.assertEqual(r.status_code, 409)
        UserBorderUnlock.objects.all().delete()
        self.member.equipped_border = b; self.member.save()
        self.assertEqual(self.c.delete(f"/api/avatar/borders/{b.id}/delete/").status_code, 409)
        self.member.equipped_border = None; self.member.save()
        self.assertEqual(self.c.delete(f"/api/avatar/borders/{b.id}/delete/").status_code, 200)
        self.assertFalse(Border.objects.filter(id=b.id).exists())

    def test_admin_list_says_how_many_have_each(self):
        b = Border.objects.get(id=self.create().data["id"])
        UserBorderUnlock.objects.create(user=self.member, border=b)
        row = next(x for x in self.c.get("/api/avatar/borders/admin/").data["borders"] if x["id"] == b.id)
        self.assertEqual((row["owners"], row["uploaded"]), (1, True))


@override_settings(MEDIA_ROOT=MEDIA)
class CardSearchPagingTest(TestCase):
    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)
        self.admin = User.objects.create_user(email="admin@example.com", username="운영자", password="x", is_staff=True)
        self.c = APIClient(); self.c.force_authenticate(self.admin)
        for i in range(65):
            md_card(5000 + i, f"젬나이트 {i:02d}")
        md_card(6000, "젬나이트 일러 없음", art=False)

    def search(self, **params):
        return self.c.get("/api/avatar/card-icons/search-cards/", params).data

    def test_every_match_can_be_reached_page_by_page(self):
        first = self.search(q="젬나이트")
        self.assertEqual((first["total"], first["total_pages"], first["page"], len(first["results"])), (65, 3, 1, 30))
        names = []
        for page in (1, 2, 3):
            names += [r["name"] for r in self.search(q="젬나이트", page=page)["results"]]
        self.assertEqual(names, [f"젬나이트 {i:02d}" for i in range(65)])   # in order, none twice, none missing
        self.assertEqual(first["results"][0], {"id": 5000, "card_id": 5000, "name": "젬나이트 00",
                                               "image_url": "/media/cards/art/common/5000.webp"})

    def test_a_page_past_the_end_is_empty_and_a_bad_page_is_the_first(self):
        self.assertEqual(self.search(q="젬나이트", page=9)["results"], [])
        self.assertEqual(self.search(q="젬나이트", page="abc")["page"], 1)


def md_card(cid, name, art=True, versions=("common",), image=None):
    """A new-DB card with one print and Master Duel art (files only when `image` is given)."""
    import os

    from carddb.models import Card, MdArt, MdPrint
    card = Card.objects.filter(id=cid).first() or Card.objects.create(
        id=cid, category="monster", name_ja=name, name_ko=name, frame="effect")
    MdPrint.objects.get_or_create(md_id=cid, defaults={"card": card})
    if art:
        for v in versions:
            rel = f"cards/art/{v}/{cid}.webp"
            if image is not None:
                os.makedirs(os.path.join(MEDIA, f"cards/art/{v}"), exist_ok=True)
                image.save(os.path.join(MEDIA, rel), "WEBP", quality=95)
            MdArt.objects.create(md_print_id=cid, version=v, image=rel)
    return card


def smooth_noise(seed, size=(512, 512)):
    import numpy as np
    rng = np.random.default_rng(seed)
    small = Image.fromarray(rng.integers(0, 255, (24, 24, 3), dtype=np.uint8))
    return small.resize(size, Image.BICUBIC)


def old_crop(img, cx, cy, r, scale=624 / 512):
    """The crop users see today: made from a differently sized copy of the art."""
    big = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    w, h = big.size
    x, y, rr = cx * w, cy * h, r * min(w, h)
    return big.crop((round(x - rr), round(y - rr), round(x + rr), round(y + rr))).resize((256, 256), Image.LANCZOS)


@override_settings(MEDIA_ROOT=MEDIA)
class CardIconArtTest(TestCase):
    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)
        self.admin = User.objects.create_user(email="ad@example.com", username="관리", password="x", is_staff=True)
        self.c = APIClient(); self.c.force_authenticate(self.admin)

    def test_icon_reads_the_art_it_was_made_from(self):
        from avatar.models import CardIcon
        from avatar.serializers import CardIconSerializer
        from carddb.models import MdArt, MdPrint
        card = md_card(4041, "블랙 매지션")
        MdPrint.objects.create(md_id=23001, card=card, is_alt_art=True)
        MdArt.objects.create(md_print_id=23001, version="tcg", image="cards/art/tcg/23001.webp")
        plain = CardIcon.objects.create(new_card=card, center_x=.5, center_y=.5, radius=.3)
        alt = CardIcon.objects.create(new_card=card, art_print_id=23001, art_version="tcg", center_x=.5, center_y=.5, radius=.3)
        data = CardIconSerializer(plain).data
        self.assertEqual((data["card_id"], data["card_name"], data["card_image_url"]), (4041, "블랙 매지션", "/media/cards/art/common/4041.webp"))
        self.assertEqual(CardIconSerializer(alt).data["card_image_url"], "/media/cards/art/tcg/23001.webp")

    def test_crop_comes_from_the_master_duel_art(self):
        from avatar.models import CardIcon
        art = Image.new("RGB", (512, 512), (0, 0, 255))
        art.paste((255, 0, 0), (0, 0, 256, 512))
        card = md_card(4042, "반반", image=art)
        icon = CardIcon.objects.create(new_card=card, center_x=.25, center_y=.5, radius=.2)
        self.assertGreater(Image.open(icon.cropped_image.path).convert("RGB").getpixel((128, 128))[0], 200)

    def test_create_an_icon_from_a_new_card(self):
        from avatar.models import CardIcon
        from avatar.views import _resolve_default_icon
        card = md_card(4043, "크리보", image=Image.new("RGB", (512, 512), (90, 60, 30)))
        r = self.c.post("/api/avatar/card-icons/create/", {"card_id": 4043, "center_x": .5, "center_y": .5, "radius": .4,
                                                           "category": "default"}, format="json")
        self.assertEqual(r.status_code, 201)
        icon = CardIcon.objects.get(id=r.data["id"])
        self.assertEqual((icon.new_card_id, bool(icon.cropped_image)), (card.id, True))
        self.assertEqual(_resolve_default_icon(), icon)
        mine = self.c.get("/api/avatar/card-icons/my/", {"q": "크리"}).data["icons"]
        self.assertEqual([i["id"] for i in mine], [icon.id])


@override_settings(MEDIA_ROOT=MEDIA)
class IconFitTest(TestCase):
    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)

    def icon_with_crop(self, card, crop):
        from django.core.files.base import ContentFile
        from avatar.models import CardIcon
        icon = CardIcon.objects.create(new_card=card, center_x=.5, center_y=.5, radius=.5)
        buf = io.BytesIO(); crop.save(buf, "JPEG", quality=92)
        icon.cropped_image.save(f"old_{icon.id}.jpg", ContentFile(buf.getvalue()), save=False)
        CardIcon.objects.filter(id=icon.id).update(cropped_image=icon.cropped_image.name)
        icon.refresh_from_db()
        return icon

    def test_finds_the_same_spot_on_the_right_art(self):
        import os

        from avatar.icon_fit import fit
        from carddb.models import MdArt, MdPrint
        base, alt = smooth_noise(1), smooth_noise(2)
        card = md_card(4044, "기본", image=base)
        MdPrint.objects.create(md_id=23002, card=card, is_alt_art=True)
        os.makedirs(os.path.join(MEDIA, "cards/art/common"), exist_ok=True)
        alt.save(os.path.join(MEDIA, "cards/art/common/23002.webp"), "WEBP", quality=95)
        MdArt.objects.create(md_print_id=23002, version="common", image="cards/art/common/23002.webp")
        found = fit(self.icon_with_crop(card, old_crop(alt, .4, .55, .2)))
        self.assertEqual((found["md_id"], found["version"]), (23002, "common"))
        self.assertGreater(found["score"], .9)
        for got, want in zip((found["cx"], found["cy"], found["r"]), (.4, .55, .2)):
            self.assertAlmostEqual(got, want, delta=.012)

    def test_prefers_the_original_when_it_looks_the_same_there(self):
        from avatar.icon_fit import fit
        art = smooth_noise(3)
        card = md_card(4045, "심의", versions=("ocg", "tcg"), image=art)
        self.assertEqual(fit(self.icon_with_crop(card, old_crop(art, .5, .5, .25)))["version"], "ocg")

    def test_command_records_the_spot_and_keeps_the_picture(self):
        from django.core.management import call_command
        art = smooth_noise(4)
        good = self.icon_with_crop(md_card(4046, "맞음", image=art), old_crop(art, .3, .6, .15))
        lost = self.icon_with_crop(md_card(4047, "다른 그림", image=smooth_noise(5)), smooth_noise(6, (256, 256)))
        good_crop, lost_crop = good.cropped_image.name, lost.cropped_image.name
        call_command("fit_card_icons", stdout=io.StringIO())
        good.refresh_from_db(); lost.refresh_from_db()
        self.assertAlmostEqual(good.center_x, .3, delta=.012)
        self.assertEqual((good.art_print_id, good.art_version, good.cropped_image.name), (4046, "common", good_crop))
        self.assertEqual((lost.center_x, lost.cropped_image.name, lost.art_print_id), (.5, lost_crop, None))

    def test_recut_cuts_again_from_the_master_duel_art(self):
        from django.core.management import call_command
        art = smooth_noise(7)
        icon = self.icon_with_crop(md_card(4048, "다시 자름", image=art), old_crop(art, .4, .4, .2))
        call_command("fit_card_icons", recut=True, stdout=io.StringIO())
        icon.refresh_from_db()
        self.assertNotIn("old_", icon.cropped_image.name)

    def test_icons_cut_from_a_hand_picked_picture_keep_it(self):
        import os

        from django.core.management import call_command
        from card.models import Card as OldCard
        os.makedirs(os.path.join(MEDIA, "card_illusts"), exist_ok=True)
        picked = smooth_noise(8, (750, 750))
        picked.save(os.path.join(MEDIA, "card_illusts/picked.jpg"), quality=95)
        smooth_noise(9, (624, 624)).save(os.path.join(MEDIA, "card_illusts/9000000000.jpg"), quality=95)
        hand = OldCard.objects.create(card_id="8149728501", konami_id="4049", name="Lady", korean_name="레이디",
                                      card_illust="card_illusts/picked.jpg")
        stock = OldCard.objects.create(card_id="9000000000", konami_id="4050", name="Stock", card_illust="card_illusts/9000000000.jpg")
        icon = self.icon_with_crop(md_card(4049, "레이디 오브 더 라뷰린스", image=picked.resize((512, 512))), old_crop(picked, .5, .4, .2, 1))
        CardIconTable = type(icon)
        CardIconTable.objects.filter(id=icon.id).update(card=hand, center_x=.5, center_y=.4, radius=.2)
        plain = self.icon_with_crop(md_card(4050, "평범", image=smooth_noise(10)), smooth_noise(11, (256, 256)))
        CardIconTable.objects.filter(id=plain.id).update(card=stock)
        crop = CardIconTable.objects.get(id=icon.id).cropped_image.name
        call_command("fit_card_icons", stdout=io.StringIO())
        icon.refresh_from_db(); plain.refresh_from_db()
        self.assertIsNotNone(icon.custom_illust)
        self.assertEqual((icon.custom_illust.name, icon.center_x, icon.center_y, icon.radius, icon.cropped_image.name),
                         ("레이디 오브 더 라뷰린스", .5, .4, .2, crop))
        self.assertEqual(Image.open(icon.custom_illust.image.path).size, (750, 750))
        self.assertEqual(icon.new_card_id, 4049)
        self.assertIsNone(plain.custom_illust)


class MyBordersTierRankTest(TestCase):
    """참혈 2026-10-11: 마이페이지 테두리는 순차 지급 단계(기본→아이언→…→다이아) 중 바로 다음 단계만 보여 주므로
    서버가 각 테두리의 단계 순서를 알려 준다."""

    def setUp(self):
        from rest_framework.test import APIClient
        from django.contrib.auth import get_user_model
        from .models import Border
        self.Border = Border
        # migrations may already seed some of these
        Border.objects.update_or_create(key="default", defaults={"name": "기본", "is_default": True, "category": "default"})
        for i, key in enumerate(["iron", "bronze", "silver"]):
            Border.objects.update_or_create(key=key, defaults={"name": key, "category": "exclusive", "sort_order": i + 1})
        Border.objects.update_or_create(key="fire", defaults={"name": "화속성", "category": "shop", "rarity": "rare", "sort_order": 50})
        self.user = get_user_model().objects.create_user(email="tier@t.com", username="tier", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_tier_rank_marks_the_step_borders_only(self):
        rows = {b["key"]: b for b in self.client.get("/api/avatar/borders/me/").json()["borders"]}
        self.assertEqual(rows["default"]["tier_rank"], 0)
        self.assertEqual(rows["iron"]["tier_rank"], 1)
        self.assertEqual(rows["silver"]["tier_rank"], 3)
        self.assertIsNone(rows["fire"]["tier_rank"])
        self.assertEqual(rows["iron"]["unlock_condition"], "누적 포인트 10P 달성")
