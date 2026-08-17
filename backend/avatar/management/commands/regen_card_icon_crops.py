"""(Re)generate `CardIcon.cropped_image` for icons missing one (or all of
them, with --all). Use after deploying the cropped_image feature, or after
bulk-updating card illustrations."""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Generate CardIcon.cropped_image from card illustrations."

    def add_arguments(self, parser):
        parser.add_argument(
            "--all",
            action="store_true",
            help="Regenerate every icon (default: only icons missing cropped_image).",
        )

    def handle(self, *args, **opts):
        from django.db.models import Q
        from avatar.models import CardIcon
        qs = CardIcon.objects.select_related("card").all()
        if not opts["all"]:
            qs = qs.filter(Q(cropped_image="") | Q(cropped_image__isnull=True))
        total = qs.count()
        self.stdout.write(f"Generating crops for {total} icon(s)...")
        ok = 0
        for i, icon in enumerate(qs.iterator(), start=1):
            icon.regenerate_crop(save=True)
            if icon.cropped_image:
                ok += 1
            if i % 100 == 0:
                self.stdout.write(f"  {i}/{total} done...")
        self.stdout.write(self.style.SUCCESS(f"Done. {ok}/{total} crops generated."))
