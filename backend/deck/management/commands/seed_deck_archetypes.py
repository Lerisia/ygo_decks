"""Seed DeckArchetype from the deck→EN theme map used for video selection, matched against Card.archetype.

usage: manage.py seed_deck_archetypes [--map PATH] [--dry-run]
Existing rows are kept; only missing (deck, name) pairs are added.
"""
import json

from django.core.management.base import BaseCommand

from card.models import Card
from deck.models import Deck, DeckArchetype

DEFAULT_MAP = "/home/elyss/.cache/deckwiki/deck_names_map.json"

# deck name → [(archetype, weight)] for decks whose EN theme name isn't a Card.archetype value
MANUAL = {
    "천년 엑조디아": [("Exodia", 1.0)],
    "이빌트윈": [("Evil★Twin", 1.0), ("Live☆Twin", 1.0)],
    "@이그니스터": [("@Ignister", 1.0)],
    "드래곤 링크": [("Rokket", 0.8), ("Dragunity", 0.5)],
    "의식 데몬": [("Archfiend", 1.0)],
    "틴당글": [("Tindangle", 1.0)],
    "레드 데몬": [("Resonator", 1.0), ("Red Dragon Archfiend", 1.0)],
    "고블린라이더": [("Goblin", 1.0)],
}


class Command(BaseCommand):
    help = "Seed DeckArchetype rows from deck_names_map.json + Card.archetype"

    def add_arguments(self, parser):
        parser.add_argument("--map", default=DEFAULT_MAP)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        name_map = json.load(open(opts["map"], encoding="utf-8"))
        archetypes = set(Card.objects.exclude(archetype__isnull=True).exclude(archetype="").values_list("archetype", flat=True).distinct())
        added, unmatched = [], []
        for deck in Deck.objects.all():
            pairs = list(MANUAL.get(deck.name, []))
            en = (name_map.get(deck.name) or {}).get("en") if isinstance(name_map.get(deck.name), dict) else None
            if en and en in archetypes:
                pairs.append((en, 1.0))
            elif en and not pairs:
                # loose match: archetype contained in the theme name or vice versa (min 4 chars)
                loose = [a for a in archetypes if len(a) >= 4 and (a.lower() in en.lower() or en.lower() in a.lower())]
                pairs.extend((a, 1.0) for a in loose[:3])
            if not pairs:
                unmatched.append((deck.name, en))
                continue
            for arch, w in pairs:
                if arch not in archetypes:
                    self.stderr.write(f"  ! {deck.name}: '{arch}' is not a Card.archetype value, skipped")
                    continue
                if DeckArchetype.objects.filter(deck=deck, name=arch).exists():
                    continue
                added.append((deck.name, arch, w))
                if not opts["dry_run"]:
                    DeckArchetype.objects.create(deck=deck, name=arch, weight=w)
        for d, a, w in added:
            self.stdout.write(f"  + {d} ← {a} (w={w})")
        self.stdout.write(self.style.SUCCESS(f"added {len(added)} rows; decks with no archetype: {len(unmatched)}"))
        for d, en in unmatched:
            self.stdout.write(f"  - {d} (en={en})")
