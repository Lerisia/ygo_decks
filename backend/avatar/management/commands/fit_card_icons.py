"""Point card icons at the Master Duel art and spot each icon shows today.

The crop image users bought stays as it is unless --recut. Icons cut from a
picture staff put in themselves keep that picture as a custom illustration;
icons whose crop can't be found in any Master Duel art of their card are left
exactly as they are.
"""
import json

from django.core.management.base import BaseCommand

from avatar.icon_fit import MATCH, apply, fit, keep_hand_picked_base
from avatar.models import CardIcon
from carddb.importer import restore_pendulum_art


class Command(BaseCommand):
    help = "Fit every card icon's crop onto its card's Master Duel art and record where it sits."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report matches without changing any icon.")
        parser.add_argument("--report", help="Write every icon's match to this JSON file.")
        parser.add_argument("--ids", help="Only these icon ids (comma-separated).")
        parser.add_argument("--recut", action="store_true", help="Also cut the icon images again from the Master Duel art.")

    def handle(self, *args, **opts):
        restore_pendulum_art()
        icons = CardIcon.objects.filter(new_card__isnull=False, custom_illust__isnull=True).exclude(cropped_image="").order_by("id")
        if opts["ids"]:
            icons = icons.filter(id__in=[int(i) for i in opts["ids"].split(",")])
        picked = []
        if not opts["dry_run"]:
            picked = [icon.id for icon in icons.select_related("card", "new_card") if keep_hand_picked_base(icon)]
            icons = icons.exclude(id__in=picked)
        rows, fitted, kept = [], 0, []
        for icon in icons:
            found = fit(icon)
            rows.append({"id": icon.id, "title": icon.title, "found": found})
            if found and found["score"] >= MATCH:
                fitted += 1
                if not opts["dry_run"]:
                    apply(icon, found, recut=opts["recut"])
            else:
                kept.append(icon.id)
        if opts["report"]:
            with open(opts["report"], "w") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)
        verb = "would fit" if opts["dry_run"] else ("fitted and re-cut" if opts["recut"] else "fitted")
        self.stdout.write(f"{verb} {fitted} icons; kept their own picture: {picked}; not found, left as they are: {kept}")
