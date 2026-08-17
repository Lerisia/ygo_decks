"""Solo 딱무고개 question engine.

Defines the structured yes/no question vocabulary and the per-question
answerer that turns a `Card` row into a boolean answer. Also exposes the
menu the client renders (groups → items) so adding new questions only
touches this file.
"""
from __future__ import annotations

from typing import Iterable

from . import yp_clusters as _yp


# ─────────────── label maps ───────────────

ATTR_LABELS = {
    "DARK": "어둠",
    "LIGHT": "빛",
    "WATER": "물",
    "FIRE": "불",
    "EARTH": "땅",
    "WIND": "바람",
    "DIVINE": "신",
}

# Monster races only — the solo Twenty Questions pool is restricted to
# monsters (see _pool_card_ids in twenty_views), so spell/trap subcategory
# questions are excluded from the menu to avoid guaranteed-no turns.
RACE_LABELS = {
    "Dragon": "드래곤족",
    "Spellcaster": "마법사족",
    "Warrior": "전사족",
    "Beast": "야수족",
    "Beast-Warrior": "야수전사족",
    "Winged Beast": "비행야수족",
    "Dinosaur": "공룡족",
    "Fish": "어류족",
    "Sea Serpent": "해룡족",
    "Reptile": "파충류족",
    "Insect": "곤충족",
    "Plant": "식물족",
    "Fairy": "천사족",
    "Fiend": "악마족",
    "Zombie": "언데드족",
    "Machine": "기계족",
    "Aqua": "물족",
    "Pyro": "화염족",
    "Thunder": "번개족",
    "Rock": "암석족",
    "Psychic": "사이킥족",
    "Wyrm": "환룡족",
    "Divine-Beast": "환신야수족",
    "Cyberse": "사이버스족",
    "Illusion": "환상마족",
}

# `frame_type` covers the headline card-type categories. The bot collapses
# pendulum variants under "pendulum" so the player can ask one question for
# "any pendulum card" without enumerating each sub-frame.
FRAME_TYPE_LABELS = {
    "normal": "일반 몬스터",
    "effect": "효과 몬스터",
    "ritual": "의식 몬스터",
    "fusion": "융합 몬스터",
    "synchro": "싱크로 몬스터",
    "xyz": "엑시즈 몬스터",
    "pendulum": "펜듈럼 몬스터",  # virtual — matches any pendulum sub-frame
    "link": "링크 몬스터",
}

EXTRA_DECK_FRAMES = {
    "synchro", "xyz", "fusion", "link",
    "fusion_pendulum", "xyz_pendulum", "synchro_pendulum",
}

# Spell/Trap sub-categories. The DB stores these in `race` (shared field
# with monster race), so the question handler combines frame_type + race
# to disambiguate Normal Spell vs Normal Trap vs Normal Monster.
SPELL_KIND_LABELS = {
    "Normal":     "일반 마법",
    "Quick-Play": "속공 마법",
    "Continuous": "지속 마법",
    "Field":      "필드 마법",
    "Equip":      "장착 마법",
    "Ritual":     "의식 마법",
}
TRAP_KIND_LABELS = {
    "Normal":     "일반 함정",
    "Continuous": "지속 함정",
    "Counter":    "카운터 함정",
}

# Effect-tag questions — values mirror CardEffectTag field names. Reusing
# the model field names keeps the q_type → tag lookup trivial.
# Only `hand_trap` is still wired through the legacy CardEffectTag path —
# it's namuwiki-sourced and lives in the 일반적인 질문 group. All other
# effect questions now come from the yp_* clusters (yp_clusters.py),
# sourced from Yugipedia SMW data.

# 14 plain consonants used in the menu. The match rule includes both 초성
# (leading) AND 종성 (final/받침), and treats doubled/cluster consonants as
# matching their plain component — e.g., asking for 'ㄱ' matches syllables
# whose initial is ㄱ or ㄲ, AND syllables whose final is ㄱ, ㄲ, ㄳ, or ㄺ.
_PLAIN_INITIALS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ",
                   "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]

# Per plain consonant: set of 초성 indices (0~18, "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
# and 종성 indices (0~27, where 0 = no final). Built once from the canonical
# initial/final order so the runtime lookup is just `set membership`.
_CONSONANT_MATCH = {
    "ㄱ": ({0, 1},  {1, 2, 3, 9}),                 # 초성 ㄱ,ㄲ;     종성 ㄱ,ㄲ,ㄳ,ㄺ
    "ㄴ": ({2},     {4, 5, 6}),                    # 초성 ㄴ;        종성 ㄴ,ㄵ,ㄶ
    "ㄷ": ({3, 4},  {7}),                          # 초성 ㄷ,ㄸ;     종성 ㄷ
    "ㄹ": ({5},     {8, 9, 10, 11, 12, 13, 14, 15}),  # 초성 ㄹ;     종성 ㄹ,ㄺ,ㄻ,ㄼ,ㄽ,ㄾ,ㄿ,ㅀ
    "ㅁ": ({6},     {10, 16}),                     # 초성 ㅁ;        종성 ㄻ,ㅁ
    "ㅂ": ({7, 8},  {11, 14, 17, 18}),             # 초성 ㅂ,ㅃ;     종성 ㄼ,ㄿ,ㅂ,ㅄ
    "ㅅ": ({9, 10}, {3, 12, 18, 19, 20}),          # 초성 ㅅ,ㅆ;     종성 ㄳ,ㄽ,ㅄ,ㅅ,ㅆ
    "ㅇ": ({11},    {21}),                         # 초성 ㅇ;        종성 ㅇ
    "ㅈ": ({12, 13},{22}),                         # 초성 ㅈ,ㅉ;     종성 ㅈ
    "ㅊ": ({14},    {23}),                         # 초성 ㅊ;        종성 ㅊ
    "ㅋ": ({15},    {24}),                         # 초성 ㅋ;        종성 ㅋ
    "ㅌ": ({16},    {13, 25}),                     # 초성 ㅌ;        종성 ㄾ,ㅌ
    "ㅍ": ({17},    {14, 26}),                     # 초성 ㅍ;        종성 ㄿ,ㅍ
    "ㅎ": ({18},    {6, 15, 27}),                  # 초성 ㅎ;        종성 ㄶ,ㅀ,ㅎ
}


def _name_has_consonant(name: str, consonant: str) -> bool:
    """True if any Hangul syllable in `name` contains `consonant` as either
    its leading (초성) or final (종성) — counting cluster finals (e.g. ㄺ for
    ㄱ) and doubled/tense variants (e.g. ㄲ for ㄱ)."""
    match = _CONSONANT_MATCH.get(consonant)
    if not match:
        return False
    initials, finals = match
    for c in name:
        if "가" <= c <= "힣":
            code = ord(c) - 0xAC00
            initial_idx = code // 588
            final_idx = code % 28
            if initial_idx in initials or final_idx in finals:
                return True
    return False

# ATK/DEF questions are freeform (user types a number). Backend doesn't pre-
# enumerate thresholds.


# ─────────────── answer engine ───────────────

def _effective_level(card):
    """Return the card's level/rank/link value on a unified axis, or
    None if it has no value on this axis.

    - Link monsters: link_value (Link-N). The level field is a stored
      placeholder 0 from YGOPRODeck and must be ignored.
    - Spell/Trap and empty frames: None.
    - Xyz: level field (= Rank). 0 is legit (FNo.0 미래황 호프 등 5장).
    - Normal/effect/ritual/fusion/synchro + pendulum variants: level.
    """
    ft = card.frame_type or ""
    if ft == "link":
        return card.link_value
    if ft in {"", "spell", "trap"}:
        return None
    return card.level


def answer_question(card, q_type: str, q_value) -> bool:
    """Return True/False for a structured question against `card`.
    Raises ValueError on an unknown question type — view-level validation
    prevents that from reaching this function in production."""
    ft = card.frame_type or ""
    ct = card.card_type or ""
    rc = card.race or ""
    if q_type == "is_monster":
        return ft != "" and ft not in {"spell", "trap"}
    if q_type == "is_spell_or_trap":
        return ft in {"spell", "trap"}
    if q_type == "spell_kind":
        return ft == "spell" and rc == q_value
    if q_type == "trap_kind":
        return ft == "trap" and rc == q_value
    if q_type == "frame_type":
        if q_value == "pendulum":
            return "pendulum" in ft
        if q_value == "effect":
            # frame_type='effect' covers ALL effect-monster variants,
            # including ones whose card_type doesn't have "Effect" in it
            # (Tuner Monster, Spirit Monster, Toon Monster, Gemini Monster,
            # Flip Effect Monster). frame_type='effect_pendulum' likewise.
            if ft in {"effect", "effect_pendulum"}:
                return True
            if ft in {"", "normal", "normal_pendulum", "spell", "trap"}:
                return False
            # Extra-deck frames + ritual can be vanilla (e.g. 블랙 데몬즈
            # 드래곤 fusion, 청안의 궁극룡, 천상의 백룡). YGOPRODeck card_type
            # is identical for vanilla vs effect ("Fusion Monster") so we
            # rely on Yugipedia's `Non-Effect Monster` misc tag.
            misc = card.yugipedia_misc or []
            if "Non-Effect Monster" in misc:
                return False
            return "Normal" not in ct
        # Pendulum is a modifier, not a base type — a 펜듈럼 효과 몬스터 has
        # frame_type="effect_pendulum" but IS an effect monster too. Match
        # both the bare base type and its pendulum variant.
        return ft == q_value or ft == f"{q_value}_pendulum"
    if q_type == "attribute":
        return (card.attribute or "") == q_value
    if q_type == "race":
        return (card.race or "") == q_value
    if q_type in ("attribute_in", "race_in"):
        # Multi-select: q_value is a comma-separated list of values; matches
        # if the card's attribute/race is in the set.
        field = "attribute" if q_type == "attribute_in" else "race"
        values = {v.strip() for v in str(q_value).split(",") if v.strip()}
        return (getattr(card, field) or "") in values
    if q_type == "level_exact":
        try:
            n = int(q_value)
        except (TypeError, ValueError):
            return False
        v = _effective_level(card)
        return v is not None and v == n
    if q_type == "name_initial":
        name = (card.korean_name or "").replace(" ", "")
        if not name:
            return False
        return _name_has_consonant(name, str(q_value))
    if q_type == "name_has_alpha":
        name = card.korean_name or ""
        return any("a" <= c.lower() <= "z" for c in name)
    if q_type == "name_has_digit":
        name = card.korean_name or ""
        return any(c.isdigit() for c in name)
    if q_type == "name_has_special":
        # Anything that's not Korean syllable, ASCII letter, digit, or
        # whitespace counts as "special". Catches ＝・★＜＞・「」"...".
        name = card.korean_name or ""
        for c in name:
            if c.isspace():
                continue
            if "가" <= c <= "힣":
                continue
            if "a" <= c.lower() <= "z":
                continue
            if c.isdigit():
                continue
            return True
        return False
    if q_type in ("name_len_gte", "name_len_lte", "name_len_eq"):
        try:
            n = int(q_value)
        except (TypeError, ValueError):
            return False
        # Count Korean name length excluding spaces — every other char
        # (punctuation, digits, alphanumeric, special symbols) counts.
        name = (card.korean_name or "").replace(" ", "")
        if not name:
            return False
        L = len(name)
        if q_type == "name_len_gte":
            return L >= n
        if q_type == "name_len_lte":
            return L <= n
        return L == n
    if q_type in ("level_gte", "level_lte", "level_eq"):
        try:
            n = int(q_value)
        except (TypeError, ValueError):
            return False
        val = _effective_level(card)
        if val is None:
            return False
        if q_type == "level_gte":
            return val >= n
        if q_type == "level_lte":
            return val <= n
        return val == n
    if q_type in ("atk_gte", "atk_lte", "atk_eq"):
        try:
            n = int(q_value)
        except (TypeError, ValueError):
            return False
        # -1 sentinel = "?" on the card → treat as not-comparable for all
        # three directions (≥, ≤, = all false).
        atk = card.atk if card.atk is not None else -1
        if atk == -1:
            return False
        if q_type == "atk_gte":
            return atk >= n
        if q_type == "atk_lte":
            return atk <= n
        return atk == n
    if q_type in ("def_gte", "def_lte", "def_eq"):
        try:
            n = int(q_value)
        except (TypeError, ValueError):
            return False
        # Link monsters have no DEF stat at all — every DEF comparison is
        # false. Same outcome (false) for "?" DEF on a regular monster.
        if ft == "link":
            return False
        d = card.def_value if card.def_value is not None else -1
        if d == -1:
            return False
        if q_type == "def_gte":
            return d >= n
        if q_type == "def_lte":
            return d <= n
        return d == n
    if q_type == "tuner":
        return "Tuner" in ct
    if q_type == "extra_deck":
        return ft in EXTRA_DECK_FRAMES
    if q_type == "atk_eq_def":
        atk = card.atk if card.atk is not None else -1
        d = card.def_value if card.def_value is not None else -1
        # Link monsters: no DEF → false (no equality possible).
        if ft == "link" or atk == -1 or d == -1:
            return False
        return atk == d
    if q_type == "desc_has_graveyard":
        text = (card.korean_description or "")
        return "묘지" in text
    if q_type == "has_level":
        # A card "has level" iff it's a monster that's neither Xyz nor Link.
        # Xyz monsters have ranks; Link monsters have link markers.
        return ft not in {"xyz", "xyz_pendulum", "link", "", "spell", "trap"}
    if q_type == "has_multi_effects":
        # OCG numbers effects "①: ... ②: ..." in card text. Presence of "②"
        # means the card has at least 2 numbered effects. Vanilla monsters
        # have no numbered effects → false.
        return "②" in (card.korean_description or "")
    if q_type == "tag_hand_trap":
        # Only legacy CardEffectTag field still used — sourced from namuwiki.
        try:
            return bool(card.effect_tag.hand_trap)
        except Exception:
            return False
    if q_type == "special_win":
        # "Duel winner" Yugipedia tag — cards with alternate win
        # conditions (엑조디아, 종언의 카운트 다운, 잭팟 7, 라스트 배틀, 등).
        return "Duel winner" in (card.yugipedia_archseries or [])
    if q_type == "yp_in":
        # Multi-cluster OR: q_value is comma-separated cluster ids; True if
        # the card belongs to ANY of them. Single-element lists work too,
        # which lets a "list" group be safely migrated to multiselect.
        cluster_ids = [v.strip() for v in str(q_value).split(",") if v.strip()]
        return any(_yp.card_in_cluster(card, cid) for cid in cluster_ids)
    if q_type == "archetype_in":
        # Yugipedia Archseries multi-match. q_value is comma-separated
        # archetype names (English, as stored on the card). True if any
        # listed archetype is in the card's yugipedia_archseries.
        # Special token "__NONE__" matches cards with NO archetypes at all
        # (literal value, not derived from any Archseries page name).
        wanted = {v.strip() for v in str(q_value).split(",") if v.strip()}
        # Expand canonical picks to include subsumed aliases (e.g. picking
        # "Evil★Twin" also matches Live☆Twin / Lil-la / Ki-sikil cards).
        for w in list(wanted):
            for alias in _ARCHETYPE_ALIASES.get(w, []):
                wanted.add(alias)
        archs = card.yugipedia_archseries or []
        if "__NONE__" in wanted and not archs:
            return True
        return any(a in wanted for a in archs)
    if q_type.startswith("yp_"):
        cluster_id = q_type[3:]
        return _yp.card_in_cluster(card, cluster_id)
    raise ValueError(f"unknown q_type: {q_type}")


def build_question_text(q_type: str, q_value) -> str:
    """Human-readable representation for the history log (and the FE chip)."""
    if q_type == "is_monster":
        return "몬스터 카드인가요?"
    if q_type == "is_spell_or_trap":
        return "마법 / 함정 카드인가요?"
    if q_type == "spell_kind":
        return f"유형: {SPELL_KIND_LABELS.get(q_value, q_value)}?"
    if q_type == "trap_kind":
        return f"유형: {TRAP_KIND_LABELS.get(q_value, q_value)}?"
    if q_type == "frame_type":
        if q_value == "spell":
            return "마법 카드인가요?"
        if q_value == "trap":
            return "함정 카드인가요?"
        return f"유형: {FRAME_TYPE_LABELS.get(q_value, q_value)}?"
    if q_type == "attribute":
        return f"속성: {ATTR_LABELS.get(q_value, q_value)}?"
    if q_type == "race":
        return f"종족: {RACE_LABELS.get(q_value, q_value)}?"
    if q_type == "attribute_in":
        labels = [ATTR_LABELS.get(v.strip(), v.strip()) for v in str(q_value).split(",") if v.strip()]
        return f"속성: {labels[0]}?" if len(labels) == 1 else f"속성: {' / '.join(labels)} 중 하나?"
    if q_type == "race_in":
        labels = [RACE_LABELS.get(v.strip(), v.strip()) for v in str(q_value).split(",") if v.strip()]
        return f"종족: {labels[0]}?" if len(labels) == 1 else f"종족: {' / '.join(labels)} 중 하나?"
    if q_type == "level_exact":
        return f"레벨/랭크/링크 = {q_value}?"
    if q_type == "level_gte":
        return f"레벨/랭크/링크 ≥ {q_value}?"
    if q_type == "level_lte":
        return f"레벨/랭크/링크 ≤ {q_value}?"
    if q_type == "atk_gte":
        return f"공격력 ≥ {q_value}?"
    if q_type == "atk_lte":
        return f"공격력 ≤ {q_value}?"
    if q_type == "atk_eq":
        return f"공격력 = {q_value}?"
    if q_type == "def_gte":
        return f"수비력 ≥ {q_value}?"
    if q_type == "def_lte":
        return f"수비력 ≤ {q_value}?"
    if q_type == "def_eq":
        return f"수비력 = {q_value}?"
    if q_type == "level_eq":
        return f"레벨/랭크/링크 = {q_value}?"
    if q_type == "name_len_gte":
        return f"이름 길이 ≥ {q_value}?"
    if q_type == "name_len_lte":
        return f"이름 길이 ≤ {q_value}?"
    if q_type == "name_len_eq":
        return f"이름 길이 = {q_value}?"
    if q_type == "name_initial":
        return f"이름에 자음 '{q_value}' 포함?"
    if q_type == "name_has_alpha":
        return "이름에 영어 포함?"
    if q_type == "name_has_digit":
        return "이름에 숫자 포함?"
    if q_type == "name_has_special":
        return "이름에 특수문자 포함?"
    if q_type == "tuner":
        return "튜너 몬스터?"
    if q_type == "extra_deck":
        return "엑스트라 덱 카드?"
    if q_type == "atk_eq_def":
        return "공격력 = 수비력?"
    if q_type == "desc_has_graveyard":
        return "묘지 관련 카드?"
    if q_type == "has_multi_effects":
        return "효과가 여러 개인가요?"
    if q_type == "has_level":
        return "레벨이 있는 카드?"
    if q_type == "tag_hand_trap":
        return "패 트랩인가요?"
    if q_type == "special_win":
        return "특수 승리 카드인가요?"
    if q_type == "yp_in":
        cluster_ids = [v.strip() for v in str(q_value).split(",") if v.strip()]
        if len(cluster_ids) == 1:
            return _yp.CLUSTER_LABELS.get(cluster_ids[0], f"{cluster_ids[0]}?")
        # Multi-select: strip the trailing "...인가요?" so the joined list
        # reads naturally as "A / B / C 중 하나에 해당하는 카드인가요?".
        parts = [_short_cluster_label(_yp.CLUSTER_LABELS.get(cid, cid)) for cid in cluster_ids]
        return f"{' / '.join(parts)} 중 하나에 해당하는 카드인가요?"
    if q_type == "archetype_in":
        names = [v.strip() for v in str(q_value).split(",") if v.strip()]
        labels = ["테마 없음" if n == "__NONE__" else _archetype_label(n) for n in names]
        if len(labels) == 1:
            return f"카드군: {labels[0]}?"
        return f"카드군: {' / '.join(labels)} 중 하나?"
    if q_type.startswith("yp_"):
        cluster_id = q_type[3:]
        return _yp.CLUSTER_LABELS.get(cluster_id, f"{cluster_id}?")
    return f"{q_type}({q_value})?"


# ─────────────── hint resolver ───────────────

# Public dimension keys + their Korean display labels for the hint picker.
# ATK / DEF excluded — testing showed they're too strong (combined with
# 유형/속성/race they narrow to ≤5 candidates almost every time).
HINT_DIMS = [
    ("frame",     "유형"),
    ("attribute", "속성"),
    ("race",      "종족"),
    ("level",     "레벨/랭크/링크"),
    ("effect",    "효과"),
    ("cost",      "발동 비용"),
    ("trigger",   "발동 시점"),
]


REPEATABLE_HINT_DIMS = {"effect", "cost", "trigger"}


def _cluster_list_for_dim(dim: str):
    if dim == "effect":
        return _yp.EFFECT_CLUSTERS
    if dim == "cost":
        return _yp.COST_CLUSTERS
    if dim == "trigger":
        return _yp.TRIGGER_CLUSTERS
    return []


def hint_remaining_per_dim(card, history: list) -> dict:
    """How many more times each hint dim can be used in this game.
    Single-use dims: 1 if not yet used, else 0. Repeatable dims
    (effect/cost/trigger): number of matching clusters not yet revealed."""
    used_dims: set[str] = set()
    used_values_per_dim: dict[str, set[str]] = {}
    for h in history or []:
        if h.get("kind") == "hint":
            d = h.get("hint_dim") or ""
            used_dims.add(d)
            used_values_per_dim.setdefault(d, set()).add(h.get("hint_value") or "")
    out: dict[str, int] = {}
    for dim, _ in HINT_DIMS:
        if dim in REPEATABLE_HINT_DIMS:
            matches = [c for c in _cluster_list_for_dim(dim) if _yp.card_in_cluster(card, c)]
            if not matches:
                # Card has no matching cluster — single "없음" payload only.
                out[dim] = 0 if dim in used_dims else 1
            else:
                used_vals = used_values_per_dim.get(dim, set())
                out[dim] = sum(1 for c in matches
                               if _short_cluster_label(_yp.CLUSTER_LABELS[c]) not in used_vals)
        else:
            out[dim] = 0 if dim in used_dims else 1
    return out


def resolve_hint(card, dim: str, history: list | None = None) -> str:
    """Return the human-readable string the hint UI shows for `dim` against
    the secret card. ST cards return '없음' for monster-only dims. Cluster-
    based hints (effect / cost / trigger) pick ONE random matching cluster
    label NOT already revealed earlier in this game's `history`."""
    import random
    ft = card.frame_type or ""
    is_monster = ft != "" and ft not in {"spell", "trap"}
    history = history or []

    if dim == "frame":
        return _frame_label(card)
    if dim == "attribute":
        if not is_monster:
            return "없음"
        return ATTR_LABELS.get(card.attribute or "", card.attribute or "없음")
    if dim == "race":
        if not is_monster:
            return "없음"
        return RACE_LABELS.get(card.race or "", card.race or "없음")
    if dim == "level":
        v = _effective_level(card)
        return "없음" if v is None else str(v)
    if dim == "atk":
        if not is_monster:
            return "없음"
        if card.atk is None or card.atk < 0:
            return "? (수치 없음)"
        return str(card.atk)
    if dim == "def":
        if not is_monster:
            return "없음"
        if ft == "link":
            return "없음 (링크 몬스터)"
        if card.def_value is None or card.def_value < 0:
            return "? (수치 없음)"
        return str(card.def_value)
    if dim in REPEATABLE_HINT_DIMS:
        matches = [c for c in _cluster_list_for_dim(dim) if _yp.card_in_cluster(card, c)]
        if not matches:
            return {
                "effect":  "분류된 효과 없음",
                "cost":    "특수한 발동 비용 없음",
                "trigger": "특수한 발동 시점 없음",
            }[dim]
        # Filter out cluster labels already revealed earlier in this game.
        already = {h.get("hint_value") for h in history
                   if h.get("kind") == "hint" and h.get("hint_dim") == dim}
        remaining_labels = [
            _short_cluster_label(_yp.CLUSTER_LABELS[c]) for c in matches
            if _short_cluster_label(_yp.CLUSTER_LABELS[c]) not in already
        ]
        if not remaining_labels:
            raise ValueError("no more clusters to reveal for this dim")
        return random.choice(remaining_labels)
    raise ValueError(f"unknown hint dim: {dim}")


# ─────────────── wrong-guess comparison ───────────────

def _frame_label(card) -> str:
    ft = card.frame_type or ""
    if ft == "spell":
        rc = card.race or ""
        if rc in SPELL_KIND_LABELS:
            return SPELL_KIND_LABELS[rc]
        return "마법 카드"
    if ft == "trap":
        rc = card.race or ""
        if rc in TRAP_KIND_LABELS:
            return TRAP_KIND_LABELS[rc]
        return "함정 카드"
    base = ft.replace("_pendulum", "")
    label = FRAME_TYPE_LABELS.get(base, base)
    if "pendulum" in ft and base != "pendulum":
        return f"펜듈럼 / {label}"
    return label


def build_guess_comparison(secret, guess) -> list[dict]:
    """For wrong-guess feedback. Returns a list of {label, guess, match}
    rows showing which dimensions the guess shares with the secret card.
    Skips effect-cluster comparisons (too noisy — user explicitly
    excluded those)."""
    rows: list[dict] = []
    s_ft = secret.frame_type or ""
    g_ft = guess.frame_type or ""

    # 유형 — always shown. Match if both share base frame (collapsing
    # pendulum variants). For spells/traps, sub-kind via race must also
    # match for a "full" match.
    s_label = _frame_label(secret)
    g_label = _frame_label(guess)
    rows.append({"label": "유형", "guess": g_label, "match": s_label == g_label})

    # 테마 — intersection of archseries. Show shared archetype names if
    # any, else just ✗ / ✓ based on whether at least one is shared.
    s_archs = set(secret.yugipedia_archseries or [])
    g_archs = set(guess.yugipedia_archseries or [])
    shared = s_archs & g_archs
    if g_archs:
        if shared:
            labels = [_archetype_label(a) for a in shared]
            rows.append({"label": "테마", "guess": ", ".join(labels), "match": True})
        else:
            g_labels = [_archetype_label(a) for a in g_archs]
            rows.append({"label": "테마", "guess": ", ".join(g_labels), "match": False})

    monster_dims = s_ft not in {"spell", "trap"} and g_ft not in {"spell", "trap"}
    if monster_dims:
        # 속성
        rows.append({
            "label": "속성",
            "guess": ATTR_LABELS.get(guess.attribute or "", guess.attribute or "-"),
            "match": (secret.attribute or "") == (guess.attribute or ""),
        })
        # 종족
        rows.append({
            "label": "종족",
            "guess": RACE_LABELS.get(guess.race or "", guess.race or "-"),
            "match": (secret.race or "") == (guess.race or ""),
        })
        # 레벨/랭크/링크 — unified axis via _effective_level
        g_lvl = _effective_level(guess)
        s_lvl = _effective_level(secret)
        if g_lvl is not None:
            rows.append({"label": "레벨/랭크/링크", "guess": g_lvl, "match": g_lvl == s_lvl})
        # 공격력
        if guess.atk is not None and guess.atk >= 0:
            rows.append({"label": "공격력", "guess": guess.atk, "match": guess.atk == (secret.atk if secret.atk is not None else -99)})
        # 수비력 — link monsters have no DEF
        if guess.def_value is not None and guess.def_value >= 0 and g_ft != "link":
            rows.append({"label": "수비력", "guess": guess.def_value, "match": guess.def_value == (secret.def_value if secret.def_value is not None else -99)})

    return rows


# ─────────────── label shortening ───────────────

def _short_cluster_label(full: str) -> str:
    """Strip the question framing from a cluster label so it reads as a
    bare verb phrase. The CLUSTER_LABELS source strings end variably with
    '효과를 가진 카드인가요?', ' 카드인가요?', '인가요?' etc. — unify them
    all to '~하는' form for use in multiselect items and joined
    multi-question text."""
    s = full
    # Strip "효과를 가진 카드인가요?" first so trailing "효과" doesn't survive.
    for suffix in ("효과를 가진 카드인가요?", " 효과를 가진 카드인가요?",
                   " 카드인가요?", "카드인가요?", "인가요?"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
            break
    return s.strip()


# ─────────────── archetype helpers ───────────────

# Manual overrides for archetype display labels. Yugipedia tracks
# parent/child archetypes (HERO ⊃ Elemental HERO / Destiny HERO / ...),
# but YGOPRODeck only knows the deepest leaf so its Korean labels are
# misleading at the parent level. Override map wins over derived data.
_ARCHETYPE_LABEL_OVERRIDES: dict[str, str] = {
    "HERO":           "히어로",
    "Elemental HERO": "엘리멘틀 히어로",
    "Destiny HERO":   "데스티니 히어로",
    "Evil HERO":      "이블 히어로",
    "Masked HERO":    "마스크드 히어로",
    "Vision HERO":    "비전 히어로",
    "Xtra HERO":      "엑스트라 히어로",
    "Ice Barrier":    "빙결계",
    "White Forest":   "하얀 숲",
    "P.U.N.K.":       "P.U.N.K.",
    "Prophecy":       "마도",
    "D/D":            "DD",
    "D/D/D":          "DDD",
    "Gimmick Puppet": "기믹 퍼핏",
    "Magician":       "마술사",
    "Neos":           "네오스",
    "Maliss":         "M∀LICE",
    "Charmer":        "령사",
    "Blue-Eyes":      "푸른 눈의 백룡",
    "Red-Eyes":       "붉은 눈의 흑룡",
    "Number":         "넘버즈",
    "K9":             "K9",
    "Sky Striker":    "섬도희",
    "Blackwing":      "BF",
    "Crystal":        "보옥수",
    "Dark Magician (archetype)":      "블랙 매지션",
    "Horus":          "호루스",
    "Ra (series)":    "라의 익신룡",
    "The Phantom Knights": "팬텀 나이츠",
    "Egyptian God":   "삼환신",
    "Traptrix":       "충혹마",
    "Radiant Typhoon": "현람",
    "Code Talker (archetype)": "코드 토커",
    "Exchange of the Spirit (series)": "현세와 명계의 역전",
    "Sacred Beast":           "삼환마",
    "Sacred Beast (archetype)": "삼환마",
    "Artifact":       "아티팩트",
    "Fur Hire":       "공아단",
    "Dragon Ruler":   "정룡",
    "Phantom Beast":  "환상수",
    "Danger!":        "미계역",
    "Floowandereeze": "후완다리즈",
    "Goblin Biker":   "고블린라이더",
    "Raidraptor":     "RR",
    "Thunder Dragon (archetype)": "썬더 드래곤",
    "A-to-Z":         "ABC",
    "Abyss Actor":    "마계극단",
    "Nouvelles":      "누밸즈",
    "Clear Wing":     "클리어윙",
    "Mayakashi":      "마요괴",
    "Deep Sea":       "심해",
    "Drytron":        "드라이트론",
    "P (series)":     ":P",
    "Tachyon":        "타키온",
    "Gearfried":      "기어프리드",
    "Millennium":     "천년",
    "Generaider":     "제너레이드",
    "Red Dragon Archfiend (archetype)": "레드 데몬",
    "Dream Mirror":   "몽마경",
    "Adventurer":     "용사",
    "Three Musketeers of Face Cards": "트럼프의 삼총사",
    "Voiceless Voice": "순성",
    "Aesir":          "극신",
    "Meklord Emperor": "기황",
    "Yubel (archetype)": "유벨",
    "The Agent":      "대행자",
    "Wicked God":     "삼사신",
    "Topologic":      "토폴로직",
    "Visas":          "비서스",
    "Ancient Warriors": "전황",
    "Phantasm":       "환마",
    "Plunder Patroll": "플런드롤",
    "Borrel":         "바렐",
    "Burning Abyss":  "피안",
    # Dante (단테) is part of 피안 — also see alias group
    "Chimeratech":    "키메라테크",
    "Nephthys":       "네프티스",
    "Train":          "열차",
    "Yo-kai Girl":    "요괴소녀",
    "Gold Pride":     "GP",
    "Lyrilusc":       "LL",
    "\"C\"":          "G",
    "Dog Marron":     "미아견 마론",
    "Ragnaraika":     "뇌화",
    "Morphtronic":    "디포머",
    "Amazoness":      "아마조네스",
    "Dark World":     "암흑계",
    "Number C":       "카오스 넘버즈",
    "Fire Fist":      "염성",
    "Tellarknight":   "테라나이트",
    "Gravekeeper's":  "묘지기",
    "Heroic":         "히로익",
    "Mermail":        "머메일",
    "Melodious":      "환주",
    "Crystron":       "크리스트론",
    "Rank-Up-Magic":  "RUM",
    "Kozmo":          "Kozmo",
    "Alien":          "에일리언",
    "Yang Zing":      "룡성",
    "Trap Hole (archetype)": "함정 속으로",
    "Evil Eye":       "주안",
    "Void":           "연옥",
    "Zefra":          "세피라",
    "Flower Cardian": "카디언",
    "Ghoti":          "고티스",
    "Tistina":        "티스티나",
    "Rokket":         "로켓",
    "Battlewasp":     "B·F",
    "Cyber Girl":     "사이버 걸",
    "ZW -":           "ZW",
    "Utopia (archetype)": "유토피아",
    "Familiar-Possessed": "빙의장착",
    "Infernoble Knight": "불꽃성기사",
    "Fossil":         "화석",
    "Fairy Tail":     "페어리테일",
    "Mirror Trap (series)": "방어막",
    "Deskbot":        "분보그",
    "Earthbound Immortal": "지박신",
    "Earthbound Servant":  "지박계례",
    "Therion":        "세리온즈",
    "Enneacraft":     "에니아크래프트",
    "Gaia The Fierce Knight (archetype)": "암흑 기사 가이아",
    # Batch namuwiki-confirmed Korean labels for previously EN-only entries.
    "Heraldic Beast":   "문장수",
    "Hazy Flame":       "헤이즈비스트",
    "Cybernetic":       "사이버네틱",
    "Forbidden One":    "봉인된 자",
    "Lightray":         "라이트레이",
    "Goyo":             "고요우",
    "Element":          "엘리멘트",
    "Djinn of Rituals": "의식마인",
    "Twilightsworn":    "트와일라이트로드",
    "Fire King Avatar": "염왕수",
    "PSY-Frame":        "PSY프레임",
    "PSY-Framegear":    "PSY프레임기어",
    "Geargiano (archetype)": "기아기아노",
    "Backup":           "백업",
    "Codebreaker":      "코드브레이커",
    "Nitro":            "니트로",
    "Sky Scourge":      "천마신",
    "Empower":          "엠파워",
    "Outer Entity":     "외신",
    "Old Entity":       "고신",
    "Elder Entity":     "구신",
    "Skyscraper (archetype)": "마천루",
    "Roland (archetype)":     "롤랑",
    "Sylvan":           "삼라",
    "Dante":            "단테",
    "Virtual World Gate": "전뇌계문",
    "Aqua Jet (archetype)": "아쿠아 제트",
    "Mist Valley":      "안개 골짜기",
    "Allure Queen":     "얼루어 퀸",
    "Fire Formation":   "염무",
    "Symphonic Warrior": "사운드 워리어",
    "Tenpai Dragon":    "천배룡",
    "Phantasm Spiral":  "환황룡",
    "Clown Crew":       "크라운 클랜",
    "Dark Contract":    "계약서",
    "Black Luster Soldier (archetype)": "카오스 솔저",
    "Solemn":           "신의 심판",
    "Magnet Warrior Sigma": "마그넷 워리어 Σ",
    "Patissciel":       "파티시엘",
    "Gem-Knight Lady":  "젬나이트 레이디",
    "Sasuke Samurai (series)": "사스케 사무라이",
    "Abyss Script":     "마계대본",
    "Neo Space (archetype)": "네오스페이스",
    "Machine Angel":    "기계천사",
    "Super Quantum":    "초량사",
    "Skilled Magician": "숙련된 마도사",
    "White Aura":       "화이트 아우라",
    "Mokey Mokey (archetype)": "모케모케",
    "Buster Blader (archetype)": "버스터 블레이더",
    "Ultimate Crystal": "궁극보옥신",
    "Attribute Spirit": "정령",
    "Robo":             "레어메탈",
    "Empower":          "마장전사",
    "Aether":           "마장전사",
    "Cyber Angel":      "사이버 엔젤",
    "Seventh":          "세븐스",
    "/Assault Mode":    "버스터 모드",
    # Batch 3 — real archetypes translated
    "Virus":            "바이러스",
    "Necrovalley (archetype)": "네크로밸리",
    "Iron Chain":       "사슬",
    "Ultimate Insect":  "얼티미트 인섹트",
    "Dark Lucius":      "다크 루시어스",
    "Mystic Swordsman": "미스틱 스워드맨",
    "Shark Drake":      "샤크 드레이크",
    "Cipher Dragon":    "사이퍼 드래곤",
    "Insect Queen (archetype)": "곤충 여왕",
    "Labyrinth Wall (archetype)": "미궁",
    "Numerounius":      "누메로니어스",
    "Palladium":        "수호신관",
    "Magna Warrior":    "자석의 전사",
    "Battlin' Boxing":  "BK",
    "SPYRAL MISSION":   "SPYRAL",  # subsumed below too
    "SPYRAL GEAR":      "SPYRAL",
    "Majestic Mech":    "라이트닝 기어",
    "Artorigus":        "성기사",  # actually Noble Knight, alias below
    "Skull Guardian (archetype)": "로가디언",
    "Shiranui Spectralsword (archetype)": "요도－시라누이",
    "Sea Stealth":      "씨 스텔스",
    "Fortress Whale (archetype)": "대요새 고래",
    "Galaxy-Eyes Tachyon Dragon": "갤럭시아이즈 타키온 드래곤",
    "Armored Xyz (archetype)": "아머드 엑시즈",
    "Eldlich":          "엘드리치",
    "Temple of the Kings (series)": "왕가의 신전",
    "Forbidden (archetype)": "금지된",
    "Dominus":          "도미나스",
    "Draconia":         "드라코니아",
    "Star (series)":    "천&지",
    "Gate Guardian (archetype)": "게이트 가디언",
    "Risebell":       "라이즈벨트",
    "Toad":           "깨구리",
}

# (Puppet — Yugipedia non-existent in Korean YGO; only Gimmick Puppet is real)

# Yugipedia archetypes to hide entirely from the 카드군 picker — meta
# categories ("Number (Spell/Trap)", "Recolored counterpart") or generic
# noise that doesn't read as a real card series to players.
_ARCHETYPE_REMOVE: set[str] = {
    "Synchro (archetype)",
    "Heart",
    "Puppet",
    "Duel winner",  # exposed as a dedicated "특수 승리 카드?" question instead
    "Gigo",         # 가가기고/기고바이트 부속 — 카드 7장에 불과, 진짜 시리즈 X
    "Field Searcher",  # 필드 마법 서치 메커닉 태그
    "Phantom Knights",  # 이름에 "Phantom" 든 카드 어휘 태그 — 진짜 archetype은 "The Phantom Knights"
    "Greed (series)",            # 욕망 항아리 등 — 진짜 시리즈 아님
    "Shining Sarcophagus (series)",  # 빛나는 관 — 진짜 시리즈 아님
    "Signer Dragon",   # 시그너 드래곤 — 시리즈 X (5D's anime grouping)
    "Cosmic Synchro Monster",  # 코즈믹 싱크로 메커닉 태그, 시리즈 X
    "Signature move",  # 애니 시그니처 기술 카드 메타
    "From the Underworld",  # 데스가이드 류 4장
    "Mythical Dragon",      # Yugipedia 신화 드래곤 컨셉 그룹, 정식 시리즈 X
    "Synchro Dragon",       # 싱크로 드래곤 메타 태그
    "Dark counterpart",     # "Dark X" 카드 메타 태그
    "Dark Magician Girl (archetype)",  # 블랙 매지션 걸 alt-arts — 테마 X
    "Ultimate Magical",     # 블매 융합 6장 — 통일 테마명 없음
    "Wingman",              # 엘히어로 윙맨 류 5장 — 테마 X
    "Swamp",                # 늪지대 4장 — 테마 X
    "Recolored counterpart", # Yugipedia 메타 (재컬러 카드 100장)
    "King",                  # "X왕" 어둠 야수족 비공식 11장
    "Itsu",                  # 아이츠/도이츠/코이츠 4장
    "Gun Dragon",            # 속사포 드래곤 류 카이바 8장
    "Inpachi",
    "Light and Darkness Dragon (series)",  # 다크엔드/라이트엔드 7장
    "Power Tool",                          # 파워 툴 드래곤 3장
    "Four Dimensional Dragons",            # Arc-V 사차원 드래곤 anime 그룹
    "Warrior Lady",                        # 여전사 3장
    "Grepher",                             # 그레퍼 류 5장 — 테마 X
    "Ecclesia (archetype)",                # 에클레시아는 각 카드가 다른 테마 소속
    "Yokai (series)",                      # 마요괴 무관 잡 요괴 11장
    "Duel Dragon",
    "Name-Inverted Spiritualist",
    "Inca",
    "Star God",
    "Winged Kuriboh (archetype)",
    "Fusion (archetype)",   # 퓨전 — 융합 카드 어휘 태그 (메타)
    "Trap Monster",         # 함정 몬스터 — 메커닉 분류
    "Cyclone (series)",     # 싸이크론 이름 카드 어휘 태그
    "Change",               # 체인/체인저/변화 어휘 태그
    "Zexal",
    "Zombie counterpart",
    "Possessed",            # 빙의각성 — 정령매사 + 가가기고 합성, 진정한 시리즈 X
    "Fan-Made Cards",
    "Counter",
    "Konami Arcade Games",
    "Counter Fairy",        # 카운터천사 13장 — 메커닉 분류
    "Attribute Booster",    # 속성별 ATK 부스트 메타 24장
    "Fairy Tale (anime)",   # anime-only 동화 카드 8장
    "Heraldry",             # 메달리온 11장
    "Treasure Cards",       # 드로우 패 메타 11장
    "Mask",                 # 가면 어휘 그룹 12장
    "Hand (archetype)",     # 파이어/아이스 핸드 메커닉 7장
    "Attribute Knight",     # 속성 기사 어휘 6장
    "Gem Dragon",           # 보석 드래곤 어휘 6장
    "Sparrow Family",       # 7장 anime
    "Protective Seal",      # 7장 메타
    "Attraction",           # 7장 lexical
    "Mireniamu",            # 8장 lexical
    "Zera",                 # 9장 lexical
    "Skull Archfiend",      # 9장 lexical
    "Darkness (archetype)", # 10장 lexical
    "Legendary Planet",     # 10장 lexical
    "Attribute Summoner",   # 7장 mechanic
    "Designator",           # 6장 (지명자)
    "PaniK's monsters",
    "Recipe",
    "Xyz Dragon",
    "Dragon Ninja",
    "The Dragon of",
    "25th Anniversary Monsters",
    "Paladins of Dragons",
    "Ritual Art",
    "Summon Restriction",
    "Ancient Treasure",
    "Evolution Pill",
    "Piece Golem",
    "Plant Princess",
    "Token Celebration",
    "Sealing Ceremony",
    "Doom King",
    "Divine Dragon",
    "Fusion Dragon",
    "Attribute Reptile",
    "Ghost (anime)",
    "Bumper",
    "Number F",
    "Utopic Future",
    "Mythyrian Numbers",
    # Batch 3 — lexical/meta sweep
    "Reactor", "Hunder", "Chthonian", "Monk", "Snow", "Felgrand", "Motor",
    "Vanity's", "Sarcophagus", "Rites", "Aquamirror", "Entity", "Daedalus",
    "Gottoms", "Onomat", "Smile", "ZS -", "Bugroth", "Teleport (archetype)",
    "Bonding", "Cataclysmic", "Corn", "Rider", "Coach", "Crashbug", "Effigy",
    "Favorite", "Moth", "Swarm of", "Test", "Ape", "Baboon of the Forest",
    "Cular", "Potan", "Bombardment", "Oni", "Burning Skull", "Thousand Hands",
    "Freed", "DNA", "Force", "Foolish", "Sea Stealth", "Indestructible Insects",
    "Helios", "Laundsallyn", "Captain", "Drain", "Pendulumgraph", "Raider's",
    "Rainbow Bridge (archetype)", "Sphere", "Creator", "Legendary Dragon",
    "Hex-Sealed Fusion", "Uniform Nomenclature", "Tiki", "Turbo", "WAKE CUP!",
    "Hunting Scout of the Deep Forest", "Blue Tears", "Inmato (archetype)",
    "Supercolossal", "Kangaroo", "Emblema", "Cosmic", "Mischief", "Dragon Mech",
    "Stealth Kragen", "Veda", "White Night", "Doodlebook",
    "Mystical Spirit of the Forest", "Schoolwork", "Spiritual Earth Art",
    "Spiritual Fire Art", "Spiritual Water Art", "Spiritual Wind Art",
    "Gearspring", "End of the World (archetype)", "Rank-Down-Magic",
    "Harpie Lady Sisters (archetype)", "Rebellion (archetype)", "Zubaba",
    "Tribute (archetype)", "Tiki", "Sphere",
    "Scrap-Iron", "Starliege", "Super Quantal Mech Beast", "Vehicroid",
    "Bumpkin", "Bumper", "Skilled Magician",
    "Salamandra (archetype)",
    "Black (series)",
    "Circular (series)",
    "Inpachi (series)",
    "Old Entity",
    "Insect Queen (archetype)",
    "Boot-Up",
    "Nitro",
    "Dark Lucius",
    "Martial Art Spirit",
    "Doll Monster",
    "Robo",
    "Rokket",
    "Roland (archetype)",
    "Maju",
    "Madoor",
    "Labyrinth Wall (archetype)",
    "Barian's",
    "Backup",
    "Blaze Accelerator (archetype)",
    "Iron Chain",
    "Sasuke Samurai (series)",
    "Broken World",
    "Shark Drake",
    "Starving Venom",
    "Aquaactress",
    "Aquarium",
    "Anotherverse",
    "Abyss-",
    "Book of",
    "Wedju",
    "Eyes Restrict",
    "Exodd",
    "Spirit Message",
    "Koala",
    "Chimeratech",
    "Theorealize (archetype)",
    "Fleur",
    "White",
    "Stygian",

    "Keeper",
    "Legendary Knight",
    "Summoner",
    "Umi (series)",
    "Unicorn",
    "Xyz (archetype)",
    "Pendulum (archetype)",
    "Counter (archetype)",
    "Type Booster",
    "Match winner",
    "Empower",
    "Raigeki (series)",
    "Royal",
    "Infestation",
    "Overlay (series)",
    "Empowered Warrior",
    "Barrier Statue",
    "With Chain",
    "Doriado (series)",
    "Huge Revolution (series)",
    "Timaeus (series)",
    "Aged counterpart",
    "Curse of Dragon (series)",
    "Dark Blade (series)",
    "Dimension (series)",
    "Machine King (series)",
    "King Rex (series)",
    "The Sanctuary in the Sky (series)",
    "Man-Eater Bug (series)",
    "Thousand Needles (series)",
    "G.O.D. (series)",
    "Call of the Haunted (series)",
    "Ryu-Kishin (series)",
    "Flint (series)",
}

# Treat several Yugipedia archetypes as one for the picker. Picking the
# canonical key matches cards tagged with ANY of the aliases. The
# subsumed aliases are hidden from the menu (no duplicate entry).
_ARCHETYPE_ALIASES: dict[str, list[str]] = {
    "Evil★Twin": ["Evil★Twin", "Live☆Twin", "Lil-la", "Ki-sikil"],
    "Branded":   ["Branded", "Albaz Dragon"],
    "Number":    ["Number", "Number (Spell/Trap archetype)", "Number 10X", "Evolving Numbers", "Mythyrian Numbers", "Number F", "Utopic Future", "Barian Number", "Number 99", "Number S"],
    # Number C / Number C10X / Number C39 share "Number" tag on their cards,
    # so Number pick naturally includes them. Keep them as standalone entries.
    "Number C":  ["Number C", "Number C10X", "Number C39"],
    "Tellarknight": ["Tellarknight", "Stellarknight"],
    "Monarch":      ["Monarch", "Monarch (Spell/Trap archetype)"],
    "@Ignister":    ["@Ignister", "A.I."],
    "Heroic":       ["Heroic", "Heroic Challenger", "Heroic Champion"],
    "Superheavy Samurai": ["Superheavy Samurai", "Superheavy Samurai Soul"],
    "Genex":        ["Genex", "R-Genex"],
    "Cyberdark":    ["Cyberdark", "Cyberdark (Spell/Trap archetype)"],
    "Armored Xyz (archetype)": ["Armored Xyz (archetype)", "Armored Xyz"],
    "Ninja":        ["Ninja", "Armor Ninja"],
    "Blackwing":    ["Blackwing", "Assault Blackwing"],
    "Infernoble Knight": ["Infernoble Knight", "Infernoble Arms"],
    "Melodious":    ["Melodious", "Melodious Maestra"],
    "Gladiator Beast": ["Gladiator Beast", "Gladiator", "Dueling Equipment"],
    "Numeron":      ["Numeron", "Numeron Gate", "Numerounius"],
    # SPYRAL family
    "SPYRAL":       ["SPYRAL", "SPYRAL MISSION", "SPYRAL GEAR"],
    # Labrynth family
    "Labrynth":     ["Labrynth", "Welcome Labrynth (archetype)"],
    # Battlin' Boxer family
    "Battlin' Boxer": ["Battlin' Boxer", "Battlin' Boxing"],
    # Galaxy-Eyes 시리즈 통합
    "Galaxy-Eyes":  ["Galaxy-Eyes", "Galaxy-Eyes Tachyon Dragon", "Tachyon"],
    # Noble Knight family
    "Noble Knight": ["Noble Knight", "Artorigus"],
    # Cipher
    "Cipher":       ["Cipher", "Cipher Dragon"],
    "Eldlich":      ["Eldlich", "Eldlixir", "Golden Land"],
    "X-Saber":      ["X-Saber", "XX-Saber"],
    "Tenpai Dragon": ["Tenpai Dragon", "Sangen"],
    "Temple of the Kings (series)": ["Temple of the Kings (series)", "Apophis", "Serket"],
    # Duplicate-label merges
    "Cyber":         ["Cyber", "Cyber Dragon (archetype)"],
    "-Eyes Dragon":  ["-Eyes Dragon", "Pendulum Dragon", "Odd-Eyes"],
    "Prophecy":      ["Prophecy", "Spellbook"],
    "Rose":          ["Rose", "Rose Dragon"],
    "Galaxy":        ["Galaxy", "Galaxy-Eyes", "Galaxy-Eyes Tachyon Dragon", "Tachyon"],
    "Goblin":        ["Goblin", "Goblin Biker"],
    "Phantom Beast": ["Phantom Beast", "Chimera"],
    "Hole":          ["Hole", "Trap Hole (archetype)"],
    "Frightfur":     ["Frightfur", "Edge Imp"],
    "Magnet":        ["Magnet", "Magnet Warrior", "Magnet Warrior Sigma", "Magna Warrior"],
    "Heraldic":      ["Heraldic", "Heraldic Beast"],
    "Hazy":          ["Hazy", "Hazy Flame"],
    "Neos":          ["Neos", "Neo-Spacian", "Neo Space (archetype)"],
    "Geargia":       ["Geargia", "Geargiano (archetype)"],
    "Sylvan":        ["Sylvan", "Sprout"],
    "Sunavalon":     ["Sunavalon", "Sunvine", "Sunseed"],
    "Subterror":     ["Subterror", "Subterror Behemoth"],
    "Qli":           ["Qli", "Apoqliphort"],
    "Shiranui":      ["Shiranui", "Shiranui Spectralsword (archetype)"],
    "Virtual World": ["Virtual World", "Virtual World Gate"],
    "Earthbound":    ["Earthbound", "Earthbound Servant"],
    "Super Quant":   ["Super Quant", "Super Quantum"],
    "Burning Abyss": ["Burning Abyss", "Dante"],
    "Horus":         ["Horus", "Horus the Black Flame Dragon"],
    "Charmer":      ["Charmer", "Cataclysmic Charmer", "Spiritual Art"],
    "Gaia The Fierce Knight (archetype)": ["Gaia The Fierce Knight (archetype)", "Gaia the Dragon Champion (archetype)", "Gaia Knight"],
    # Number S (시리얼 넘버즈) / Barian Number are subset of Number
    # — picking 넘버즈 catches them naturally via "Number" tag on cards.
    "Ritual Beast": ["Ritual Beast", "Ritual Beast Tamer", "Ritual Beast Ulti", "Spiritual Beast"],
    "Sacred Beast": ["Sacred Beast", "Sacred Beast (archetype)"],
    "Sky Striker":  ["Sky Striker", "Sky Striker Ace"],
    "Crystal":      ["Crystal", "Crystal Beast", "Advanced Crystal Beast"],
    "Gem-":         ["Gem-", "Gem-Knight"],
    "Predaplant":   ["Predaplant", "Predap"],
    "Ancient Gear": ["Ancient Gear", "Ancient Gear Golem (archetype)"],
    "Aesir":        ["Aesir", "Nordic", "Nordic Relic", "Nordic Beast", "Nordic Alfar", "Nordic Ascendant"],
    "Meklord":      ["Meklord", "Meklord Emperor", "Meklord Army", "Meklord Astro"],
    "Ra (series)":  ["Ra (series)", "The Winged Dragon of Ra (archetype)"],
    "Unchained":    ["Unchained", "Unchained Soul"],
    "Invoked":      ["Invoked", "Aleister"],
    "Diabell":      ["Diabell", "Diabellstar"],
    "-Eyes Dragon": ["-Eyes Dragon", "Pendulum Dragon", "Odd-Eyes"],
    "Evol":         ["Evol", "Evolzar", "Evoltile", "Evolsaur", "Evo-"],
    "Millennium":   ["Millennium", "Sennen"],
    "Solfachord":   ["Solfachord", "GranSolfachord"],
    "Six Samurai":  ["Six Samurai", "Legendary Six Samurai", "Secret Six Samurai", "Shien"],
    "Blue-Eyes":    ["Blue-Eyes", "With Eyes of Blue"],
    "Supreme King": ["Supreme King", "Supreme King Gate", "Supreme King Dragon"],
}
_ARCHETYPE_ALIAS_SUBSUMED: set[str] = {
    a for canon, lst in _ARCHETYPE_ALIASES.items() for a in lst if a != canon
}

# Brand-new archseries discovered on Yugipedia for which there's no
# official Korean name yet. Hidden from the 카드군 menu (treated like
# REMOVE) until a Korean translation lands. Run
# `python manage.py review_pending_archseries` after a DB refresh to
# see which entries now have Korean-named cards and can be promoted.
_ARCHETYPE_PENDING_KOREAN: set[str] = {
    "Blitzclique",                         # 2026-06 신규
    "Dark Tuner (archetype)",              # 2026-06 신규 — 다크 튜너 정식 명칭 미정
    "Ritual of Light and Darkness (series)",  # 2026-06 신규 — 카오스 솔저 의식 확장
    "GMX",                                 # 2026-06 신규 — YGOPRODeck-only 태그
    "Dark Time Wizard",                    # 2026-06 신규
    "Familiar-Possessed",                  # 2026-06 신규 — 정령매사 변종?
    "White Knight",                        # 2026-06 신규
}
_ARCHETYPE_REMOVE |= _ARCHETYPE_PENDING_KOREAN


def _build_archetype_en_to_kr() -> dict[str, str]:
    """Seed EN→KR archetype map from existing (Card.archetype, Card.korean_archetype) pairs.
    Cached at module level — call _reset_archetype_cache() to refresh."""
    from collections import Counter
    from card.models import Card
    pairs: dict[str, Counter] = {}
    for en, kr in Card.objects.exclude(archetype__isnull=True).exclude(archetype="").exclude(korean_archetype__isnull=True).exclude(korean_archetype="").values_list("archetype", "korean_archetype"):
        pairs.setdefault(en, Counter())[kr] += 1
    base = {en: c.most_common(1)[0][0].strip() for en, c in pairs.items() if c.most_common(1)[0][0].strip()}
    base.update(_ARCHETYPE_LABEL_OVERRIDES)
    return base

_ARCH_EN_TO_KR: dict[str, str] | None = None

_LABEL_STRIP_CHARS = " -－＝·"  # dashes / spaces / middots — strip from both ends

def _archetype_label(en: str) -> str:
    """Display label for a Yugipedia Archseries name. Override map keys
    are checked verbatim FIRST (so 'Code Talker (archetype)' resolves
    before the cleaned 'Code Talker' that YGOPRODeck maps to '코드').
    Leading/trailing dash-like characters are stripped — YGOPRODeck
    Korean labels often carry a trailing '－' that breaks the bare
    series name (e.g. 'BF－' → 'BF', '카디언－' → '카디언')."""
    global _ARCH_EN_TO_KR
    if _ARCH_EN_TO_KR is None:
        _ARCH_EN_TO_KR = _build_archetype_en_to_kr()
    raw = (
        _ARCH_EN_TO_KR.get(en)
        or _ARCH_EN_TO_KR.get(en.replace(" (archetype)", "").replace(" (series)", "").strip())
        or en.replace(" (archetype)", "").replace(" (series)", "").strip()
    )
    return raw.strip(_LABEL_STRIP_CHARS)


def _archetype_items(difficulty: str = "중급", exclude_st: bool = False) -> list[dict]:
    """Build {q_value, label} list for the 카드군 menu group from cards
    currently in the solo 딱무고개 pool. Sorted by frequency, drops
    singletons (always-yes-for-one-card is no fun)."""
    from collections import Counter
    from card.models import Card
    from .twenty_views import _pool_card_ids
    pool_ids = set(_pool_card_ids(difficulty, exclude_st=exclude_st))
    if not pool_ids:
        return []
    counter: Counter = Counter()
    for archs in Card.objects.filter(id__in=pool_ids).exclude(yugipedia_archseries=[]).values_list("yugipedia_archseries", flat=True):
        for a in archs:
            counter[a] += 1
    # No real archetype data yet (Yugipedia fetch incomplete) → return
    # empty so the menu builder hides the whole 카드군 group.
    if not counter:
        return []
    no_arch = Card.objects.filter(id__in=pool_ids, yugipedia_archseries=[]).count()
    items: list[dict] = []
    for en, n in counter.most_common():
        if n < 2:
            continue
        if en in _ARCHETYPE_REMOVE:
            continue
        if en in _ARCHETYPE_ALIAS_SUBSUMED:
            continue
        items.append({"q_value": en, "label": _archetype_label(en)})
    # Alphabetize by Korean label (가나다 → English fallback). 테마 없음
    # pinned to the top so it's easy to find regardless of count.
    items.sort(key=lambda x: x["label"])
    if no_arch >= 2:
        items.insert(0, {"q_value": "__NONE__", "label": "테마 없음"})
    return items


# ─────────────── menu builder (sent to client) ───────────────


def build_menu(difficulty: str = "중급", exclude_st: bool = False) -> list[dict]:
    """Returns the question menu shape the FE renders.

    Each group declares a `kind`:
      - "list":   `items` is a list of {q_type, q_value, label} buttons.
      - "number": freeform numeric input. The FE renders a number field +
                  three buttons (이상? / 일치? / 이하?) that send `q_value`
                  to `q_types[0]` (gte) / `q_types[1]` (lte) / `q_types[2]`
                  (eq). Static range metadata (`min`, `max`, `step`,
                  `placeholder`) is part of the group; the FE may override
                  `max` for groups whose range depends on game state (e.g.
                  레벨 cap shrinks once frame_type is confirmed).
    """
    # When exclude_st is on, the four card-kind branch questions (몬스터/
    # 마법/함정/마함) are all trivially answerable so we drop them — the
    # player chose the monsters-only mode.
    branch_items = (
        [] if exclude_st else [
            {"q_type": "is_monster", "q_value": "", "label": "몬스터 카드인가요?"},
            {"q_type": "frame_type", "q_value": "spell", "label": "마법 카드인가요?"},
            {"q_type": "frame_type", "q_value": "trap", "label": "함정 카드인가요?"},
            {"q_type": "is_spell_or_trap", "q_value": "", "label": "마법 / 함정 카드인가요?"},
        ]
    )
    return [
        {
            "group": "일반적인 질문",
            "kind": "list",
            "items": branch_items + [
                {"q_type": "tuner", "q_value": "", "label": "튜너 몬스터인가요?"},
                {"q_type": "extra_deck", "q_value": "", "label": "엑스트라 덱 카드인가요?"},
                {"q_type": "atk_eq_def", "q_value": "", "label": "공격력과 수비력이 같은가요?"},
                {"q_type": "has_level", "q_value": "", "label": "레벨이 있는 카드인가요?"},
                {"q_type": "tag_hand_trap", "q_value": "", "label": "패 트랩인가요?"},
                {"q_type": "special_win", "q_value": "", "label": "특수 승리 카드인가요?"},
            ],
        },
        {
            "group": "발동 비용",
            "kind": "list",
            "items": [
                {"q_type": f"yp_{c}", "q_value": "", "label": _yp.CLUSTER_LABELS[c]}
                for c in _yp.COST_CLUSTERS
            ],
        },
        {
            # Multiselect — many effect clusters, players often want to
            # bundle "destroys monster / banishes / negates effect" type
            # OR-questions into one budget unit. Single-cluster picks still
            # work (yp_in with a one-element list).
            "group": "효과",
            "kind": "multiselect",
            "multi_q_type": "yp_in",
            "items": [
                {"q_value": c, "label": _short_cluster_label(_yp.CLUSTER_LABELS[c])}
                for c in _yp.EFFECT_CLUSTERS
            ],
        },
        {
            "group": "발동 시점",
            "kind": "list",
            "items": [
                {"q_type": f"yp_{c}", "q_value": "", "label": _yp.CLUSTER_LABELS[c]}
                for c in _yp.TRIGGER_CLUSTERS
            ],
        },
        {
            "group": "유형",
            "kind": "list",
            "items": [
                *({"q_type": "frame_type", "q_value": k, "label": v}
                  for k, v in FRAME_TYPE_LABELS.items()),
                *([] if exclude_st else
                  ({"q_type": "spell_kind", "q_value": k, "label": v}
                   for k, v in SPELL_KIND_LABELS.items())),
                *([] if exclude_st else
                  ({"q_type": "trap_kind", "q_value": k, "label": v}
                   for k, v in TRAP_KIND_LABELS.items())),
            ],
        },
        {
            "group": "속성",
            "kind": "multiselect",
            "multi_q_type": "attribute_in",
            "items": [
                {"q_value": k, "label": v}
                for k, v in ATTR_LABELS.items()
            ],
        },
        {
            "group": "종족",
            "kind": "multiselect",
            "multi_q_type": "race_in",
            "items": [
                {"q_value": k, "label": v}
                for k, v in RACE_LABELS.items()
            ],
        },
        {
            "group": "레벨 / 랭크 / 링크",
            "kind": "number",
            "q_types": ["level_gte", "level_lte", "level_eq"],
            "min": 0, "max": 13, "step": 1, "placeholder": "0~13",
        },
        {
            "group": "공격력",
            "kind": "number",
            "q_types": ["atk_gte", "atk_lte", "atk_eq"],
            "min": 0, "max": 10000, "step": 100, "placeholder": "예: 2000",
        },
        {
            "group": "수비력",
            "kind": "number",
            "q_types": ["def_gte", "def_lte", "def_eq"],
            "min": 0, "max": 10000, "step": 100, "placeholder": "예: 2000",
        },
        # 카드군 group is omitted entirely when the pool has no real
        # archetype data (e.g. Yugipedia fetch hasn't completed) — showing
        # only "테마 없음" confuses players. _archetype_items returns
        # zero items in that case.
        *([{
            "group": "카드군",
            "kind": "multiselect",
            "multi_q_type": "archetype_in",
            "searchable": True,
            "items": _archetype_items(difficulty, exclude_st=exclude_st),
        }] if _archetype_items(difficulty, exclude_st=exclude_st) else []),
        {
            "group": "이름 길이",
            "kind": "number",
            "q_types": ["name_len_gte", "name_len_lte", "name_len_eq"],
            "min": 1, "max": 30, "step": 1, "placeholder": "예: 5 (띄어쓰기 제외)",
        },
        {
            "group": "이름 자음",
            "kind": "list",
            "items": [
                *({"q_type": "name_initial", "q_value": k, "label": k}
                  for k in _PLAIN_INITIALS),
                {"q_type": "name_has_alpha",   "q_value": "", "label": "영어"},
                {"q_type": "name_has_digit",   "q_value": "", "label": "숫자"},
                {"q_type": "name_has_special", "q_value": "", "label": "특수문자"},
            ],
        },
    ]


# ─────────────── scoring ───────────────

def score_for(used: int, ladder: Iterable[tuple[int, int]]) -> int:
    """Map question-count used → score using the tiered ladder (first
    threshold ≥ used wins). Returns 0 above the last threshold."""
    for threshold, pts in ladder:
        if used <= threshold:
            return pts
    return 0
