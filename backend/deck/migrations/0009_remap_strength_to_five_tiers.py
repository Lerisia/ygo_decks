from django.db import migrations


def remap_forward(apps, schema_editor):
    """Old 4-tier → new 5-tier.
    Old 0 티어권      → new 0 최상위권 (no change)
    Old 1 준티어권    → new 1 중상위권 (no change)
    Old 2 비티어권    → new 3 중하위권
    Old 3 하위권      → new 4 최하위권
    New 2 중위권 stays empty; admin re-tags individual decks over time.

    Order matters: bump 3→4 first, then 2→3, otherwise the second UPDATE
    catches the just-migrated rows.
    """
    Deck = apps.get_model("deck", "Deck")
    Deck.objects.filter(strength=3).update(strength=4)
    Deck.objects.filter(strength=2).update(strength=3)


def remap_backward(apps, schema_editor):
    """Reverse the mapping. Old 5-tier 중위권(2) collapses into 중하위권(3)
    slot in the 4-tier world (there's no clean pre-image for it).
    """
    Deck = apps.get_model("deck", "Deck")
    Deck.objects.filter(strength=2).update(strength=3)  # 중위권 → 중하위권 slot
    Deck.objects.filter(strength=3).update(strength=2)  # 중하위권 → 비티어권
    Deck.objects.filter(strength=4).update(strength=3)  # 최하위권 → 하위권


class Migration(migrations.Migration):

    dependencies = [
        ("deck", "0008_alter_deck_strength"),
    ]

    operations = [
        migrations.RunPython(remap_forward, remap_backward),
    ]
