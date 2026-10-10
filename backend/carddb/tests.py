import shutil
import struct
import tempfile
import zlib
from datetime import date
from pathlib import Path

from django.test import SimpleTestCase, TestCase

from .importer import import_md
from .md import KEY, decrypt, frame_of, parse_prop, ruby_reading, split_text
from .models import Card, CardText, MdPrint, Override, SrcMd


def encrypt(raw: bytes) -> bytes:
    out = bytearray(zlib.compress(raw))
    for i in range(len(out)):
        out[i] ^= (((i + KEY + 0x23D) * KEY) ^ (i % 7)) & 0xFF
    return bytes(out)


def prop_a(cid, kind, attr=0, value=0, level_type=0):
    return cid | kind << 16 | attr << 22 | value << 26 | level_type << 30


def prop_b(atk=0, def_or_markers=0, icon=0, race=0, scale=0):
    return atk | def_or_markers << 9 | icon << 18 | race << 21 | scale << 27


class DecodeTest(SimpleTestCase):
    def test_decrypt_roundtrip(self):
        self.assertEqual(decrypt(encrypt("青眼の白龍".encode())), "青眼の白龍".encode())

    def test_pendulum_monster(self):
        p = parse_prop(1553607629, 539070714)
        self.assertEqual(p["category"], "monster")
        self.assertEqual(p["types"], ["pendulum", "effect"])
        self.assertEqual((p["attribute"], p["race"], p["level"], p["rank"]), ("dark", "dragon", 7, None))
        self.assertEqual((p["atk"], p["def_value"], p["pendulum_scale"]), (2500, 2000, 4))
        self.assertEqual(frame_of("monster", p["types"]), "effect_pendulum")

    def test_xyz_has_rank_not_level(self):
        p = parse_prop(2421630311, 31559930)
        self.assertEqual((p["level"], p["rank"], p["types"]), (None, 4, ["xyz", "effect"]))
        self.assertEqual(frame_of("monster", p["types"]), "xyz")

    def test_link_has_markers_and_no_def(self):
        p = parse_prop(3312136938, 48267364)
        self.assertEqual((p["link_rating"], p["def_value"], p["link_markers"]), (1, None, ["bottom"]))
        self.assertEqual((p["attribute"], p["race"]), ("earth", "cyberse"))

    def test_question_mark_stat(self):
        p = parse_prop(prop_a(5000, 1, attr=2, value=8, level_type=1), prop_b(atk=511, def_or_markers=250, race=1))
        self.assertEqual((p["atk"], p["def_value"]), (-1, 2500))

    def test_spell_and_trap_subtypes(self):
        self.assertEqual(parse_prop(prop_a(5318, 13), prop_b(icon=5))["spell_trap_subtype"], "quick_play")
        trap = parse_prop(prop_a(5319, 14), prop_b(icon=1))
        self.assertEqual((trap["category"], trap["spell_trap_subtype"]), ("trap", "counter"))
        self.assertEqual(frame_of("trap", []), "trap")

    def test_frames(self):
        self.assertEqual(frame_of("monster", ["pendulum", "tuner", "normal"]), "normal_pendulum")
        self.assertEqual(frame_of("monster", ["special_summon", "effect"]), "effect")
        self.assertEqual(frame_of("monster", ["fusion", "tuner"]), "fusion")
        self.assertEqual(frame_of("monster", ["token", "tuner"]), "token")
        self.assertEqual(frame_of("monster", ["ritual", "pendulum", "effect"]), "ritual_pendulum")

    def test_ruby_reading(self):
        self.assertEqual(ruby_reading("$R青眼の白龍(ブルーアイズ・ホワイト・ドラゴン)"), "ブルーアイズ・ホワイト・ドラゴン")
        self.assertEqual(ruby_reading("$R幸(こう)$R運(うん)の$R前(まえ)$R借(が)り"), "こううんのまえがり")
        self.assertEqual(ruby_reading("ブラック・マジシャン"), "ブラック・マジシャン")


class SplitTextTest(SimpleTestCase):
    def test_pendulum_effect_after_marker(self):
        t = split_text("①：戦闘ダメージは倍になる。\n【ペンデュラム効果】\n①：０にできる。", ["pendulum", "effect"], "ja")
        self.assertEqual(t, {"materials": "", "effect": "①：戦闘ダメージは倍になる。", "pendulum_effect": "①：０にできる。", "flavor": ""})

    def test_materials_first_line(self):
        t = split_text("レベル４モンスター×２\n①：攻撃を無効にする。", ["xyz", "effect"], "ja")
        self.assertEqual((t["materials"], t["effect"]), ("レベル４モンスター×２", "①：攻撃を無効にする。"))

    def test_summoned_only_by_a_card_has_no_materials(self):
        text = "このカードは「マスク・チェンジ」の効果でのみ特殊召喚できる。\n①：破壊されない。"
        self.assertEqual(split_text(text, ["fusion", "effect"], "ja")["materials"], "")
        ko = "이 카드는 \"마스크 체인지\"의 효과로만 특수 소환할 수 있다.\n①: 파괴되지 않는다."
        self.assertEqual(split_text(ko, ["fusion", "effect"], "ko")["materials"], "")

    def test_ritual_line_goes_to_materials(self):
        t = split_text("「イリュージョンの儀式」により降臨。\n①：装備できる。", ["ritual", "effect"], "ja")
        self.assertEqual((t["materials"], t["effect"]), ("「イリュージョンの儀式」により降臨。", "①：装備できる。"))
        ko = split_text("\"일루전의 의식\"에 의해 의식 소환.\n①: 장착할 수 있다.", ["ritual", "effect"], "ko")
        self.assertEqual(ko["materials"], "\"일루전의 의식\"에 의해 의식 소환.")

    def test_normal_monster_text_is_flavor(self):
        t = split_text("鋭いかぎづめで相手を切り裂く。", ["normal"], "ja")
        self.assertEqual((t["flavor"], t["effect"]), ("鋭いかぎづめで相手を切り裂く。", ""))

    def test_pendulum_normal_keeps_flavor_and_p_effect(self):
        t = split_text("天才魔術師。\n【펜듈럼 효과】\n①: 1턴에 1번.", ["pendulum", "normal"], "ko")
        self.assertEqual((t["flavor"], t["pendulum_effect"], t["effect"]), ("天才魔術師。", "①: 1턴에 1번.", ""))

    def test_token_text_is_effect(self):
        t = split_text("「霊魂鳥神－姫孔雀」の効果で特殊召喚される。", ["token"], "ja")
        self.assertEqual((t["effect"], t["flavor"]), ("「霊魂鳥神－姫孔雀」の効果で特殊召喚される。", ""))


CARDS = [
    (3001, "アンノウン", "アンノウン", "なし", "언논", "없음", prop_a(3001, 10), prop_b()),
    (3100, "墓場のゴースト王－パンプキング－", "墓場のゴースト王－パンプキング－", "ソロ用。", "펌프킹", "솔로용.", prop_a(3100, 1, 2, 6, 1), prop_b(180, 200, race=2)),
    (3902, "羊トークン", "$R羊(ひつじ)トークン", "「スケープ・ゴート」の効果で特殊召喚される。", "양 토큰", "\"스케이프 고트\"의 효과로 특수 소환된다.", prop_a(3902, 10, 5, 1, 1), prop_b(0, 0, race=11)),
    (3903, "羊トークン", "$R羊(ひつじ)トークン", "「スケープ・ゴート」の効果で特殊召喚される。", "양 토큰", "\"스케이프 고트\"의 효과로 특수 소환된다.", prop_a(3903, 10, 5, 1, 1), prop_b(0, 0, race=11)),
    (3863, "ブラック・マジシャン", "ブラック・マジシャン", "最高クラス。", "블랙 매지션", "최고 클래스.", prop_a(3863, 0, 2, 7, 1), prop_b(250, 210, race=18)),
    (4007, "青眼の白龍", "$R青眼の白龍(ブルーアイズ・ホワイト・ドラゴン)", "伝説のドラゴン。", "푸른 눈의 백룡", "전설의 드래곤.", prop_a(4007, 0, 1, 8, 1), prop_b(300, 250, race=1)),
    (4041, "ブラック・マジシャン", "ブラック・マジシャン", "最高クラス。", "블랙 매지션", "최고 클래스.", prop_a(4041, 0, 2, 7, 1), prop_b(250, 210, race=18)),
    (11213, "オッドアイズ・ペンデュラム・ドラゴン", "オッドアイズ・ペンデュラム・ドラゴン", "①：倍になる。\n【ペンデュラム効果】\n①：０にできる。",
     "오드아이즈 펜듈럼 드래곤", "①: 배가 된다.\n【펜듈럼 효과】\n①: 0으로 할 수 있다.", 1553607629, 539070714),
]


def write_locale(folder: Path, locale: str, rows, with_ruby: bool):
    names, descs, rubies = bytearray(b"\0"), bytearray(b"\0"), bytearray(b"\0")
    indx, rindx, prop = bytearray(), bytearray(), bytearray()
    for cid, name_ja, ruby, desc_ja, name_ko, desc_ko, a, b in rows:
        name, desc = (name_ja, desc_ja) if locale == "ja-jp" else (name_ko, desc_ko)
        indx += struct.pack("<II", len(names), len(descs))
        names += name.encode() + b"\0"
        descs += desc.encode() + b"\0"
        rindx += struct.pack("<II", len(rubies), 0)
        rubies += ruby.encode() + b"\0"
        prop += struct.pack("<II", a, b)
    parts = {"name": names, "desc": descs, "indx": indx, "prop": prop}
    if with_ruby:
        parts.update(rubyname=rubies, rubyindx=rindx)
    for part, raw in parts.items():
        (folder / f"{locale}_card_{part}.bytes").write_bytes(encrypt(bytes(raw)))


class ImportMdTest(TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.write(CARDS)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, rows):
        rows = sorted(rows, key=lambda r: r[0])
        write_locale(self.dir, "ja-jp", rows, True)
        write_locale(self.dir, "ko-kr", rows, False)
        same = struct.pack("<HHH", 3863, 4041, 5) + struct.pack("<HHH", 3903, 3902, 1) + struct.pack("<HHH", 12416, 4041, 256)
        (self.dir / "md_card_same.bytes").write_bytes(encrypt(same))
        rarity = b"".join(struct.pack("<I", cid | r << 16) for cid, r in ((3863, 4), (4007, 4), (4041, 3), (11213, 4)))
        (self.dir / "md_card_rarity_asset.bytes").write_bytes(rarity)

    def test_fills_cards_prints_and_texts(self):
        stats = import_md(self.dir, self.dir)
        self.assertEqual(stats["skipped"], 2)
        self.assertEqual(sorted(Card.objects.values_list("id", flat=True)), [3902, 4007, 4041, 11213])
        sheep = Card.objects.get(id=3902)
        self.assertEqual((sheep.frame, sheep.name_ja_ruby, sheep.atk), ("token", "ひつじトークン", 0))
        self.assertEqual(CardText.objects.get(card_id=3902, lang="ja").effect, "「スケープ・ゴート」の効果で特殊召喚される。")
        self.assertTrue(MdPrint.objects.get(md_id=3903).is_alt_art)
        bewd = Card.objects.get(id=4007)
        self.assertEqual((bewd.name_ko, bewd.name_ja_ruby, bewd.frame, bewd.level, bewd.atk), ("푸른 눈의 백룡", "ブルーアイズ・ホワイト・ドラゴン", "normal", 8, 3000))
        self.assertEqual(CardText.objects.get(card_id=4007, lang="ko").flavor, "전설의 드래곤.")
        oe = CardText.objects.get(card_id=11213, lang="ja")
        self.assertEqual((oe.effect, oe.pendulum_effect), ("①：倍になる。", "①：０にできる。"))
        alt = MdPrint.objects.get(md_id=3863)
        self.assertEqual((alt.card_id, alt.is_alt_art, alt.rarity), (4041, True, "UR"))
        self.assertEqual(MdPrint.objects.get(md_id=4041).rarity, "SR")
        self.assertFalse(MdPrint.objects.filter(md_id=12416).exists())
        self.assertEqual(SrcMd.objects.filter(md_id=3863).count(), 2)

    def test_first_seen_only_for_ids_after_the_first_import(self):
        import_md(self.dir, self.dir, today=date(2026, 10, 10))
        self.assertIsNone(MdPrint.objects.get(md_id=4007).first_seen)
        new = (20000, "新カード", "新カード", "効果。", "신카드", "효과.", prop_a(20000 - 16384, 1, 1, 4, 1), prop_b(100, 100, race=15))
        self.write(CARDS + [new])
        import_md(self.dir, self.dir, today=date(2026, 10, 11))
        self.assertEqual(MdPrint.objects.get(md_id=20000).first_seen, date(2026, 10, 11))
        self.assertIsNone(MdPrint.objects.get(md_id=4007).first_seen)

    def test_reimport_keeps_overrides(self):
        import_md(self.dir, self.dir)
        Override.objects.create(card_id=4041, field="name_ko", value="블랙 매지션(고침)")
        Override.objects.create(card_id=4041, field="text.ko.flavor", value="고친 설명")
        import_md(self.dir, self.dir)
        self.assertEqual(Card.objects.get(id=4041).name_ko, "블랙 매지션(고침)")
        self.assertEqual(CardText.objects.get(card_id=4041, lang="ko").flavor, "고친 설명")
