"""Training pictures for the deck scanner's detector (엘리스 2026-10-11): real uploads labelled by scan_layout, windows cut
out of them (a few cards, cards cut at the edge, pictures shrunk to a thumbnail), card faces composed alone or in
small groups on backgrounds with photo-like damage, and pictures with no card at all. Labels are YOLO lines
"class cx cy w h" in fractions."""
import io

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

CLASSES = ["card", "deck_panel", "head_main", "head_extra", "head_side"]
KEEP_CARD = 0.5      # a cut card is labelled when at least half of it is in view (the labelling rule)
KEEP_HEADING = 0.3   # a cut heading when a third of it is, and all of its height


def clip(box, window):
    """box (x0, y0, x1, y1) clipped to window, in the window's coordinates, with the part of it in view; None if
    nothing is."""
    x0, y0, x1, y1 = box
    wx0, wy0, wx1, wy1 = window
    cx0, cy0, cx1, cy1 = max(x0, wx0), max(y0, wy0), min(x1, wx1), min(y1, wy1)
    if cx1 <= cx0 or cy1 <= cy0:
        return None
    seen = (cx1 - cx0) * (cy1 - cy0) / max(1e-9, (x1 - x0) * (y1 - y0))
    return (cx0 - wx0, cy0 - wy0, cx1 - wx0, cy1 - wy0), seen


def window_labels(labels, window):
    """[(class, box)] in a window of the picture, by the labelling rule for cut cards and headings."""
    out = []
    for cls, box in labels:
        got = clip(box, window)
        if not got:
            continue
        b, seen = got
        if cls == "card" and seen < KEEP_CARD:
            continue
        if cls.startswith("head") and (seen < KEEP_HEADING or (b[3] - b[1]) < 0.9 * (box[3] - box[1])):
            continue
        out.append((cls, b))
    return out


def yolo_lines(labels, width, height):
    lines = []
    for cls, (x0, y0, x1, y1) in labels:
        # rounding the crop can leave a box a hair past the edge, and YOLO drops the whole picture for it
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(width, x1), min(height, y1)
        w, h = (x1 - x0) / width, (y1 - y0) / height
        if w <= 0 or h <= 0:
            continue
        lines.append(f"{CLASSES.index(cls)} {(x0 + x1) / 2 / width:.6f} {(y0 + y1) / 2 / height:.6f} {w:.6f} {h:.6f}")
    return lines


def real_labels(row):
    """[(class, box)] of a scan_pseudo_labels row."""
    labels = [("card", tuple(b)) for b in row["cards"]]
    if row.get("panel"):
        labels.append(("deck_panel", tuple(row["panel"])))
    labels += [(c, tuple(b)) for c, b in row.get("headings", [])]
    return labels


def pick_window(rng, cards, width, height):
    """A window around a few neighbouring cards (1~10), sometimes cutting the outer ones."""
    card = cards[rng.randrange(len(cards))]
    cw, ch = card[2] - card[0], card[3] - card[1]
    across, down = rng.choice([(1, 1), (1, 1), (2, 1), (3, 1), (2, 2), (3, 2), (5, 2), (4, 3)])
    ww = cw * (across + rng.uniform(0.1, 0.9))
    wh = ch * (down + rng.uniform(0.1, 0.9))
    x0 = card[0] - rng.uniform(0.05, 0.5) * cw * (across > 1 or rng.random() < 0.5) - rng.uniform(0, 0.2) * cw
    y0 = card[1] - rng.uniform(0, 0.5) * ch
    x0 = min(max(0, x0), max(0, width - ww))
    y0 = min(max(0, y0), max(0, height - wh))
    return (x0, y0, min(width, x0 + ww), min(height, y0 + wh))


MIN_CARD_PX = 16   # smaller than this a card can't be told apart even by eye


def degrade(img, rng, long_side=None, card_h=None):
    """Shrink (to a thumbnail at times), blur and recompress like a capture passed around chats and sites; never so
    far that a card (card_h pixels tall) drops under MIN_CARD_PX."""
    if long_side is None:
        long_side = rng.choice([48, 64, 96, 128, 200, 300, 480, 640, 800, 1000, 1280])
    scale = long_side / max(img.size)
    if card_h:
        scale = max(scale, min(1.0, MIN_CARD_PX / card_h))
    if scale < 1:
        img = img.resize((max(8, round(img.width * scale)), max(8, round(img.height * scale))), Image.LANCZOS)
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    if rng.random() < 0.7:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=rng.randint(35, 90))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def _perspective(img, rng, strength):
    """Warp as a photo taken at an angle; returns the warped picture and a function mapping its points."""
    w, h = img.size
    d = strength * min(w, h)
    dst = [(rng.uniform(0, d), rng.uniform(0, d)), (w - rng.uniform(0, d), rng.uniform(0, d)),
           (w - rng.uniform(0, d), h - rng.uniform(0, d)), (rng.uniform(0, d), h - rng.uniform(0, d))]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    # coefficients mapping output points back to input ones (PIL wants the inverse)
    a = []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    coeffs = np.linalg.solve(np.array(a, float), np.array([c for p in src for c in p], float))
    out = img.transform((w, h), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC)
    fwd = []
    for (x, y), (u, v) in zip(src, dst):
        fwd.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        fwd.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    f = np.linalg.solve(np.array(fwd, float), np.array([c for p in dst for c in p], float))

    def warp(px, py):
        den = f[6] * px + f[7] * py + 1
        return (f[0] * px + f[1] * py + f[2]) / den, (f[3] * px + f[4] * py + f[5]) / den
    return out, warp


def compose_cards(faces, background, rng):
    """1~4 card faces on a background, side by side or scattered, at a slight tilt or in perspective like a photo;
    returns the picture and its card boxes."""
    W, H = background.size
    n = rng.choice([1, 1, 1, 2, 2, 3, 4])
    fill = rng.uniform(0.35, 0.95)   # how much of the picture the cards take up
    card_h = fill * H / (1 if n <= 3 or rng.random() < 0.5 else 2)
    card_w = card_h * 704 / 1024
    while n * card_w * 1.05 > W and card_h > 20:
        card_h *= 0.9
        card_w = card_h * 704 / 1024
    img = background.copy()
    boxes = []
    gap = rng.uniform(0.02, 0.15) * card_w
    total = n * card_w + (n - 1) * gap
    x = rng.uniform(0, max(1, W - total))
    y = rng.uniform(0, max(1, H - card_h))
    for face in faces[:n]:
        f = face.resize((max(4, round(card_w)), max(4, round(card_h))), Image.LANCZOS)
        angle = rng.uniform(-6, 6) if rng.random() < 0.4 else 0
        if angle:
            f = f.convert("RGBA").rotate(angle, expand=True, resample=Image.BICUBIC)
            img.paste(f, (round(x), round(y)), f)
            boxes.append((x, y, x + f.width, y + f.height))
        else:
            img.paste(f, (round(x), round(y)))
            boxes.append((x, y, x + f.width, y + f.height))
        x += card_w + gap
    if rng.random() < 0.35:   # a photo of a screen or of real cards: perspective, glare, colour cast
        img, warp = _perspective(img, rng, rng.uniform(0.03, 0.15))
        new = []
        for x0, y0, x1, y1 in boxes:
            pts = [warp(px, py) for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            new.append((max(0, min(xs)), max(0, min(ys)), min(W, max(xs)), min(H, max(ys))))
        boxes = new
        if rng.random() < 0.5:
            glare = Image.new("L", img.size, 0)
            gx, gy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.1, 0.4) * max(W, H)
            ImageDraw.Draw(glare).ellipse((gx - r, gy - r, gx + r, gy + r), fill=rng.randint(40, 110))
            glare = glare.filter(ImageFilter.GaussianBlur(r / 3))
            img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, glare)
        img = ImageEnhance.Color(img).enhance(rng.uniform(0.7, 1.2))
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.75, 1.15))
    # a card run off the edge is labelled by the same rule as a cut one
    return img, window_labels([("card", b) for b in boxes], (0, 0, W, H))


def background_crop(img, cards, rng, size):
    """A part of a real picture with no card in it (the deck screen's empty space, buttons, titles), or None."""
    W, H = img.size
    for _ in range(20):
        w = rng.uniform(0.2, 0.6) * W
        h = rng.uniform(0.2, 0.6) * H
        x0, y0 = rng.uniform(0, W - w), rng.uniform(0, H - h)
        if not any(clip(c, (x0, y0, x0 + w, y0 + h)) for c in cards):
            return img.crop((round(x0), round(y0), round(x0 + w), round(y0 + h))).resize(size, Image.BILINEAR)
    return None


def plain_background(rng, size):
    """A flat, gradient or noisy background."""
    a = np.array([rng.randint(0, 255) for _ in range(3)], float)
    b = np.array([rng.randint(0, 255) for _ in range(3)], float)
    t = np.linspace(0, 1, size[1])[:, None, None]
    arr = a * (1 - t) + b * t
    arr = np.broadcast_to(arr, (size[1], size[0], 3)).copy()
    arr += np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(0, 12), arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))


def frameless_art(face, rng):
    """A card's picture without its frame: not a card, which the detector must learn too."""
    w, h = face.size
    art = face.crop((round(w * 0.13), round(h * 0.19), round(w * 0.87), round(h * 0.70)))
    s = rng.uniform(0.5, 1.5)
    return art.resize((max(8, round(art.width * s)), max(8, round(art.height * s))), Image.LANCZOS)
