from collections import defaultdict

from django.apps import apps
from django.db import transaction

from carddb.models import LegacyCard

from .models import EffectTag, LegacyTheme, Yugipedia

YP = ["actions", "summoning", "misc", "monster_spell_trap", "banishing", "archseries"]


def old_rows_by_card():
    """Old rows of each new card, base art (card_id ending 00) first."""
    rows = defaultdict(list)
    for old_id, old_card_id, card_id in LegacyCard.objects.exclude(card=None).values_list("old_id", "old_card_id", "card_id"):
        rows[card_id].append(((not old_card_id.endswith("00"), old_id), old_id))
    return {card_id: [old_id for _, old_id in sorted(rs)] for card_id, rs in rows.items()}


def first_filled(rows, field):
    return next((r[field] for r in rows if r[field]), None)


@transaction.atomic
def copy_site_data():
    """Base art row wins; a field it leaves empty is filled from the card's other art rows."""
    Old = apps.get_model("card", "Card")
    OldTag = apps.get_model("card", "CardEffectTag")
    order = old_rows_by_card()
    all_old = [o for olds in order.values() for o in olds]
    wanted = set(all_old)
    old = {o["id"]: o for o in Old.objects.values("id", "archetype", "korean_archetype", *[f"yugipedia_{f}" for f in YP])
           if o["id"] in wanted}
    for o in old.values():
        for f in YP:
            o[f] = o.pop(f"yugipedia_{f}")
    flags = [f.name for f in EffectTag._meta.fields if f.name not in ("card",)]
    old_tags = {t["card_id"]: t for t in OldTag.objects.values("card_id", *flags) if t["card_id"] in wanted}
    themes, yps, tags = [], [], []
    for card_id, olds in order.items():
        rows = [old[o] for o in olds if o in old]
        if not rows:
            continue
        en, ko = first_filled(rows, "archetype"), first_filled(rows, "korean_archetype")
        if en or ko:
            themes.append(LegacyTheme(card_id=card_id, archetype=en or "", archetype_ko=ko or ""))
        lists = {f: first_filled(rows, f) or [] for f in YP}
        if any(lists.values()):
            yps.append(Yugipedia(card_id=card_id, **lists))
        tag = next((old_tags[o] for o in olds if o in old_tags), None)
        if tag:
            tags.append(EffectTag(card_id=card_id, **{f: tag[f] for f in flags}))
    LegacyTheme.objects.bulk_create(themes, update_conflicts=True, unique_fields=["card"], update_fields=["archetype", "archetype_ko"], batch_size=1000)
    Yugipedia.objects.bulk_create(yps, update_conflicts=True, unique_fields=["card"], update_fields=YP, batch_size=1000)
    EffectTag.objects.bulk_create(tags, update_conflicts=True, unique_fields=["card"], update_fields=flags, batch_size=1000)
    return {"themes": len(themes), "yugipedia": len(yps), "effect_tags": len(tags)}
