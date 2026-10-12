from django.db import migrations


PRICE_TO_RARITY = [
    (50, "common"),     # ≤ 50  → common
    (300, "rare"),      # ≤ 300 → rare
    (1000, "epic"),     # ≤ 1000 → epic
    (10**9, "legendary"),
]
RARITY_PRICE = {"common": 10, "rare": 100, "epic": 500, "legendary": 2000}


def forwards(apps, schema_editor):
    CardIcon = apps.get_model("avatar", "CardIcon")
    for icon in CardIcon.objects.all():
        if icon.category != "shop":
            continue
        old_price = icon.price or 0
        if old_price <= 0:
            continue
        for ceiling, rarity in PRICE_TO_RARITY:
            if old_price <= ceiling:
                icon.rarity = rarity
                icon.price = RARITY_PRICE[rarity]
                icon.save(update_fields=["rarity", "price"])
                break


def backwards(apps, schema_editor):
    CardIcon = apps.get_model("avatar", "CardIcon")
    CardIcon.objects.update(rarity="")


class Migration(migrations.Migration):
    dependencies = [
        ("avatar", "0006_cardicon_rarity_alter_cardicon_price"),
    ]
    operations = [migrations.RunPython(forwards, backwards)]
