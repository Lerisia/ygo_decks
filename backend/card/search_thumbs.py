"""256px webp thumbnails of card illustrations for the card search picker (2026-10-06): a ~100px tile used to pull the
full 70–250KB illustration, about 4MB for one archetype search on a phone."""
import os

from django.conf import settings
from PIL import Image

SIZE = 256
DIR = "card_search_thumbs"


def thumb_rel(illust_name):
    return f"{DIR}/{os.path.splitext(os.path.basename(illust_name))[0]}.webp"


def thumb_url(illust_name):
    """The thumbnail's URL when it has been made, else None (the caller shows the illustration)."""
    rel = thumb_rel(illust_name)
    return settings.MEDIA_URL + rel if os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)) else None


def thumb_stale(card):
    path = os.path.join(settings.MEDIA_ROOT, thumb_rel(card.card_illust.name))
    try:
        return os.path.getmtime(path) < os.path.getmtime(card.card_illust.path)
    except OSError:
        return True


def make_thumb(card):
    path = os.path.join(settings.MEDIA_ROOT, thumb_rel(card.card_illust.name))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with Image.open(card.card_illust.path) as img:
        im = img.convert("RGB")
    if max(im.size) > SIZE:
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    # Written under a temporary name and swapped in, so a search never shows half a picture.
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        im.save(tmp, "WEBP", quality=78, method=4)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
