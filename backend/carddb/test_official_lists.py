"""금제 from the games' own pages: the OCG page in Japanese, the TCG page in English, replacing Yugipedia's lists."""
import os
import shutil
import tempfile
from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from . import official_lists
from .models import Banlist, BanlistEntry, Card


def ocg_html(day, sections):
    """An OCG リミットレギュレーション page as it is written: a heading a status, a row a card (name, TCG name, change)."""
    body = ""
    for heading, rows in sections:
        body += f"<h3>{heading}（{len(rows)}枚）</h3><table>"
        for ja, en, update in rows:
            changed = ' class="news"' if update else ""
            body += (f'<tr{changed}><td class="cell-ocg icon_effect">{ja}</td>'
                     f'<td class="cell-tcg">{en}</td><td class="cell-update">{update}</td></tr>')
        body += "</table>"
    return f"<html><head><title>リミットレギュレーション {day}適用リスト | イベント・大会</title></head><body><h2>カード検索</h2>{body}</body></html>"


def tcg_html(day, rows):
    """A TCG Forbidden & Limited page: the effective day, then a table (type, NAME, Advanced, Traditional, remarks)."""
    body = "".join(f'<tr class="cardlist_effect"><td>Monster/Effect</td><td>{name}</td><td>{adv}</td><td>Limited</td><td>{remark}</td></tr>'
                   for name, adv, remark in rows)
    return f'<html><body><p>Effective from {day}</p><table class="cardlist"><tr class="cardlist_atitle"><td>Card Type</td></tr>{body}</table></body></html>'


OCG_PAGE = ocg_html("2026年10月1日", [
    ("禁止カード", [("アーティファクト－デスサイズ", "ARTIFACT SCYTHE", ""), ("PSYフレームロード・Ω", "PSY-FRAMELORD OMEGA", "制限⇒禁止")]),
    ("制限カード", [("パーフェクトロン・ハイドライブ・ドラゴン", "PERFECTRON HYDRADRIVE DRAGON", "準制限⇒制限"),
                   ("キラーチューン・キュー", "KILLER TUNE CUE", "新規・制限")]),
    ("準制限カード", [("K９－１７号 イヅナ", "K9-17 IZUNA", "")]),
    ("制限解除されたカード", [("旧神ノーデン", "ELDER ENTITY NORDEN", "制限⇒解除")]),
])

TCG_PAGE = tcg_html("September 21, 2026", [
    ("AGIDO THE    ANCIENT SENTINEL", "Forbidden", ""), ("ARCHLORD    KRISTYA", "Forbidden", "New"),
    ("DIMENSION    SHIFTER", "Forbidden", "Was    Limited"), ("MIND MASTER", "Unlimited", "Was Forbidden"),
    ("POT OF DESIRES", "Semi-Limited", ""),
])


class ParseTest(SimpleTestCase):
    def test_the_ocg_page(self):
        p = official_lists.parse_ocg(OCG_PAGE)
        self.assertEqual(p.effective, date(2026, 10, 1))
        self.assertEqual([(e.name, e.status, e.previous) for e in p.entries], [
            ("アーティファクト－デスサイズ", "forbidden", ""), ("PSYフレームロード・Ω", "forbidden", "limited"),
            ("パーフェクトロン・ハイドライブ・ドラゴン", "limited", "semi_limited"), ("キラーチューン・キュー", "limited", "unlimited"),
            ("K９－１７号 イヅナ", "semi_limited", ""), ("旧神ノーデン", "unlimited", "limited")])
        self.assertEqual(p.entries[0].name_en, "ARTIFACT SCYTHE")
        self.assertIsNone(official_lists.parse_ocg("<html><title>リミットレギュレーション (禁止・制限・準制限カード)</title></html>"))

    def test_the_tcg_page(self):
        p = official_lists.parse_tcg(TCG_PAGE)
        self.assertEqual(p.effective, date(2026, 9, 21))
        self.assertEqual([(e.name, e.status, e.previous) for e in p.entries], [
            ("AGIDO THE ANCIENT SENTINEL", "forbidden", ""), ("ARCHLORD KRISTYA", "forbidden", "unlimited"),
            ("DIMENSION SHIFTER", "forbidden", "limited"), ("MIND MASTER", "unlimited", "forbidden"),
            ("POT OF DESIRES", "semi_limited", "")])
        self.assertIsNone(official_lists.parse_tcg("<html><body>Deck Construction Rules</body></html>"))
        self.assertEqual(official_lists.tcg_list_days('<a href="/en/limited/list_2026-02-02/">a</a> <a href="/en/limited/list_2026-09-21/">b</a>'),
                         ["2026-09-21", "2026-02-02"])

    def test_the_ocg_months_run_from_the_first_list_to_a_few_months_on(self):
        months = official_lists.ocg_months(date(2026, 10, 17))
        self.assertEqual((months[0], months[-1], len(months)), ("201404", "202701", 154))


class SaveTest(TestCase):
    def setUp(self):
        Card.objects.create(id=22743, category="monster", name_ja="パーフェクトロン・ハイドライブ・ドラゴン", frame="link")
        Card.objects.create(id=5868, category="monster", name_ja="ヴィクトリー・ドラゴン", name_en="Victory Dragon", frame="effect")
        Card.objects.create(id=4007, category="monster", name_ja="青眼の白龍", name_en="Blue-Eyes White Dragon", frame="normal")
        Card.objects.create(id=4011, category="monster", name_ja="ＰＳＹフレームロード・Ω", name_en="PSY-Framelord Omega", frame="synchro")

    def test_an_ocg_list_is_matched_by_japanese_name_and_replaces_yugipedias(self):
        """A card not out in the TCG has no English name here, and is still placed (퍼펙트론, 엘리스 10/17); widths
        are folded (ＰＳＹ / PSY)."""
        old = Banlist.objects.create(format="ocg", effective=date(2026, 10, 1), source="October 2026 Lists (OCG)")
        BanlistEntry.objects.create(banlist=old, name="Perfectron Hydradrive Dragon", card=None, status="limited")
        lost = official_lists.save("ocg", official_lists.parse_ocg(OCG_PAGE), official_lists.OCG_URL.format("202610"))
        b = Banlist.objects.get(format="ocg", effective=date(2026, 10, 1))
        self.assertEqual(b.source, "official:https://www.yugioh-card.com/japan/event/limitregulation/?list=202610")
        self.assertTrue(official_lists.is_official(b))
        got = dict(b.entries.values_list("name", "card_id"))
        self.assertEqual(got["パーフェクトロン・ハイドライブ・ドラゴン"], 22743)
        self.assertEqual(got["PSYフレームロード・Ω"], 4011)
        self.assertEqual(b.entries.get(card_id=22743).status, "limited")
        self.assertEqual(sorted(lost), ["K９－１７号 イヅナ", "アーティファクト－デスサイズ", "キラーチューン・キュー", "旧神ノーデン"])
        self.assertFalse(b.entries.filter(name="Perfectron Hydradrive Dragon").exists())   # Yugipedia's rows are gone

    def test_japanese_names_match_across_spacing_and_by_reading(self):
        """The OCG page writes 氷結界の虎王ドゥローレン without the card DB's ideographic space, and once wrote 炎舞－「天璣」
        as its reading エンブテンキ (the 2014 lists)."""
        Card.objects.create(id=7970, category="monster", name_ja="氷結界の虎王　ドゥローレン", name_ja_ruby="ひょうけっかいのこおう　ドゥローレン", frame="synchro")
        Card.objects.create(id=10418, category="spell", name_ja="炎舞－「天璣」", name_ja_ruby="えんぶ－「テンキ」", frame="spell")
        page = official_lists.parse_ocg(ocg_html("2014年4月1日", [("制限カード", [("氷結界の虎王ドゥローレン", "DEWLOREN", ""), ("エンブテンキ", "FIRE FORMATION - TENKI", "")])]))
        lost = official_lists.save("ocg", page, official_lists.OCG_URL.format("201404"))
        self.assertEqual(lost, [])
        self.assertEqual(dict(Banlist.objects.get(format="ocg").entries.values_list("card_id", "status")), {7970: "limited", 10418: "limited"})

    def test_a_tcg_list_is_matched_by_english_name(self):
        page = official_lists.parse_tcg(tcg_html("September 21, 2026", [("VICTORY DRAGON", "Forbidden", ""), ("BLUE-EYES WHITE DRAGON", "Limited", "New")]))
        lost = official_lists.save("tcg", page, official_lists.TCG_URL.format("2026-09-21"))
        b = Banlist.objects.get(format="tcg")
        self.assertEqual(dict(b.entries.values_list("card_id", "status")), {5868: "forbidden", 4007: "limited"})
        self.assertEqual(lost, [])


class CommandTest(TestCase):
    def setUp(self):
        cache = tempfile.mkdtemp()   # never the live cache
        self.addCleanup(shutil.rmtree, cache)
        ctx = override_settings(BANLIST_CACHE=cache)
        ctx.enable()
        self.addCleanup(ctx.disable)
        self.cache = cache
        self.fetched = []
        self.pages = {
            official_lists.OCG_URL.format("202607"): ocg_html("2026年7月1日", [("制限カード", [("青眼の白龍", "BLUE-EYES WHITE DRAGON", "新規・制限")])]),
            official_lists.OCG_URL.format("202608"): "<html><title>リミットレギュレーション (禁止・制限・準制限カード)</title></html>",
            official_lists.OCG_URL.format("202610"): OCG_PAGE,
            # the index links only the newest list; that page links the one before it (as the site does)
            official_lists.TCG_INDEX: '<a href="/en/limited/list_2026-09-21/">View the list here</a>',
            official_lists.TCG_URL.format("2026-09-21"): TCG_PAGE + '<a href="/en/limited/list_2026-02-02/">February 2, 2026</a>',
            official_lists.TCG_URL.format("2026-02-02"): tcg_html("February 2, 2026", [("POT OF DESIRES", "Limited", "")]),
        }
        for patcher in (mock.patch.object(official_lists, "fetch", side_effect=self.fetch),
                        mock.patch.object(official_lists, "ocg_months", return_value=["202607", "202608", "202610"]),
                        mock.patch("carddb.management.commands.import_official_lists.PAUSE", 0),
                        mock.patch("carddb.management.commands.import_official_lists.date", FakeDate)):
            patcher.start()
            self.addCleanup(patcher.stop)
        Card.objects.create(id=22743, category="monster", name_ja="パーフェクトロン・ハイドライブ・ドラゴン", frame="link")
        Card.objects.create(id=4007, category="monster", name_ja="青眼の白龍", name_en="Blue-Eyes White Dragon", frame="normal")

    def fetch(self, url):
        self.fetched.append(url)
        return self.pages[url]

    def run_import(self, fmt):
        out = StringIO()
        call_command("import_official_lists", "--format", fmt, stdout=out)
        return out.getvalue()

    def test_ocg_lists_come_in_and_old_months_are_kept(self):
        out = self.run_import("ocg")
        self.assertEqual(list(Banlist.objects.filter(format="ocg").order_by("effective").values_list("effective", flat=True)),
                         [date(2026, 7, 1), date(2026, 10, 1)])                      # a month without a list is none
        self.assertEqual(BanlistEntry.objects.get(banlist__effective=date(2026, 10, 1), card_id=22743).status, "limited")
        self.assertIn("ocg: 2 official lists, 7 entries, 3 pages asked", out)
        self.assertIn("no card for 'K９－１７号 イヅナ'", out)
        self.assertTrue(os.path.exists(os.path.join(self.cache, "official-ocg", "202607.wiki")))
        self.fetched.clear()
        self.run_import("ocg")
        # only the recent months are asked again (today 2026-10-17, RECENT 2: from 2026-08 on), the rest kept
        self.assertEqual(self.fetched, [official_lists.OCG_URL.format("202608"), official_lists.OCG_URL.format("202610")])

    def test_tcg_lists_come_in_from_the_index_page(self):
        self.run_import("tcg")
        self.assertEqual(dict(BanlistEntry.objects.filter(banlist__effective=date(2026, 9, 21)).values_list("name", "status")),
                         {"AGIDO THE ANCIENT SENTINEL": "forbidden", "ARCHLORD KRISTYA": "forbidden", "DIMENSION SHIFTER": "forbidden",
                          "MIND MASTER": "unlimited", "POT OF DESIRES": "semi_limited"})
        self.assertEqual(Banlist.objects.filter(format="tcg").count(), 2)
        self.fetched.clear()
        with mock.patch("carddb.management.commands.import_official_lists.RECENT", 1):
            self.run_import("tcg")
        self.assertEqual(self.fetched, [official_lists.TCG_INDEX, official_lists.TCG_URL.format("2026-09-21")])


class FakeDate(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 17)
