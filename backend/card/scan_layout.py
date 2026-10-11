"""The layout of a deck picture from its card boxes: rows, the sections they form (메인 / 엑스트라 / 사이드) and the
heading line above each, read with OCR — to label real uploads for the detector's training and to give staff a
first draft of the deck panel and the headings (엘리스 2026-10-11)."""
import io
import os
import re
import subprocess

import numpy as np
from PIL import Image

TESSDATA = os.path.expanduser("~/.local/share/tessdata")   # the languages below and the tsv config
# Read first in the languages most decks come in, then in the rest Master Duel speaks (해외 덱 사진, 엘리스 10/11).
LANGS = ["kor+jpn+eng", "chi_sim+chi_tra+rus+eng"]
# extra and side first: "デッキ" alone (main in Japanese shares it) only decides when nothing else does. Master Duel's
# languages: 사이드 덱 / サイドデッキ / Side Deck (en·de·fr·it) / Deck Lateral (pt) / 副卡组·副牌組 / Сайд-колода;
# 엑스트라 덱 / エクストラデッキ / Extra Deck / Deck Adicional (pt) / 额外卡组·額外牌組 / Экстра-колода;
# 메인 덱 / メインデッキ / Main Deck / Deck Principal(e) (fr·es·pt·it) / 主卡组·主牌組 / Основная колода.
HEADINGS = [
    ("head_side", re.compile(r"사이드|サイド|(?<![a-z])side|lateral|banquillo|副卡|副牌|сайд|побочн", re.I)),
    ("head_extra", re.compile(r"엑스트라|エクストラ|(?<![a-z])extra|(?<![a-z])ex(?:デッキ|덱|deck)|adicional|额外|額外|экстра", re.I)),
    ("head_main", re.compile(r"메인|メイン|(?<![a-z])main|principal|主卡|主牌|основн|デッキ", re.I)),
]
ORDER = {"head_main": 0, "head_extra": 1, "head_side": 2}


def heading_of(text):
    t = re.sub(r"\s+", "", text)
    if "dcinside" in t.lower():
        return None
    for cls, rx in HEADINGS:
        if rx.search(t):
            return cls
    return None


def rows_of(boxes, card_h):
    """Indices of boxes grouped into rows, top to bottom, each left to right."""
    b = np.asarray(boxes, float)
    centre = (b[:, 1] + b[:, 3]) / 2
    rows, cur, cy = [], [], None
    for i in np.argsort(centre):
        if cy is not None and abs(centre[i] - cy) > 0.5 * card_h:
            rows.append(cur)
            cur = []
        cur.append(int(i))
        cy = centre[i] if len(cur) == 1 else cy
    rows.append(cur)
    return [sorted(r, key=lambda i: b[i, 0]) for r in rows]


def columns_of(boxes, card_w):
    """Indices of boxes in side-by-side groups split where the gap is wider than half a card (the deck and, on a PC
    screen, the collection beside it)."""
    b = np.asarray(boxes, float)
    groups, cur, right = [], [], None
    for i in np.argsort(b[:, 0]):
        if right is not None and b[i, 0] - right > 0.5 * card_w:
            groups.append(cur)
            cur, right = [], None
        cur.append(int(i))
        right = b[i, 2] if right is None else max(right, b[i, 2])
    groups.append(cur)
    return groups


def sections_of(boxes, rows, card_h):
    """Rows grouped into sections: a section ends where the gap to the next row is clearly wider than between rows
    (a heading sits there)."""
    b = np.asarray(boxes, float)
    gaps = [b[row, 1].min() - b[prev, 3].max() for prev, row in zip(rows, rows[1:])]
    base = max(float(np.median(gaps)), 0.0) if gaps else 0.0
    sections, cur = [], [rows[0]]
    for gap, row in zip(gaps, rows[1:]):
        if gap > base + 0.18 * card_h:
            sections.append(cur)
            cur = []
        cur.append(row)
    sections.append(cur)
    return sections


def regular(boxes, section, card_w):
    """Do the rows of a section line up as a grid — every row but the last as long as the first, all starting at
    the same place? A card the detector missed breaks this."""
    b = np.asarray(boxes, float)
    lengths = [len(r) for r in section]
    if any(n != lengths[0] for n in lengths[:-1]) or lengths[-1] > lengths[0]:
        return False
    left = b[section[0][0], 0]
    return all(abs(b[r[0], 0] - left) < 0.35 * card_w for r in section)


def _png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def ocr_lines(img, psm, langs=LANGS[0]):
    """[(text, (x0, y0, x1, y1))] per text line of img, coordinates in img."""
    k = 3
    g = img.convert("L").resize((max(1, img.width * k), max(1, img.height * k)), Image.LANCZOS)
    arr = np.array(g)
    if arr.mean() < 128:   # light text on a dark bar
        arr = 255 - arr
    p = subprocess.run(["tesseract", "stdin", "stdout", "-l", langs, "--psm", str(psm), "tsv"],
                       input=_png(Image.fromarray(arr)), capture_output=True,
                       env=dict(os.environ, TESSDATA_PREFIX=TESSDATA, OMP_THREAD_LIMIT="1"))
    lines = {}
    for row in p.stdout.decode("utf-8", "ignore").splitlines()[1:]:
        f = row.split("\t")
        if len(f) < 12 or not f[11].strip():
            continue
        x, y, w, h = (int(v) / k for v in f[6:10])
        text, box = lines.get((f[2], f[3], f[4]), ("", None))
        box = (x, y, x + w, y + h) if box is None else (min(box[0], x), min(box[1], y), max(box[2], x + w), max(box[3], y + h))
        lines[(f[2], f[3], f[4])] = (text + f[11], box)
    return list(lines.values())


def find_heading(img, x0, x1, top, bottom, card_h, read=None):
    """(class, (x0, y0, x1, y1)) of the heading line between top and bottom, or None. OCR misses often, so the band is
    read at a few heights and two page modes, in the common languages first."""
    read = read or ocr_lines
    for langs in LANGS:
        found = _find_heading(img, x0, x1, top, bottom, card_h, lambda crop, psm: read(crop, psm, langs))
        if found:
            return found
    return None


def _find_heading(img, x0, x1, top, bottom, card_h, read):
    for frac in (0.45, 0.65, 1.0):
        y0 = max(top, bottom - frac * card_h)
        if bottom - y0 < 0.15 * card_h:
            continue
        crop = img.crop((int(x0), int(y0), int(x1), int(bottom)))
        for psm in (6, 11):
            for text, (lx0, ly0, lx1, ly1) in read(crop, psm):
                cls = heading_of(text)
                if cls:
                    pad = 0.3 * (ly1 - ly0)
                    return cls, (x0, y0 + ly0 - pad, x1, min(bottom, y0 + ly1 + pad))
    return None


def layout(img, boxes, read=None):
    """{"cards", "panel", "headings", "sure"} for a picture and its card boxes (pixels). panel is the box around the
    deck — the side-by-side group with headings, or the only group — and its headings; sure says whether every
    section lines up as a grid and has its heading (or no room for one), in deck order."""
    if len(boxes) < 3:
        return {"cards": list(boxes), "panel": None, "headings": [], "sure": False}
    b = np.asarray(boxes, float)
    w = float(np.median(b[:, 2] - b[:, 0]))
    h = float(np.median(b[:, 3] - b[:, 1]))
    steady = float(np.std(b[:, 3] - b[:, 1]) / h) < 0.12
    best = None
    for group in columns_of(b, w):
        gb = b[group]
        rows = rows_of(gb, h)
        sections = sections_of(gb, rows, h)
        heads, ok, prev_bottom = [], all(regular(gb, s, w) for s in sections), 0.0
        x0, x1 = gb[:, 0].min(), gb[:, 2].max()
        for s in sections:
            ids = [i for r in s for i in r]
            top_card = gb[ids, 1].min()
            found = find_heading(img, x0, x1, max(prev_bottom, top_card - 1.0 * h, 0), top_card, h, read)
            if found:
                heads.append(found)
            elif top_card - max(prev_bottom, 0) > 0.3 * h:
                ok = False   # room for a heading but none read
            prev_bottom = gb[ids, 3].max()
        order = [ORDER[c] for c, _ in heads]
        ok = ok and order == sorted(set(order))
        score = (len(heads), len(group))
        if best is None or score > best[0]:
            ys = [y for _, (_, y0, _, y1) in heads for y in (y0, y1)] + [gb[:, 1].min(), gb[:, 3].max()]
            panel = (x0, min(ys), x1, max(ys))
            best = (score, panel, heads, ok, len(group))
    _, panel, heads, ok, _ = best
    single_group = len(columns_of(b, w)) == 1
    return {"cards": [tuple(map(float, x)) for x in b], "panel": tuple(map(float, panel)) if heads or single_group else None,
            "headings": [(c, tuple(map(float, box))) for c, box in heads], "sure": bool(ok and steady)}


def as_boxes(result, width, height):
    """The layout as ScanSample boxes (fractions)."""
    def frac(c, x0, y0, x1, y1):
        return {"c": c, "x": round(max(0, x0) / width, 5), "y": round(max(0, y0) / height, 5),
                "w": round((min(width, x1) - max(0, x0)) / width, 5), "h": round((min(height, y1) - max(0, y0)) / height, 5)}
    out = [frac("card", *c) for c in result["cards"]]
    if result["panel"]:
        out.append(frac("deck_panel", *result["panel"]))
    out += [frac(c, *box) for c, box in result["headings"]]
    return out
