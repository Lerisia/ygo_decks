"""금제 (Forbidden & Limited lists), every one since a game began (엘리스 2026-10-12): read from Yugipedia, whose page
for each list holds the whole list ("name; status[; status before]"), linked to the card DB by English name.

A card's status on a day is the last list's on or before it, unlimited when that list leaves it out, and 미출시 while
the card was not yet out in that game (Master Duel: the day its print came, MdPrint.first_seen).
"""
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from collections import namedtuple
from datetime import datetime

from django.conf import settings

from .models import Banlist, BanStatus, Card, MdPrint

API = "https://yugipedia.com/api.php"
USER_AGENT = "ygodecks.com banlist import (contact: rlawodus96@gmail.com)"

# per format: the first list (the rest are found by each page's "next") and the game its pages must be about
FIRST = {Banlist.Format.MD: "January 2022 Lists (Master Duel)"}
MEDIUM = {Banlist.Format.MD: "Yu-Gi-Oh! Master Duel"}

WORDS = {"Forbidden": BanStatus.FORBIDDEN, "Limited": BanStatus.LIMITED, "Semi-Limited": BanStatus.SEMI_LIMITED,
         "Unlimited": BanStatus.UNLIMITED, "Did not exist": BanStatus.UNRELEASED}

Page = namedtuple("Page", "effective medium prev next entries")


def fetch_wikitext(title):
    """A page's wikitext from Yugipedia's API (its pages themselves turn scripts away)."""
    query = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "wikitext", "format": "json", "redirects": 1})
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as r:
        return json.load(r)["parse"]["wikitext"]["*"]


def _field(text, name):
    m = re.search(rf"^\|\s*{name}\s*=[ \t]*(.*)$", text, re.M)
    return m.group(1).strip() if m else ""


def title(link):
    """A page link as its title: underscores are spaces."""
    return link.replace("_", " ").strip()


def parse_page(text):
    """A list page: its day, game, neighbours and [(name, status, status before or "")]."""
    m = re.search(r"\|\s*cards\s*=(.*?)\n\}\}", text, re.S)
    entries = []
    for line in (m.group(1) if m else "").splitlines():
        parts = [p.strip() for p in line.split(";")]
        if not parts[0]:
            continue
        if len(parts) not in (2, 3) or any(p not in WORDS for p in parts[1:]):
            raise ValueError(f"unknown status line: {line!r}")
        entries.append((parts[0], WORDS[parts[1]], WORDS[parts[2]] if len(parts) == 3 else ""))
    effective = datetime.strptime(_field(text, "effective_date"), "%B %d, %Y").date()
    return Page(effective, _field(text, "medium"), title(_field(text, "prev")), title(_field(text, "next")), entries)


def name_key(name, brackets=False):
    """A name to match on: letters and digits alone, case and width folded. Our English names carry a note on some
    cards ("(Updated from: …)"), and lost the bracketed letter on others (Maliss <P> Dormouse): with `brackets`
    that part is left out too."""
    name = unicodedata.normalize("NFKC", name)
    name = re.sub(r"\s*\(Updated from:[^)]*\)", "", name)
    if brackets:
        name = re.sub(r"<[^>]*>", "", name)
    return re.sub(r"[^0-9a-z]+", "", name.casefold())


class CardIndex:
    """The card DB's English names, to find a list's cards by."""

    def __init__(self):
        self.keys, self.loose = {}, {}
        for cid, en in Card.objects.exclude(name_en="").values_list("id", "name_en"):
            self.keys.setdefault(name_key(en), set()).add(cid)
            self.loose.setdefault(name_key(en, brackets=True), set()).add(cid)

    def match(self, name):
        """The card a list names, or None when there is none or more than one."""
        for index, key in ((self.keys, name_key(name)), (self.loose, name_key(name, brackets=True))):
            ids = index.get(key, ())
            if len(ids) == 1:
                return next(iter(ids))
            if ids:
                return None
        return None


def cache_path(fmt, page_title):
    return os.path.join(settings.BANLIST_CACHE, fmt, page_title.replace("/", "%2F") + ".wiki")


def released_on(card, fmt):
    """The day a card came out in the game; None when it never did, True when it did on a day not known."""
    if fmt == Banlist.Format.MD:
        p = MdPrint.objects.filter(card=card, is_alt_art=False).order_by("md_id").first()
        return (p.first_seen or True) if p else None
    return {Banlist.Format.OCG: card.ocg_date, Banlist.Format.TCG: card.tcg_date}.get(fmt)


def _status(card, day, fmt, released, lists):
    if released is None or (released is not True and released > day):
        return BanStatus.UNRELEASED
    current = next((b for b in lists if b.effective <= day), None)
    if current is None:
        return BanStatus.UNRELEASED   # before the game's first list: before the game
    entry = next((e for e in current.entries.all() if e.card_id == card.id), None)
    return entry.status if entry else BanStatus.UNLIMITED


def _lists(card, fmt):
    from django.db.models import Prefetch
    from .models import BanlistEntry
    return list(Banlist.objects.filter(format=fmt).order_by("-effective")
                .prefetch_related(Prefetch("entries", queryset=BanlistEntry.objects.filter(card=card))))


def status_on(card, day, fmt=Banlist.Format.MD):
    """A card's status on a day."""
    return _status(card, day, fmt, released_on(card, fmt), _lists(card, fmt))


def history(card, fmt=Banlist.Format.MD):
    """[(list day, status)] for every list of the game, oldest first."""
    released, lists = released_on(card, fmt), _lists(card, fmt)
    return [(b.effective, _status(card, b.effective, fmt, released, lists)) for b in reversed(lists)]
