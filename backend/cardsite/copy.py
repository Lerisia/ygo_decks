from django.apps import apps
from django.db import transaction

from carddb.models import LegacyCard

from .models import EffectTag, LegacyTheme, Yugipedia

YP = ["actions", "summoning", "misc", "monster_spell_trap", "banishing", "archseries"]


def primary_old_rows():
    best = {}
    for old_id, old_card_id, card_id in LegacyCard.objects.exclude(card=None).values_list("old_id", "old_card_id", "card_id"):
        rank = (not old_card_id.endswith("00"), old_id)
        if card_id not in best or rank < best[card_id][0]:
            best[card_id] = (rank, old_id)
    return {card_id: old_id for card_id, (_, old_id) in best.items()}


@transaction.atomic
def copy_site_data():
    Old = apps.get_model("card", "Card")
    OldTag = apps.get_model("card", "CardEffectTag")
    primary = primary_old_rows()
    by_old = {v: k for k, v in primary.items()}
    themes, yps = [], []
    for o in Old.objects.filter(id__in=by_old).values("id", "archetype", "korean_archetype", *[f"yugipedia_{f}" for f in YP]):
        card_id = by_old[o["id"]]
        if o["archetype"] or o["korean_archetype"]:
            themes.append(LegacyTheme(card_id=card_id, archetype=o["archetype"] or "", archetype_ko=o["korean_archetype"] or ""))
        lists = {f: o[f"yugipedia_{f}"] or [] for f in YP}
        if any(lists.values()):
            yps.append(Yugipedia(card_id=card_id, **lists))
    flags = [f.name for f in EffectTag._meta.fields if f.name not in ("card",)]
    tags = [
        EffectTag(card_id=by_old[t["card_id"]], **{f: t[f] for f in flags})
        for t in OldTag.objects.filter(card_id__in=by_old).values("card_id", *flags)
    ]
    LegacyTheme.objects.bulk_create(themes, update_conflicts=True, unique_fields=["card"], update_fields=["archetype", "archetype_ko"], batch_size=1000)
    Yugipedia.objects.bulk_create(yps, update_conflicts=True, unique_fields=["card"], update_fields=YP, batch_size=1000)
    EffectTag.objects.bulk_create(tags, update_conflicts=True, unique_fields=["card"], update_fields=flags, batch_size=1000)
    return {"themes": len(themes), "yugipedia": len(yps), "effect_tags": len(tags)}
