"""Stand-in art for cards Master Duel has not released (엘리스 2026-10-17).

The card DB lists every card the official database knows, but only Master Duel prints bring art, so an OCG-only card
shows no picture. Until it does, the picture Konami published with the card (ygoprodeck keeps it, found by the card's
Konami id) is cut down to its illustration and shown instead. The real art outranks it the moment a Master Duel
print arrives (see display.ART_ORDER), and `sweep` drops the stand-in then.
"""
import io
import json
import os
import time
import urllib.error
import urllib.request

from django.conf import settings
from PIL import Image, ImageFilter

from .display import forget_art
from .models import Card, MdPrint, ProvisionalArt

API = "https://db.ygoprodeck.com/api/v7/cardinfo.php?konami_id={}"
CROPPED = "https://images.ygoprodeck.com/images/cards_cropped/{}.jpg"
USER_AGENT = "ygodecks.com provisional card art (https://ygodecks.com)"
DIR = "cards/art/provisional"
PAUSE = 0.25   # between requests; ygoprodeck asks for no more than 20 a second

# Where the illustration sits on a card image, as fractions of its width and height: the same on the 480×700 images
# ygoprodeck has for OCG-only cards and on its 813×1185 scans of printed ones.
ART_BOX = (0.100, 0.154, 0.900, 0.703)
# A pendulum card's frame leaves only the top of its art visible, above the pendulum text box...
PEND_BOX = (0.064, 0.162, 0.936, 0.625)
# ...while Master Duel's pendulum art, which the card face is drawn for, runs on behind the boxes at this shape.
PEND_SIZE = (512, 653)


def fetch_bytes(url, timeout=30):
    """The body at the url, or None when there is nothing there (400/404)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None
        raise


def lookup(konami_id):
    """ygoprodeck's entry for the card with this Konami id: its (changeable) ygoprodeck id and card image url."""
    body = fetch_bytes(API.format(konami_id))
    if not body:
        return None
    data = json.loads(body).get("data") or []
    if not data:
        return None
    card = data[0]
    image = (card.get("card_images") or [{}])[0].get("image_url")
    if not image:
        return None
    return {"id": card["id"], "image": image}


def extend_down(img, height):
    """`img` with its bottom rows stretched and blurred on down to `height`: what shows faintly through a pendulum
    card's boxes is a continuation of the picture, not a blank."""
    if img.height >= height:
        return img.crop((0, 0, img.width, height))
    strip = img.crop((0, max(0, img.height - 8), img.width, img.height)).resize((img.width, height - img.height), Image.LANCZOS)
    strip = strip.filter(ImageFilter.GaussianBlur(12))
    out = Image.new("RGB", (img.width, height))
    out.paste(img, (0, 0))
    out.paste(strip, (0, img.height))
    return out


def cut_art(card_image, pendulum):
    """The illustration cut out of a whole card image; a pendulum card's visible art, set at the top of a canvas of
    Master Duel's pendulum art shape."""
    img = card_image.convert("RGB")
    w, h = img.size
    if not pendulum:
        x0, y0, x1, y1 = ART_BOX
        return img.crop((round(w * x0), round(h * y0), round(w * x1), round(h * y1)))
    x0, y0, x1, y1 = PEND_BOX
    visible = img.crop((round(w * x0), round(h * y0), round(w * x1), round(h * y1)))
    pw, ph = PEND_SIZE
    visible = visible.resize((pw, round(visible.height * pw / visible.width)), Image.LANCZOS)
    return extend_down(visible, ph)


def art_for(card, info):
    """The stand-in illustration: ygoprodeck's own art crop when it has one (printed cards), else cut from the card."""
    pendulum = card.frame.endswith("_pendulum")
    if not pendulum:
        cropped = fetch_bytes(CROPPED.format(info["id"]))
        if cropped:
            return Image.open(io.BytesIO(cropped)).convert("RGB")
    body = fetch_bytes(info["image"])
    if not body:
        raise FileNotFoundError(info["image"])
    return cut_art(Image.open(io.BytesIO(body)), pendulum)


def rel_path(card_id):
    return f"{DIR}/{card_id}.webp"


def save_art(card, img):
    rel = rel_path(card.id)
    path = os.path.join(settings.MEDIA_ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        img.save(tmp, "WEBP", quality=90, method=4)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return rel


def _remove(rel):
    path = os.path.join(settings.MEDIA_ROOT, rel)
    if os.path.exists(path):
        os.remove(path)


def sweep(ids=None, refresh=False, limit=None, pause=PAUSE, log=lambda s: None):
    """Fetch a stand-in for every card without a Master Duel print that has none yet (all of them with `refresh`,
    only `ids` when given, newest OCG release first), and drop the stand-ins of cards that have their art now.
    Returns what happened; `touched` are the card ids whose faces need drawing again."""
    printed = set(MdPrint.objects.values_list("card_id", flat=True))
    dropped, touched = 0, []
    for row in ProvisionalArt.objects.all():
        if row.card_id in printed:
            _remove(row.image.name)
            row.delete()
            dropped += 1
    cards = Card.objects.exclude(id__in=printed)
    if ids:
        cards = cards.filter(id__in=ids)
    elif not refresh:
        cards = cards.exclude(id__in=ProvisionalArt.objects.values_list("card_id", flat=True))
    cards = cards.order_by("-ocg_date", "id")
    if limit:
        cards = cards[:limit]
    fetched = missing = failed = 0
    for card in cards:
        try:
            info = lookup(card.id)
            if not info:
                missing += 1
                log(f"{card.id} {card.name_ja}: not on ygoprodeck")
                continue
            img = art_for(card, info)
            rel = save_art(card, img)
            ProvisionalArt.objects.update_or_create(card=card, defaults={"image": rel, "source_id": str(info["id"])})
            fetched += 1
            touched.append(card.id)
            log(f"{card.id} {card.name_ja}: {img.width}x{img.height} from ygoprodeck {info['id']}")
        except Exception as e:   # one bad card must not stop the sweep
            failed += 1
            log(f"{card.id} {card.name_ja}: failed ({type(e).__name__}: {e})")
        if pause:
            time.sleep(pause)
    forget_art()
    return {"fetched": fetched, "missing": missing, "failed": failed, "dropped": dropped, "touched": touched}
