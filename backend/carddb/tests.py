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


class CardGroupCase(TestCase):
    """Cards that show each 카드군 case, and building the groups from them."""

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
        self.card(17, "H・C 強襲のハルベルト", "H·C 강습의 할베르트", ruby="$RＨ(ヒロイック)・$RＣ(チャレンジャー)　強襲のハルベルト")
        self.card(18, "C・リペアラー", "C·리페어러", ruby="$RＣ(チェーン)・リペアラー", ja_text="「C」モンスター", ko_text='"C" 몬스터')
        self.card(19, "C・ドラゴン", "C·드래곤", ruby="$RＣ(チェーン)・ドラゴン")
        self.card(25, "C・チッキー", "C·치키", ruby="$RＣ(コクーン)・チッキー")
        self.card(26, "コクーン・パーティ", "코쿤 파티", ja_text="「C」モンスター", ko_text='"C" 몬스터')

    def build(self):
        from .groups import compute, save
        from .models import CardGroup
        save(compute())
        out = {}
        for g in CardGroup.objects.all():
            out[(g.text, g.reading)] = g
            out.setdefault(g.text, g)
        return out

    def members(self, group):
        return sorted(group.members.exclude(how="removed").values_list("card_id", flat=True))


class CardGroupTest(CardGroupCase):
    """카드군 by the rule, on cards that show each case."""

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

    def test_one_text_read_two_ways_is_two_groups(self):
        g = self.build()
        self.assertEqual(self.members(g[("C", "チェーン")]), [18, 19])
        self.assertEqual(self.members(g[("C", "コクーン")]), [25])   # コクーン・パーティ spells out which C it means
        self.assertNotIn(("C", "チャレンジャー"), g)   # no card names H・C's C on its own
        self.assertTrue(g[("C", "チェーン")].needs_review)

    def test_latin_letters_in_front_still_count(self):
        self.card(40, "DDリリス", "DD 릴리스", ruby="$RＤ(ディー)$RＤ(ディー)リリス", ja_text="「DD」モンスター")
        self.card(41, "DDD制覇王カイゼル", "DDD 제패왕 카이젤", ruby="$RＤ(ディー)$RＤ(ディー)$RＤ(ディー)$R制(せい)$R覇(は)$R王(おう)カイゼル")
        self.card(42, "D・ライトン", "D·라이튼", ruby="$RＤ(ディフォーマー)・ライトン", ja_text="「D」モンスター")
        self.card(43, "D・バリア", "D·배리어", ruby="$RＤ(ディフォーマー)・バリア", ja_text="「D」モンスター")
        self.card(44, "ダブルツールD&C", "더블 툴 D&C", ruby="ダブルツール$RＤ(ディー)＆$RＣ(シー)", ja_text="「D」モンスター")
        self.card(45, "CNo.39 希望皇ホープレイ", "CNo.39 유토피아 레이", ruby="$RＣＮｏ．(カオスナンバーズ)３９ 希望皇ホープレイ",
                  ja_text="「No.」モンスター")
        from .models import SrcMd
        SrcMd.objects.filter(md_id=14).update(ruby="$RＮｏ．(ナンバーズ)３９ 希望皇ホープ")
        g = self.build()
        self.assertEqual(self.members(g["DD"]), [40, 41])
        self.assertEqual((self.members(g["D"]), g["D"].reading), ([42, 43], "ディフォーマー"))
        self.assertEqual(self.members(g["No."]), [14, 45])
        self.assertEqual(self.members(g["N"]), [13])   # a letter after it still splits the word
        self.assertFalse(any(16 in self.members(x) for k, x in g.items() if k[0] == "C"))   # RESCUE! as R－ACE

    def test_a_group_read_only_inside_whole_name_rubies(self):
        self.card(60, "巳剣之尊 草那藝", "미츠루기노미코토 쿠사나기", ruby="$R巳剣之尊(ミツルギノミコト)　$R草那藝(クサナギ)",
                  ja_text="「巳剣」カード１枚を対象として発動できる。")
        self.card(61, "巳剣勧請", "미츠루기권청", ruby="$R巳剣勧請(ミツルギカンジョウ)")
        self.card(62, "天叢雲之巳剣", "아메노무라쿠모노미츠루기", ruby="$R天叢雲之巳剣(アメノムラクモノミツルギ)")
        g = self.build()
        self.assertEqual((self.members(g["巳剣"]), g["巳剣"].reading), ([60, 61, 62], "ミツルギ"))

    def test_reading_is_the_one_the_naming_cards_mean(self):
        from .models import CardGroup
        for cid, name, ruby in ((50, "魔法探査の石版", "$R魔(ま)$R法(ほう)$R探(たん)$R査(さ)の$R石(せき)$R版(ばん)"),
                                (51, "ヒエログリフの石版", "ヒエログリフの$R石(せき)$R版(ばん)"),
                                (52, "墓守の石版", "$R墓(はか)$R守(もり)の$R石(せき)$R版(ばん)"),
                                (53, "石版の神殿", "$R石版(ウェジュ)の$R神(しん)$R殿(でん)")):
            self.card(cid, name, ruby=ruby)
        self.card(54, "嘆きの石版", ruby="$R嘆(なげ)きの$R石版(ウェジュ)", ja_text="「嘆きの石版」以外の「石版」カード１枚")
        old = CardGroup.objects.create(text="石版", reading="せきばん", name_ko="석판", name_source="manual")
        g = self.build()
        self.assertEqual((g["石版"].id, g["石版"].reading, g["石版"].name_ko), (old.id, "ウェジュ", "석판"))
        self.assertEqual(self.members(g["石版"]), [53, 54])
        self.assertEqual(CardGroup.objects.filter(text="石版").count(), 1)

    def test_cards_without_a_known_reading_dont_outvote_master_duel(self):
        self.card(20, "幻魔皇ラビエル", "환마황제 라비엘", ruby="$R幻(げん)$R魔(ま)$R皇(おう)ラビエル", ja_text="「幻魔」融合モンスター")
        self.card(21, "混沌幻魔アーミタイル", "혼돈환마 아미타일", ruby="$R混(こん)$R沌(とん)$R幻(げん)$R魔(ま)アーミタイル")
        for cid, name in ((22, "劫火の三幻魔－神炎皇ウリア"), (23, "罪禍の三幻魔－降雷皇ハモン"), (24, "無窮の三幻魔－幻魔皇ラビエル")):
            self.card(cid, name, md=False)
        g = self.build()
        self.assertEqual((self.members(g["幻魔"]), g["幻魔"].reading), ([20, 21, 22, 23, 24], "げんま"))

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

    def test_a_group_a_deck_is_linked_to_is_never_dropped(self):
        from deck.models import Deck, DeckCardGroup
        from .models import CardGroup
        gone = CardGroup.objects.create(text="消えた", reading="きえた", name_ko="사라진")
        deck = Deck.objects.create(name="덱", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCardGroup.objects.create(deck=deck, group=gone)
        CardGroup.objects.create(text="ただの", reading="ただの", name_ko="그냥")
        self.build()
        self.assertTrue(CardGroup.objects.filter(text="消えた").exists())
        self.assertFalse(CardGroup.objects.filter(text="ただの").exists())
        self.assertEqual(DeckCardGroup.objects.count(), 1)

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


class CardSupportTest(CardGroupCase):
    """서포트: a card that names a 카드군 or a card in its Japanese text without being one of them (엘리스 2026-10-11)."""

    def setUp(self):
        super().setUp()
        self.card(70, "ヒーロー・ブラスト", "히어로 블라스트", ja_text="自分の墓地の「E・HERO」通常モンスター１体を対象として発動できる。")
        self.card(71, "ミラクル・フュージョン", "미라클 퓨전", ja_text="「HERO」融合モンスターを融合召喚する。")
        self.card(73, "ブラック・マジシャン", "블랙 매지션")
        self.card(75, "ブラック・マジシャン・ガール", "블랙 매지션 걸", ja_text="デッキから「ブラック・マジシャン」カード１枚を手札に加える。")
        self.card(72, "黒・魔・導", "흑·마·도", ja_text="自分フィールドに「ブラック・マジシャン」が存在する場合に発動できる。")
        self.card(74, "マジシャンズ・ロッド", "매지션즈 로드",
                  ja_text="「マジシャンズ・ロッド」の①の効果は１ターンに１度しか使用できない。①：「ブラック・マジシャン」のカード名が記された魔法・罠カード１枚を手札に加える。")
        self.card(76, "スケープ・ゴート", "스케이프 고트", ja_text="「羊トークン」（獣族・地・星１・攻／守０）４体を特殊召喚する。")
        self.card(77, "羊トークン", "양 토큰")
        self.card(78, "アンノウン・シンクロン", "언노운 싱크론", ja_text="「相手の手札をランダムに１枚捨てる」効果を発動する。")
        self.card(79, "マジシャン・オブ・ブラックイリュージョン", "매지션 오브 블랙 일루전",
                  ja_text="②：このカードはモンスターゾーンに存在する限り、カード名を「ブラック・マジシャン」として扱う。")
        self.card(80, "EMヒーロー・フェス", "EM 히어로 페스", ruby="$REM(エンタメイト)ヒーロー・フェス", ja_text="「EM」又は「HERO」モンスター１体")
        self.card(81, "鎖の宴", "사슬의 연회", ja_text="「C」モンスター１体を対象とする。")
        self.card(82, "D-HERO ドグマガイ", "데스티니 히어로 도그마 가이", ja_text="自分フィールドの「HERO」モンスター３体をリリースした場合のみ特殊召喚できる。")
        self.card(83, "E・HERO フェザーマン", "엘리멘틀 히어로 페더맨", ja_text="「E・HERO バーストレディ」が存在する場合に発動できる。")
        self.card(84, "E・HERO バーストレディ", "엘리멘틀 히어로 버스트 레이디")
        self.card(85, "ブラック・フレア・ナイト", "블랙 플레어 나이트", ja_text="デッキから「ミラージュ・ナイト」１体を特殊召喚する。")
        self.card(86, "ミラージュ・ナイト", "미라지 나이트", ja_text="「ブラック・フレア・ナイト」の効果でのみ特殊召喚できる。")
        self.card(87, "ロード・シンクロン", "로드 싱크론", ja_text="「ロード・ウォリアー」以外のシンクロ召喚には使用できない。")
        self.card(88, "ロード・ウォリアー", "로드 워리어")

    def supports(self, cid):
        from .models import CardSupport
        out = {}
        for s in CardSupport.objects.filter(card_id=cid).select_related("group"):
            key = ("g", s.group.text, s.group.reading) if s.group_id else ("c", s.target_id)
            out[key] = s.how
        return out

    def build(self):
        g = super().build()
        from .support import compute, save
        save(compute())
        return g

    def test_a_group_named_by_a_card_outside_it(self):
        self.build()
        self.assertEqual(self.supports(70), {("g", "E・HERO", "E・HERO"): "group"})
        # D-HERO is a HERO but not an E・HERO: naming E・HERO supports it
        self.assertEqual(self.supports(3), {("g", "E・HERO", "E・HERO"): "group"})

    def test_members_naming_their_own_group_are_members_not_support(self):
        self.build()
        self.assertEqual(self.supports(1), {})   # E・HERO エアーマン naming 「HERO」
        self.assertEqual(self.supports(4), {})   # EM naming 「EM」
        # a D-HERO naming 「HERO」 is a HERO talking about its own: nothing reaches E・HERO under it either
        self.assertEqual(self.supports(82), {})

    def test_support_of_a_group_reaches_the_groups_under_it(self):
        self.build()
        self.assertEqual(self.supports(71), {("g", "HERO", "HERO"): "group", ("g", "E・HERO", "E・HERO"): "parent"})

    def test_a_named_card_and_the_groups_it_is_in(self):
        self.build()
        self.assertEqual(self.supports(72), {("c", 73): "card", ("g", "ブラック・マジシャン", "ブラック・マジシャン"): "card_group"})
        # cards that name a card ("のカード名が記された") support it too; its own name is not a mention
        self.assertEqual(self.supports(74), {("c", 73): "card", ("g", "ブラック・マジシャン", "ブラック・マジシャン"): "card_group"})

    def test_tokens_quoted_effects_and_treated_as_are_not_support(self):
        g = self.build()
        self.assertEqual(self.supports(76), {})
        self.assertEqual(self.supports(78), {})
        self.assertEqual(self.supports(9), {})    # ルール上「ギャラクシーアイズ」カードとしても扱う: a member
        # a card bearing another's name is recorded as such ("named"), apart from what it supports
        self.assertEqual(self.supports(79), {("c", 73): "named"})
        # "while on the field its name is 「ブラック・マジシャン」" makes it one of them
        self.assertIn(79, self.members(g["ブラック・マジシャン"]))

    def test_a_chain_of_groups(self):
        self.build()
        self.assertEqual(self.supports(80), {("g", "HERO", "HERO"): "group", ("g", "E・HERO", "E・HERO"): "parent"})   # EM: a member

    def test_mentions_that_are_no_support(self):
        self.build()
        # one of a group naming a fellow member: their 카드군 already ties them, no support
        self.assertEqual(self.supports(83), {})
        # two cards naming each other (의식 몬스터 ↔ 의식 마법 …) support each other
        self.assertEqual((self.supports(85), self.supports(86)), ({("c", 86): "card"}, {("c", 85): "card"}))
        # named only to be left out ("「X」以外")
        self.assertEqual(self.supports(87), {})

    def test_a_text_read_two_ways(self):
        self.build()
        self.assertEqual(self.supports(26), {("g", "C", "コクーン"): "group"})   # コクーン・パーティ spells out its C
        self.assertEqual(self.supports(81), {("g", "C", "コクーン"): "group", ("g", "C", "チェーン"): "group"})   # can't tell: both

    def test_a_rebuild_replaces_the_rows(self):
        from .models import CardSupport
        self.build()
        n = CardSupport.objects.count()
        self.build()
        self.assertEqual(CardSupport.objects.count(), n)


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


class CardDexApiTest(TestCase):
    """카드 도감: Master Duel cards with art, searched, filtered, sorted newest first, 60 a page; card documents."""

    def card(self, cid, ko, ja="", en="", art=True, md=True, **fields):
        from .models import MdArt
        values = dict(category="monster", frame="effect", types=["effect"], attribute="dark", race="spellcaster",
                      level=4, atk=1800, def_value=1000)
        values.update(fields)
        c = Card.objects.create(id=cid, name_ko=ko, name_ja=ja or ko, name_en=en, **values)
        if md:
            MdPrint.objects.create(md_id=cid, card=c, rarity="SR")
            if art:
                MdArt.objects.create(md_print_id=cid, version="common", image=f"cards/art/common/{cid}.webp")
        return c

    def setUp(self):
        from django.test import override_settings
        from . import display
        media = tempfile.mkdtemp()   # never the live media folder
        self.addCleanup(shutil.rmtree, media)
        ctx = override_settings(MEDIA_ROOT=media)
        ctx.enable()
        self.addCleanup(ctx.disable)
        display.forget_art()
        self.addCleanup(display.forget_art)
        self.dm = self.card(1, "블랙 매지션", "ブラック・マジシャン", "Dark Magician", level=7, atk=2500, def_value=2100,
                            types=["normal"], frame="normal", ocg_date=date(1999, 2, 4))
        self.bewd = self.card(2, "푸른 눈의 백룡", "青眼の白龍", "Blue-Eyes White Dragon", level=8, atk=3000, def_value=2500,
                              types=["normal"], frame="normal", attribute="light", race="dragon", ocg_date=date(1999, 2, 4))
        self.girl = self.card(3, "블랙 매지션 걸", "ブラック・マジシャン・ガール", "Dark Magician Girl", level=6, atk=2000,
                              def_value=1700, ocg_date=date(2000, 7, 13))
        self.quick = self.card(4, "블랙 매지션의 속공", category="spell", frame="spell", types=[], attribute="", race="",
                               level=None, atk=None, def_value=None, spell_trap_subtype="quick_play", ocg_date=date(2024, 1, 1))
        self.scale = self.card(5, "펜듈럼 마술사", frame="effect_pendulum", types=["pendulum", "effect"], pendulum_scale=4,
                               ocg_date=date(2015, 1, 1))
        self.link = self.card(6, "링크 몬스터", frame="link", types=["link", "effect"], level=None, link_rating=2,
                              def_value=None, link_markers=["bottom_left", "bottom_right"], race="cyberse", ocg_date=date(2017, 3, 25))
        self.card(7, "그림 없는 카드", art=False)
        self.card(8, "OCG 전용 카드", md=False)

    def get(self, **params):
        return self.client.get("/api/carddb/cards/", params).json()

    def ids(self, **params):
        params.setdefault("sort", "new")   # the filter tests read the cards newest first
        return [r["id"] for r in self.get(**params)["results"]]

    def test_list_is_public_in_default_order_and_master_duel_only(self):
        body = self.get()   # Master Duel's 디폴트 순 unless another is asked (엘리스 10/12)
        self.assertEqual([r["id"] for r in body["results"]], [1, 2, 3, 5, 6, 4])
        self.assertEqual((body["total"], body["page"], body["has_more"]), (6, 1, False))
        self.assertEqual(body["results"][0]["name"], "블랙 매지션")
        self.assertEqual(self.ids(sort="new"), [4, 6, 5, 3, 2, 1])   # same day: higher id first
        self.assertEqual(self.ids(sort="name"), [6, 1, 3, 4, 5, 2])

    def test_type_order(self):
        # 디폴트 순 as Master Duel has it (몬마함순; 엘리스 10/12): monsters by frame (each before its pendulum), level / rank /
        # link low to high, then card number; spells, traps by kind
        self.card(9, "효과 레벨 4")
        self.card(12, "엑시즈", frame="xyz", types=["xyz", "effect"], level=None, rank=4)
        self.card(11, "지속 마법", category="spell", frame="spell", types=[], attribute="", race="", level=None,
                  atk=None, def_value=None, spell_trap_subtype="continuous")
        self.card(10, "일반 함정", category="trap", frame="trap", types=[], attribute="", race="", level=None,
                  atk=None, def_value=None, spell_trap_subtype="normal")
        self.assertEqual(self.ids(sort="type"), [1, 2, 9, 3, 5, 12, 6, 4, 11, 10])

    def test_master_duel_sorts_either_way(self):
        # every sort of Master Duel's card list, low to high or high to low (엘리스 10/12): equal cards keep the
        # 디폴트 순, cards without the value (a spell's level, a link's DEF) come last
        for md_id, rarity in ((1, "N"), (2, "UR"), (3, "R"), (4, "UR"), (5, "N"), (6, "SR")):
            MdPrint.objects.filter(md_id=md_id).update(rarity=rarity)
        expect = {
            ("type", "asc"): [1, 2, 3, 5, 6, 4], ("type", "desc"): [4, 6, 5, 3, 2, 1],
            ("new", "desc"): [4, 6, 5, 3, 2, 1], ("new", "asc"): [1, 2, 3, 5, 6, 4],
            ("name", "asc"): [6, 1, 3, 4, 5, 2], ("name", "desc"): [2, 5, 4, 3, 1, 6],
            ("rarity", "asc"): [1, 5, 3, 6, 2, 4], ("rarity", "desc"): [2, 4, 6, 3, 1, 5],
            ("level", "asc"): [6, 5, 3, 1, 2, 4], ("level", "desc"): [2, 1, 3, 5, 6, 4],
            ("atk", "asc"): [5, 6, 3, 1, 2, 4], ("atk", "desc"): [2, 1, 3, 5, 6, 4],
            ("def", "asc"): [5, 3, 1, 2, 6, 4], ("def", "desc"): [2, 1, 3, 5, 6, 4],
        }
        for (sort, way), ids in expect.items():
            self.assertEqual(self.ids(sort=sort, dir=way), ids, (sort, way))
        # each sort's own way when none is asked: the newest first, the rest low to high
        self.assertEqual(self.ids(sort="new"), expect["new", "desc"])
        self.assertEqual(self.ids(sort="rarity"), expect["rarity", "asc"])

    def test_list_gives_the_master_duel_banlist_status(self):
        # the 금제 icon in each card's corner (엘리스 10/12): the Master Duel list in effect today; one announced for
        # a later day waits for it, and unlimited shows nothing
        from datetime import timedelta
        from django.utils import timezone
        from .models import Banlist, BanlistEntry
        today = timezone.localdate()
        now = Banlist.objects.create(format="md", effective=today - timedelta(days=3))
        later = Banlist.objects.create(format="md", effective=today + timedelta(days=3))
        ocg = Banlist.objects.create(format="ocg", effective=today - timedelta(days=1))
        BanlistEntry.objects.create(banlist=now, card=self.dm, name="1", status="forbidden")
        BanlistEntry.objects.create(banlist=now, card=self.bewd, name="2", status="unlimited", previous="limited")
        BanlistEntry.objects.create(banlist=later, card=self.girl, name="3", status="limited")
        BanlistEntry.objects.create(banlist=ocg, card=self.quick, name="4", status="semi_limited")
        ban = {r["id"]: r["ban"] for r in self.get()["results"]}
        self.assertEqual((ban[1], ban[2], ban[3], ban[4]), ("forbidden", "", "", ""))
        # and the filter on it, several at once (엘리스 10/12)
        self.assertEqual(self.ids(ban="forbidden"), [1])
        self.assertEqual(self.ids(ban="limited,semi_limited"), [])
        self.assertEqual(sorted(self.ids(ban="unlimited")), [2, 3, 4, 5, 6])
        self.assertEqual(sorted(self.ids(ban="forbidden,unlimited")), [1, 2, 3, 4, 5, 6])

    def test_card_page_gives_its_master_duel_banlist_status(self):
        # the 금제 icon at the top left of the card page, as the rarity is at its top right (엘리스 10/12)
        from datetime import timedelta
        from django.utils import timezone
        from .models import Banlist, BanlistEntry
        now = Banlist.objects.create(format="md", effective=timezone.localdate() - timedelta(days=3))
        BanlistEntry.objects.create(banlist=now, card=self.dm, name="1", status="semi_limited")
        BanlistEntry.objects.create(banlist=now, card=self.bewd, name="2", status="unlimited", previous="limited")
        self.assertEqual(self.client.get("/api/carddb/cards/1/").json()["ban"], "semi_limited")
        self.assertEqual(self.client.get("/api/carddb/cards/2/").json()["ban"], "")   # unlimited: no icon

    def test_list_gives_the_rarity(self):
        MdPrint.objects.filter(md_id=2).update(rarity="UR")
        rarity = {r["id"]: r["rarity"] for r in self.get()["results"]}
        self.assertEqual((rarity[1], rarity[2]), ("SR", "UR"))

    def test_newest_goes_by_the_day_a_card_came_to_master_duel(self):
        MdPrint.objects.filter(md_id=1).update(first_seen=date(2026, 9, 1))   # an old card, newly in Master Duel
        self.assertEqual(self.ids()[:2], [1, 4])
        self.assertEqual(self.client.get("/api/carddb/cards/1/").json()["dates"]["md"], "2026-09-01")

    def test_master_duel_release_days_from_mdm(self):
        from unittest.mock import patch
        from django.core.management import call_command
        from . import md_release

        class Reply:
            def __init__(self, rows):
                self.rows = rows

            def raise_for_status(self):
                pass

            def json(self):
                return self.rows

        pages = {1: [{"gameId": "1", "release": "2022-01-19T06:00:00.000Z"}, {"gameId": "2", "release": "2022-01-18T20:00:00.000Z"}],
                 2: [{"gameId": "1", "release": "2024-02-07T06:00:00.000Z", "alternateArt": True}, {"gameId": "x"}]}
        calls = []

        def fake_get(url, params, **kw):
            calls.append(params["page"])
            return Reply(pages.get(params["page"], []))

        with patch.object(md_release, "PAGE", 2), patch.object(md_release.requests, "get", fake_get):
            out = io.StringIO()
            call_command("fetch_md_release", "--pause", "0", stdout=out)
        self.assertEqual(MdPrint.objects.get(md_id=1).first_seen, date(2022, 1, 19))   # not its alternate art's day
        self.assertEqual(MdPrint.objects.get(md_id=2).first_seen, date(2022, 1, 19))   # 20:00 UTC is the next day in Korea
        self.assertIn("2 prints dated", out.getvalue())
        MdPrint.objects.update(first_seen=date(2022, 1, 19))
        with patch.object(md_release.requests, "get", fake_get):
            out = io.StringIO()
            call_command("fetch_md_release", "--if-needed", stdout=out)
        self.assertIn("nothing to check", out.getvalue())

    def test_pages(self):
        for i in range(100, 170):
            self.card(i, f"카드 {i}", ocg_date=date(2020, 1, 1))
        first, second = self.get(), self.get(page=2)
        self.assertEqual((len(first["results"]), first["has_more"], first["total"]), (60, True, 76))
        self.assertEqual((len(second["results"]), second["has_more"]), (16, False))

    def test_search_any_language_exact_first(self):
        self.assertEqual(self.ids(q="블랙매지션"), [1, 3, 4])
        self.assertEqual(self.ids(q="ブラック・マジシャン"), [1, 3])
        self.assertEqual(self.ids(q="blue-eyes"), [2])
        self.assertEqual(self.ids(q="ㅂㄹㅁㅈㅅ"), [1, 3, 4])           # 초성
        self.assertEqual(self.ids(q="ㅍㄹ"), [2])

    def test_the_index_follows_changes(self):
        self.assertEqual(self.ids(q="새카드"), [])
        self.card(9, "새카드", ocg_date=date(2026, 1, 1))
        self.assertEqual(self.ids(q="새카드"), [9])
        renamed = Card.objects.get(id=9)
        renamed.name_ko = "고친카드"
        renamed.save()
        self.assertEqual(self.ids(q="고친카드"), [9])

    def test_filters(self):
        from .models import CardGroup, CardGroupMember
        self.assertEqual(self.ids(category="spell"), [4])
        self.assertEqual(self.ids(st="spell:quick_play"), [4])
        self.assertEqual(self.ids(frame="pendulum"), [5])
        self.assertEqual(self.ids(frame="normal"), [2, 1])
        self.assertEqual(self.ids(attribute="light"), [2])
        self.assertEqual(self.ids(race="cyberse"), [6])
        self.assertEqual(self.ids(level="2"), [6])                     # link rating counts
        g = CardGroup.objects.create(text="ブラック・マジシャン", reading="ブラック・マジシャン", name_ko="블랙 매지션")
        for c in (self.dm, self.girl):
            CardGroupMember.objects.create(group=g, card=c, how="name")
        CardGroupMember.objects.create(group=g, card=self.quick, how="removed")
        self.assertEqual(self.ids(group=g.id), [3, 1])
        # cards with another art, or with a monster cut-in (from the cut-in index on media; an alt art's counts for its card)
        import json
        import os
        from django.conf import settings
        from . import display
        from .models import MdArt
        alt = MdPrint.objects.create(md_id=3901, card=self.girl, is_alt_art=True, rarity="UR")
        MdArt.objects.create(md_print=alt, version="common", image="cards/art/common/3901.webp")
        display.forget_art()
        os.makedirs(os.path.join(settings.MEDIA_ROOT, "md_ui/cutin"))
        with open(os.path.join(settings.MEDIA_ROOT, "md_ui/cutin/index.json"), "w") as f:
            json.dump({"2": {"anim": "animation", "view": None}, "3901": {"anim": "animation", "view": None}}, f)
        self.assertEqual(self.ids(has="alt"), [3])
        self.assertEqual(self.ids(has="cutin"), [3, 2])
        self.assertEqual(self.ids(has="alt,cutin"), [3])
        # cards with an 오버프레임 print (특이점 2026-10-12): an alternate art covering the whole card (taller than 1.5×)
        from PIL import Image
        os.makedirs(os.path.join(settings.MEDIA_ROOT, "cards/art/common"), exist_ok=True)
        Image.new("RGB", (512, 1024)).save(os.path.join(settings.MEDIA_ROOT, "cards/art/common/3902.webp"), "WEBP")
        Image.new("RGB", (624, 624)).save(os.path.join(settings.MEDIA_ROOT, "cards/art/common/3901.webp"), "WEBP")
        of = MdPrint.objects.create(md_id=3902, card=self.dm, is_alt_art=True, rarity="UR")
        MdArt.objects.create(md_print=of, version="common", image="cards/art/common/3902.webp")
        display.forget_art()
        self.assertEqual(self.ids(has="overframe"), [1])
        self.assertEqual(self.ids(has="alt"), [3, 1])
        self.assertEqual(self.ids(has="overframe,cutin"), [])

    def test_dex_counts(self):
        from deck.models import Deck
        Deck.objects.create(name="덱", strength=0, difficulty=0, deck_type=0, art_style=0)
        self.assertEqual(self.client.get("/api/carddb/dex-counts/").json(), {"decks": 1, "cards": 6})

    def test_options_give_korean_labels_and_reviewed_groups(self):
        from .models import CardGroup, CardGroupMember
        ok = CardGroup.objects.create(text="ブラック・マジシャン", reading="ブラック・マジシャン", name_ko="블랙 매지션")
        twin = CardGroup.objects.create(text="ブラック・マジシャン２", reading="x", name_ko="블랙 매지션")
        held = CardGroup.objects.create(text="ガール", reading="ガール", name_ko="걸", needs_review=True)
        for g in (ok, twin, held):
            CardGroupMember.objects.create(group=g, card=self.girl, how="name")
        body = self.client.get("/api/carddb/cards/options/").json()
        self.assertIn({"value": "light", "label": "빛"}, body["attributes"])
        self.assertIn({"value": "spellcaster", "label": "마법사족"}, body["races"])
        self.assertIn({"value": "spell:quick_play", "label": "속공 마법"}, body["spell_trap_kinds"])
        self.assertEqual(body["groups"], [{"id": ok.id, "name": "블랙 매지션", "count": 1}])

    def test_card_document(self):
        from deck.models import Deck, DeckCardGroup
        from .models import CardGroup, CardGroupMember
        CardText.objects.create(card=self.girl, lang="ko", effect="①: 이 카드의 공격력은 올라간다.")
        CardText.objects.create(card=self.girl, lang="ja", effect="①：このカードの攻撃力は上がる。")
        g = CardGroup.objects.create(text="ブラック・マジシャン", reading="ブラック・マジシャン", name_ko="블랙 매지션")
        held = CardGroup.objects.create(text="ガール", reading="ガール", name_ko="걸", needs_review=True)
        CardGroupMember.objects.create(group=g, card=self.girl, how="name")
        CardGroupMember.objects.create(group=held, card=self.girl, how="name")
        deck = Deck.objects.create(name="블랙 매지션", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCardGroup.objects.create(deck=deck, group=g)
        alt = MdPrint.objects.create(md_id=3901, card=self.girl, is_alt_art=True)
        from .models import MdArt
        MdArt.objects.create(md_print=alt, version="common", image="cards/art/common/3901.webp")
        body = self.client.get("/api/carddb/cards/3/").json()
        self.assertEqual((body["name_ko"], body["name_ja"], body["name_en"]), ("블랙 매지션 걸", "ブラック・マジシャン・ガール", "Dark Magician Girl"))
        self.assertEqual((body["type_line"], body["attribute"], body["level_label"]), ("마법사족 / 효과", "어둠", "레벨 6"))
        # the keys the document's icons are chosen by (Master Duel's own: attribute, race, spell / trap kind)
        self.assertEqual((body["attribute_key"], body["race"], body["spell_trap_kind"]), ("dark", "spellcaster", ""))
        self.assertEqual((body["atk"], body["def"]), ("2000", "1700"))
        self.assertEqual(body["texts"]["ko"]["effect"], "①: 이 카드의 공격력은 올라간다.")
        self.assertEqual(body["groups"], [{"id": g.id, "name": "블랙 매지션", "parent_id": None}])
        self.assertEqual([d["name"] for d in body["decks"]], ["블랙 매지션"])
        self.assertEqual(body["rarity"], "SR")
        self.assertEqual((body["face_url"], body["faces"]), (None, []))   # not drawn yet
        self.assertEqual(body["history"], [])   # no 금제 lists stored here
        self.assertEqual(body["ban"], "")         # nor a Master Duel 금제 for the icon beside its name
        link = self.client.get("/api/carddb/cards/6/").json()
        self.assertEqual((link["level_label"], link["def"], link["link_markers"]), ("링크 2", None, ["bottom_left", "bottom_right"]))
        spell = self.client.get("/api/carddb/cards/4/").json()
        self.assertEqual((spell["type_line"], spell["attribute"]), ("속공 마법", ""))
        self.assertEqual((spell["attribute_key"], spell["race"], spell["spell_trap_kind"]), ("", "", "quick_play"))
        # what Master Duel's finish shaders draw themselves: the attribute icon's tile (光 闇 水 炎 地 風 神 魔 罠), the
        # level stars (a rank as a negative count, its stars sitting on the left) and the frame they light
        self.assertEqual(body["finish"], {"attribute": 1, "level": 6, "frame": "normal"})
        self.assertEqual((spell["finish"], link["finish"]), ({"attribute": 7, "level": 0, "frame": "normal"},
                                                             {"attribute": 1, "level": 0, "frame": "link"}))
        from .dex import _finish
        pendulum = Card(category="monster", frame="effect_pendulum", attribute="dark", level=4)
        self.assertEqual(_finish(pendulum), {"attribute": 1, "level": 4, "frame": "pendulum"})
        self.assertEqual(self.client.get("/api/carddb/cards/7/").status_code, 404)   # no art
        self.assertEqual(self.client.get("/api/carddb/cards/8/").status_code, 404)   # not in Master Duel

    def test_a_decks_cards_in_the_card_book(self):
        """덱 문서 → 카드 도감 (특이점 2026-10-12): a deck's 테마 카드 — its 카드군 and those under them, the card it is
        built on and cards bearing that card's name — and, with role=support, the cards supporting them."""
        from deck.models import Deck, DeckCard, DeckCardGroup
        from .models import CardGroup, CardGroupMember, CardSupport
        top = CardGroup.objects.create(text="マジシャン", reading="マジシャン", name_ko="매지션")
        sub = CardGroup.objects.create(text="ブラック・マジシャン", reading="ブラック・マジシャン", name_ko="블랙 매지션", parent=top)
        CardGroupMember.objects.create(group=sub, card=self.dm, how="name")       # in a group under the deck's
        CardGroupMember.objects.create(group=top, card=self.scale, how="name")    # in the deck's own group
        deck = Deck.objects.create(name="매지션", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCardGroup.objects.create(deck=deck, group=top)
        DeckCard.objects.create(deck=deck, card=self.bewd)                         # built on a card as well
        CardSupport.objects.create(card=self.girl, target=self.bewd, how="named")  # bears that card's name: one of them
        CardSupport.objects.create(card=self.link, group=sub, how="group")         # supports a group under the deck's
        CardSupport.objects.create(card=self.quick, target=self.bewd, how="card")  # names the card it is built on
        CardSupport.objects.create(card=self.scale, group=sub, how="group")        # a member naming a group: stays a member
        body = self.get(deck=deck.id)
        self.assertEqual((body["deck_filter"], body["deck_counts"]), ({"id": deck.id, "name": "매지션", "by_card": False}, {"member": 4, "support": 2}))
        self.assertEqual(sorted(r["id"] for r in body["results"]), [1, 2, 3, 5])
        self.assertEqual(sorted(r["id"] for r in self.get(deck=deck.id, role="support")["results"]), [4, 6])
        self.assertEqual(self.get(deck=deck.id, q="블랙")["deck_counts"], {"member": 2, "support": 1})
        self.assertNotIn("deck_counts", self.get())
        # the deck page knows how many there are, for its button
        self.assertEqual(self.client.get(f"/api/deck/{deck.id}/").json()["card_book"], {"member": 4, "support": 2})
        bare = Deck.objects.create(name="연결 없음", strength=0, difficulty=0, deck_type=0, art_style=0)
        self.assertEqual(self.client.get(f"/api/deck/{bare.id}/").json()["card_book"], {"member": 0, "support": 0})
        self.assertEqual(self.get(deck=bare.id)["total"], 0)

    def test_a_cards_support_list_leaves_out_its_own_groups(self):
        # whatever the link, a card sharing a 카드군 with it is no 서포트 of it (엘리스 10/12, SPYRAL－댄디)
        from .models import CardGroup, CardGroupMember, CardSupport
        g = CardGroup.objects.create(text="ＳＰＹＲＡＬ", reading="スパイラル", name_ko="SPYRAL")
        dandy, tough, mate, charming = (self.card(20, "SPYRAL－댄디"), self.card(21, "SPYRAL－터프니스"),
                                        self.card(22, "SPYRAL－동료"), self.card(23, "RESORT STAFF－차밍"))
        for c in (dandy, tough, mate):
            CardGroupMember.objects.create(group=g, card=c, how="name")
        CardSupport.objects.create(card=tough, target=dandy, how="named")     # bears its name
        CardSupport.objects.create(card=mate, target=dandy, how="card")       # names it from inside the 카드군
        CardSupport.objects.create(card=charming, target=dandy, how="card")   # names it from outside
        self.assertEqual(self.client.get("/api/carddb/cards/20/").json()["supporters"], 2)   # itself and 차밍
        self.assertEqual(sorted(self.ids(card=20)), [20, 23])
        self.assertIn({"id": 20, "name": "SPYRAL－댄디", "count": 2},
                      self.client.get("/api/carddb/cards/options/").json()["support_cards"])
        self.assertEqual(self.client.get("/api/carddb/cards/22/").json()["supports"], [])
        self.assertEqual([t["id"] for t in self.client.get("/api/carddb/cards/23/").json()["supports"]], [20])

    def test_a_deck_built_on_a_card_alone_is_one_list(self):
        # no 카드군 to split into 테마 카드 and 서포트 (빛의 황금궤, 엘리스 10/12): the card, the cards bearing its name
        # and the cards naming it, in one list, as the card's own support list shows them
        from deck.models import Deck, DeckCard
        from .models import CardSupport
        deck = Deck.objects.create(name="빛의 황금궤", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCard.objects.create(deck=deck, card=self.quick)
        CardSupport.objects.create(card=self.dm, target=self.quick, how="card")     # names it
        CardSupport.objects.create(card=self.girl, target=self.quick, how="named")  # bears its name
        body = self.get(deck=deck.id)
        self.assertEqual(sorted(r["id"] for r in body["results"]), [1, 3, 4])
        self.assertEqual((body["deck_counts"], body["deck_filter"]["by_card"]), ({"member": 3, "support": 0}, True))
        self.assertEqual(sorted(self.ids(deck=deck.id, role="support")), [1, 3, 4])   # no 서포트 tab to fall into
        self.assertEqual(self.client.get(f"/api/deck/{deck.id}/").json()["card_book"], {"member": 3, "support": 0, "by_card": True})

    def test_supports_on_the_card_page_and_in_the_group_list(self):
        from deck.models import Deck, DeckCardGroup
        from .models import CardGroup, CardGroupMember, CardSupport
        g = CardGroup.objects.create(text="ブラック・マジシャン", reading="ブラック・マジシャン", name_ko="블랙 매지션")
        for c in (self.dm, self.girl):
            CardGroupMember.objects.create(group=g, card=c, how="name")
        deck = Deck.objects.create(name="블랙 매지션", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCardGroup.objects.create(deck=deck, group=g)
        # 속공 (4) names the card 블랙 매지션, and so its group; 링크 몬스터 (6) names the group
        CardSupport.objects.create(card=self.quick, target=self.dm, how="card")
        CardSupport.objects.create(card=self.quick, group=g, how="card_group")
        CardSupport.objects.create(card=self.link, group=g, how="group")
        # a deck built on a card (빛의 황금궤 …): the card, cards bearing its name and the cards naming it
        from deck.models import DeckCard
        ark = Deck.objects.create(name="빛의 황금궤", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCard.objects.create(deck=ark, card=self.bewd)
        CardSupport.objects.create(card=self.scale, target=self.bewd, how="card")
        CardSupport.objects.create(card=self.girl, target=self.bewd, how="named")
        self.assertEqual([(d["name"], d["via"]) for d in self.client.get("/api/carddb/cards/2/").json()["decks"]], [("빛의 황금궤", "member")])
        self.assertEqual([(d["name"], d["via"]) for d in self.client.get("/api/carddb/cards/5/").json()["decks"]], [("빛의 황금궤", "support")])
        girl = self.client.get("/api/carddb/cards/3/").json()
        self.assertEqual(([(d["name"], d["via"]) for d in girl["decks"]], girl["supports"]),
                         ([("블랙 매지션", "member"), ("빛의 황금궤", "member")], []))
        # a card's own support list: the card itself, cards bearing its name, cards naming it (엘리스 2026-10-11)
        self.assertEqual(self.client.get("/api/carddb/cards/2/").json()["supporters"], 3)
        body = self.get(card=2)
        self.assertEqual(([r["id"] for r in body["results"]], body["card_filter"]), ([2, 3, 5], {"id": 2, "name": "푸른 눈의 백룡"}))
        self.assertEqual(self.client.get("/api/carddb/cards/6/").json()["supporters"], 0)   # nobody names it: no list
        # the cards with such a list, to search them beside the 카드군 (엘리스 10/12): the same count as their page
        support_cards = self.client.get("/api/carddb/cards/options/").json()["support_cards"]
        self.assertIn({"id": 2, "name": "푸른 눈의 백룡", "count": 3}, support_cards)
        self.assertNotIn(6, [c["id"] for c in support_cards])
        CardSupport.objects.filter(how="named").delete()
        body = self.client.get("/api/carddb/cards/4/").json()
        self.assertEqual(body["supports"], [{"kind": "card", "id": 1, "name": "블랙 매지션", "mutual": False}])   # what it names outright
        self.assertEqual(self.client.get("/api/carddb/cards/1/").json()["supporters"], 2)   # itself and 속공
        self.assertEqual([(d["name"], d["via"]) for d in body["decks"]], [("블랙 매지션", "support")])
        self.assertEqual(self.client.get("/api/carddb/cards/6/").json()["supports"], [{"kind": "group", "id": g.id, "name": "블랙 매지션", "mutual": False}])
        self.assertEqual([(d["name"], d["via"]) for d in self.client.get("/api/carddb/cards/3/").json()["decks"]], [("블랙 매지션", "member")])
        # a group's list: its members, or the cards supporting it, with both counts
        body = self.get(group=g.id)
        self.assertEqual(([r["id"] for r in body["results"]], body["group_counts"]), ([1, 3], {"member": 2, "support": 2}))
        self.assertEqual(self.ids(group=g.id, role="support"), [4, 6])
        self.assertEqual(self.get(group=g.id, role="support", q="링크")["group_counts"], {"member": 0, "support": 1})
        self.assertNotIn("group_counts", self.get())
        # supporting a group under another supports part of it: the decks linked to the one above count too
        top = CardGroup.objects.create(text="マジシャン", reading="マジシャン", name_ko="매지션")
        CardGroup.objects.filter(id=g.id).update(parent=top)
        family = Deck.objects.create(name="매지션 일가", strength=0, difficulty=0, deck_type=0, art_style=0)
        DeckCardGroup.objects.create(deck=family, group=top)
        self.assertEqual([(d["name"], d["via"]) for d in self.client.get("/api/carddb/cards/6/").json()["decks"]],
                         [("블랙 매지션", "support"), ("매지션 일가", "support")])
        # two cards naming each other: each one's support, marked as mutual (⇄)
        CardSupport.objects.create(card=self.link, target=self.scale, how="card")
        CardSupport.objects.filter(card=self.scale, target=self.bewd).update(target=self.link)
        scale = self.client.get("/api/carddb/cards/5/").json()
        self.assertEqual(([s for s in scale["supports"] if s["kind"] == "card"], scale["supporters"]),
                         ([{"kind": "card", "id": 6, "name": "링크 몬스터", "mutual": True}], 2))


class CardFaceTest(TestCase):
    """Korean card faces drawn from Master Duel's pictures (stand-ins here) with free fonts (마루 부리, Noto)."""

    def setUp(self):
        import os
        from django.conf import settings
        from django.test import override_settings
        from PIL import Image
        from . import display, face
        fonts = getattr(settings, "CARD_FACE_ASSETS", "")
        font_files = ("NotoSansKR.ttf", "NotoSerifKR.ttf", "MaruBuri-Bold.otf", "NotoSerifJP.ttf", "DejaVuSerif-Bold.ttf")
        if not all(os.path.exists(os.path.join(fonts, f)) for f in font_files):
            self.skipTest("free fonts not installed")
        self.assets, self.media = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.assets)
        self.addCleanup(shutil.rmtree, self.media)
        for f in font_files:
            os.symlink(os.path.join(fonts, f), os.path.join(self.assets, f))
        names = ([f"card_frame{k}.png" for k in face.FRAMES.values()] + ["tex_IconLv.png", "tex_IconRank.png"]
                 + [f"GUI_T_Icon1_Attr0{i}.png" for i in range(1, 10)] + [f"GUI_T_Icon1_Icon0{i}.png" for i in range(1, 7)]
                 + [f"GUI_CardPicture_MarkerLinkOn_{k}.png" for k in ("U", "D", "L", "R", "UL", "UR", "DL", "DR")])
        for n in names:
            if n.startswith("card_frame"):
                im = Image.new("RGBA", (704, 1024), (200, 120, 60, 255))
                im.paste((0, 0, 0, 0), face.ART)   # the window the art shows through
            else:
                im = Image.new("RGBA", (64, 64), (200, 120, 60, 200))
            im.save(os.path.join(self.assets, n))
        os.makedirs(os.path.join(self.media, "cards/art/common"))
        Image.new("RGB", (512, 512), (10, 200, 10)).save(os.path.join(self.media, "cards/art/common/7.webp"), "WEBP", lossless=True)
        ctx = override_settings(CARD_FACE_ASSETS=self.assets, MEDIA_ROOT=self.media)
        ctx.enable()
        self.addCleanup(ctx.disable)
        for clear in (face._image.cache_clear, face._font.cache_clear, display.forget_art):
            clear()
            self.addCleanup(clear)
        from .models import MdArt
        self.card = Card.objects.create(id=7, category="monster", name_ko="스타더스트 드래곤", name_ja="スターダスト・ドラゴン",
                                        frame="synchro", types=["synchro", "tuner", "effect"], attribute="wind",
                                        race="dragon", level=8, atk=2500, def_value=2000)
        MdPrint.objects.create(md_id=7, card=self.card)
        MdArt.objects.create(md_print_id=7, version="common", image="cards/art/common/7.webp")

    def test_letters_the_name_font_lacks(self):
        """마루 부리 has no Greek, Cyrillic or Japanese-only kanji: those letters come from the next free font that has
        them (엘리스 10/11: PSY프레임로드 Ω showed a box), and only the faces with such names are drawn again."""
        from .face import draw_face, needs_fallback, signature, text_runs, title
        runs = text_runs("PSY프레임로드 Ω", title(48))
        self.assertEqual([t for t, _ in runs], ["PSY프레임로드 ", "Ω"])
        self.assertTrue(runs[1][1].path.endswith("NotoSerifKR.ttf"))
        self.assertTrue(text_runs("黙", title(48))[0][1].path.endswith("NotoSerifJP.ttf"))
        self.assertTrue(text_runs("에니아크래프트ϝ", title(48))[-1][1].path.endswith("DejaVuSerif-Bold.ttf"))
        self.assertEqual(len(text_runs("스타더스트 드래곤", title(48))), 1)
        self.assertFalse(needs_fallback("스타더스트 드래곤"))
        self.assertTrue(needs_fallback("데모닉 모터 Ω"))
        plain = signature(self.card, 7)
        self.card.name_ko = "PSY프레임로드 Ω"
        self.assertEqual(draw_face(self.card).size, (704, 1024))
        self.card.name_ko = "스타더스트 드래곤"
        self.assertEqual(signature(self.card, 7), plain)

    def test_type_line(self):
        from .face import type_line
        self.assertEqual(type_line(self.card), "【드래곤족／싱크로／튜너／효과】")
        self.card.types = ["normal"]
        self.assertEqual(type_line(self.card), "【드래곤족】")

    def test_face_is_drawn_and_saved(self):
        import os
        from django.core.management import call_command
        from .face import draw_face, face_url
        img = draw_face(self.card)
        self.assertEqual((img.size, img.mode), ((704, 1024), "RGBA"))
        self.assertEqual(img.getpixel((352, 450))[:3], (10, 200, 10))   # the art shows through the frame's window
        self.assertIsNone(face_url(7))
        from PIL import Image
        from .models import MdArt
        MdPrint.objects.filter(md_id=7).update(rarity="R")
        alt = MdPrint.objects.create(md_id=3907, card=self.card, is_alt_art=True, rarity="UR")
        Image.new("RGB", (512, 1024), (10, 200, 10)).save(os.path.join(self.media, "cards/art/common/3907.webp"), "WEBP")
        MdArt.objects.create(md_print=alt, version="common", image="cards/art/common/3907.webp")   # in 오버프레임
        from . import display
        display.forget_art()
        call_command("draw_card_faces", "--workers", "1", stdout=io.StringIO())
        for rel in ("cards/face/7.webp", "cards/face_thumb/7.webp", "cards/face/3907.webp", "cards/face_name/7.png"):
            self.assertTrue(os.path.exists(os.path.join(self.media, rel)), rel)
        # Browsers keep /media for years, so each address carries the file's version: a redrawn face gets a new one.
        first = face_url(7)
        self.assertRegex(first, r"^/media/cards/face/7\.webp\?v=\w+$")
        body = self.client.get("/api/carddb/cards/7/").json()
        self.assertEqual(body["face_url"], first)
        # an R card's 오버프레임 print is UR: each face carries its own rarity (로얄 comes in SR and UR only)
        self.assertEqual([(f["id"], f["overframe"], f["rarity"]) for f in body["faces"]], [(7, False, "R"), (3907, True, "UR")])
        # Master Duel's monster cut-ins (index on media) go with the print they belong to; the sound is the attribute's
        import json
        os.makedirs(os.path.join(self.media, "md_ui/cutin"))
        with open(os.path.join(self.media, "md_ui/cutin/index.json"), "w") as f:
            json.dump({"3907": {"anim": "animation", "view": [0, 0, 500]}}, f)
        body = self.client.get("/api/carddb/cards/7/").json()
        self.assertEqual([f["cutin"] for f in body["faces"]], [None, {"anim": "animation", "view": [0, 0, 500]}])
        self.assertEqual(body["cutin_sound"], "wind")
        self.assertEqual(body["faces"][0]["face"], first)
        # the name alone, for the Shine / Royal shaders to paint (the card's top sixth at 1.5×)
        self.assertRegex(body["faces"][0]["name_mask"], r"^/media/cards/face_name/7\.png\?v=\w+$")
        from PIL import Image
        with Image.open(os.path.join(self.media, "cards/face_name/7.png")) as mask:
            self.assertEqual((mask.size, mask.mode), ((1056, 256), "L"))
            self.assertGreater(mask.getextrema()[1], 200)
        first_thumb = self.client.get("/api/carddb/cards/").json()["results"][0]["face_thumb_url"]
        self.assertRegex(first_thumb, r"^/media/cards/face_thumb/7\.webp\?v=\w+$")
        os.remove(os.path.join(self.media, "cards/face_thumb/7.webp"))
        out = io.StringIO()
        call_command("draw_card_faces", "--workers", "1", stdout=out)
        self.assertIn("0 faces drawn, 1 thumbnails made", out.getvalue())   # only what is missing
        Card.objects.filter(id=7).update(atk=2600)
        out = io.StringIO()
        call_command("draw_card_faces", "--workers", "1", stdout=out)
        self.assertIn("2 faces drawn", out.getvalue())   # ATK changed: the card and its alternate art
        self.assertNotEqual(face_url(7), first)
        self.assertNotEqual(self.client.get("/api/carddb/cards/").json()["results"][0]["face_thumb_url"], first_thumb)
        out = io.StringIO()
        call_command("draw_card_faces", "--workers", "1", stdout=out)
        self.assertIn("0 faces drawn, 0 thumbnails made", out.getvalue())

    def test_sign_only_records_existing_faces_without_drawing(self):
        import os
        from django.core.management import call_command
        from .face import load_signatures, save_face
        save_face(self.card)
        out = io.StringIO()
        call_command("draw_card_faces", "--sign-only", stdout=out)
        self.assertEqual(list(load_signatures()), ["7"])
        out = io.StringIO()
        call_command("draw_card_faces", "--workers", "1", stdout=out)
        self.assertIn("0 faces drawn", out.getvalue())

    def test_refresh_card_book_runs_every_step(self):
        from django.core.management import call_command
        from django.test import override_settings
        from unittest.mock import patch
        from . import md_release
        import tempfile
        out = io.StringIO()
        # BASE_DIR elsewhere: the identifier's gallery step must never reach the site's own files
        with override_settings(MD_NAMED_PATH="", BASE_DIR=tempfile.mkdtemp()), \
                patch.object(md_release, "fetch_releases", lambda **kw: {}):
            call_command("refresh_card_book", "--workers", "1", stdout=out)
        self.assertIn("md release", out.getvalue())
        self.assertIn("faces drawn", out.getvalue())
        self.assertIn("gallery: no identifier model here", out.getvalue())
        self.assertIn("thumbnails made", out.getvalue())


    def test_an_overframe_art_covers_the_whole_card(self):
        import os
        from PIL import Image
        from . import display
        from .face import draw_face
        from .models import MdArt
        Image.new("RGB", (512, 1024), (200, 10, 200)).save(os.path.join(self.media, "cards/art/common/22789.webp"), "WEBP", lossless=True)
        of = MdPrint.objects.create(md_id=22789, card=self.card, is_alt_art=True)
        MdArt.objects.create(md_print=of, version="common", image="cards/art/common/22789.webp")
        display.forget_art()
        img = draw_face(self.card, art_id=22789)
        self.assertEqual(img.getpixel((10, 500))[:3], (200, 10, 200))     # where the frame would be
        self.assertEqual(draw_face(self.card).getpixel((10, 500))[:3], (200, 120, 60))   # the usual print keeps its frame

    def test_pendulum_scale_is_drawn_with_the_text_boxes_empty(self):
        from .face import PEND_SCALE_X, draw_face
        self.card.frame, self.card.types, self.card.pendulum_scale = "effect_pendulum", ["pendulum", "effect"], 7
        x = PEND_SCALE_X[0]
        box = draw_face(self.card).crop((x - 15, 715, x + 15, 755)).convert("L")
        self.assertLess(min(box.getdata()), 60)   # dark digit strokes on the light frame
