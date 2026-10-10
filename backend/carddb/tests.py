import io
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


COPY = (30019, "ブラック・マジシャン", "ブラック・マジシャン", "最高クラス。", "블랙 매지션", "최고 클래스.", prop_a(30019 - 16384, 0, 2, 7, 1), prop_b(250, 210, race=18))

CARDS = [
    (3001, "アンノウン", "アンノウン", "なし", "언논", "없음", prop_a(3001, 10), prop_b()),
    (3100, "墓場のゴースト王－パンプキング－", "墓場のゴースト王－パンプキング－", "ソロ用。", "펌프킹", "솔로용.", prop_a(3100, 1, 2, 6, 1), prop_b(180, 200, race=2)),
    (3902, "羊トークン", "$R羊(ひつじ)トークン", "「スケープ・ゴート」の効果で特殊召喚される。", "양 토큰", "\"스케이프 고트\"의 효과로 특수 소환된다.", prop_a(3902, 10, 5, 1, 1), prop_b(0, 0, race=11)),
    (3903, "羊トークン", "$R羊(ひつじ)トークン", "「スケープ・ゴート」の効果で特殊召喚される。", "양 토큰", "\"스케이프 고트\"의 효과로 특수 소환된다.", prop_a(3903, 10, 5, 1, 1), prop_b(0, 0, race=11)),
    (3863, "ブラック・マジシャン", "ブラック・マジシャン", "最高クラス。", "블랙 매지션", "최고 클래스.", prop_a(3863, 0, 2, 7, 1), prop_b(250, 210, race=18)),
    (4007, "青眼の白龍", "$R青眼の白龍(ブルーアイズ・ホワイト・ドラゴン)", "伝説のドラゴン。", "푸른 눈의 백룡", "전설의 드래곤.", prop_a(4007, 0, 1, 8, 1), prop_b(300, 250, race=1)),
    (4041, "ブラック・マジシャン", "ブラック・マジシャン", "最高クラス。", "블랙 매지션", "최고 클래스.", prop_a(4041, 0, 2, 7, 1), prop_b(250, 210, race=18)),
    (5239, "ハーピィ・レディ・ＳＢ", "ハーピィ・レディ・ＳＢ", "このカード名はルール上「ハーピィ・レディ」として扱う。", "하피 레이디 SB", "룰상 \"하피 레이디\"로 취급한다.", prop_a(5239, 0, 6, 4, 1), prop_b(180, 140, race=16)),
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
        self.write(CARDS + [COPY])

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, rows):
        rows = sorted(rows, key=lambda r: r[0])
        write_locale(self.dir, "ja-jp", rows, True)
        write_locale(self.dir, "ko-kr", rows, False)
        same = struct.pack("<HHH", 3863, 4041, 5) + struct.pack("<HHH", 3903, 3902, 0) + struct.pack("<HHH", 12416, 4041, 256) + struct.pack("<HHH", 5239, 4068, 0)
        (self.dir / "md_card_same.bytes").write_bytes(encrypt(same))
        rarity = b"".join(struct.pack("<I", cid | r << 16) for cid, r in ((3863, 4), (4007, 4), (4041, 3), (11213, 4)))
        (self.dir / "md_card_rarity_asset.bytes").write_bytes(rarity)
        collectible = [r[0] for r in rows if r[0] >= 4007 and r[0] not in (5239, 30019)]
        (self.dir / "md_cards_all.bytes").write_bytes(b"".join(struct.pack("<H", c) for c in collectible))

    def test_fills_cards_prints_and_texts(self):
        stats = import_md(self.dir, self.dir)
        self.assertEqual(stats["skipped"], 3)
        self.assertEqual(sorted(Card.objects.values_list("id", flat=True)), [3902, 4007, 4041, 5239, 11213])
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
        self.write(CARDS + [COPY, new])
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


def official_row(cid, name, ruby, attr, text, *, rarity="R", level=None, rank=None, link=None, species=None, atk=None, dfn=None,
                 scale=None, pen="", subtype=None, note=""):
    spec = f'<img class="icon_img" src="external/image/parts/attribute/attribute_icon_{attr}.png" alt="">'
    if subtype:
        spec += f'<span class="box_card_effect"><img class="icon_img" src="external/image/parts/effect/effect_icon_{subtype}.png"><span>x</span></span>'
    if level is not None or rank is not None:
        kind, word, n = ("level", "レベル", level) if level is not None else ("rank", "ランク", rank)
        spec += f'<span class="box_card_level_rank {kind}">\n<img class="icon_img" src="x.png">\n<span>{word} {n}</span>\n</span>'
    if link:
        spec += f'<span class="box_card_linkmarker">\n<img class="icon_img" src="external/image/parts/link_pc/link{link}.png" alt="リンク">\n<span>リンク {len(link)}</span>\n</span>'
    if species:
        spec += f'<span class="card_info_species_and_other_item"><span>\n【\n{species}<!--\n-->\n】\n</span></span>'
    if atk is not None:
        spec += f'<div class="atkdef">\n<span class="atk_power">\n<span>攻撃力 {atk}</span>\n</span>\n<span class="def_power"><span>\n守備力 {dfn}\n</span></span>\n</div>'
    pen_block = ""
    if scale is not None:
        pen_block = (f'<dd class="box_card_pen_info flex_1">\n<span class="box_card_pen_scale">\n<img class="icon_img" src="external/image/parts/icon_pendulum.png" alt="">\n'
                     f'Pスケール {scale}\n</span>\n<span class="box_card_pen_effect c_text flex_1 text_linebreak">\n{pen}\n</span>\n</dd>')
    biko = f'<dd class="box_card_text c_text flex_1 biko text_linebreak">\n&lt;hr&gt;※{note}\n</dd>' if note else ""
    return (f'<div class="t_row c_normal open t_rid_2">\n<dl class="flex_1">\n<dd class="box_card_name flex_1 top_set">\n<span class="card_ruby">{ruby}</span>\n'
            f'<span class="card_name">\n{name}\n</span>\n</dd>\n<input type="hidden" class="cid" value="{cid}">\n'
            f'<dd class="box_card_spec flex_1">\n<span class="box_card_attribute">{spec}</span>\n</dd>\n{pen_block}\n'
            f'<dd class="box_card_text c_text flex_1 text_linebreak">\n{text}\n</dd>\n{biko}\n</dl>\n'
            f'<div class="icon rarity pack_r">\n<div class="lr_icon rid rid_2" style="x">\n<p>{rarity}</p>\n</div>\n</div>\n'
            f'</div><!-- .t_row c_normal -->\n')


def official_page(day, rows, label="公開日"):
    return f'<header id="broad_title"><p id="previewed">\n(\n{label} : {day}\n)\n</p></header>\n' + "".join(rows)


KNIGHT = dict(level=4, species="戦士族／ペンデュラム／通常", atk=1800, dfn=600, scale=7)
TOWER = dict(rarity="UR", link="8462", species="岩石族／リンク／効果", atk=2400, dfn="-", note="公式のデュエルでは使用できません。")


class OfficialParseTest(SimpleTestCase):
    def test_monster_rows(self):
        from .official import parse_product

        page = official_page("2014年04月19日", [
            official_row(11210, "閃光の騎士", "せんこうのきし", "light", "神の振り子により覚醒した騎士。", **KNIGHT),
            official_row(14797, "黒き森の航天閣", "くろきもりのこうてんかく", "wind", "岩石族の効果モンスター３体以上&lt;br&gt;このカードはリンク召喚でしか特殊召喚できない。", **TOWER),
            official_row(5000, "謎の竜", "なぞのりゅう", "dark", "①：効果。", rank=4, species="ドラゴン族／エクシーズ／効果", atk="?", dfn="?"),
        ])
        p = parse_product(page, "ja")
        self.assertEqual(p["release_date"], date(2014, 4, 19))
        knight, tower, xyz = p["rows"]
        self.assertEqual((knight["types"], knight["race"], knight["level"], knight["pendulum_scale"], knight["atk"]), (["pendulum", "normal"], "warrior", 4, 7, 1800))
        self.assertEqual((tower["link_rating"], tower["link_markers"], tower["def_value"]), (4, ["top", "left", "right", "bottom"], None))
        self.assertEqual(tower["text"], "岩石族の効果モンスター３体以上\nこのカードはリンク召喚でしか特殊召喚できない。")
        self.assertEqual(tower["note"], "公式のデュエルでは使用できません。")
        self.assertEqual((xyz["rank"], xyz["level"], xyz["atk"], xyz["def_value"]), (4, None, -1, -1))

    def test_spell_subtypes(self):
        from .official import parse_product

        p = parse_product(official_page("2014年04月19日", [
            official_row(11264, "カバーカーニバル", "カバーカーニバル", "spell", "①：効果。", subtype="quickplay"),
            official_row(11265, "蛮族の狂宴LV５", "ばんぞくのきょうえんレベル５", "spell", "①：効果。"),
            official_row(4887, "聖なるバリア －ミラーフォース－", "せいなるバリア －ミラーフォース－", "trap", "①：効果。", subtype="counter"),
        ]), "ja")
        self.assertEqual([(r["category"], r["spell_trap_subtype"]) for r in p["rows"]], [("spell", "quick_play"), ("spell", "normal"), ("trap", "counter")])

    def test_korean_and_english_formats(self):
        from .official import parse_product

        ko = parse_product(official_page("2014/07/18", [official_row(11210, "섬광의 기사", "", "light", "x", **{**KNIGHT, "species": "전사족／펜듈럼／일반"})], label="공개일"), "ko")
        self.assertEqual((ko["release_date"], ko["rows"][0]["race"], ko["rows"][0]["types"]), (date(2014, 7, 18), "warrior", ["pendulum", "normal"]))
        en = parse_product(official_page("08/15/2014", [official_row(11210, "Flash Knight", "", "light", "x", **{**KNIGHT, "species": "Warrior／Pendulum／Normal"})], label="Release Date"), "en")
        self.assertEqual((en["release_date"], en["rows"][0]["race"], en["rows"][0]["types"]), (date(2014, 8, 15), "warrior", ["pendulum", "normal"]))


class ImportOfficialTest(TestCase):
    def setUp(self):
        import gzip
        import json

        self.dir = Path(tempfile.mkdtemp())
        (self.dir / "raw" / "ja").mkdir(parents=True)
        (self.dir / "raw" / "ko").mkdir(parents=True)
        pages = {
            "ja": {
                "100": official_page("2014年04月19日", [official_row(11210, "閃光の騎士", "せんこうのきし", "light", "神の振り子により覚醒した騎士。", **KNIGHT)]),
                "200": official_page("2022年08月14日", [
                    official_row(14797, "黒き森の航天閣", "くろきもりのこうてんかく", "wind", "岩石族の効果モンスター３体以上&lt;br&gt;このカードは特殊召喚できない。", **TOWER),
                    official_row(11210, "閃光の騎士", "せんこうのきし", "light", "神の振り子により覚醒した騎士。", rarity="UR", **KNIGHT),
                    official_row(9001, "羊トークン", "ひつじトークン", "earth", "「スケープ・ゴート」の効果で特殊召喚される。", level=1, species="獣族／トークン", atk=0, dfn=0),
                ]),
            },
            "ko": {"300": official_page("2014/07/18", [
                official_row(11210, "섬광의 기사(공식)", "", "light", "공식 문장.", **{**KNIGHT, "species": "전사족／펜듈럼／일반"}),
                official_row(14797, "검은 숲의 항천각", "", "wind", "암석족 효과 몬스터 3장 이상&lt;br&gt;특수 소환할 수 없다.", **{**TOWER, "species": "암석족／링크／효과"}),
            ], label="공개일")},
        }
        for lang, by_pid in pages.items():
            (self.dir / f"products_{lang}.json").write_text(json.dumps([{"pid": pid, "name": f"상품{pid}", "category": "packc1"} for pid in by_pid]))
            for pid, page in by_pid.items():
                with gzip.open(self.dir / "raw" / lang / f"{pid}.html.gz", "wt", encoding="utf-8") as g:
                    g.write(page)
        Card.objects.create(id=11210, category="monster", name_ja="閃光の騎士", name_ko="섬광의 기사", frame="normal_pendulum", types=["pendulum", "normal"], level=4, atk=1800, def_value=600, pendulum_scale=7)
        CardText.objects.create(card_id=11210, lang="ko", flavor="마듀 문장.")
        CardText.objects.create(card_id=11210, lang="ja", flavor="マスターデュエルの文。")
        SrcMd.objects.create(md_id=11210, lang="ko", name="섬광의 기사", prop_a=0, prop_b=0)
        Card.objects.create(id=3902, category="monster", name_ja="羊トークン", frame="token", types=["token"])

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_ocg_import(self):
        from .importer import import_official
        from .models import ProductCard

        stats = import_official(self.dir, "ja")
        self.assertEqual((stats["new_cards"], stats["merged_tokens"]), (1, 1))
        knight = Card.objects.get(id=11210)
        self.assertEqual((knight.ocg_date, knight.name_ja, knight.name_ja_ruby), (date(2014, 4, 19), "閃光の騎士", ""))
        self.assertEqual(CardText.objects.get(card_id=11210, lang="ja").flavor, "マスターデュエルの文。")
        tower = Card.objects.get(id=14797)
        self.assertEqual((tower.frame, tower.link_markers, tower.def_value, tower.ocg_date), ("link", ["top", "left", "right", "bottom"], None, date(2022, 8, 14)))
        self.assertEqual(CardText.objects.get(card_id=14797, lang="ja").materials, "岩石族の効果モンスター３体以上")
        self.assertFalse(Card.objects.filter(id=9001).exists())
        self.assertEqual(ProductCard.objects.filter(cid=11210).count(), 2)

    def test_printed_level_or_rank_zero_wins_over_master_duel(self):
        import gzip

        from .importer import import_official

        Card.objects.create(id=11413, category="monster", name_ja="FNo.0 未来皇ホープ", frame="xyz", types=["xyz", "effect"], rank=1)
        SrcMd.objects.create(md_id=11413, lang="ko", name="FNo.0 미래황 호프", prop_a=0, prop_b=0)
        page = official_page("2015年01月01日", [official_row(11413, "FNo.0 未来皇ホープ", "", "light", "①：効果。", rank=0, species="戦士族／エクシーズ／効果", atk=0, dfn=0)])
        with gzip.open(self.dir / "raw" / "ja" / "100.html.gz", "wt", encoding="utf-8") as g:
            g.write(page)
        import_official(self.dir, "ja")
        self.assertEqual(Card.objects.get(id=11413).rank, 0)
        self.assertEqual(Card.objects.get(id=11210).level, 4)

    def test_reimport_refreshes_cards_only_the_official_db_has(self):
        from .importer import import_official

        import_official(self.dir, "ja")
        Card.objects.filter(id=14797).update(atk=1, name_ja="古い名前")
        import_official(self.dir, "ja")
        tower = Card.objects.get(id=14797)
        self.assertEqual((tower.atk, tower.name_ja), (2400, "黒き森の航天閣"))

    def test_korean_official_only_fills_what_master_duel_lacks(self):
        from .importer import import_official

        import_official(self.dir, "ja")
        import_official(self.dir, "ko")
        knight = Card.objects.get(id=11210)
        self.assertEqual((knight.name_ko, knight.kr_date), ("섬광의 기사", date(2014, 7, 18)))
        self.assertEqual(CardText.objects.get(card_id=11210, lang="ko").flavor, "마듀 문장.")
        tower = Card.objects.get(id=14797)
        self.assertEqual(tower.name_ko, "검은 숲의 항천각")
        self.assertEqual(CardText.objects.get(card_id=14797, lang="ko").effect, "특수 소환할 수 없다.")


class ImportArtTest(TestCase):
    def test_links_saved_art_to_prints(self):
        import json

        from .importer import import_art
        from .models import MdArt

        Card.objects.create(id=4441, category="monster", name_ja="ウォーター・ガール", frame="normal")
        MdPrint.objects.create(md_id=4441, card_id=4441)
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        manifest = folder / "manifest.json"
        manifest.write_text(json.dumps({"common/4441": {}, "ocg/4441": {}, "tcg/4441": {}, "common/3101": {}}))
        self.assertEqual(import_art(manifest), {"arts": 3, "without_print": 1, "pendulum_restored": 0})
        self.assertEqual(MdArt.objects.get(md_print_id=4441, version="ocg").image.name, "cards/art/ocg/4441.webp")
        self.assertEqual(import_art(manifest)["arts"], 3)
        self.assertEqual(MdArt.objects.count(), 3)


class RestorePendulumArtTest(TestCase):
    def test_pendulum_art_gets_its_proportions_back_once(self):
        from django.test import override_settings
        from PIL import Image

        from .importer import restore_pendulum_art
        from .models import MdArt

        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, True)
        with override_settings(MEDIA_ROOT=media):
            for cid, frame in ((4045, "effect_pendulum"), (22812, "spell"), (4007, "normal")):
                Card.objects.create(id=cid, category="spell" if frame == "spell" else "monster", name_ja=str(cid), frame=frame)
                MdPrint.objects.create(md_id=cid, card_id=cid)
                size = (512, 512) if cid == 4007 else (512, 1024)
                img = Image.new("RGB", size, (200, 0, 0))
                img.paste((0, 0, 200), (0, size[1] - 64, 512, size[1]))
                Path(media, "cards/art/common").mkdir(parents=True, exist_ok=True)
                img.save(Path(media, f"cards/art/common/{cid}.webp"), "WEBP")
                MdArt.objects.create(md_print_id=cid, version="common", image=f"cards/art/common/{cid}.webp")
            self.assertEqual(restore_pendulum_art(), 1)
            self.assertEqual(restore_pendulum_art(), 0)
            sizes = {cid: Image.open(Path(media, f"cards/art/common/{cid}.webp")).size for cid in (4045, 22812, 4007)}
            pend = Image.open(Path(media, "cards/art/common/4045.webp")).convert("RGB")
        self.assertEqual(sizes, {4045: (512, 653), 22812: (512, 1024), 4007: (512, 512)})
        self.assertGreater(pend.getpixel((256, 650))[2], 150)


class LegacyMapTest(TestCase):
    def test_maps_by_konami_then_names_and_keeps_manual(self):
        from card.models import Card as Old

        from .importer import map_legacy_cards
        from .models import LegacyCard

        Card.objects.create(id=4007, category="monster", name_ja="青眼の白龍", name_ko="푸른 눈의 백룡", frame="normal")
        Card.objects.create(id=3906, category="monster", name_ja="兵隊アリトークン", name_ko="병사개미 토큰", frame="token")
        Card.objects.create(id=19359, category="monster", name_ja="", name_en="Anotherverse Gluttonia", frame="normal")
        Card.objects.create(id=21000, category="monster", name_ja="ドミナス・スパーク", name_ko="도미나스 스파크", frame="effect")
        a = Old.objects.create(card_id="8989333900", konami_id="4007", name="Blue-Eyes White Dragon", korean_name="푸른 눈의 백룡")
        b = Old.objects.create(card_id="8989333901", konami_id="4007", name="Blue-Eyes White Dragon", korean_name="푸른 눈의 백룡")
        tok = Old.objects.create(card_id="2249381200", konami_id="0", name="Army Ant Token", korean_name="병사개미 토큰")
        tcg = Old.objects.create(card_id="8689370200", konami_id="1", name="Anotherverse Gluttonia", korean_name="")
        skill = Old.objects.create(card_id="30030202200", konami_id="0", name="Ancient Fusion", korean_name="")
        wrong = Old.objects.create(card_id="6325660000", konami_id="6325660", name="Dominus Spark", korean_name="도미나스 스파크(옛)")
        LegacyCard.objects.create(old_id=wrong.id, card_id=21000, how="manual")
        counts = map_legacy_cards()
        got = {l.old_id: (l.card_id, l.how) for l in LegacyCard.objects.all()}
        self.assertEqual(got[a.id], (4007, "konami"))
        self.assertEqual(got[b.id], (4007, "konami"))
        self.assertEqual(got[tok.id], (3906, "name_ko"))
        self.assertEqual(got[tcg.id], (19359, "name_en"))
        self.assertEqual(got[skill.id], (None, "none"))
        self.assertEqual(got[wrong.id], (21000, "manual"))
        self.assertEqual(counts["konami"], 2)


class FillNewCardLinksTest(TestCase):
    def test_new_card_follows_the_legacy_map(self):
        from django.contrib.auth import get_user_model

        from avatar.models import CardIcon
        from card.models import Card as Old
        from solo.models import SoloTwentyGame

        from .importer import fill_new_card_links
        from .models import LegacyCard

        Card.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", frame="normal")
        old = Old.objects.create(card_id="4602257801", konami_id="4041", name="Dark Magician")
        lost = Old.objects.create(card_id="30030202200", konami_id="0", name="Ancient Fusion")
        LegacyCard.objects.create(old_id=old.id, old_card_id=old.card_id, card_id=4041, how="konami")
        LegacyCard.objects.create(old_id=lost.id, old_card_id=lost.card_id, how="none")
        icon = CardIcon.objects.create(card=old, center_x=0.5, center_y=0.5, radius=0.3)
        user = get_user_model().objects.create_user(email="t@test.com", username="t1", password="pass1234")
        game = SoloTwentyGame.objects.create(user=user, card=lost, card_name_snapshot="x")
        out = fill_new_card_links()
        self.assertEqual((out["avatar.CardIcon"], out["solo.SoloTwentyGame"]), (1, 1))
        icon.refresh_from_db()
        game.refresh_from_db()
        self.assertEqual((icon.new_card_id, game.new_card_id), (4041, None))
        self.assertEqual(fill_new_card_links()["avatar.CardIcon"], 0)


class SwapStepsTest(TestCase):
    """swap_cards prepare: what has to be true before the migration that switches features to the new card ids."""

    def setUp(self):
        from datetime import timedelta
        from django.contrib.auth import get_user_model
        from django.utils import timezone

        from solo.models import SoloDailyPoints, SoloDrawing, SoloTwentyGame
        self.user = get_user_model().objects.create_user(email="sw@test.com", username="swap", password="x")
        card = Card.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", name_ko="블랙 매지션", frame="normal")
        self.game = SoloTwentyGame.objects.create(user=self.user, new_card=card, card_name_snapshot="블랙매지션", status="active")
        self.done = SoloTwentyGame.objects.create(user=self.user, new_card=card, card_name_snapshot="블랙매지션", status="won")
        later = timezone.now() + timedelta(days=3)
        self.drawing = SoloDrawing.objects.create(drawer=self.user, new_card=card, word="블랙매지션", strokes_json=[], expires_at=later)
        SoloDailyPoints.objects.create(user=self.user, date=timezone.localdate(), pending_offer_cards=[1, 2, 3], pending_offer_token="t")

    def test_words_to_drop_keeps_one_enabled_word_per_card(self):
        from .management.commands.swap_cards import words_to_drop
        rows = [(1, 10, 4041, False), (2, 10, 4041, True), (3, 10, 4041, True), (4, 10, 4007, False), (5, 11, 4041, False)]
        self.assertEqual(words_to_drop(rows), [1, 3])

    def test_prepare_moves_live_answers_to_master_duel_names(self):
        from django.core.management import call_command

        from solo.models import SoloDailyPoints
        call_command("swap_cards", "prepare", stdout=io.StringIO())
        self.game.refresh_from_db(); self.done.refresh_from_db(); self.drawing.refresh_from_db()
        self.assertEqual((self.game.card_name_snapshot, self.done.card_name_snapshot), ("블랙 매지션", "블랙매지션"))
        self.assertEqual(self.drawing.word, "블랙 매지션")
        self.assertEqual(list(SoloDailyPoints.objects.values_list("pending_offer_cards", "pending_offer_token")), [([], "")])

    def test_prepare_stops_while_a_room_is_mid_game(self):
        from django.core.management import call_command
        from django.core.management.base import CommandError

        from multiplayer.models import Room
        Room.objects.create(name="방", host=self.user, status="in_game")
        with self.assertRaises(CommandError):
            call_command("swap_cards", "prepare", stdout=io.StringIO())
        self.game.refresh_from_db()
        self.assertEqual(self.game.card_name_snapshot, "블랙매지션")


class CardGroupTest(TestCase):
    """카드군 by the rule, on cards that show each case."""

    def card(self, cid, name, ko="", ruby="", ja_text="", ko_text="", md=True):
        from .models import CardText, MdPrint, SrcMd
        Card.objects.create(id=cid, category="monster", name_ja=name, name_ko=ko, frame="effect")
        if md:
            MdPrint.objects.create(md_id=cid, card_id=cid)
            SrcMd.objects.create(md_id=cid, lang="ja", name=name, ruby=ruby, text=ja_text, prop_a=0, prop_b=0)
        if ja_text:
            CardText.objects.create(card_id=cid, lang="ja", effect=ja_text)
        if ko_text:
            CardText.objects.create(card_id=cid, lang="ko", effect=ko_text)

    def setUp(self):
        self.card(1, "E・HERO エアーマン", "엘리멘틀 히어로 에어맨",
                  ja_text="①：デッキから「HERO」モンスター１体を手札に加える。", ko_text='①: 덱에서 "HERO" 몬스터 1장을 패에 넣는다.')
        self.card(2, "E・HERO クレイマン", "엘리멘틀 히어로 클레이맨")
        self.card(3, "D-HERO ディアボリックガイ", "데스티니 히어로 디아볼릭 가이",
                  ja_text="「E・HERO」モンスターを対象とする。", ko_text='"엘리멘틀 히어로" 몬스터를 대상으로 한다.')
        self.card(4, "EMペンデュラム・マジシャン", "EM 펜듈럼 매지션", ruby="$REM(エンタメイト)ペンデュラム・マジシャン",
                  ja_text="「EM」モンスター", ko_text='"EM" 몬스터')
        self.card(5, "EMドクロバット・ジョーカー", "EM 도크로뱃 조커", ruby="$REM(エンタメイト)ドクロバット・ジョーカー")
        self.card(6, "アルカナフォースIII－THE EMPRESS", "아르카나 포스 III－디 임프레스")
        self.card(7, "銀河眼の光子竜", "갤럭시아이즈 포톤 드래곤", ruby="$R銀河眼の光子竜(ギャラクシーアイズ・フォトン・ドラゴン)",
                  ja_text="「ギャラクシーアイズ」モンスター", ko_text='"갤럭시아이즈" 몬스터')
        self.card(8, "ギャラクシーアイズ・FA・フォトン・ドラゴン", "갤럭시아이즈 FA 포톤 드래곤")
        self.card(9, "最後の希望", "마지막 희망",
                  ja_text="このカード名はルール上「ギャラクシーアイズ」カードとしても扱う。", ko_text='이 카드명은 룰상 "갤럭시아이즈" 카드로도 취급한다.')
        self.card(10, "サイバー・ドラゴン", "사이버 드래곤", ja_text="「サイバー」カード", ko_text='"사이버" 카드')
        self.card(11, "ハーピィ・レディ", "해피 레이디")
        self.card(12, "ハーピィ・レディ・SB", "해피 레이디·SB", ruby="ハーピィ・レディ・$RSB(サイバー・ボンテージ)",
                  ja_text="このカード名はルール上「ハーピィ・レディ」として扱う。「ハーピィ」モンスター", ko_text='"해피 레이디" "해피" 몬스터')
        self.card(13, "N・アクア・ドルフィン", "네오 스페이시언 아쿠아 돌핀", ruby="$RN(ネオスペーシアン)・アクア・ドルフィン",
                  ja_text="「N」モンスター", ko_text='"네오 스페이시언" 몬스터')
        self.card(14, "No.39 希望皇ホープ", "No.39 유토피아")
        self.card(15, "R－ACEインパルス", "R－ACE 임펄스", ruby="$RR－ACE(レスキュー・エース)インパルス",
                  ja_text="「R－ACE」モンスター", ko_text='"R－ACE(레스큐 에이스)" 몬스터')
        self.card(16, "RESCUE!", "RESCUE!", ja_text="このカード名はルール上「R－ACE」カードとしても扱う。")
        self.card(17, "H・C 強襲のハルベルト", "H·C 강습의 할베르트", ruby="$RＨ(ヒロイック)・$RＣ(チャレンジャー)　強襲のハルベルト",
                  ja_text="「C」モンスター", ko_text='"C" 몬스터')

    def build(self):
        from .groups import compute, save
        from .models import CardGroup
        save(compute())
        return {g.text: g for g in CardGroup.objects.all()}

    def members(self, group):
        return sorted(group.members.exclude(how="removed").values_list("card_id", flat=True))

    def test_members_by_written_name_and_reading(self):
        g = self.build()
        self.assertEqual(self.members(g["HERO"]), [1, 2, 3])
        self.assertEqual(self.members(g["E・HERO"]), [1, 2])
        self.assertEqual(g["E・HERO"].parent, g["HERO"])
        self.assertEqual((self.members(g["EM"]), g["EM"].reading), ([4, 5], "エンタメイト"))
        self.assertEqual(self.members(g["ギャラクシーアイズ"]), [7, 8, 9])
        self.assertEqual(dict(g["ギャラクシーアイズ"].members.values_list("card_id", "how")), {7: "reading", 8: "name", 9: "treated"})
        self.assertEqual(self.members(g["N"]), [13])
        self.assertEqual(self.members(g["R-ACE"]), [15, 16])
        self.assertEqual(self.members(g["C"]), [17])   # RESCUE! counts as R－ACE, whose C sits inside a word

    def test_a_replaced_name_is_what_counts(self):
        g = self.build()
        self.assertEqual(self.members(g["サイバー"]), [10])
        self.assertEqual(self.members(g["ハーピィ"]), [11, 12])

    def test_korean_names_from_paired_texts(self):
        g = self.build()
        self.assertEqual((g["E・HERO"].name_ko, g["E・HERO"].name_source), ("엘리멘틀 히어로", "pair"))
        self.assertEqual(g["ギャラクシーアイズ"].name_ko, "갤럭시아이즈")
        self.assertEqual(g["N"].name_ko, "네오 스페이시언")
        self.assertEqual(g["R-ACE"].name_ko, "R－ACE")   # the card names' own dash, reading dropped

    def test_staff_edits_survive_a_rebuild(self):
        from .models import CardGroup, CardGroupMember
        g = self.build()
        CardGroup.objects.filter(id=g["HERO"].id).update(name_ko="히어로", name_source="manual", needs_review=False)
        CardGroupMember.objects.filter(group=g["HERO"], card_id=3).update(how="removed")
        CardGroupMember.objects.create(group=g["HERO"], card_id=14, how="added")
        g = self.build()
        self.assertEqual((g["HERO"].name_ko, g["HERO"].name_source), ("히어로", "manual"))
        self.assertEqual(self.members(g["HERO"]), [1, 2, 14])

    def test_master_duel_named_lists(self):
        from .md import parse_named
        import struct
        lists = [[], [1, 2, 3], [4, 5]]
        ids = [c for l in lists for c in l]
        offs, pos = [], 0
        for l in lists:
            offs.append((pos, len(l)))
            pos += len(l)
        blob = struct.pack("<HH", len(lists), len(ids)) + b"".join(struct.pack("<HH", *o) for o in offs) + struct.pack(f"<{len(ids)}H", *ids)
        self.assertEqual(parse_named(blob), lists)
        from .groups import compute, save
        from .models import CardGroup
        save(compute(lists))
        self.assertEqual(sorted(CardGroup.objects.filter(md_list=True).values_list("text", flat=True)), ["EM", "HERO"])


class CardGroupReviewApiTest(CardGroupTest):
    def setUp(self):
        super().setUp()
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient
        self.groups = self.build()
        self.staff = get_user_model().objects.create_user(email="cg@test.com", username="cg", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def test_only_staff(self):
        from django.contrib.auth import get_user_model
        from rest_framework.test import APIClient
        c = APIClient()
        c.force_authenticate(get_user_model().objects.create_user(email="u@test.com", username="u", password="x"))
        self.assertEqual(c.get("/api/carddb/card-groups/").status_code, 403)

    def test_list_puts_groups_to_check_first(self):
        from .models import CardGroup
        CardGroup.objects.update(needs_review=False)
        CardGroup.objects.filter(text="EM").update(needs_review=True)
        body = self.client.get("/api/carddb/card-groups/").json()
        self.assertEqual(body["results"][0]["text"], "EM")
        self.assertEqual(body["review_count"], CardGroup.objects.filter(needs_review=True).count())
        self.assertEqual([r["text"] for r in self.client.get("/api/carddb/card-groups/", {"q": "엘리멘틀"}).json()["results"]], ["E・HERO"])

    def test_rename_and_edit_members_are_logged(self):
        from django.contrib.admin.models import LogEntry
        gid = self.groups["HERO"].id
        ok = self.client.patch(f"/api/carddb/card-groups/{self.groups['EM'].id}/", {"reviewed": True}, format="json").json()
        self.assertEqual((ok["group"]["name_source"], ok["group"]["needs_review"]), ("manual", False))
        body = self.client.patch(f"/api/carddb/card-groups/{gid}/", {"name_ko": "히어로"}, format="json").json()
        self.assertEqual((body["group"]["name_ko"], body["group"]["name_source"], body["group"]["needs_review"]), ("히어로", "manual", False))
        body = self.client.post(f"/api/carddb/card-groups/{gid}/members/", {"card_id": 3, "action": "remove"}, format="json").json()
        self.assertEqual(body["group"]["members"], 2)
        self.assertEqual(next(m["how"] for m in body["members"] if m["card_id"] == 3), "removed")
        body = self.client.post(f"/api/carddb/card-groups/{gid}/members/", {"card_id": 14, "action": "add"}, format="json").json()
        self.assertEqual(body["group"]["members"], 3)
        self.assertEqual([c["text"] for c in body["children"]], ["E・HERO"])
        self.assertEqual(LogEntry.objects.count(), 4)
