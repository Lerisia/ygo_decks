import json

from django.core.management.base import BaseCommand

from deck.card_groups import apply, draft


class Command(BaseCommand):
    help = "Draft deck → 카드군 links from the decks' old YGOPRODeck themes; --apply writes the sure ones."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--report", help="Write the whole draft to this JSON file.")

    def handle(self, *args, **opts):
        rows = draft()
        if opts["report"]:
            with open(opts["report"], "w") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)
        counts = {}
        for r in rows:
            counts[r["kind"]] = counts.get(r["kind"], 0) + 1
        made = apply(rows) if opts["apply"] else 0
        self.stdout.write(f"{counts}; links made: {made}")
