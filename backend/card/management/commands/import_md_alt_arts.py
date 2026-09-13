"""Import Master Duel alternate-artwork card IDs into CardIdAlias.

Source format (daominah/yugioh_master_duel_card_art alt_arts.json):
  [{"OriginalCardID": "4007", "CardName": "Blue-Eyes White Dragon", "AltArtIDs": ["3801"]}, ...]
usage: manage.py import_md_alt_arts path/to/alt_arts.json
"""
import json

from django.core.management.base import BaseCommand

from card.models import Card, CardIdAlias


class Command(BaseCommand):
    help = "Map Master Duel alt-art IDs to base cards (CardIdAlias)"

    def add_arguments(self, parser):
        parser.add_argument("path")

    def handle(self, *args, **opts):
        rows = json.load(open(opts["path"], encoding="utf-8"))
        added = skipped = missing = 0
        for r in rows:
            base = str(r.get("OriginalCardID") or "").strip()
            if not base.isdigit():
                continue
            card = Card.objects.filter(konami_id=base).first()
            if not card:
                missing += 1
                self.stderr.write(f"  ! base card {base} ({r.get('CardName')}) not in DB")
                continue
            for alt in r.get("AltArtIDs") or []:
                alt = str(alt).strip()
                if not alt.isdigit():
                    continue
                _, created = CardIdAlias.objects.update_or_create(md_id=int(alt), defaults={"card": card, "note": "대체 일러스트"})
                added += created
                skipped += not created
        self.stdout.write(self.style.SUCCESS(f"aliases added {added}, already present {skipped}, base cards missing {missing}"))
