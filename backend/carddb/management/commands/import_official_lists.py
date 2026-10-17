"""The OCG's and TCG's 금제 lists from the games' own pages (carddb/official_lists.py): every OCG month since 2014-04
(pages kept in BANLIST_CACHE/official-ocg, the last few months asked again so a list put up early, or corrected, is
seen), and the TCG lists /en/limited/ links to (kept in official-tcg, the newest two asked again)."""
import os
import time
from datetime import date

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from carddb import banlist, official_lists
from carddb.models import Banlist, BanlistEntry

PAUSE = 1.0        # seconds between asks of Konami's site
RECENT = 2         # OCG months before this one, and TCG lists, asked again every run


class Command(BaseCommand):
    help = "Read the OCG's or TCG's Forbidden & Limited lists from the game's own site into the card DB."

    def add_arguments(self, parser):
        parser.add_argument("--format", default=Banlist.Format.OCG, choices=[Banlist.Format.OCG, Banlist.Format.TCG])
        parser.add_argument("--fresh", action="store_true", help="ask for every page again")

    def page(self, folder, key, url, fresh):
        path = banlist.cache_path(folder, key)
        if os.path.exists(path) and not fresh:
            with open(path, encoding="utf-8") as f:
                return f.read()
        if self.asked:
            time.sleep(PAUSE)
        text = official_lists.fetch(url)
        self.asked += 1
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return text

    def handle(self, *args, **opts):
        fmt, fresh = opts["format"], opts["fresh"]
        self.asked = 0
        pages = []   # (url, Page)
        today = date.today()
        if fmt == Banlist.Format.OCG:
            months = official_lists.ocg_months(today)
            recent = f"{today.year}{today.month:02d}"
            for month in months:
                url = official_lists.OCG_URL.format(month)
                # a month without a list is a page without a date: kept too, but asked again while it is recent
                again = fresh or month >= self._months_back(today, RECENT)
                p = official_lists.parse_ocg(self.page("official-ocg", month, url, again))
                if p:
                    pages.append((url, p))
        else:
            # /en/limited/ links the newest list; each list page links the ones before it, so every list reachable
            # from the newest comes in, and the days kept from earlier runs with them
            index_text = self.page("official-tcg", "index", official_lists.TCG_INDEX, True)
            folder = os.path.join(settings.BANLIST_CACHE, "official-tcg")
            cached = {f[5:-5] for f in os.listdir(folder) if f.startswith("list_") and f.endswith(".wiki")} if os.path.isdir(folder) else set()
            days, done = set(official_lists.tcg_list_days(index_text)) | cached, set()
            while days - done:
                for i, day in enumerate(sorted(days, reverse=True)):
                    if day in done:
                        continue
                    done.add(day)
                    url = official_lists.TCG_URL.format(day)
                    text = self.page("official-tcg", f"list_{day}", url, fresh or i < RECENT)
                    days |= set(official_lists.tcg_list_days(text))
                    p = official_lists.parse_tcg(text)
                    if p:
                        pages.append((url, p))
                    break   # the newest first, then whatever it linked
        index = banlist.CardIndex()
        lost = {}
        with transaction.atomic():
            for url, p in pages:
                for name in official_lists.save(fmt, p, url, index):
                    lost.setdefault(name, p.effective)
        entries = BanlistEntry.objects.filter(banlist__format=fmt, banlist__source__startswith=official_lists.SOURCE)
        self.stdout.write(f"{fmt}: {len(pages)} official lists, {entries.count()} entries, {self.asked} pages asked")
        for name, day in sorted(lost.items(), key=lambda x: x[1]):
            self.stdout.write(f"  no card for {name!r} (first on {day})")

    @staticmethod
    def _months_back(today, n):
        y, m = today.year, today.month - n
        while m < 1:
            y, m = y - 1, m + 12
        return f"{y}{m:02d}"
