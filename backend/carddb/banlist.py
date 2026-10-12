"""금제 (Forbidden & Limited lists), every one since a game began (엘리스 2026-10-12): read from Yugipedia, whose page
for each list holds the whole list, linked to the card DB by English name. Master Duel's pages write each card as
"name; status[; status before]"; the OCG's and TCG's write one section a status, a changed card noting its status
before ("name // prev::Limited").

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
FIRST = {Banlist.Format.MD: "January 2022 Lists (Master Duel)", Banlist.Format.OCG: "August 1999 Lists",
         Banlist.Format.TCG: "May 2002 Lists (TCG)"}
MEDIUM = {Banlist.Format.MD: "Yu-Gi-Oh! Master Duel", Banlist.Format.OCG: "OCG", Banlist.Format.TCG: "TCG"}

WORDS = {"Forbidden": BanStatus.FORBIDDEN, "Limited": BanStatus.LIMITED, "Semi-Limited": BanStatus.SEMI_LIMITED,
         "Unlimited": BanStatus.UNLIMITED, "Did not exist": BanStatus.UNRELEASED,
         "Not yet released": BanStatus.UNRELEASED}
# an OCG / TCG page's sections; off the list is unlimited again
SECTIONS = {"forbidden": BanStatus.FORBIDDEN, "limited": BanStatus.LIMITED, "semi_limited": BanStatus.SEMI_LIMITED,
            "no_longer_on_list": BanStatus.UNLIMITED}

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


def _word(word, line):
    if word not in WORDS:
        raise ValueError(f"unknown status in {line!r}")
    return WORDS[word]


def _day(text):
    return datetime.strptime(text.rstrip("."), "%B %d, %Y").date()


def _parse_paper(body):
    """An OCG / TCG {{Limitation list}}: the sections as they come, each card's status before from its note."""
    entries, status = [], None
    for line in body.splitlines():
        head = re.match(r"^\|\s*([\w-]+)\s*=[ \t]*(.*)$", line)
        if head:
            status = SECTIONS.get(head.group(1))
            continue
        name, _, note = line.partition("//")
        name = name.split("|")[0]   # a link's shown text ("Allure of Darkness|sc") is no part of the name
        if status is None or not name.strip():
            continue
        before = re.search(r"prev::([^;]+)", note)
        entries.append((name.strip(), status, _word(before.group(1).strip(), line) if before else ""))
    return entries


def parse_page(text):
    """A list page: its day, game, neighbours and [(name, status, status before or "")]."""
    paper = re.search(r"\{\{Limitation list\n(.*?)\n\}\}", text, re.S)
    if paper:
        body = paper.group(1)
        return Page(_day(_field(body, "start_date")), _field(body, "medium"), title(_field(body, "prev")),
                    title(_field(body, "next")), _parse_paper(body))
    m = re.search(r"\|\s*cards\s*=(.*?)\n\}\}", text, re.S)
    entries = []
    for line in (m.group(1) if m else "").splitlines():
        parts = [p.strip() for p in line.split(";")]
        if not parts[0]:
            continue
        if len(parts) not in (2, 3) or any(p not in WORDS for p in parts[1:]):
            raise ValueError(f"unknown status line: {line!r}")
        entries.append((parts[0], WORDS[parts[1]], WORDS[parts[2]] if len(parts) == 3 else ""))
    effective = _day(_field(text, "effective_date"))
    return Page(effective, _field(text, "medium"), title(_field(text, "prev")), title(_field(text, "next")), entries)


def fill_gaps(pages):
    """Cards a page left out: on the list before, and on the one after either unchanged or noted as having had that
    status (TCG October 2013's Return from the Different Dimension, limited, then forbidden "from limited"), but
    missing between (OCG January 2016 without Pot of Greed). They are put back with the status they kept;
    [(day, name, status)] put back. A card that does not come back was released, the page only omitting it."""
    filled = []
    for before, page, after in zip(pages, pages[1:], pages[2:]):
        here = {name for name, *_ in page.entries}
        after_by = {name: (status, prev) for name, status, prev in after.entries}
        for name, status, _ in before.entries:
            if status == BanStatus.UNLIMITED or name in here or name not in after_by:
                continue
            later, prev = after_by[name]
            # the one after says what it was on this list: its status before, or unchanged
            if prev == status or (not prev and later == status):
                page.entries.append((name, status, ""))
                filled.append((page.effective, name, status))
    return filled


def name_key(name, brackets=False):
    """A name to match on: letters and digits alone, case and width folded. Our English names carry a note on some
    cards ("(Updated from: …)"), and lost the bracketed letter on others (Maliss <P> Dormouse, which the OCG / TCG
    pages write "Maliss P Dormouse"): with `brackets` that part, or a lone letter, is left out too."""
    name = unicodedata.normalize("NFKC", name)
    name = re.sub(r"\s*\(Updated from:[^)]*\)", "", name)
    if brackets:
        name = re.sub(r"<[^>]*>|\b[A-Za-z]\b", "", name)
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


def _known(card, fmt):
    """The game's lists (newest first, with this card's entries) and the day the card came out there; a card on any
    list was out though the card DB lacks its day (190 cards have no OCG day)."""
    released, lists = released_on(card, fmt), _lists(card, fmt)
    if released is None and any(b.entries.all() for b in lists):
        released = True
    return released, lists


def status_on(card, day, fmt=Banlist.Format.MD):
    """A card's status on a day."""
    released, lists = _known(card, fmt)
    return _status(card, day, fmt, released, lists)


def history(card, fmt=Banlist.Format.MD):
    """[(list day, status)] for every list of the game, oldest first."""
    released, lists = _known(card, fmt)
    return [(b.effective, _status(card, b.effective, fmt, released, lists)) for b in reversed(lists)]


def runs(card, fmt=Banlist.Format.MD):
    """[(day, status)] each time the card's status changed, oldest first: on a list's day, or on the day the card
    came out between two lists (it is 미출시 until then, not until the next list)."""
    released, lists = _known(card, fmt)
    days = {b.effective for b in lists}
    if released not in (None, True) and lists and released > lists[-1].effective:
        days.add(released)
    out = []
    for day in sorted(days):
        status = _status(card, day, fmt, released, lists)
        if not out or out[-1][1] != status:
            out.append((day, status))
    return out


def events(card, fmt=Banlist.Format.MD):
    """[(day, status, event)] oldest first: the release ("release", no status: it stands apart from the 금제,
    엘리스 10/12), Korea's release on the OCG's line ("release_kr", with the 금제 it came under if any), and a 금제 line ("", its status) each time it
    changed. A card out unlimited, as nearly every card is, has no 금제 line until it changes; one out already limited
    (선금제) has one beside its release. Before a game's first list everything was unlimited. Empty when the card never
    came out in the game."""
    released, _ = _known(card, fmt)
    if released is None:
        return []
    day_out = released if released is not True else None
    out = [(day_out, "", "release")] if day_out else []
    # from its release the card is unlimited unless a list says otherwise; with no day known, the first list says
    last = BanStatus.UNLIMITED if day_out else None
    for day, status in runs(card, fmt):
        if status == BanStatus.UNRELEASED:
            continue
        if status != last:
            out.append((day, status, ""))
            last = status
    if fmt == Banlist.Format.OCG and card.kr_date and out:
        # Korea's release carries the 금제 the card was under then, if any, so a limited card does not look free
        # (엘리스 10/12)
        then = [status for day, status, event in out if not event and day <= card.kr_date]
        limit = then[-1] if then and then[-1] != BanStatus.UNLIMITED else ""
        out.append((card.kr_date, limit, "release_kr"))
    order = {"release": 0, "": 1, "release_kr": 2}   # on one day: the release, then the 금제 it came out in
    out.sort(key=lambda e: (e[0], order[e[2]]))
    return out


def card_history(card):
    """The card page's 연혁 (엘리스 10/12): each game with lists stored, its release and 금제 changes."""
    have = set(Banlist.objects.values_list("format", flat=True).distinct())
    return [{"format": fmt.value, "label": fmt.label,
             "events": [{"day": day.isoformat(), "status": str(status), "event": event}
                        for day, status, event in events(card, fmt)]}
            for fmt in Banlist.Format if fmt in have]


def current_statuses(fmt, day):
    """{card id: status} on the game's list in effect on a day, unlimited left out (a list announced for a later day
    waits for it)."""
    current = Banlist.objects.filter(format=fmt, effective__lte=day).order_by("-effective").first()
    if not current:
        return {}
    return dict(current.entries.exclude(card=None).exclude(status=BanStatus.UNLIMITED).values_list("card_id", "status"))
