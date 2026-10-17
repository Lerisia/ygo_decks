"""금제 from the games' own pages (엘리스 2026-10-17, "게임 공지를 직접 참고합시다"): the OCG's リミットレギュレーション page,
one list a month code (?list=YYYYMM) since 2014-04, naming cards in Japanese; and the TCG's Forbidden & Limited
list pages (/en/limited/list_<day>/, the recent ones linked from /en/limited/), naming them in English. Each list's
cards are matched in that game's own language, so a card not yet out in the TCG (no English name here) is no
trouble. A list from here replaces Yugipedia's for the same day, and the Yugipedia import leaves it alone
(Banlist.source starts with SOURCE). Master Duel stays with Yugipedia until its lists come from the game.
"""
import html
import re
import unicodedata
import urllib.request
from collections import namedtuple
from datetime import date, datetime

from .banlist import CardIndex
from .models import Banlist, BanlistEntry, BanStatus

OCG_URL = "https://www.yugioh-card.com/japan/event/limitregulation/?list={}"
OCG_FIRST = (2014, 4)   # the oldest list the page still serves
TCG_INDEX = "https://www.yugioh-card.com/en/limited/"
TCG_URL = "https://www.yugioh-card.com/en/limited/list_{}/"
USER_AGENT = "YGODecks banlist import (+https://ygodecks.com)"
SOURCE = "official:"

Entry = namedtuple("Entry", "name name_en status previous")
Page = namedtuple("Page", "effective entries")

# the OCG page: a section a status, and a changed card's cell-update reads "制限⇒禁止" or "新規・制限"
OCG_SECTIONS = (("準制限カード", BanStatus.SEMI_LIMITED), ("制限解除", BanStatus.UNLIMITED),
                ("禁止カード", BanStatus.FORBIDDEN), ("制限カード", BanStatus.LIMITED))
OCG_WORDS = {"禁止": BanStatus.FORBIDDEN, "制限": BanStatus.LIMITED, "準制限": BanStatus.SEMI_LIMITED,
             "解除": BanStatus.UNLIMITED}
TCG_WORDS = {"Forbidden": BanStatus.FORBIDDEN, "Limited": BanStatus.LIMITED, "Semi-Limited": BanStatus.SEMI_LIMITED,
             "Unlimited": BanStatus.UNLIMITED}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def _text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def _ocg_previous(update):
    """"制限⇒禁止": limited before; "新規・制限": newly on the list, so free before; "": as it was."""
    if not update:
        return ""
    if update.startswith("新規"):
        return BanStatus.UNLIMITED
    before = update.split("⇒")[0]
    return OCG_WORDS.get(before, "")


def parse_ocg(text):
    """The list on an OCG リミットレギュレーション page, or None when the page holds no list (a month without one)."""
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日適用リスト", text)
    if not m:
        return None
    effective = date(*map(int, m.groups()))
    entries, status = [], None
    for part in re.split(r"(<h[2-4][^>]*>.*?</h[2-4]>)", text, flags=re.S):
        if re.match(r"<h[2-4]", part):
            heading = _text(part)
            status = next((s for word, s in OCG_SECTIONS if heading.startswith(word)), None)
            continue
        if status is None:
            continue
        for ja, en, update in re.findall(
                r'<td class="cell-ocg[^"]*">(.*?)</td>\s*<td class="cell-tcg">(.*?)</td>\s*<td class="cell-update">(.*?)</td>',
                part, flags=re.S):
            entries.append(Entry(_text(ja), _text(en), status, _ocg_previous(_text(update))))
    return Page(effective, entries)


def parse_tcg(text):
    """The list on a TCG Forbidden & Limited page (Advanced Format), or None when the page is not one."""
    m = re.search(r"Effective from\s+([A-Z][a-z]+ \d{1,2}, \d{4})", _text(text))
    if not m:
        return None
    effective = datetime.strptime(m.group(1), "%B %d, %Y").date()
    entries = []
    for _, name, advanced, _, remarks in re.findall(
            r'<tr class="cardlist_[^"]*">\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>',
            text, flags=re.S):
        status = TCG_WORDS.get(_text(advanced))
        if status is None:
            continue
        remark = _text(remarks)
        previous = BanStatus.UNLIMITED if remark == "New" else TCG_WORDS.get(remark[4:], "") if remark.startswith("Was ") else ""
        entries.append(Entry(_text(name), _text(name), status, previous))
    return Page(effective, entries)


def tcg_list_days(index_text):
    """The days of the lists /en/limited/ links to, newest first."""
    return sorted(set(re.findall(r"/en/limited/list_(\d{4}-\d{2}-\d{2})/", index_text)), reverse=True)


def ocg_months(today=None, ahead=3):
    """The month codes to ask the OCG page for: from the oldest it serves to a few months on (a list is put up weeks
    before its day)."""
    today = today or date.today()
    y, m = OCG_FIRST
    end = today.year * 12 + today.month - 1 + ahead
    months = []
    while y * 12 + m - 1 <= end:
        months.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def find_card(index, fmt, entry):
    """The card an entry names, in the game's own language: the OCG's Japanese names against ours (NFKC), the TCG's
    English ones through the usual English matching."""
    if fmt == Banlist.Format.OCG:
        return index.match_ja(entry.name)
    return index.match(entry.name)


def save(fmt, page, url, index=None):
    """The list into the card DB, in place of whatever list that day had (Yugipedia's included); only entries that
    changed are written. Returns the names it could not place."""
    index = index or CardIndex()
    b, _ = Banlist.objects.update_or_create(format=fmt, effective=page.effective, defaults={"source": SOURCE + url})
    rows, lost = [], []
    for e in page.entries:
        card_id = find_card(index, fmt, e)
        if card_id is None:
            lost.append(e.name)
        rows.append((e.name, card_id, e.status, e.previous))
    have = sorted(b.entries.values_list("name", "card_id", "status", "previous"))
    if have != sorted(rows):
        b.entries.all().delete()
        BanlistEntry.objects.bulk_create(BanlistEntry(banlist=b, name=n, card_id=c, status=s, previous=p) for n, c, s, p in rows)
    return lost


def is_official(banlist):
    return banlist.source.startswith(SOURCE)
