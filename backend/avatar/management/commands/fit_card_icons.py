"""Re-cut card icons from Master Duel art at the spot each icon shows today.

Icons whose crop can't be found in any Master Duel art of their card are
left exactly as they are (crop file, coordinates and all).
"""
import json

from django.core.management.base import BaseCommand

from avatar.icon_fit import MATCH, apply, fit
from avatar.models import CardIcon
from carddb.importer import restore_pendulum_art


class Command(BaseCommand):
    help = "Fit every card icon's crop onto its card's Master Duel art and re-cut it there."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report matches without changing any icon.")
        parser.add_argument("--report", help="Write every icon's match to this JSON file.")
        parser.add_argument("--ids", help="Only these icon ids (comma-separated).")

    def handle(self, *args, **opts):
        restore_pendulum_art()
        icons = CardIcon.objects.filter(new_card__isnull=False, custom_illust__isnull=True).exclude(cropped_image="").order_by("id")
        if opts["ids"]:
            icons = icons.filter(id__in=[int(i) for i in opts["ids"].split(",")])
        rows, fitted, kept = [], 0, []
        for icon in icons:
            found = fit(icon)
            rows.append({"id": icon.id, "title": icon.title, "found": found})
            if found and found["score"] >= MATCH:
                fitted += 1
                if not opts["dry_run"]:
                    apply(icon, found)
            else:
                kept.append(icon.id)
        if opts["report"]:
            with open(opts["report"], "w") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)
        verb = "would re-cut" if opts["dry_run"] else "re-cut"
        self.stdout.write(f"{verb} {fitted} icons; kept {len(kept)} as they are: {kept}")
