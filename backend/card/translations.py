"""Translations from YGOPRODeck English values to Korean."""

ATTRIBUTE_KR = {
    "DARK": "어둠",
    "LIGHT": "빛",
    "WATER": "물",
    "FIRE": "화염",
    "EARTH": "땅",
    "WIND": "바람",
    "DIVINE": "신",
}

# 종족 (몬스터)
MONSTER_RACE_KR = {
    "Aqua": "어류족",
    "Beast": "야수족",
    "Beast-Warrior": "야수전사족",
    "Cyberse": "사이버스족",
    "Dinosaur": "공룡족",
    "Divine-Beast": "환신야수족",
    "Dragon": "드래곤족",
    "Fairy": "천사족",
    "Fiend": "악마족",
    "Fish": "어류족",
    "Insect": "곤충족",
    "Machine": "기계족",
    "Plant": "식물족",
    "Psychic": "사이킥족",
    "Pyro": "염족",
    "Reptile": "파충류족",
    "Rock": "암석족",
    "Sea Serpent": "해룡족",
    "Spellcaster": "마법사족",
    "Thunder": "번개족",
    "Warrior": "전사족",
    "Winged Beast": "비행야수족",
    "Wyrm": "환룡족",
    "Zombie": "언데드족",
    "Creator-God": "창조신족",
    "Illusion": "환상마족",
}

# 마법/함정 종족 (race 필드가 마법/함정의 카테고리도 담음)
SPELL_TRAP_RACE_KR = {
    "Normal": "일반",
    "Field": "필드",
    "Equip": "장착",
    "Continuous": "지속",
    "Quick-Play": "속공",
    "Ritual": "의식",
    "Counter": "카운터",
}

# Frame type → 한국어 표시
FRAME_TYPE_KR = {
    "normal": "일반",
    "effect": "효과",
    "ritual": "의식",
    "fusion": "융합",
    "synchro": "싱크로",
    "xyz": "엑시즈",
    "pendulum": "펜듈럼",
    "normal_pendulum": "일반 펜듈럼",
    "effect_pendulum": "효과 펜듈럼",
    "ritual_pendulum": "의식 펜듈럼",
    "fusion_pendulum": "융합 펜듈럼",
    "synchro_pendulum": "싱크로 펜듈럼",
    "xyz_pendulum": "엑시즈 펜듈럼",
    "link": "링크",
    "spell": "마법",
    "trap": "함정",
    "token": "토큰",
    "skill": "스킬",
}

# 카드 타입 (전체 표기)
CARD_TYPE_KR = {
    "Effect Monster": "효과 몬스터",
    "Normal Monster": "일반 몬스터",
    "Normal Tuner Monster": "일반 튜너 몬스터",
    "Tuner Monster": "튜너 몬스터",
    "Flip Effect Monster": "리버스 효과 몬스터",
    "Flip Tuner Effect Monster": "리버스 튜너 효과 몬스터",
    "Spirit Monster": "스피릿 몬스터",
    "Union Effect Monster": "유니온 효과 몬스터",
    "Gemini Monster": "듀얼 몬스터",
    "Toon Monster": "툰 몬스터",
    "Pendulum Effect Monster": "펜듈럼 효과 몬스터",
    "Pendulum Normal Monster": "펜듈럼 일반 몬스터",
    "Pendulum Tuner Effect Monster": "펜듈럼 튜너 효과 몬스터",
    "Pendulum Effect Fusion Monster": "펜듈럼 효과 융합 몬스터",
    "Ritual Monster": "의식 몬스터",
    "Ritual Effect Monster": "의식 효과 몬스터",
    "Pendulum Effect Ritual Monster": "펜듈럼 효과 의식 몬스터",
    "Fusion Monster": "융합 몬스터",
    "Synchro Monster": "싱크로 몬스터",
    "Synchro Tuner Monster": "싱크로 튜너 몬스터",
    "Synchro Pendulum Effect Monster": "싱크로 펜듈럼 효과 몬스터",
    "XYZ Monster": "엑시즈 몬스터",
    "XYZ Pendulum Effect Monster": "엑시즈 펜듈럼 효과 몬스터",
    "Link Monster": "링크 몬스터",
    "Spell Card": "마법 카드",
    "Trap Card": "함정 카드",
    "Token": "토큰",
    "Skill Card": "스킬 카드",
}

# 링크 마커 방향 한국어
LINK_MARKER_KR = {
    "Top": "↑",
    "Top-Left": "↖",
    "Top-Right": "↗",
    "Left": "←",
    "Right": "→",
    "Bottom": "↓",
    "Bottom-Left": "↙",
    "Bottom-Right": "↘",
}


def race_kr(race: str, is_monster: bool = True) -> str:
    """Race in Korean. Falls back to English if unmapped."""
    if not race:
        return ""
    if is_monster:
        return MONSTER_RACE_KR.get(race, race)
    return SPELL_TRAP_RACE_KR.get(race, race)


def attribute_kr(attribute: str) -> str:
    if not attribute:
        return ""
    return ATTRIBUTE_KR.get(attribute, attribute)


def card_type_kr(card_type: str) -> str:
    if not card_type:
        return ""
    return CARD_TYPE_KR.get(card_type, card_type)


def frame_type_kr(frame_type: str) -> str:
    if not frame_type:
        return ""
    return FRAME_TYPE_KR.get(frame_type, frame_type)
