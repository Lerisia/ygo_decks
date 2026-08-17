"""Delete SoloDrawing rows whose `expires_at` has passed.

SoloDrawings carry full stroke JSON (potentially hundreds of KB each), so
letting them accumulate past the 3-day window would balloon the DB.
Cascade also drops the SoloDrawingGuess + SoloDrawingRecommend rows tied
to each drawing.

Run via cron, e.g.:
    0 4 * * * cd /home/elyss/ygo_decks/backend && /home/elyss/ygo_decks/backend/venv/bin/python manage.py prune_expired_solo_drawings
"""
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete SoloDrawing rows past expires_at (cascades to guess/recommend rows)."

    def handle(self, *args, **opts):
        from solo.models import SoloDrawing
        cutoff = timezone.now()
        qs = SoloDrawing.objects.filter(expires_at__lte=cutoff)
        n = qs.count()
        deleted, breakdown = qs.delete()
        self.stdout.write(self.style.SUCCESS(
            f"pruned {n} SoloDrawing row(s) past expiry "
            f"(cascade total {deleted}: {breakdown})"
        ))
