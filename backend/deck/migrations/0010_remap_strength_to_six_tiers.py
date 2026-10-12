from django.db import migrations, models

# 5-tier -> 6-tier split (2026-08-31):
#   old 0 최상위권 -> new 0 최상위권
#   old 1 중상위권 -> new 1 상위권
#   old 2 중위권   -> new 2 중상위권
#   old 3 중하위권 -> new 4 하위권
#   old 4 최하위권 -> new 5 최하위권
# New 3 중하위권 starts empty; admins re-tag individual decks over time.


def forwards(apps, schema_editor):
    Deck = apps.get_model("deck", "Deck")
    Deck.objects.filter(strength=4).update(strength=5)
    Deck.objects.filter(strength=3).update(strength=4)


def backwards(apps, schema_editor):
    Deck = apps.get_model("deck", "Deck")
    # Manually re-tagged 중하위권(3) decks collapse back into the old 중위권 slot.
    Deck.objects.filter(strength=3).update(strength=2)
    Deck.objects.filter(strength=4).update(strength=3)
    Deck.objects.filter(strength=5).update(strength=4)


class Migration(migrations.Migration):

    dependencies = [
        ("deck", "0009_remap_strength_to_five_tiers"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deck",
            name="strength",
            field=models.IntegerField(choices=[(0, "최상위권"), (1, "상위권"), (2, "중상위권"), (3, "중하위권"), (4, "하위권"), (5, "최하위권")]),
        ),
        migrations.RunPython(forwards, backwards),
    ]
