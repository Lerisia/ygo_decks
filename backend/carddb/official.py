import html
import re
from datetime import date

from .md import UNKNOWN_STAT

RACES = {
    "ja": {
        "魔法使い族": "spellcaster", "ドラゴン族": "dragon", "アンデット族": "zombie", "戦士族": "warrior",
        "獣戦士族": "beast_warrior", "獣族": "beast", "鳥獣族": "winged_beast", "悪魔族": "fiend", "天使族": "fairy",
        "昆虫族": "insect", "恐竜族": "dinosaur", "爬虫類族": "reptile", "魚族": "fish", "海竜族": "sea_serpent",
        "水族": "aqua", "炎族": "pyro", "雷族": "thunder", "岩石族": "rock", "植物族": "plant", "機械族": "machine",
        "サイキック族": "psychic", "幻神獣族": "divine_beast", "創造神族": "creator_god", "幻竜族": "wyrm",
        "サイバース族": "cyberse", "幻想魔族": "illusion",
    },
    "ko": {
        "마법사족": "spellcaster", "드래곤족": "dragon", "언데드족": "zombie", "전사족": "warrior", "야수전사족": "beast_warrior",
        "야수족": "beast", "비행야수족": "winged_beast", "악마족": "fiend", "천사족": "fairy", "곤충족": "insect", "공룡족": "dinosaur",
        "파충류족": "reptile", "어류족": "fish", "해룡족": "sea_serpent", "물족": "aqua", "화염족": "pyro", "번개족": "thunder",
        "암석족": "rock", "식물족": "plant", "기계족": "machine", "사이킥족": "psychic", "환신야수족": "divine_beast",
        "창조신족": "creator_god", "환룡족": "wyrm", "사이버스족": "cyberse", "환상마족": "illusion",
    },
    "en": {
        "Spellcaster": "spellcaster", "Dragon": "dragon", "Zombie": "zombie", "Warrior": "warrior", "Beast-Warrior": "beast_warrior",
        "Beast": "beast", "Winged Beast": "winged_beast", "Fiend": "fiend", "Fairy": "fairy", "Insect": "insect", "Dinosaur": "dinosaur",
        "Reptile": "reptile", "Fish": "fish", "Sea Serpent": "sea_serpent", "Aqua": "aqua", "Pyro": "pyro", "Thunder": "thunder",
        "Rock": "rock", "Plant": "plant", "Machine": "machine", "Psychic": "psychic", "Divine-Beast": "divine_beast",
        "Creator God": "creator_god", "Wyrm": "wyrm", "Cyberse": "cyberse", "Illusion": "illusion",
    },
}
TYPES = {
    "ja": {
        "通常": "normal", "効果": "effect", "儀式": "ritual", "融合": "fusion", "シンクロ": "synchro",
        "エクシーズ": "xyz", "リンク": "link", "ペンデュラム": "pendulum", "チューナー": "tuner", "リバース": "flip",
        "トゥーン": "toon", "スピリット": "spirit", "ユニオン": "union", "デュアル": "gemini",
        "特殊召喚": "special_summon", "トークン": "token",
    },
    "ko": {
        "일반": "normal", "효과": "effect", "의식": "ritual", "융합": "fusion", "싱크로": "synchro", "엑시즈": "xyz", "링크": "link",
        "펜듈럼": "pendulum", "튜너": "tuner", "리버스": "flip", "툰": "toon", "스피릿": "spirit", "유니온": "union", "듀얼": "gemini",
        "특수 소환": "special_summon", "토큰": "token",
    },
    "en": {
        "Normal": "normal", "Effect": "effect", "Ritual": "ritual", "Fusion": "fusion", "Synchro": "synchro", "Xyz": "xyz", "Link": "link",
        "Pendulum": "pendulum", "Tuner": "tuner", "Flip": "flip", "Toon": "toon", "Spirit": "spirit", "Union": "union", "Gemini": "gemini",
        "Special Summon": "special_summon", "Token": "token",
    },
}
SUBTYPES = {"continuous": "continuous", "quickplay": "quick_play", "field": "field", "equip": "equip", "counter": "counter", "ritual": "ritual"}
NUMPAD = {"7": "top_left", "8": "top", "9": "top_right", "4": "left", "6": "right", "1": "bottom_left", "2": "bottom", "3": "bottom_right"}
MARKER_ORDER = ["top_left", "top", "top_right", "left", "right", "bottom_left", "bottom", "bottom_right"]

_ROW = re.compile(r'<div class="t_row c_normal[^"]*">(.*?)</div><!-- \.t_row', re.S)
_DATE = {
    "ja": (re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日"), (1, 2, 3)),
    "ko": (re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})"), (1, 2, 3)),
    "en": (re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})"), (3, 1, 2)),
}


def _text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", html.unescape(fragment))
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return "\n".join(line.strip() for line in fragment.strip().splitlines()).strip()


def _find(pattern, s, group=1, default=""):
    m = re.search(pattern, s, re.S)
    return m.group(group) if m else default


def _stat(raw: str):
    raw = raw.strip()
    if raw in ("", "-"):
        return None
    if raw == "?":
        return UNKNOWN_STAT
    return int(raw)


def release_date(page: str, lang: str):
    head = _find(r'<p id="previewed">(.*?)</p>', page)
    pattern, (y, mo, d) = _DATE[lang]
    m = pattern.search(head)
    return date(int(m.group(y)), int(m.group(mo)), int(m.group(d))) if m else None


def parse_row(row: str, lang: str) -> dict:
    cid = int(_find(r'class="cid" value="(\d+)"', row) or _find(r"ope=2&cid=(\d+)", row))
    out = {
        "cid": cid,
        "name": _text(_find(r'<span class="card_name">(.*?)</span>', row)),
        "ruby": _text(_find(r'<span class="card_ruby">(.*?)</span>', row)),
        "rarity": _find(r'<div class="lr_icon[^"]*"[^>]*>\s*<p>(.*?)</p>', row),
        "text": _text(_find(r'<dd class="box_card_text c_text flex_1 text_linebreak">(.*?)</dd>', row)),
        "note": _text(_find(r'<dd class="box_card_text c_text flex_1 biko text_linebreak">(.*?)</dd>', row)).lstrip("※").strip(),
    }
    attr = _find(r"attribute_icon_(\w+)\.png", row)
    if attr in ("spell", "trap"):
        out["category"] = attr
        out["types"] = []
        out["spell_trap_subtype"] = SUBTYPES.get(_find(r"effect_icon_(\w+)\.png", row), "normal")
        return out
    species = _text(_find(r'<span class="card_info_species_and_other_item">(.*?)</span></span>', row)).strip("【】[] \n")
    words = [w.strip() for w in re.split(r"[／/]", species) if w.strip()]
    races, types = RACES[lang], TYPES[lang]
    level_kind = _find(r'<span class="box_card_level_rank (\w+)">', row)
    level_value = _find(r'<span class="box_card_level_rank \w+">.*?<span>\D*(\d+)\s*</span>', row)
    link = _find(r"link_pc/link(\d+)\.png", row)
    scale = _find(r'icon_pendulum\.png"[^>]*>\s*\D*(\d+)', row)
    out.update({
        "category": "monster",
        "race": races.get(words[0], "") if words else "",
        "types": [types.get(w, w) for w in words[1:]],
        "attribute": attr,
        "level": int(level_value) if level_kind == "level" and level_value else None,
        "rank": int(level_value) if level_kind == "rank" and level_value else None,
        "link_rating": len(link) if link else None,
        "link_markers": sorted((NUMPAD[d] for d in link), key=MARKER_ORDER.index) if link else [],
        "atk": _stat(_find(r'<span class="atk_power">\s*<span>\D*?([\d?-]*)\s*</span>', row)),
        "def_value": None if link else _stat(_find(r'<span class="def_power"><span>\D*?([\d?-]*)\s*</span>', row)),
        "pendulum_scale": int(scale) if scale else None,
        "pendulum_effect": _text(_find(r'<span class="box_card_pen_effect[^"]*">(.*?)</span>', row)),
    })
    return out


def parse_product(page: str, lang: str) -> dict:
    return {"release_date": release_date(page, lang), "rows": [parse_row(r, lang) for r in _ROW.findall(page)]}
