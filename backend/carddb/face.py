"""Korean card faces: a Master Duel card drawn whole — frame, art, name, attribute, stars, Korean text, ATK/DEF —
from the client's own pictures (frames, icons, link markers). Every letter is set in free (OFL) Noto fonts: no
commercial font, the game's own included, is ever used: 마루 부리 (Naver's open-licence serif, 엘리스 10/11) for the
name, the type lines, ATK/DEF and the scales, with Noto Serif KR / JP and DejaVu Serif for the letters it lacks; Noto
for card text when it is drawn.

The pieces live outside the repo in settings.CARD_FACE_ASSETS; the faces are saved as media/cards/face/<id>.webp.
Coordinates are on Master Duel's 704×1024 frame.
"""
import hashlib
import json
import os
import re
from functools import lru_cache

from django.conf import settings
from PIL import Image, ImageDraw, ImageFont

from .display import art_name, art_path

W, H = 704, 1024
# Where and how every letter is set (name, type lines, ATK/DEF, scales, card text): one file, which the layout page
# /dev/cardlayout starts from (참혈 2026-10-14)
with open(os.path.join(os.path.dirname(__file__), "face_layout.json")) as _f:
    LAYOUT = json.load(_f)
FACE_VERSION = 5          # raise after any change to how faces are drawn: every face is drawn again
FACE_DIR = "cards/face"
SIGNATURES = "cards/face/_signatures.json"
THUMB_DIR = "cards/face_thumb"
NAME_DIR = "cards/face_name"
NAME_MASK_SIZE = (1056, 256)   # the card's top sixth at 1.5×, as the Shine / Royal shaders read the name
THUMB_W = 300

FRAMES = {
    "normal": "00", "effect": "01", "ritual": "02", "fusion": "03", "spell": "07", "trap": "08", "token": "09",
    "synchro": "10", "xyz": "12", "normal_pendulum": "13", "effect_pendulum": "14", "xyz_pendulum": "15",
    "synchro_pendulum": "16", "fusion_pendulum": "17", "link": "18", "ritual_pendulum": "19",
}
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

ATTR_BOX = (596, 47, 662, 113)
# Stars as Master Duel lays them, where its Royal / Shine shaders emboss them: 12 to a row (13 a little wider), a
# level's from the right, a rank's from the left
STAR_SPANS = {12: (0.085 * W, 0.915 * W), 13: (0.051 * W, 0.9491 * W)}
STAR_PITCH = 0.83 * W / 12
STAR_TOP, STAR_SIZE = 124, 48
ART = (89, 191, 616, 719)
PEND_ART = (50, 186, 654, 956)          # the art runs behind both (slightly see-through) pendulum boxes
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


def font_of(spec, size):
    """A layout font ({"file", "variation"}) at a size."""
    return _font(spec["file"], size, spec["variation"])


def title(size):
    """The name font."""
    return font_of(LAYOUT["name"]["font"], size)


@lru_cache(maxsize=16)
def _letters(path):
    from fontTools.ttLib import TTFont
    return frozenset(TTFont(path).getBestCmap())


def text_runs(text, font):
    """The text cut where its letters change font: [(text, font)], the given font wherever it has the letter. What
    마루 부리 lacks (Greek and Cyrillic letters, the kanji of Japanese-only names) comes from the first of the name's
    free fallback fonts that has it (엘리스 2026-10-11: "PSY프레임로드 Ω" showed a box)."""
    fonts = [font] + [font_of(f, font.size) for f in LAYOUT["name"]["fallbacks"] if os.path.exists(_asset(f["file"]))]
    runs = []
    for ch in text:
        f = next((f for f in fonts if ord(ch) in _letters(f.path)), font)
        if runs and runs[-1][1] is f:
            runs[-1][0] += ch
        else:
            runs.append([ch, f])
    return [(t, f) for t, f in runs]


def needs_fallback(name):
    """Whether a card name has letters the name font lacks."""
    return any(ord(ch) not in _letters(title(48).path) for ch in name)


def type_line(card):
    words = [TYPE_WORDS[t] for t in TYPE_ORDER if t in card.types and not (t == "effect" and "normal" in card.types)]
    return "【" + "／".join([RACES.get(card.race, card.race)] + words) + "】"


def _cover(img, w, h, top=0.5):
    scale = max(w / img.width, h / img.height)
    img = img.resize((max(w, round(img.width * scale)), max(h, round(img.height * scale))), Image.LANCZOS)
    x = (img.width - w) // 2
    y = round((img.height - h) * top)
    return img.crop((x, y, x + w, y + h))


def is_overframe(art):
    """Master Duel's 오버프레임 prints carry the whole card as their art (512×1024, squeezed sideways): the art
    covers the frame, and only the letters and icons go on top."""
    return art.height >= 1.5 * art.width


def _squeezed_text(text, font, fill, max_w, height, pad):
    """One line of text, squeezed sideways when it is wider than max_w (long card names); letters the font lacks in
    the fallback fonts, on the same baseline."""
    runs = text_runs(text, font)
    w = max(1, round(sum(f.getlength(t) for t, f in runs)))
    layer = Image.new("RGBA", (w + 2 * pad, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if len(runs) == 1 and runs[0][1] is font:
        draw.text((pad, height / 2), text, font=font, fill=fill, anchor="lm")
    else:
        ascent, descent = font.getmetrics()
        x, baseline = pad, height / 2 + (ascent - descent) / 2   # where "lm" puts the name font's baseline
        for t, f in runs:
            draw.text((x, baseline), t, font=f, fill=fill, anchor="ls")
            x += f.getlength(t)
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


def fit(text, box_w, box_h, font_for, sizes, spacing):
    """The largest size whose wrapped text fits the box: (font, lines, line height)."""
    for size in sizes:
        font = font_for(size)
        lines = wrap(text, font, box_w)
        lh = round(size * spacing)
        if len(lines) * lh <= box_h:
            return font, lines, lh
    font = font_for(sizes[-1])
    return font, wrap(text, font, box_w), round(sizes[-1] * spacing)


def _draw_lines(draw, lines, font, x, y, lh, fill, anchor):
    for i, line in enumerate(lines):
        draw.text((x, y + i * lh), line, font=font, fill=fill, anchor=anchor)


def _stars(face, card):
    xyz = card.frame.startswith("xyz")
    n = card.rank if xyz else card.level
    if not n:
        return
    star = _image("tex_IconRank.png" if xyz else "tex_IconLv.png").resize((STAR_SIZE, STAR_SIZE), Image.LANCZOS)
    left, right = STAR_SPANS[12 if n <= 12 else 13]
    for i in range(n):
        cx = left + STAR_PITCH * (i + .5) if xyz else right - STAR_PITCH * (i + .5)
        face.alpha_composite(star, (round(cx - STAR_SIZE / 2), STAR_TOP))


def _stat_value(v):
    return "" if v is None else "?" if v < 0 else str(v)


def stat_pieces(card, link):
    """The last line's pieces from the right: (label, number), the number None for LINK-n."""
    first = ("LINK-" + str(card.link_rating or 0), None) if link else ("DEF/", _stat_value(card.def_value))
    return [first, ("ATK/", _stat_value(card.atk))]


def _stats(draw, card, link):
    """ATK/ … DEF/ … (or LINK-n) right-aligned on the last line, each number right-aligned in a four-digit slot."""
    lay = LAYOUT["stats"]
    font, fill, anchor = font_of(lay["font"], lay["size"]), tuple(lay["color"]), lay["anchor"]
    slot = font.getlength(lay["slot"])
    x, bottom = lay["right"], lay["baseline"]
    for label, value in stat_pieces(card, link):
        if value is not None:
            draw.text((x, bottom), value, font=font, fill=fill, anchor=anchor)
            x -= slot + lay["number_gap"]
        draw.text((x, bottom), label, font=font, fill=fill, anchor=anchor)
        x -= font.getlength(label) + lay["label_gap"]


def spell_trap_label(card):
    """【마법 카드 / 【함정 카드 and the file of its kind's icon (None for a normal one); 】 closes the line."""
    icon_name = KIND_ICON.get(card.spell_trap_subtype)
    return ("【마법 카드" if card.category == "spell" else "【함정 카드",
            f"GUI_T_Icon1_Icon{icon_name}.png" if icon_name else None)


def _spell_trap_line(face, draw, card):
    lay = LAYOUT["spell_trap_line"]
    label, icon_file = spell_trap_label(card)
    font, fill, anchor = font_of(lay["font"], lay["size"]), tuple(lay["color"]), lay["anchor"]
    x0, y0, x1, y1 = lay["box"]
    size = lay["icon_size"]
    icon = _image(icon_file).resize((size, size), Image.LANCZOS) if icon_file else None
    tail_w = font.getlength("】")
    width = font.getlength(label) + (lay["icon_advance"] if icon else 0) + tail_w
    x = x1 - width
    yc = (y0 + y1) / 2
    draw.text((x, yc), label, font=font, fill=fill, anchor=anchor)
    x += font.getlength(label)
    if icon:
        face.alpha_composite(icon, (round(x + lay["icon_dx"]), round(yc - size / 2)))
        x += lay["icon_advance"]
    draw.text((x, yc), "】", font=font, fill=fill, anchor=anchor)


def _link_markers(face, markers):
    for m in markers:
        if m not in LINK_SLOTS:
            continue
        key, cx, cy = LINK_SLOTS[m]
        sprite = _image(f"GUI_CardPicture_MarkerLinkOn_{key}.png")
        sprite = sprite.resize((round(sprite.width * LINK_SCALE), round(sprite.height * LINK_SCALE)), Image.LANCZOS)
        face.alpha_composite(sprite, (round(cx - sprite.width / 2), round(cy - sprite.height / 2)))


def frame_key(card):
    """The frame a card is drawn in (a monster with none known as an effect monster)."""
    return card.frame if card.frame in FRAMES else ("spell" if card.category == "spell" else
                                                    "trap" if card.category == "trap" else "effect")


def card_text_parts(card, texts):
    """A face's two card texts from its CardText: (the pendulum box's, the lower box's, whether the lower one is a
    normal monster's, set in the serif)."""
    normal_monster = card.category == "monster" and "normal" in card.types
    body = card_paragraphs(texts.flavor if normal_monster and texts.flavor else texts.effect)
    if texts.materials:
        body = card_paragraphs(texts.materials) + "\n" + body
    return card_paragraphs(texts.pendulum_effect) if texts.pendulum_effect else "", body, normal_monster


def _text_box(draw, text, lay, box, font_key):
    x0, y0, x1, y1 = box
    font, lines, lh = fit(text, x1 - x0, y1 - y0, lambda s: font_of(lay[font_key], s),
                          range(lay["max_size"], lay["min_size"] - 1, -1), lay["line_spacing"])
    _draw_lines(draw, lines, font, x0, y0, lh, tuple(lay["color"]), lay["anchor"])


def draw_face(card, texts=None, with_text=False, art_id=None, letters=True):
    """The card face as a 704×1024 RGBA image, with the art of Master Duel print art_id (the card's own by default,
    another id for an alternate art). The effect boxes stay empty (at the size the card book shows a face, card text
    can't be read, and the page prints it in full below, 엘리스 10/11); with_text=True fills them from texts, the
    card's Korean CardText (fetched when not given). letters=False leaves every letter off (frame, art, icons, stars
    and markers only), for the layout page to set them in the browser."""
    if not with_text or not letters:
        texts = False
    elif texts is None:
        texts = card.texts.filter(lang="ko").first()
    frame = frame_key(card)
    pendulum = frame.endswith("_pendulum")
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
        face.alpha_composite(_image(f"card_frame{FRAMES[frame]}.png"))
    draw = ImageDraw.Draw(face)

    # name and attribute; over a 오버프레임 art the name is white on a soft shadow so it reads on any picture
    if letters:
        lay = LAYOUT["name"]
        x0, y0, x1, y1 = lay["box"]
        name, font = card.name_ko or card.name_ja, font_of(lay["font"], lay["size"])
        if overframe:
            shadow = _squeezed_text(name, font, tuple(lay["shadow_color"]), x1 - x0, y1 - y0, lay["pad"])
            for dx, dy in lay["shadow_offsets"]:
                face.alpha_composite(shadow, (x0 + dx, y0 + dy))
        light = overframe or frame in lay["light_frames"]
        face.alpha_composite(_squeezed_text(name, font, tuple(lay["light_color" if light else "color"]),
                                            x1 - x0, y1 - y0, lay["pad"]), (x0, y0))
    attr = ATTR_ICON.get(card.category if card.category in ("spell", "trap") else card.attribute)
    if attr:
        ax0, ay0, ax1, ay1 = ATTR_BOX
        face.alpha_composite(_image(f"GUI_T_Icon1_Attr{attr}.png").resize((ax1 - ax0, ay1 - ay0), Image.LANCZOS), (ax0, ay0))

    if card.category == "monster":
        if frame == "link":
            _link_markers(face, card.link_markers or [])
        else:
            _stars(face, card)
        if letters:
            lay = LAYOUT["type_line"]
            draw.text((lay["x"], lay["y"]), type_line(card), font=font_of(lay["font"], lay["size"]),
                      fill=tuple(lay["color"]), anchor=lay["anchor"])
            rule = LAYOUT["stats"]["rule"]
            draw.line([(rule["x0"], rule["y"]), (rule["x1"], rule["y"])], fill=tuple(rule["color"]), width=rule["width"])
            _stats(draw, card, frame == "link")
    elif letters:
        _spell_trap_line(face, draw, card)
    if letters and pendulum and card.pendulum_scale is not None:
        lay = LAYOUT["pendulum_scale"]
        for x in lay["x"]:
            draw.text((x, lay["y"]), str(card.pendulum_scale), font=font_of(lay["font"], lay["size"]),
                      fill=tuple(lay["color"]), anchor=lay["anchor"])

    if texts:
        pend, body, normal_monster = card_text_parts(card, texts)
        if pendulum and pend:
            _text_box(draw, pend, LAYOUT["pendulum_effect"], LAYOUT["pendulum_effect"]["box"], "font")
        lay = LAYOUT["effect"]
        _text_box(draw, body, lay, lay["box"] if card.category == "monster" else lay["spell_trap_box"],
                  "normal_font" if normal_monster else "font")
    return face


def signature(card, md_id):
    """What a face is drawn from (the drawing version, the card's face fields and the art file): a face is drawn
    again when this changes."""
    parts = [FACE_VERSION, card.name_ko or card.name_ja, card.category, card.frame, card.attribute, card.race,
             card.types, card.level, card.rank, card.link_rating, card.link_markers, card.atk, card.def_value,
             card.pendulum_scale, card.spell_trap_subtype, art_name(md_id)]
    if needs_fallback(card.name_ko or card.name_ja or ""):
        parts.append("fallback letters 1")   # only the faces with such names were drawn again
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


def draw_name_mask(card):
    """The card name alone, white on black over the card's top sixth: Master Duel's Shine and Royal shaders paint the
    name from it (Royal in gold, Shine in white) instead of taking it from the face (엘리스 10/11)."""
    lay = LAYOUT["name"]
    x0, y0, x1, y1 = lay["box"]
    layer = _squeezed_text(card.name_ko or card.name_ja, font_of(lay["font"], lay["size"]), (255, 255, 255, 255),
                           x1 - x0, y1 - y0, lay["pad"])
    mask = Image.new("L", (W, H), 0)
    mask.paste(255, (x0, y0), layer.getchannel("A"))
    return mask.resize(NAME_MASK_SIZE, Image.LANCZOS, box=(0, 0, W, H / 6))


def save_name_mask(card, md_id=None):
    out = os.path.join(settings.MEDIA_ROOT, name_rel(md_id or card.id))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    draw_name_mask(card).save(out, optimize=True)


def name_rel(md_id):
    return f"{NAME_DIR}/{md_id}.png"


def name_mask_url(md_id):
    return _url(name_rel(md_id))


def face_rel(md_id):
    return f"{FACE_DIR}/{md_id}.webp"


def thumb_rel(md_id):
    return f"{THUMB_DIR}/{md_id}.webp"


def _url(rel):
    """The file's address with its version (when it was written): nginx lets browsers keep /media for years, so a
    face drawn again must come under a new address or people who saw it go on seeing the old one."""
    try:
        written = os.stat(os.path.join(settings.MEDIA_ROOT, rel)).st_mtime_ns
    except OSError:
        return None
    return f"{settings.MEDIA_URL}{rel}?v={written:x}"


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
    save_name_mask(card, md_id)
    return out
