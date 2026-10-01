from django.core.management.base import BaseCommand

from deck.hyeol import fetch_archive_text, parse_archive, store_archive


class Command(BaseCommand):
    help = "Refresh the 혈자리 summaries from 듀얼 아카이브's 혈자리 아카이브 (mdarchive.pages.dev)."

    def add_arguments(self, parser):
        parser.add_argument("--file", help="read a saved hyeol-v2.js instead of fetching")

    def handle(self, *args, **opts):
        text = open(opts["file"], encoding="utf-8").read() if opts.get("file") else fetch_archive_text()
        parsed = parse_archive(text)
        if not parsed:
            raise SystemExit("no decks parsed; keeping the stored summaries")
        self.stdout.write(f"{store_archive(parsed)} decks")
