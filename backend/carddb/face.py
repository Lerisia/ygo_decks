"""Korean card faces: a Master Duel card drawn whole — frame, art, name, attribute, stars, Korean text, ATK/DEF —
from the client's own pictures (frames, icons, link markers). Every letter is set in free (OFL) Noto fonts: no
commercial font, the game's own included, is ever used: Pretendard (the site's own face) for the name and the
type lines, Noto Serif KR for ATK/DEF and the card text.

The pieces live outside the repo in settings.CARD_FACE_ASSETS; the faces are saved as media/cards/face/<id>.webp.
Coordinates are on Master Duel's 704×1024 frame.
"""
import hashlib
import json
import os
import re
from functools import lru_cache

import numpy as np
from django.conf import settings
from PIL import Image, ImageDraw, ImageFont

from .display import art_name, art_path

W, H = 704, 1024
FACE_VERSION = 4          # raise after any change to how faces are drawn: every face is drawn again
FACE_DIR = "cards/face"
SIGNATURES = "cards/face/_signatures.json"
THUMB_DIR = "cards/face_thumb"
THUMB_W = 300

FRAMES = {
    "normal": "00", "effect": "01", "ritual": "02", "fusion": "03", "spell": "07", "trap": "08", "token": "09",
    "synchro": "10", "xyz": "12", "normal_pendulum": "13", "effect_pendulum": "14", "xyz_pendulum": "15",
    "synchro_pendulum": "16", "fusion_pendulum": "17", "link": "18", "ritual_pendulum": "19",
}
WHITE_NAME = {"spell", "trap", "xyz", "xyz_pendulum", "link"}
ATTR_ICON = {"light": "01", "dark": "02", "water": "03", "fire": "04", "earth": "05", "wind": "06", "divine": "07",
             "spell": "08", "trap": "09"}
KIND_ICON = {"counter": "01", "field": "02", "equip": "03", "continuous": "04", "quick_play": "05", "ritual": "06"}
RACES = {
    "dragon": "드래곤족", "spellcaster": "마법사족", "warrior": "전사족", "beast": "야수족", "beast_warrior": "야수전사족",
    "winged_beast": "비행야수족", "dinosaur": "공룡족", "fish": "어류족", "sea_serpent": "해룡족", "reptile": "파충류족",
    "insect": "곤충족", "plant": "식물족", "fairy": "천사족", "fiend": "악마족", "zombie": "언데드족", "machine": "기계족",
    "aqua": "물족", "pyro": "화염족", "thunder": "번개족", "rock": "암석족", "psychic": "사이킥족", "wyrm": "환룡족",
    "cyberse": "사이버스족", "divine_beast": "환신야수족", "illusion": "환상마족",
}
# 【종족／…】 words in the order the card line prints them; 일반 is never printed.
TYPE_ORDER = ["fusion", "ritual", "synchro", "xyz", "pendulum", "link", "special_summon", "flip", "gemini", "spirit",
              "toon", "union", "tuner", "effect"]
TYPE_WORDS = {"fusion": "융합", "ritual": "의식", "synchro": "싱크로", "xyz": "엑시즈", "pendulum": "펜듈럼",
              "link": "링크", "special_summon": "특수 소환", "flip": "리버스", "gemini": "듀얼", "spirit": "스피릿",
              "toon": "툰", "union": "유니온", "tuner": "튜너", "effect": "효과"}

NAME_BOX = (58, 46, 590, 114)          # name plate, leaving the attribute icon its corner
ATTR_BOX = (596, 47, 662, 113)
STAR_ROW = (60, 123, 646, 171)
ART = (89, 191, 616, 719)
PEND_ART = (50, 186, 654, 956)          # the art runs behind both (slightly see-through) pendulum boxes
TEXT = (62, 769, 644, 956)              # inside the lower box
TYPE_LINE_H = 32
STAT_RULE_Y = 922                      # the rule over ATK/DEF
STAT_BASELINE_Y = 952
PEND_TEXT = (108, 648, 598, 756)
PEND_SCALE_X = (74, 630)
LINK_SLOTS = {"top": ("U", 352, 171), "bottom": ("D", 352, 737), "left": ("L", 68, 455), "right": ("R", 636, 455),
              "top_left": ("UL", 92, 192), "top_right": ("UR", 612, 192),
              "bottom_left": ("DL", 92, 715), "bottom_right": ("DR", 612, 715)}
LINK_SCALE = 1.5
NO_LINE_START = set(".,)]」』〕〉》:;!?%·、。")


def _asset(name):
    return os.path.join(settings.CARD_FACE_ASSETS, name)


@lru_cache(maxsize=64)
def _image(name):
    return Image.open(_asset(name)).convert("RGBA")


@lru_cache(maxsize=256)
def _font(name, size, variation=None):
    f = ImageFont.truetype(_asset(name), size)
    if variation:
        f.set_variation_by_name(variation)
    return f


def title(size, weight="Bold"):
    """Pretendard, the face the site itself is set in, for names and type lines."""
    return _font(f"Pretendard-{weight}.otf", size)


def sans(size, weight="Medium"):
    return _font("NotoSansKR.ttf", size, weight)


def serif(size, weight="Regular"):
    return _font("NotoSerifKR.ttf", size, weight)


def stat_font(size):
    return serif(size, "Bold")


def type_line(card):
    words = [TYPE_WORDS[t] for t in TYPE_ORDER if t in card.types and not (t == "effect" and "normal" in card.types)]
    return "【" + "／".join([RACES.get(card.race, card.race)] + words) + "】"


def _cover(img, w, h, top=0.5):
    scale = max(w / img.width, h / img.height)
    img = img.resize((max(w, round(img.width * scale)), max(h, round(img.height * scale))), Image.LANCZOS)
    x = (img.width - w) // 2
    y = round((img.height - h) * top)
    return img.crop((x, y, x + w, y + h))


@lru_cache(maxsize=1)
def special_frames():
    """{print id: {"mask", "normal"}}: prints Master Duel finishes specially (WCS rewards), from
    SpecialIllustCardSetting (exported to special_illust.json with the textures)."""
    try:
        with open(_asset("special_illust.json")) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except (OSError, ValueError):
        return {}


@lru_cache(maxsize=8)
def _gold_layers(mask, normal):
    """(coverage, colour) of a special frame: the mask's red lines (outer border, art frame, text box rules) in
    brushed gold, lit from the top left through the normal map so they stand out like embossed foil."""
    red = np.asarray(_image(mask + ".png").resize((W, H), Image.LANCZOS))[..., 0].astype(np.float32)[..., None] / 255
    n = np.asarray(_image(normal + ".png").convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32) / 127.5 - 1
    n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
    light = np.array([-0.5, 0.6, 0.62], np.float32)
    light /= np.linalg.norm(light)
    half = light + np.array([0, 0, 1], np.float32)
    half /= np.linalg.norm(half)
    diffuse = np.clip(n @ light, 0, 1)[..., None]
    specular = (np.clip(n @ half, 0, 1) ** 24)[..., None]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sheen = (0.5 + 0.5 * np.sin((xx * 0.6 + yy) / 85.0))[..., None]
    base = np.array([196, 150, 52], np.float32) * (0.8 + 0.35 * sheen)
    return red, np.clip(base * (0.45 + 0.75 * diffuse) + 255 * 0.55 * specular, 0, 255)


def _special_frame(face, special):
    cover, gold = _gold_layers(special["mask"], special["normal"])
    a = np.asarray(face).astype(np.float32)
    a[..., :3] = a[..., :3] * (1 - cover) + gold * cover
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def is_overframe(art):
    """Master Duel's 오버프레임 prints carry the whole card as their art (512×1024, squeezed sideways): the art
    covers the frame, and only the letters and icons go on top."""
    return art.height >= 1.5 * art.width


def _squeezed_text(text, font, fill, max_w, height):
    """One line of text, squeezed sideways when it is wider than max_w (long card names)."""
    w = max(1, round(font.getlength(text)))
    layer = Image.new("RGBA", (w + 4, height), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((2, height / 2), text, font=font, fill=fill, anchor="lm")
    if layer.width > max_w:
        layer = layer.resize((max_w, height), Image.LANCZOS)
    return layer


def wrap(text, font, width):
    """Lines of text broken anywhere a line is full (as card text is), keeping punctuation off a line's start;
    a newline is kept only before a ● bullet or after the summoning materials."""
    lines = []
    for para in text.split("\n"):
        line = ""
        for ch in para:
            if font.getlength(line + ch) <= width or not line:
                line += ch
                continue
            if ch in NO_LINE_START and len(line) > 1:
                lines.append(line[:-1])
                line = line[-1] + ch
            else:
                lines.append(line.rstrip())
                line = ch.lstrip()
        lines.append(line)
    return lines


def card_paragraphs(text):
    """Card-face text: effects run on as one paragraph; ● bullets keep their own lines."""
    text = re.sub(r"\r", "", text or "").strip()
    text = re.sub(r"\n(?=[●・])", "\0", text)
    text = re.sub(r"\n+", " ", text)
    return text.replace("\0", "\n")


def fit(text, box_w, box_h, font_for, sizes=range(30, 11, -1), spacing=1.25):
    """The largest size whose wrapped text fits the box: (font, lines, line height)."""
    for size in sizes:
        font = font_for(size)
        lines = wrap(text, font, box_w)
        lh = round(size * spacing)
        if len(lines) * lh <= box_h:
            return font, lines, lh
    font = font_for(sizes[-1])
    return font, wrap(text, font, box_w), round(sizes[-1] * spacing)


def _draw_lines(draw, lines, font, x, y, lh, fill=(0, 0, 0, 255)):
    for i, line in enumerate(lines):
        draw.text((x, y + i * lh), line, font=font, fill=fill)


def _stars(face, card):
    n = card.rank if card.frame.startswith("xyz") else card.level
    if not n:
        return
    icon = _image("tex_IconRank.png" if card.frame.startswith("xyz") else "tex_IconLv.png")
    x0, y0, x1, y1 = STAR_ROW
    size = y1 - y0
    star = icon.resize((size, size), Image.LANCZOS)
    gap = min(size + 4, (x1 - x0) // max(n, 1))
    for i in range(n):
        x = x0 + i * gap if card.frame.startswith("xyz") else x1 - size - i * gap
        face.alpha_composite(star, (x, y0))


def _stat_value(v):
    return "" if v is None else "?" if v < 0 else str(v)


def _stats(draw, card, link, right, bottom):   # bottom = the baseline
    """ATK/ … DEF/ … (or LINK-n) right-aligned on the last line, each number right-aligned in a four-digit slot."""
    font = stat_font(28)
    slot = font.getlength("0000")
    pieces = []
    if link:
        pieces.append(("LINK-" + str(card.link_rating or 0), None))
    else:
        pieces.append(("DEF/", _stat_value(card.def_value)))
    pieces.append(("ATK/", _stat_value(card.atk)))
    x = right
    for label, value in pieces:
        if value is not None:
            draw.text((x, bottom), value, font=font, fill=(0, 0, 0, 255), anchor="rs")
            x -= slot + 4
        draw.text((x, bottom), label, font=font, fill=(0, 0, 0, 255), anchor="rs")
        x -= font.getlength(label) + 26


def _spell_trap_line(face, draw, card):
    label = "【마법 카드" if card.category == "spell" else "【함정 카드"
    icon_name = KIND_ICON.get(card.spell_trap_subtype)
    font = title(38)
    x0, y0, x1, y1 = STAR_ROW
    icon = _image(f"GUI_T_Icon1_Icon{icon_name}.png").resize((40, 40), Image.LANCZOS) if icon_name else None
    tail_w = font.getlength("】")
    width = font.getlength(label) + (44 if icon else 0) + tail_w
    x = x1 - width
    yc = (y0 + y1) / 2
    draw.text((x, yc), label, font=font, fill=(0, 0, 0, 255), anchor="lm")
    x += font.getlength(label)
    if icon:
        face.alpha_composite(icon, (round(x + 2), round(yc - 20)))
        x += 44
    draw.text((x, yc), "】", font=font, fill=(0, 0, 0, 255), anchor="lm")


def _link_markers(face, markers):
    for m in markers:
        if m not in LINK_SLOTS:
            continue
        key, cx, cy = LINK_SLOTS[m]
        sprite = _image(f"GUI_CardPicture_MarkerLinkOn_{key}.png")
        sprite = sprite.resize((round(sprite.width * LINK_SCALE), round(sprite.height * LINK_SCALE)), Image.LANCZOS)
        face.alpha_composite(sprite, (round(cx - sprite.width / 2), round(cy - sprite.height / 2)))


def draw_face(card, texts=None, with_text=False, art_id=None):
    """The card face as a 704×1024 RGBA image, with the art of Master Duel print art_id (the card's own by default,
    another id for an alternate art). The effect boxes stay empty (at the size the card book shows a face, card text
    can't be read, and the page prints it in full below, 엘리스 10/11); with_text=True fills them from texts, the
    card's Korean CardText (fetched when not given)."""
    if not with_text:
        texts = False
    elif texts is None:
        texts = card.texts.filter(lang="ko").first()
    frame_key = card.frame if card.frame in FRAMES else ("spell" if card.category == "spell" else
                                                          "trap" if card.category == "trap" else "effect")
    pendulum = frame_key.endswith("_pendulum")
    path = art_path(art_id or card.id)
    art = Image.open(path).convert("RGBA") if path and os.path.exists(path) else None
    overframe = art is not None and is_overframe(art)
    if overframe:
        face = art.resize((W, H), Image.LANCZOS)
    else:
        face = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if art is not None:
            x0, y0, x1, y1 = PEND_ART if pendulum else ART
            if pendulum:
                art = art.resize((x1 - x0, round(art.height * (x1 - x0) / art.width)), Image.LANCZOS).crop((0, 0, x1 - x0, y1 - y0))
            else:
                art = _cover(art, x1 - x0, y1 - y0)
            face.alpha_composite(art, (x0, y0))
        face.alpha_composite(_image(f"card_frame{FRAMES[frame_key]}.png"))
        special = special_frames().get(art_id or card.id)
        if special:
            face = _special_frame(face, special)
    draw = ImageDraw.Draw(face)

    # name and attribute; over a 오버프레임 art the name is white on a soft shadow so it reads on any picture
    x0, y0, x1, y1 = NAME_BOX
    if overframe:
        shadow = _squeezed_text(card.name_ko or card.name_ja, title(48), (0, 0, 0, 200), x1 - x0, y1 - y0)
        for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (2, 2)):
            face.alpha_composite(shadow, (x0 + dx, y0 + dy))
    name_fill = (255, 255, 255, 255) if overframe or frame_key in WHITE_NAME else (0, 0, 0, 255)
    name = _squeezed_text(card.name_ko or card.name_ja, title(48), name_fill, x1 - x0, y1 - y0)
    face.alpha_composite(name, (x0, y0))
    attr = ATTR_ICON.get(card.category if card.category in ("spell", "trap") else card.attribute)
    if attr:
        ax0, ay0, ax1, ay1 = ATTR_BOX
        face.alpha_composite(_image(f"GUI_T_Icon1_Attr{attr}.png").resize((ax1 - ax0, ay1 - ay0), Image.LANCZOS), (ax0, ay0))

    tx0, ty0, tx1, ty1 = TEXT
    if card.category == "monster":
        if frame_key == "link":
            _link_markers(face, card.link_markers or [])
        else:
            _stars(face, card)
        draw.text((tx0, ty0), type_line(card), font=title(26), fill=(0, 0, 0, 255))
        body_top, body_bottom = ty0 + TYPE_LINE_H, STAT_RULE_Y - 2
        draw.line([(tx0, STAT_RULE_Y), (tx1, STAT_RULE_Y)], fill=(0, 0, 0, 255), width=2)
        _stats(draw, card, frame_key == "link", tx1, STAT_BASELINE_Y)
    else:
        _spell_trap_line(face, draw, card)
        body_top, body_bottom = ty0 + 2, ty1
    if pendulum and card.pendulum_scale is not None:
        for x in PEND_SCALE_X:
            draw.text((x, 735), str(card.pendulum_scale), font=stat_font(42), fill=(0, 0, 0, 255), anchor="mm")

    if texts:
        if pendulum and texts.pendulum_effect:
            pend = card_paragraphs(texts.pendulum_effect)
            px0, py0, px1, py1 = PEND_TEXT
            font, lines, lh = fit(pend, px1 - px0, py1 - py0, lambda s: sans(s), sizes=range(24, 9, -1))
            _draw_lines(draw, lines, font, px0, py0, lh)
        normal_monster = card.category == "monster" and "normal" in card.types
        body = card_paragraphs(texts.flavor if normal_monster and texts.flavor else texts.effect)
        if texts.materials:
            body = card_paragraphs(texts.materials) + "\n" + body
        font_for = (lambda s: serif(s)) if normal_monster else (lambda s: sans(s))
        font, lines, lh = fit(body, tx1 - tx0, body_bottom - body_top - 4, font_for)
        _draw_lines(draw, lines, font, tx0, body_top, lh)
    return face


def signature(card, md_id):
    """What a face is drawn from (the drawing version, the card's face fields and the art file): a face is drawn
    again when this changes."""
    parts = [FACE_VERSION, card.name_ko or card.name_ja, card.category, card.frame, card.attribute, card.race,
             card.types, card.level, card.rank, card.link_rating, card.link_markers, card.atk, card.def_value,
             card.pendulum_scale, card.spell_trap_subtype, art_name(md_id), special_frames().get(md_id)]
    return hashlib.sha1(json.dumps(parts, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def load_signatures():
    try:
        with open(os.path.join(settings.MEDIA_ROOT, SIGNATURES)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_signatures(sigs):
    path = os.path.join(settings.MEDIA_ROOT, SIGNATURES)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(sigs, f)
    os.replace(path + ".tmp", path)


def face_rel(md_id):
    return f"{FACE_DIR}/{md_id}.webp"


def thumb_rel(md_id):
    return f"{THUMB_DIR}/{md_id}.webp"


def _url(rel):
    return settings.MEDIA_URL + rel if os.path.exists(os.path.join(settings.MEDIA_ROOT, rel)) else None


def face_url(md_id):
    return _url(face_rel(md_id))


def face_thumb_url(md_id):
    return _url(thumb_rel(md_id))


def save_thumb(md_id, img=None, quality=80):
    """The small face the card list shows (THUMB_W wide), from img or the saved face."""
    img = img or Image.open(os.path.join(settings.MEDIA_ROOT, face_rel(md_id)))
    out = os.path.join(settings.MEDIA_ROOT, thumb_rel(md_id))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.resize((THUMB_W, round(H * THUMB_W / W)), Image.LANCZOS).save(out, "WEBP", quality=quality, method=5)


def save_face(card, md_id=None, quality=86):
    """Draw and save the face (and its list thumbnail) of a card's print md_id (its own by default)."""
    md_id = md_id or card.id
    out = os.path.join(settings.MEDIA_ROOT, face_rel(md_id))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img = draw_face(card, art_id=md_id)
    img.save(out, "WEBP", quality=quality, method=5)
    save_thumb(md_id, img)
    return out
