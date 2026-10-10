"""The new card DB seen through the field names and values the 딱무고개
engine was written against (YGOPRODeck vocabulary), so its rules stay put."""
from carddb.models import Card

from .twenty_engine import RACE_LABELS

RACES = {en.lower().replace("-", "_").replace(" ", "_"): en for en in RACE_LABELS}
SPELL_TRAP_KINDS = {
    "normal": "Normal", "quick_play": "Quick-Play", "continuous": "Continuous",
    "field": "Field", "equip": "Equip", "ritual": "Ritual", "counter": "Counter",
}
YP_FIELDS = ("actions", "summoning", "misc", "monster_spell_trap", "banishing", "archseries")


def card_type(card) -> str:
    if card.category == "spell":
        return "Spell Card"
    if card.category == "trap":
        return "Trap Card"
    if "token" in card.types:
        return "Token"
    return " ".join(t.replace("_", " ").title() for t in card.types) + " Monster"


class TwentyCard:
    def __init__(self, card: Card):
        self.card = card
        self.id = card.id
        self.frame_type = card.frame
        self.card_type = card_type(card)
        self.attribute = card.attribute.upper()
        if card.category == "monster":
            self.race = RACES.get(card.race, card.race)
        else:
            self.race = SPELL_TRAP_KINDS.get(card.spell_trap_subtype, "")
        self.level = card.rank if card.frame.startswith("xyz") else card.level
        self.link_value = card.link_rating
        self.atk = card.atk
        self.def_value = card.def_value
        self.korean_name = card.name_ko
        text = next((t for t in card.texts.all() if t.lang == "ko"), None)
        self.korean_description = "\n".join(
            s for s in (text.materials, text.effect, text.flavor) if s
        ) if text else ""
        self.effect_tag = getattr(card, "effect_tag", None)
        yp = getattr(card, "yugipedia", None)
        for f in YP_FIELDS:
            setattr(self, f"yugipedia_{f}", list(getattr(yp, f)) if yp else [])


def twenty_cards():
    return Card.objects.select_related("effect_tag", "yugipedia").prefetch_related("texts")


def load(card_id):
    card = twenty_cards().filter(id=card_id).first()
    return TwentyCard(card) if card else None
