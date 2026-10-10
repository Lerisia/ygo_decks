from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from carddb import display
from carddb.md import RACES
from carddb.models import Card, CardText, MdArt, MdPrint
from cardsite.models import EffectTag, Yugipedia
from multiplayer.models import DuchMindWord, DuchMindWordPack

from . import twenty_card
from .models import SoloDrawing, SoloTwentyGame
from .twenty_card import TwentyCard
from .twenty_engine import answer_question, build_guess_comparison
from .twenty_views import _pool_card_ids


def make_card(id, name_ko, *, art=True, yp=("Effect Monster",), **fields):
    values = dict(category="monster", name_ja=name_ko, name_en="", frame="effect", types=["effect"],
                  attribute="dark", race="spellcaster", level=4, atk=1800, def_value=1000)
    values.update(fields)
    card = Card.objects.create(id=id, name_ko=name_ko, **values)
    MdPrint.objects.create(md_id=id, card=card)
    if art:
        MdArt.objects.create(md_print_id=id, version="common", image=f"cards/art/common/{id}.webp")
    if yp:
        Yugipedia.objects.create(card=card, misc=list(yp))
    return card


class FreshArtMixin:
    def setUp(self):
        super().setUp()
        display.forget_art()
        self.addCleanup(display.forget_art)


class TwentyCardTest(FreshArtMixin, TestCase):
    def ask(self, card, q_type, q_value=""):
        return answer_question(TwentyCard(twenty_card.twenty_cards().get(id=card.id)), q_type, q_value)

    def test_every_md_race_has_an_engine_name(self):
        self.assertEqual(set(RACES.values()) - set(twenty_card.RACES), set())

    def test_xyz_rank_counts_as_its_level(self):
        c = make_card(5000, "엑시즈", frame="xyz", types=["xyz", "effect"], level=None, rank=4, race="winged_beast")
        tc = TwentyCard(c)
        self.assertEqual((tc.frame_type, tc.level, tc.race, tc.attribute), ("xyz", 4, "Winged Beast", "DARK"))
        self.assertTrue(self.ask(c, "level_eq", "4"))
        self.assertFalse(self.ask(c, "has_level"))
        self.assertTrue(self.ask(c, "extra_deck"))

    def test_link_rating_and_missing_def(self):
        c = make_card(5001, "링크", frame="link", types=["link", "effect"], level=None, link_rating=2, def_value=None)
        self.assertTrue(self.ask(c, "level_eq", "2"))
        self.assertFalse(self.ask(c, "def_gte", "0"))
        self.assertFalse(self.ask(c, "atk_eq_def"))

    def test_spell_and_trap_kinds(self):
        quick = make_card(5002, "속공", category="spell", frame="spell", types=[], attribute="", race="",
                          level=None, atk=None, def_value=None, spell_trap_subtype="quick_play")
        cont = make_card(5003, "지속", category="trap", frame="trap", types=[], attribute="", race="",
                         level=None, atk=None, def_value=None, spell_trap_subtype="continuous")
        self.assertTrue(self.ask(quick, "spell_kind", "Quick-Play"))
        self.assertFalse(self.ask(quick, "trap_kind", "Normal"))
        self.assertTrue(self.ask(cont, "trap_kind", "Continuous"))
        self.assertFalse(self.ask(cont, "is_monster"))
        self.assertTrue(self.ask(cont, "is_spell_or_trap"))

    def test_tuner_and_non_effect_extra_deck(self):
        tuner = make_card(5004, "튜너 싱크로", frame="synchro", types=["synchro", "tuner", "effect"])
        vanilla = make_card(5005, "통상 융합", frame="fusion", types=["fusion"], yp=("Non-Effect Monster",))
        self.assertTrue(self.ask(tuner, "tuner"))
        self.assertTrue(self.ask(tuner, "frame_type", "effect"))
        self.assertFalse(self.ask(vanilla, "frame_type", "effect"))
        self.assertTrue(self.ask(vanilla, "frame_type", "fusion"))

    def test_text_questions_skip_the_pendulum_effect(self):
        c = make_card(5006, "펜듈럼", frame="effect_pendulum", types=["pendulum", "effect"])
        CardText.objects.create(card=c, lang="ko", effect="①: 덱에서 1장 뽑는다.", pendulum_effect="①: 묘지로 보낸다. ②: 끝.")
        CardText.objects.create(card=c, lang="ja", effect="②: 墓地")
        self.assertFalse(self.ask(c, "has_multi_effects"))
        self.assertFalse(self.ask(c, "desc_has_graveyard"))
        self.assertTrue(self.ask(c, "frame_type", "pendulum"))

    def test_materials_and_flavor_are_text(self):
        fusion = make_card(5007, "융합", frame="fusion", types=["fusion", "effect"])
        CardText.objects.create(card=fusion, lang="ko", materials="묘지의 몬스터 × 2", effect="①: 끝.")
        normal = make_card(5008, "통상", frame="normal", types=["normal"])
        CardText.objects.create(card=normal, lang="ko", flavor="묘지에서 왔다.")
        self.assertTrue(self.ask(fusion, "desc_has_graveyard"))
        self.assertTrue(self.ask(normal, "desc_has_graveyard"))

    def test_site_data_tags(self):
        c = make_card(5009, "패트랩", yp=None)
        Yugipedia.objects.create(card=c, archseries=["Duel winner", "Yo-kai Girl"])
        EffectTag.objects.create(card=c, hand_trap=True)
        bare = make_card(5010, "태그 없음", yp=None)
        self.assertTrue(self.ask(c, "tag_hand_trap"))
        self.assertTrue(self.ask(c, "special_win"))
        self.assertTrue(self.ask(c, "archetype_in", "Yo-kai Girl"))
        self.assertFalse(self.ask(bare, "tag_hand_trap"))
        self.assertTrue(self.ask(bare, "archetype_in", "__NONE__"))

    def test_guess_comparison(self):
        a = make_card(5011, "가", race="dragon", attribute="light", level=8, atk=3000, def_value=2500)
        b = make_card(5012, "나", race="dragon", attribute="dark", level=8, atk=2500, def_value=2100)
        rows = {r["label"]: r for r in build_guess_comparison(TwentyCard(a), TwentyCard(b))}
        self.assertEqual((rows["종족"]["guess"], rows["종족"]["match"]), ("드래곤족", True))
        self.assertEqual((rows["속성"]["guess"], rows["속성"]["match"]), ("어둠", False))
        self.assertTrue(rows["레벨/랭크/링크"]["match"])


class TwentyGameTest(FreshArtMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = get_user_model().objects.create_user(email="tw@test.com", username="twenty", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.pack = DuchMindWordPack.objects.create(name="중급")

    def add(self, card):
        DuchMindWord.objects.create(pack=self.pack, new_card=card)
        return card

    def test_pool_keeps_guessable_cards_once(self):
        ok = self.add(make_card(6000, "블랙 매지션", name_en="Dark Magician"))
        self.add(make_card(6007, "블랙 매지션", name_en="Dark Magician"))
        spell = self.add(make_card(6001, "죽은 자의 소생", category="spell", frame="spell", types=[], spell_trap_subtype="normal"))
        self.add(make_card(6002, "토큰", frame="token", types=["token"]))
        self.add(make_card(6003, "태그 없음", yp=None))
        self.add(make_card(6004, "", name_en="No Korean"))
        self.add(make_card(6005, "ALERT!", name_en="ALERT!"))
        off = make_card(6006, "꺼진 단어")
        DuchMindWord.objects.create(pack=self.pack, new_card=off, enabled=False)
        self.assertEqual(_pool_card_ids("중급"), [ok.id, spell.id])
        self.assertEqual(_pool_card_ids("중급", exclude_st=True), [ok.id])

    def test_play_through_a_game(self):
        secret = self.add(make_card(6010, "블랙 매지션", race="spellcaster", level=7, atk=2500, def_value=2100))
        make_card(6011, "푸른 눈의 백룡", race="dragon", attribute="light", level=8, atk=3000, def_value=2500)
        game = self.client.post("/api/solo/twenty/start/", {"difficulty": "중급"}, format="json").json()
        self.assertEqual(SoloTwentyGame.objects.get(id=game["id"]).new_card_id, secret.id)
        self.assertNotIn("answer", game)

        game = self.client.post("/api/solo/twenty/ask/", {"game_id": game["id"], "q_type": "race_in", "q_value": "Spellcaster"}, format="json").json()
        self.assertTrue(game["history"][-1]["answer"])
        game = self.client.post("/api/solo/twenty/hint/", {"game_id": game["id"], "dim": "attribute"}, format="json").json()
        self.assertEqual(game["history"][-1]["hint_value"], "어둠")

        game = self.client.post("/api/solo/twenty/guess/", {"game_id": game["id"], "card_name": "푸른 눈의 백룡"}, format="json").json()
        rows = {r["label"]: r for r in game["history"][-1]["comparison"]}
        self.assertEqual((rows["종족"]["guess"], rows["종족"]["match"]), ("드래곤족", False))

        game = self.client.post("/api/solo/twenty/guess/", {"game_id": game["id"], "card_name": "블랙 매지션"}, format="json").json()
        self.assertEqual(game["status"], "won")
        self.assertEqual(game["answer"], {"card_id": 6010, "name": "블랙 매지션", "image_url": "/media/cards/art/common/6010.webp"})

    def test_menu_lists_themes_from_the_pool(self):
        for i in range(2):
            c = self.add(make_card(6020 + i, f"섬도희 {i}", yp=None))
            Yugipedia.objects.create(card=c, misc=["Effect Monster"], archseries=["Sky Striker"])
        menu = self.client.get("/api/solo/twenty/menu/?difficulty=중급").json()["menu"]
        themes = next(g for g in menu if g["group"] == "카드군")["items"]
        self.assertIn({"q_value": "Sky Striker", "label": "섬도희"}, themes)


class SoloDrawTest(FreshArtMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = get_user_model().objects.create_user(email="dr@test.com", username="drawer", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        pack = DuchMindWordPack.objects.create(name="중급")
        for i, name in enumerate(("블랙 매지션", "푸른 눈의 백룡", "붉은 눈의 흑룡")):
            card = make_card(7000 + i, name)
            DuchMindWord.objects.create(pack=pack, new_card=card)

    def test_offer_draw_and_reveal(self):
        offer = self.client.post("/api/solo/start_draw/", {}, format="json").json()
        cards = offer["cards"]
        self.assertEqual(sorted(c["card_id"] for c in cards), [7000, 7001, 7002])
        first = cards[0]
        self.assertEqual(first["image_url"], f"/media/cards/art/common/{first['card_id']}.webp")

        r = self.client.post("/api/solo/submit_draw/", {"offer_token": offer["offer_token"], "card_id": first["card_id"],
                                                        "strokes": [[0, 0, 1, 1]]}, format="json")
        drawing = SoloDrawing.objects.get(id=r.json()["id"])
        self.assertEqual((drawing.new_card_id, drawing.word), (first["card_id"], first["name"]))

        other = get_user_model().objects.create_user(email="gu@test.com", username="guesser", password="pass1234")
        self.client.force_authenticate(other)
        out = self.client.post(f"/api/solo/drawings/{drawing.id}/give_up/", {}, format="json").json()
        self.assertEqual((out["word"], out["card_image_url"]), (first["name"], first["image_url"]))


class CardsOutsideMasterDuelTest(FreshArtMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = get_user_model().objects.create_user(email="ou@test.com", username="outsider", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.pack = DuchMindWordPack.objects.create(name="중급")
        for i, name in enumerate(("블랙 매지션", "푸른 눈의 백룡", "붉은 눈의 흑룡")):
            DuchMindWord.objects.create(pack=self.pack, new_card=make_card(8000 + i, name))
        DuchMindWord.objects.create(pack=self.pack, new_card=make_card(5392, "천재지변", art=False))

    def test_twenty_pool_leaves_them_out(self):
        self.assertEqual(_pool_card_ids("중급"), [8000, 8001, 8002])

    def test_drawing_offer_leaves_them_out(self):
        for _ in range(5):
            from .models import SoloDailyPoints
            SoloDailyPoints.objects.filter(user=self.user).update(pending_offer_cards=[], pending_offer_token="")
            offer = self.client.post("/api/solo/start_draw/", {}, format="json").json()
            self.assertEqual(sorted(c["card_id"] for c in offer["cards"]), [8000, 8001, 8002])
