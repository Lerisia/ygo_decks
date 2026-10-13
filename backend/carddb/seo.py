"""Pages as search engines and link previews see them (엘리스 2026-10-13: "각 카드 검색이 검색에 걸리게"): nginx hands
/cards, /database and the pages under them here, and the built app page goes back with that card's or deck's own
title, description and picture, and a short text of it inside the page's root, which a search robot that runs no
script still reads; the app draws over it as it starts. And the sitemap robots.txt points to."""
import html
import os
import re

from django.conf import settings
from django.http import HttpResponse

from .display import display_name
from .face import face_url
from .models import Card, has_art

SITE = "https://ygodecks.com"
TITLE = "YGO Decks - 유희왕 마스터 듀얼 종합 정보"
DESCRIPTION = ("유희왕 마스터 듀얼(마듀) 종합 정보 사이트 YGO Decks에서 덱 티어와 운영법, 카드 효과와 수록 팩, 메타 통계와 "
               "전적을 확인하세요. 레코더 자동 전적 기록, 덱 성향 테스트, AI 덱 스캔, 미니게임도 있습니다.")
LISTS = {
    "/cards": ("카드 도감 - 마스터 듀얼 카드 효과·검색 | YGO Decks",
               "유희왕 마스터 듀얼의 모든 카드를 한국어 이름·초성·효과로 찾아보세요. 마스터 듀얼 레어도와 금제, 카드군, 다른 일러스트까지 볼 수 있습니다."),
    "/database": ("덱 도감 - 마스터 듀얼 덱 티어·운영법 | YGO Decks",
                  "유희왕 마스터 듀얼의 덱마다 티어와 덱 파워, 운영법, 핵심 카드, 실제 전적으로 집계한 사용률과 승률을 정리했습니다."),
}

_index = {"mtime": None, "html": ""}


def _built_page():
    """The built app page (settings.FRONTEND_INDEX), read again when a deploy replaces it."""
    path = settings.FRONTEND_INDEX
    mtime = os.path.getmtime(path)
    if _index["mtime"] != mtime:
        with open(path, encoding="utf-8") as f:
            _index.update(mtime=mtime, html=f.read())
    return _index["html"]


def _short(text, limit):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _plain(markdown):
    """A deck's description as plain words: links, images, emphasis and headings taken off."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", markdown or "")
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[#*_`>|~]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def page(path, title, description, image=None, body="", status=200, kind="website"):
    """The app page with its own head (title, description, canonical address, link preview) and body text."""
    e = html.escape
    head = [f"<title>{e(title)}</title>", f'<meta name="description" content="{e(description)}">',
            f'<link rel="canonical" href="{SITE}{path}">', '<meta property="og:site_name" content="YGO Decks">',
            f'<meta property="og:type" content="{kind}">', f'<meta property="og:title" content="{e(title)}">',
            f'<meta property="og:description" content="{e(description)}">', f'<meta property="og:url" content="{SITE}{path}">',
            '<meta property="og:locale" content="ko_KR">']
    if image:
        head += [f'<meta property="og:image" content="{e(image)}">', '<meta name="twitter:card" content="summary_large_image">']
    doc = _built_page()
    # the page's own head in place of the site's (its title, description, canonical address and preview tags)
    doc = re.sub(r'\s*<(?:meta (?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")|link rel="canonical")[^>]*>', "", doc)
    doc = re.sub(r"<title>.*?</title>", lambda m: "\n    ".join(head), doc, count=1, flags=re.S)
    if body:
        doc = doc.replace('<div id="root"></div>', f'<div id="root"><main class="seo-text">{body}</main></div>', 1)
    response = HttpResponse(doc, status=status, content_type="text/html; charset=utf-8")
    response["Cache-Control"] = "no-cache"   # its bundles change name with each deploy
    return response


def _kind(card):
    from .dex import ATTRIBUTES, CATEGORIES, RACES, SPELL_KINDS, TRAP_KINDS, TYPE_WORDS
    if card.category != "monster":
        return (SPELL_KINDS if card.category == "spell" else TRAP_KINDS).get(card.spell_trap_subtype, CATEGORIES[card.category])
    if card.link_rating:
        level = f"링크 {card.link_rating}"
    elif card.rank is not None and card.frame.startswith("xyz"):
        level = f"랭크 {card.rank}"
    else:
        level = f"레벨 {card.level}" if card.level is not None else ""
    parts = [f"{ATTRIBUTES.get(card.attribute, card.attribute)} 속성" if card.attribute else "", level,
             " / ".join([RACES.get(card.race, card.race)] + [TYPE_WORDS.get(t, t) for t in card.types])]
    return " · ".join(p for p in parts if p)


def card_page(request, card_id):
    card = Card.objects.filter(has_art(), id=card_id).prefetch_related("texts").first()
    if not card:
        return page(f"/cards/{card_id}", TITLE, DESCRIPTION, status=404)
    name = display_name(card)
    text = next((t for t in card.texts.all() if t.lang == "ko"), None) or next((t for t in card.texts.all() if t.lang == "ja"), None)
    effect = " ".join(x for x in ((text.materials, text.pendulum_effect, text.effect) if text else ()) if x)
    kind = _kind(card)
    face = face_url(card.id)
    e = html.escape
    body = (f"<h1>{e(name)}</h1><p>{e(kind)}</p>"
            + (f"<p>ATK {card.atk if card.atk is not None else '?'}" + (f" / DEF {card.def_value}" if card.def_value is not None else "") + "</p>"
               if card.category == "monster" else "")
            + f"<p>{e(effect)}</p><p><a href=\"/cards\">카드 도감</a> · <a href=\"/database\">덱 도감</a></p>")
    return page(f"/cards/{card.id}", f"{name} - 마스터 듀얼 카드 효과·수록 팩 | YGO Decks",
                _short(f"{name}: {kind}. {effect}", 150), image=f"{SITE}{face}" if face else None, body=body, kind="article")


def deck_page(request, deck_id):
    from deck.models import Deck
    deck = Deck.objects.filter(id=deck_id).first()
    if not deck:
        return page(f"/database/{deck_id}", TITLE, DESCRIPTION, status=404)
    about = _plain(deck.description)
    cover = deck.cover_image_detail or deck.cover_image
    e = html.escape
    body = f"<h1>{e(deck.name)} 덱</h1><p>{e(_short(about, 600))}</p><p><a href=\"/database\">덱 도감</a> · <a href=\"/cards\">카드 도감</a></p>"
    return page(f"/database/{deck.id}", f"{deck.name} 덱 - 마스터 듀얼 티어·운영법 | YGO Decks",
                _short(f"{deck.name} 덱: {about}" if about else f"유희왕 마스터 듀얼 {deck.name} 덱의 티어와 운영법, 핵심 카드, 사용률과 승률.", 150),
                image=f"{SITE}{cover.url}" if cover else None, body=body, kind="article")


def list_page(request, which):
    title, description = LISTS[f"/{which}"]
    return page(f"/{which}", title, description)


def sitemap(request):
    """Every card and deck page, and the main ones, for search engines."""
    from deck.models import Deck
    urls = ["/", "/cards", "/database", "/recorder", "/records", "/recommend"]
    urls += [f"/database/{i}" for i in Deck.objects.order_by("id").values_list("id", flat=True)]
    urls += [f"/cards/{i}" for i in Card.objects.filter(has_art()).order_by("id").values_list("id", flat=True)]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f"<url><loc>{SITE}{u}</loc></url>" for u in urls]
    xml.append("</urlset>")
    return HttpResponse("\n".join(xml), content_type="application/xml; charset=utf-8")
