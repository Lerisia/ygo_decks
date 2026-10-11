import hashlib
import json
import os
import random

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image

from card import scan_samples
from card.models import ScanSample

PER_KIND = {"wide": 35, "tall": 25, "single": 25, "none": 25, "few": 30, "deck": 35, "many": 25}


class Command(BaseCommand):
    help = ("Pick the scanner test set from the kept uploads (media/upload_N), so many of each kind, and fill in the "
            "card boxes the current detector finds for staff to check.")

    def add_arguments(self, parser):
        parser.add_argument("--per-kind", default=json.dumps(PER_KIND))
        parser.add_argument("--seed", type=int, default=2026)
        parser.add_argument("--conf", type=float, default=0.5, help="lowest detector confidence filled in")

    def handle(self, *args, **opts):
        per_kind = json.loads(opts["per_kind"])
        taken = set(ScanSample.objects.values_list("source", flat=True))
        by_kind = {}
        for name in sorted(os.listdir(settings.MEDIA_ROOT)):
            path = os.path.join(settings.MEDIA_ROOT, name, "input.jpg")
            if not name.startswith("upload_") or not os.path.exists(path) or f"upload:{name[7:]}" in taken:
                continue
            try:
                with Image.open(path) as im:
                    im.load()   # a truncated upload fails here and is left out
                    w, h = im.size
            except Exception:
                continue
            cards = os.path.join(settings.MEDIA_ROOT, name, "cards")
            found = len(os.listdir(cards)) if os.path.isdir(cards) else 0
            by_kind.setdefault(scan_samples.kind_of(w, h, found), []).append((name, path, w, h))
        rng = random.Random(opts["seed"])
        detector = scan_samples.load_detector()
        seen, made = set(ScanSample.objects.values_list("digest", flat=True)), {}
        for kind, want in per_kind.items():
            pool = by_kind.get(kind, [])
            rng.shuffle(pool)
            for name, path, w, h in pool:
                if made.get(kind, 0) >= want:
                    break
                data = open(path, "rb").read()
                digest = hashlib.sha1(data).hexdigest()[:16]
                if digest in seen:   # the same picture uploaded twice
                    continue
                seen.add(digest)
                s = ScanSample(source=f"upload:{name[7:]}", kind=kind, width=w, height=h, digest=digest,
                               boxes=scan_samples.detect_cards(detector, path, w, h, opts["conf"]))
                s.image.save(f"{name[7:]}.jpg", ContentFile(data))
                made[kind] = made.get(kind, 0) + 1
        self.stdout.write(json.dumps({"made": made, "pool": {k: len(v) for k, v in by_kind.items()}}, ensure_ascii=False))
