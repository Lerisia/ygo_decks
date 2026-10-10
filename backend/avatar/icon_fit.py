"""Find where an icon's current crop sits in its card's Master Duel art.

Every print (base and alternate art) and version (ocg / common / tcg) of the
card is searched with multi-scale template matching; the hit gives crop
fractions that reproduce the icon on that art.
"""
import cv2
import numpy as np
from PIL import Image

from carddb.models import MdArt

MATCH = 0.8
ORIGINAL_SLACK = 0.03


def _gray(path_or_image, size=None):
    img = path_or_image if isinstance(path_or_image, Image.Image) else Image.open(path_or_image)
    img = img.convert("L")
    if size:
        img = img.resize(size, Image.LANCZOS)
    return np.asarray(img, dtype=np.float32)


def _search(art, crop, sides):
    best = (-2.0, 0, 0, 0)
    for side in sides:
        if side < 16 or side > min(art.shape):
            continue
        tpl = cv2.resize(crop, (side, side), interpolation=cv2.INTER_AREA)
        _, score, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(art, tpl, cv2.TM_CCOEFF_NORMED))
        if score > best[0]:
            best = (score, x, y, side)
    return best


def locate(crop, art):
    """(score, x, y, side) of the square in `art` that looks most like `crop`."""
    h, w = art.shape
    half = cv2.resize(art, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    sides, side = [], 24.0
    while side <= min(half.shape):
        sides.append(int(side))
        side *= 1.05
    _, _, _, side = _search(half, crop, sides)
    return _search(art, crop, sorted({int(side * 2 * f) for f in np.arange(0.94, 1.065, 0.01)}))


def _score_at(crop, art, x, y, side):
    tpl = cv2.resize(crop, (side, side), interpolation=cv2.INTER_AREA)
    window = art[y:y + side, x:x + side]
    if window.shape != tpl.shape:
        return -1.0
    return float(cv2.matchTemplate(window, tpl, cv2.TM_CCOEFF_NORMED)[0][0])


def fit(icon):
    """Best match for the icon's crop: score, md_id, version and crop fractions — or None."""
    if not icon.new_card_id or not icon.cropped_image:
        return None
    crop = _gray(icon.cropped_image.path, (256, 256))
    arts = {}
    for art in MdArt.objects.filter(md_print__card_id=icon.new_card_id).select_related("md_print"):
        try:
            arts[(art.md_print_id, art.version)] = _gray(art.image.path)
        except OSError:
            continue
    best = None
    for (md_id, version), art in arts.items():
        score, x, y, side = locate(crop, art)
        if best is None or score > best["score"]:
            best = {"score": float(score), "md_id": md_id, "version": version, "x": x, "y": y, "side": side, "art": art}
    if best is None:
        return None
    original = arts.get((best["md_id"], "ocg"))
    if best["version"] == "tcg" and original is not None and original.shape == best["art"].shape:
        if _score_at(crop, original, best["x"], best["y"], best["side"]) >= best["score"] - ORIGINAL_SLACK:
            best["version"] = "ocg"
    h, w = best["art"].shape
    half = best["side"] / 2
    return {
        "score": best["score"], "md_id": best["md_id"], "version": best["version"],
        "cx": (best["x"] + half) / w, "cy": (best["y"] + half) / h, "r": half / min(w, h),
    }


def apply(icon, found, recut=False):
    """Point the icon at the matched art and spot. The crop users bought stays unless `recut`."""
    fields = {"art_print_id": found["md_id"], "art_version": found["version"],
              "center_x": found["cx"], "center_y": found["cy"], "radius": found["r"]}
    if recut:
        for k, v in fields.items():
            setattr(icon, k, v)
        icon.save()
    else:
        type(icon).objects.filter(pk=icon.pk).update(**fields)


STOCK_SIZES = {(624, 624), (712, 908), (710, 530), (712, 528)}


def keep_hand_picked_base(icon):
    """An icon cut from a picture staff put in instead of the stock card art keeps that picture as its custom
    illustration, with its crop and coordinates untouched. Returns True when it did."""
    import os

    from django.core.files import File

    from .models import CustomIllust

    old = icon.card
    if not old or not old.card_illust:
        return False
    path = old.card_illust.path
    if not os.path.exists(path):
        return False
    with Image.open(path) as img:
        if img.size in STOCK_SIZES:
            return False
    name = (icon.new_card.name_ko if icon.new_card else "") or old.korean_name or old.name
    with open(path, "rb") as f:
        illust = CustomIllust(name=name[:100])
        illust.image.save(os.path.basename(path), File(f), save=True)
    type(icon).objects.filter(pk=icon.pk).update(custom_illust=illust)
    return True
