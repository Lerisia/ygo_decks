from django.core.management.base import BaseCommand
from PIL import Image

from card import scan_layout
from card.models import ScanSample


class Command(BaseCommand):
    help = ("Give the scanner test set's unchecked pictures a first draft of the deck panel and the headings, worked "
            "out from their card boxes (card.scan_layout); card boxes stay as they are, and a picture that already "
            "has a panel or a heading is left alone.")

    def handle(self, *args, **opts):
        filled = 0
        for s in ScanSample.objects.filter(status=ScanSample.Status.TODO):
            if any(b["c"] != "card" for b in s.boxes):
                continue
            W, H = s.width, s.height
            cards = [(b["x"] * W, b["y"] * H, (b["x"] + b["w"]) * W, (b["y"] + b["h"]) * H) for b in s.boxes]
            with Image.open(s.image.path) as im:
                img = im.convert("RGB")
            result = scan_layout.layout(img, cards)
            extra = [b for b in scan_layout.as_boxes(result, W, H) if b["c"] != "card"]
            if extra:
                s.boxes = s.boxes + extra
                s.save(update_fields=["boxes", "updated_at"])
                filled += 1
        self.stdout.write(f"{filled} pictures given a panel or headings")
