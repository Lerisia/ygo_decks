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


class QuizQuestionNewCardTest(TestCase):
    def test_question_uses_new_cards_with_art(self):
        import os
        import shutil
        import tempfile

        from django.test import override_settings
        from PIL import Image

        from carddb import display

        from .games.quiz import make_question

        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, True)
        with override_settings(MEDIA_ROOT=media):
            display.forget_art()
            for cid, name in ((4041, "블랙 매지션"), (4007, "푸른 눈의 백룡"), (9999, "그림 없는 카드")):
                Card.objects.create(id=cid, category="monster", name_ja=name, name_ko=name, frame="normal")
                MdPrint.objects.create(md_id=cid, card_id=cid)
            for cid in (4041, 4007):
                rel = f"cards/art/common/{cid}.webp"
                os.makedirs(os.path.join(media, "cards/art/common"), exist_ok=True)
                Image.new("RGB", (512, 512), (10, 20, 30)).save(os.path.join(media, rel), "WEBP")
                MdArt.objects.create(md_print_id=cid, version="common", image=rel)
            public, answer, url = make_question()
            display.forget_art()
        self.assertIn(answer, ("블랙 매지션", "푸른 눈의 백룡"))
        self.assertNotIn("그림 없는 카드", public["choices"])
        self.assertEqual(url, f"/media/cards/art/common/{public['card_id']}.webp")
        self.assertTrue(os.path.exists(os.path.join(media, f"cards/quiz/8x8/{public['card_id']}.jpg")))


class CardsOutsideMasterDuelTest(TestCase):
    def setUp(self):
        from carddb import display
        display.forget_art()
        self.addCleanup(display.forget_art)
        self.user = get_user_model().objects.create_user(email="o@test.com", username="outside", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.pack = DuchMindWordPack.objects.create(name="내 단어장", owner=self.user)
        md = Card.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", name_ko="블랙 매지션", frame="normal")
        MdPrint.objects.create(md_id=4041, card=md)
        MdArt.objects.create(md_print_id=4041, version="common", image="cards/art/common/4041.webp")
        self.ocg_only = Card.objects.create(id=5392, category="spell", name_ja="天変地異", name_ko="천재지변", frame="spell")
        DuchMindWord.objects.create(pack=self.pack, new_card=md)
        DuchMindWord.objects.create(pack=self.pack, new_card=self.ocg_only)

    def test_pack_shows_and_exports_only_master_duel_cards(self):
        r = self.client.get(f"/api/multiplayer/duchmind/packs/{self.pack.id}/").json()
        self.assertEqual([e["card_pk"] for e in r["entries"]], [4041])
        self.assertEqual(r["pack"]["entry_count"], 1)
        self.assertEqual(self.client.get(f"/api/multiplayer/duchmind/packs/{self.pack.id}/export/").json()["csv"], "블랙 매지션")

    def test_cannot_add_a_card_outside_master_duel(self):
        url = f"/api/multiplayer/duchmind/packs/{self.pack.id}"
        r = self.client.post(f"{url}/import/", {"text": "천재지변"}, format="json").json()
        self.assertEqual(r["not_found"], ["천재지변"])
        DuchMindWord.objects.filter(new_card=self.ocg_only).delete()
        self.assertEqual(self.client.post(f"{url}/add-card/", {"card_pk": 5392}, format="json").status_code, 404)

    def test_word_options_skip_cards_outside_master_duel(self):
        from .games.duchmind import card_word_candidates
        self.assertEqual([c["new_card_id"] for c in card_word_candidates(self.pack)], [4041])
