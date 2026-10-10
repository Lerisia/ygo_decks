from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from django.test import TestCase

from carddb.models import Card, MdArt, MdPrint

from .models import DuchMindWord, DuchMindWordPack


class WordPackNewCardTest(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="p@test.com", username="packer", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.pack = DuchMindWordPack.objects.create(name="내 단어장", owner=self.user)
        card = Card.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", name_ko="블랙 매지션", frame="normal")
        MdPrint.objects.create(md_id=4041, card=card)
        MdArt.objects.create(md_print_id=4041, version="common", image="cards/art/common/4041.webp")

    def test_add_then_read_a_card_by_its_new_id(self):
        url = f"/api/multiplayer/duchmind/packs/{self.pack.id}/add-card/"
        self.assertEqual(self.client.post(url, {"card_pk": 4041}, format="json").status_code, 201)
        self.assertEqual(self.client.post(url, {"card_pk": 4041}, format="json").status_code, 200)
        self.assertEqual(DuchMindWord.objects.filter(pack=self.pack, new_card_id=4041).count(), 1)
        entry = self.client.get(f"/api/multiplayer/duchmind/packs/{self.pack.id}/").json()["entries"][0]
        self.assertEqual((entry["card_pk"], entry["name"], entry["image_url"]), (4041, "블랙 매지션", "/media/cards/art/common/4041.webp"))

    def test_import_and_export_by_korean_name(self):
        r = self.client.post(f"/api/multiplayer/duchmind/packs/{self.pack.id}/import/", {"text": "블랙 매지션, 없는 카드"}, format="json").json()
        self.assertEqual((r["added"], r["not_found"]), (1, ["없는 카드"]))
        self.assertEqual(self.client.get(f"/api/multiplayer/duchmind/packs/{self.pack.id}/export/").json()["csv"], "블랙 매지션")
