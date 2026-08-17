"""Bulk-import a folder of Twitter-saved OCG SAMPLE images as CustomIllust.

Usage:
    python manage.py import_twitter_dump /path/to/folder
    python manage.py import_twitter_dump /path/to/folder --prefix "2024-01"
    python manage.py import_twitter_dump /path/to/folder --dry-run

Filters images by size + aspect ratio so banners/screencaps get skipped.
Accepted shapes (matches OCG official Twitter):
    - 1596x1200-ish composite (card + pack), aspect 1.25 ~ 1.40
    - 1080x1080-ish single SAMPLE, aspect 0.95 ~ 1.05
    - Min dimension 1000px

Skipped files are not moved — original folder is left intact. Pass
--move-skipped to relocate them to ./_skipped/ for visual review.
"""
import os
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MIN_DIM = 1000


def is_likely_sample(width: int, height: int) -> tuple[bool, str]:
    """Returns (passes, reason). Square-only: matches the 1080×1080
    single-card SAMPLE reveal posts (cleanest avatar source). Composite
    pack-reveal images (~1596×1200) are intentionally rejected."""
    if width < MIN_DIM or height < MIN_DIM:
        return False, f"too small ({width}x{height})"
    aspect = width / height if height else 0
    if 0.95 <= aspect <= 1.05:
        return True, "single"
    return False, f"aspect {aspect:.2f} not square"


class Command(BaseCommand):
    help = "Bulk-import Twitter-saved SAMPLE images into CustomIllust."

    def add_arguments(self, parser):
        parser.add_argument("folder", help="Folder containing downloaded images")
        parser.add_argument("--prefix", default="", help="Name prefix; final name = '<prefix> <filename-stem>'")
        parser.add_argument("--dry-run", action="store_true", help="Scan only, don't import")
        parser.add_argument("--move-skipped", action="store_true",
                            help="Move skipped files to ./_skipped/ for review")

    def handle(self, *args, **opts):
        from PIL import Image
        from avatar.models import CustomIllust

        root = Path(opts["folder"]).expanduser().resolve()
        if not root.is_dir():
            self.stderr.write(self.style.ERROR(f"Not a directory: {root}"))
            return

        prefix = (opts["prefix"] or "").strip()
        dry = opts["dry_run"]
        move_skipped = opts["move_skipped"]

        skipped_dir = root / "_skipped"
        if move_skipped and not dry:
            skipped_dir.mkdir(exist_ok=True)

        imported = skipped = errors = duplicates = 0
        for path in sorted(root.iterdir()):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTS:
                continue
            try:
                with Image.open(path) as im:
                    w, h = im.size
            except Exception as e:
                self.stderr.write(f"  ERROR reading {path.name}: {e}")
                errors += 1
                continue

            ok, reason = is_likely_sample(w, h)
            if not ok:
                skipped += 1
                self.stdout.write(f"  SKIP {path.name} ({w}x{h}, {reason})")
                if move_skipped and not dry:
                    try:
                        path.rename(skipped_dir / path.name)
                    except OSError as e:
                        self.stderr.write(f"    mv error: {e}")
                continue

            stem = path.stem
            name = f"{prefix} {stem}".strip() if prefix else stem
            name = name[:100]

            # Deduplicate by name+size combo so re-running the command on
            # the same folder doesn't double-import.
            if CustomIllust.objects.filter(name=name).exists():
                duplicates += 1
                self.stdout.write(f"  DUP  {path.name} (name={name!r})")
                continue

            self.stdout.write(self.style.SUCCESS(f"  KEEP {path.name} ({w}x{h}) → {name}"))
            if dry:
                imported += 1
                continue

            try:
                with path.open("rb") as f:
                    obj = CustomIllust(name=name)
                    obj.image.save(path.name, File(f), save=True)
                imported += 1
            except Exception as e:
                self.stderr.write(f"    SAVE ERROR: {e}")
                errors += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Done — imported={imported} skipped={skipped} duplicates={duplicates} errors={errors}"))
        if dry:
            self.stdout.write(self.style.WARNING("(dry-run: no DB changes made)"))
