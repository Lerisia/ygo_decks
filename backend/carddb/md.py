import re
import struct
import zlib

KEY = 42
FIRST_OFFICIAL_ID = 4007
UNKNOWN_STAT = -1

KIND_TYPES = {
    0: ["normal"], 1: ["effect"], 2: ["fusion"], 3: ["fusion", "effect"],
    4: ["ritual"], 5: ["ritual", "effect"], 6: ["toon", "effect"], 7: ["spirit", "effect"],
    8: ["union", "effect"], 9: ["gemini", "effect"], 10: ["token"],
    15: ["tuner", "normal"], 16: ["tuner", "effect"], 17: ["synchro"], 18: ["synchro", "effect"],
    19: ["synchro", "tuner", "effect"], 22: ["xyz"], 23: ["xyz", "effect"], 24: ["flip", "effect"],
    25: ["pendulum", "normal"], 26: ["pendulum", "effect"], 27: ["special_summon", "effect"],
    28: ["special_summon", "toon", "effect"], 29: ["special_summon", "spirit", "effect"],
    30: ["special_summon", "tuner", "effect"], 32: ["flip", "tuner", "effect"],
    33: ["pendulum", "tuner", "effect"], 34: ["xyz", "pendulum", "effect"], 35: ["pendulum", "flip", "effect"],
    36: ["synchro", "pendulum", "effect"], 37: ["union", "tuner", "effect"], 38: ["ritual", "spirit", "effect"],
    39: ["fusion", "tuner"], 40: ["special_summon", "pendulum", "effect"], 41: ["fusion", "pendulum", "effect"],
    42: ["link"], 43: ["link", "effect"], 44: ["pendulum", "tuner", "normal"], 45: ["pendulum", "spirit", "effect"],
    47: ["ritual", "tuner", "effect"], 48: ["fusion", "tuner", "effect"], 49: ["token", "tuner"],
    52: ["ritual", "pendulum", "effect"], 53: ["ritual", "flip", "effect"],
}
KIND_SPELL = 13
KIND_TRAP = 14

ATTRIBUTES = {1: "light", 2: "dark", 3: "water", 4: "fire", 5: "earth", 6: "wind", 7: "divine"}
RACES = {
    1: "dragon", 2: "zombie", 3: "fiend", 4: "pyro", 5: "sea_serpent", 6: "rock", 7: "machine", 8: "fish",
    9: "dinosaur", 10: "insect", 11: "beast", 12: "beast_warrior", 13: "plant", 14: "aqua", 15: "warrior",
    16: "winged_beast", 17: "fairy", 18: "spellcaster", 19: "thunder", 20: "reptile", 21: "psychic", 22: "wyrm",
    23: "cyberse", 24: "divine_beast", 25: "illusion",
}
SPELL_SUBTYPES = {0: "normal", 2: "field", 3: "equip", 4: "continuous", 5: "quick_play", 6: "ritual"}
TRAP_SUBTYPES = {0: "normal", 1: "counter", 4: "continuous"}
LINK_MARKERS = ["top_left", "top", "top_right", "left", "right", "bottom_left", "bottom", "bottom_right"]
RARITIES = {1: "N", 2: "R", 3: "SR", 4: "UR"}
EXTRA_DECK = {"fusion", "synchro", "xyz", "link"}
PENDULUM_MARK = {"ja": "【ペンデュラム効果】", "ko": "【펜듈럼 효과】"}
NO_MATERIALS = ("このカード", "이 카드")
NAME_TREATED = 256


def decrypt(data: bytes) -> bytes:
    out = bytearray(data)
    for i in range(len(out)):
        out[i] ^= (((i + KEY + 0x23D) * KEY) ^ (i % 7)) & 0xFF
    return zlib.decompress(bytes(out))


def _bits(v, lo, hi):
    return (v >> lo) & ((1 << (hi - lo)) - 1)


def card_ids(prop: bytes) -> list[int]:
    ids, prev, wrap = [], -1, 0
    for a, _ in struct.iter_unpack("<II", prop):
        i = a & 0x3FFF
        if i < prev:
            wrap += 16384
        prev = i
        ids.append(i + wrap)
    return ids


def _stat(raw):
    return UNKNOWN_STAT if raw == 511 else raw * 10


def parse_prop(a: int, b: int) -> dict:
    kind = _bits(a, 16, 22)
    if kind == KIND_SPELL or kind == KIND_TRAP:
        category = "spell" if kind == KIND_SPELL else "trap"
        subtypes = SPELL_SUBTYPES if kind == KIND_SPELL else TRAP_SUBTYPES
        return {"kind": kind, "category": category, "types": [], "spell_trap_subtype": subtypes.get(_bits(b, 18, 21), "")}
    types = KIND_TYPES.get(kind)
    if types is None:
        return {"kind": kind, "category": None}
    level_type = _bits(a, 30, 32)
    value = _bits(a, 26, 30)
    is_link = level_type == 3
    return {
        "kind": kind,
        "category": "monster",
        "types": list(types),
        "attribute": ATTRIBUTES.get(_bits(a, 22, 26), ""),
        "race": RACES.get(_bits(b, 21, 26), ""),
        "level": value if level_type == 1 else None,
        "rank": value if level_type == 2 else None,
        "link_rating": value if is_link else None,
        "atk": _stat(_bits(b, 0, 9)),
        "def_value": None if is_link else _stat(_bits(b, 9, 18)),
        "link_markers": [LINK_MARKERS[i] for i in range(8) if _bits(b, 9, 18) >> i & 1] if is_link else [],
        "pendulum_scale": _bits(b, 27, 31) if "pendulum" in types else None,
    }


def is_card(cid: int, prop: dict, name: str, text: str) -> bool:
    if prop["category"] is None:
        return False
    if "token" in prop["types"]:
        return text not in ("なし", name)
    return cid >= FIRST_OFFICIAL_ID


def frame_of(category: str, types: list[str]) -> str:
    if category != "monster":
        return category
    if "token" in types:
        return "token"
    base = next((t for t in ("ritual", "fusion", "synchro", "xyz", "link") if t in types), None)
    if base is None:
        base = "normal" if "normal" in types else "effect"
    return f"{base}_pendulum" if "pendulum" in types else base


def _cstr(blob: bytes, off: int) -> str:
    return blob[off:blob.index(b"\0", off)].decode("utf-8")


def parse_texts(name: bytes, desc: bytes, indx: bytes, prop: bytes) -> dict[int, tuple[str, str]]:
    offs = list(struct.iter_unpack("<II", indx))
    return {cid: (_cstr(name, offs[k][0]), _cstr(desc, offs[k][1])) for k, cid in enumerate(card_ids(prop))}


def parse_ruby(rubyname: bytes, rubyindx: bytes, prop: bytes) -> dict[int, str]:
    offs = list(struct.iter_unpack("<II", rubyindx))
    return {cid: _cstr(rubyname, offs[k][0]) for k, cid in enumerate(card_ids(prop))}


_RUBY = re.compile(r"\$R(.+?)\((.+?)\)")


def ruby_reading(ruby: str) -> str:
    return _RUBY.sub(lambda m: m.group(2), ruby)


def parse_same(data: bytes) -> list[tuple[int, int, int]]:
    return list(struct.iter_unpack("<HHH", data))


def parse_rarity(data: bytes) -> dict[int, str]:
    out = {}
    for (v,) in struct.iter_unpack("<I", data):
        r = RARITIES.get(v >> 16)
        if r:
            out[v & 0xFFFF] = r
    return out


def split_text(text: str, types: list[str], lang: str) -> dict[str, str]:
    main, pend = text, ""
    mark = PENDULUM_MARK.get(lang)
    if mark and mark in text:
        main, pend = text.split(mark, 1)
    main, pend = main.strip("\n"), pend.strip("\n")
    materials = ""
    if EXTRA_DECK & set(types) or "ritual" in types:
        first, _, rest = main.partition("\n")
        if not first.startswith(NO_MATERIALS):
            materials, main = first, rest.strip("\n")
    flavor, effect = (main, "") if "normal" in types else ("", main)
    return {"materials": materials, "effect": effect, "pendulum_effect": pend, "flavor": flavor}
