import os
import shutil
import tempfile

from django.test import TestCase, override_settings

from deck.models import Deck

from . import seo
from .models import Card, CardText, MdArt, MdPrint

INDEX = """<!doctype html><html lang="ko"><head>
    <title>YGO Decks - 유희왕 마스터 듀얼 종합 정보</title>
    <meta name="description" content="site">
    <meta property="og:title" content="site">
  </head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>"""


class SeoTest(TestCase):
    """Card and deck pages carry their own title, description, preview and text for search engines (엘리스 10/13)."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        path = os.path.join(self.dir, "index.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(INDEX)
        over = override_settings(FRONTEND_INDEX=path, MEDIA_ROOT=self.dir)
        over.enable()
        self.addCleanup(over.disable)
        seo._index.update(mtime=None)

    def card(self):
        c = Card.objects.create(id=19188, category="monster", name_ko="에스:피 리틀나이트", name_ja="S:Pリトルナイト",
                                name_en="S:P Little Knight", frame="link", attribute="dark", race="warrior", link_rating=2,
                                atk=1600, types=["link", "effect"])
        CardText.objects.create(card=c, lang="ko", materials="효과 몬스터 2장", effect="이 카드가 링크 소환했을 경우 <발동>.")
        MdArt.objects.create(md_print=MdPrint.objects.create(md_id=19188, card=c, rarity="UR"), version="common", image="cards/art/x.png")
        return c

    def test_card_page(self):
        self.card()
        r = self.client.get("/cards/19188")
        doc = r.content.decode()
        self.assertEqual(r.status_code, 200)
        self.assertIn("<title>에스:피 리틀나이트 - 마스터 듀얼 카드 효과·수록 팩 | YGO Decks</title>", doc)
        self.assertIn('<link rel="canonical" href="https://ygodecks.com/cards/19188">', doc)
        self.assertIn("어둠 속성 · 링크 2", doc)
        self.assertIn("&lt;발동&gt;", doc)                       # the text escaped
        self.assertEqual(doc.count("<title>"), 1)
        self.assertEqual(doc.count('name="description"'), 1)
        self.assertEqual(doc.count('property="og:title"'), 1)  # the site's own taken out
        self.assertIn('<div id="root"><main class="seo-text"><h1>에스:피 리틀나이트</h1>', doc)
        self.assertIn('src="/assets/index-abc.js"', doc)        # the app still starts
        self.assertEqual(r["Cache-Control"], "no-cache")

    def test_unknown_card_and_lists(self):
        r = self.client.get("/cards/1")
        self.assertEqual(r.status_code, 404)
        self.assertIn("<title>YGO Decks - 유희왕 마스터 듀얼 종합 정보</title>", r.content.decode())
        self.assertIn("카드 도감 - 마스터 듀얼", self.client.get("/cards").content.decode())
        # a list has no picture of its own: the site's link preview (참혈 2026-10-14)
        self.assertIn('<meta property="og:image" content="https://ygodecks.com/og-image.png">', self.client.get("/cards").content.decode())
        self.assertIn("덱 도감 - 마스터 듀얼", self.client.get("/database/").content.decode())

    def test_deck_page_and_sitemap(self):
        self.card()
        deck = Deck.objects.create(name="천배룡", strength=1, difficulty=1, deck_type=1, art_style=1,
                                   description="**천배룡**은 [링크](https://x.y)를 쓰는 덱입니다.")
        doc = self.client.get(f"/database/{deck.id}").content.decode()
        self.assertIn("<title>천배룡 덱 - 마스터 듀얼 티어·운영법 | YGO Decks</title>", doc)
        self.assertIn("천배룡 덱: 천배룡은 링크를 쓰는 덱입니다.", doc)
        xml = self.client.get("/sitemap.xml").content.decode()
        self.assertIn(f"<loc>https://ygodecks.com/database/{deck.id}</loc>", xml)
        self.assertIn("<loc>https://ygodecks.com/cards/19188</loc>", xml)
