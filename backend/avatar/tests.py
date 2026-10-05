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


class CardSearchPagingTest(TestCase):
    def setUp(self):
        from card.models import Card
        self.admin = User.objects.create_user(email="admin@example.com", username="운영자", password="x", is_staff=True)
        self.c = APIClient(); self.c.force_authenticate(self.admin)
        for i in range(65):
            Card.objects.create(card_id=f"gk{i}", konami_id=str(i), name=f"Gem-Knight {i}",
                                korean_name=f"젬나이트 {i:02d}", card_illust=f"card_illusts/gk{i}.jpg")
        Card.objects.create(card_id="no-art", konami_id="x", name="No art", korean_name="젬나이트 일러 없음")

    def search(self, **params):
        return self.c.get("/api/avatar/card-icons/search-cards/", params).data

    def test_every_match_can_be_reached_page_by_page(self):
        first = self.search(q="젬나이트")
        self.assertEqual((first["total"], first["total_pages"], first["page"], len(first["results"])), (65, 3, 1, 30))
        names = []
        for page in (1, 2, 3):
            names += [r["name"] for r in self.search(q="젬나이트", page=page)["results"]]
        self.assertEqual(names, [f"젬나이트 {i:02d}" for i in range(65)])   # in order, none twice, none missing

    def test_a_page_past_the_end_is_empty_and_a_bad_page_is_the_first(self):
        self.assertEqual(self.search(q="젬나이트", page=9)["results"], [])
        self.assertEqual(self.search(q="젬나이트", page="abc")["page"], 1)
