"""Import the merged pokemon.json (generated from damage-calc) into the
PokemonCard table. Idempotent: re-running upserts on (dex_number,
source_file, name_ko)."""
import json
import os

from django.core.management.base import BaseCommand
from django.db import transaction

from multiplayer.models import PokemonCard


DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data",
    "pokemon.json",
)


class Command(BaseCommand):
    help = "Import pokemon.json into PokemonCard. Image URL maps to /media/pokemon/<dex>.png by default."

    def add_arguments(self, parser):
        parser.add_argument(
            "--path",
            default=DATA_PATH,
            help=f"Path to pokemon.json (default: {DATA_PATH})",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be imported without writing.",
        )

    def handle(self, *args, **opts):
        path = opts["path"]
        dry = opts["dry_run"]

        if not os.path.exists(path):
            self.stderr.write(self.style.ERROR(f"File not found: {path}"))
            return

        with open(path, encoding="utf-8") as fp:
            entries = json.load(fp)

        self.stdout.write(f"Loaded {len(entries)} entries from {path}")
        if dry:
            self.stdout.write(self.style.WARNING("--dry-run: no DB writes"))

        created = 0
        updated = 0
        with transaction.atomic():
            for e in entries:
                dex = e["dex_number"]
                source = e["source_file"]
                name_ko = e["name_ko"]
                # Default image: /media/pokemon/<dex>.png. Forms share the
                # base dex image until form-specific images are mapped
                # (e.g. via PokeAPI form IDs or admin UI).
                image_url = f"/media/pokemon/{dex}.png"

                obj, was_created = PokemonCard.objects.update_or_create(
                    dex_number=dex,
                    source_file=source,
                    name_ko=name_ko,
                    defaults={
                        "name_ko_original": e.get("name_ko_original", ""),
                        "name_en": e.get("name_en", ""),
                        "name_ja": e.get("name_ja", "") or "",
                        "type1": e.get("type1") or "",
                        "type2": e.get("type2") or "",
                        "image_url": image_url,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

            if dry:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            f"Done. created={created}, updated={updated}, total={created + updated}"
        ))
