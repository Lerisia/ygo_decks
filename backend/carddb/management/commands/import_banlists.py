"""Every 금제 list of a game, from Yugipedia (carddb/banlist.py): from the first list, each page's "next" leads to the
one after, so a new list is found from the newest. Pages are kept in BANLIST_CACHE and asked again only for the
newest (whose "next" fills in when a list comes); a page about another game stops the run before anything is saved.
Running it again changes nothing but what changed, and links cards the card DB has learnt since."""
import os
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from carddb import banlist
from carddb.models import Banlist, BanlistEntry

PAUSE = 1.5   # seconds between asks: Yugipedia is a volunteer wiki


class Command(BaseCommand):
    help = "Read every Forbidden & Limited list of a game from Yugipedia into the card DB."

    def add_arguments(self, parser):
        parser.add_argument("--format", default=Banlist.Format.MD, choices=sorted(banlist.FIRST))

    def page(self, fmt, page_title, fresh):
        path = banlist.cache_path(fmt, page_title)
        if os.path.exists(path) and (not fresh or page_title in self.fetched):
            with open(path, encoding="utf-8") as f:
                return f.read()
        if self.asked:
            time.sleep(PAUSE)
        text = banlist.fetch_wikitext(page_title)
        self.asked += 1
        self.fetched.add(page_title)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return text

    def card_page(self, name):
        """A card's Yugipedia page, kept once it is had (a page not there yet is asked for again next time)."""
        path = banlist.cache_path("card", name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return f.read()
        try:
            text = self.page("card", name, fresh=True)
        except Exception:   # no such page, or Yugipedia away: the card stays unplaced this time
            return ""
        return text

    def handle(self, *args, **opts):
        fmt = opts["format"]
        self.asked, self.fetched = 0, set()
        pages, page_title, seen = [], banlist.FIRST[fmt], set()
        while page_title and page_title not in seen:
            seen.add(page_title)
            p = banlist.parse_page(self.page(fmt, page_title, fresh=False))
            if not p.next:   # the newest as kept: ask again, a list may have come since
                p = banlist.parse_page(self.page(fmt, page_title, fresh=True))
            if p.medium != banlist.MEDIUM[fmt]:
                raise CommandError(f"{page_title}: a page about {p.medium!r}, not {banlist.MEDIUM[fmt]!r}")
            pages.append((page_title, p))
            page_title = p.next

        filled = banlist.fill_gaps([p for _, p in pages])
        index = banlist.CardIndex()
        lost, resolved = {}, {}
        with transaction.atomic():
            for page_title, p in pages:
                b, _ = Banlist.objects.update_or_create(format=fmt, effective=p.effective, defaults={"source": page_title})
                rows = []
                for name, status, previous in p.entries:
                    card_id = index.match(name)
                    if card_id is None:
                        # a card without an English name here (not out in the TCG): its own page says which it is
                        if name not in resolved:
                            resolved[name] = index.resolve(self.card_page(name))
                        card_id = resolved[name]
                    if card_id is None:
                        lost.setdefault(name, p.effective)
                    rows.append((name, card_id, status, previous))
                have = sorted(b.entries.values_list("name", "card_id", "status", "previous"))
                if have != sorted(rows):
                    b.entries.all().delete()
                    BanlistEntry.objects.bulk_create(
                        BanlistEntry(banlist=b, name=n, card_id=c, status=s, previous=pr) for n, c, s, pr in rows)
        entries = BanlistEntry.objects.filter(banlist__format=fmt)
        self.stdout.write(f"{fmt}: {len(pages)} lists, {entries.count()} entries, {self.asked} pages asked")
        for name, day in sorted(lost.items(), key=lambda x: x[1]):
            self.stdout.write(f"  no card for {name!r} (first on {day})")
        for day, name, status in filled:
            self.stdout.write(f"  put back {name!r} on {day} ({status}): the page left it out")
