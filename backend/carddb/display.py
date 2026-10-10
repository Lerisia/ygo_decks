import os
import time

from django.conf import settings
from PIL import Image

from .models import MdArt

ART_ORDER = ("ocg", "common", "tcg")
THUMB_DIR = "cards/thumb256"
THUMB_SIZE = 256
TTL = 300
_art = {"map": None, "at": 0.0}


def art_names():
    if _art["map"] is None or time.time() - _art["at"] > TTL:
        m = {}
        for md_id, version, image in MdArt.objects.values_list("md_print_id", "version", "image"):
            m.setdefault(md_id, {})[version] = image
        _art["map"], _art["at"] = m, time.time()
    return _art["map"]


def forget_art():
    _art["map"] = None


def art_name(md_id):
    versions = art_names().get(md_id) or {}
    return next((versions[v] for v in ART_ORDER if v in versions), None)


def art_url(md_id):
    name = art_name(md_id)
    return settings.MEDIA_URL + name if name else None


def art_path(md_id):
    name = art_name(md_id)
    return os.path.join(settings.MEDIA_ROOT, name) if name else None


def display_name(card):
    return card.name_ko or card.name_ja or card.name_en


def thumb_rel(md_id):
    return f"{THUMB_DIR}/{md_id}.webp"


def thumb_url(md_id):
    rel = thumb_rel(md_id)
    return settings.MEDIA_URL + rel if os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)) else None


def make_thumb(md_id, force=False):
    src = art_path(md_id)
    if not src:
        return False
    path = os.path.join(settings.MEDIA_ROOT, thumb_rel(md_id))
    if not force and os.path.exists(path) and os.path.getmtime(path) >= os.path.getmtime(src):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with Image.open(src) as img:
        im = img.convert("RGB")
    if max(im.size) > THUMB_SIZE:
        im.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        im.save(tmp, "WEBP", quality=78, method=4)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return True
