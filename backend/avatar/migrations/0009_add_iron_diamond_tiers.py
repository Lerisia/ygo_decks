"""Add iron + diamond rank borders. Final 6-tier set: iron / bronze / silver
/ gold / platinum / diamond. Point thresholds will be configured separately
in user/points.py once decided."""
from django.db import migrations


NEW_BORDERS = [
    # (key, name, color, sort_order)
    ("iron",    "아이언", "#52525b", 95),
    ("diamond", "다이아", "linear-gradient(135deg,#b9f2ff,#ffffff 50%,#80dfff)", 135),
]


def add_borders(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    for key, name, color, sort_order in NEW_BORDERS:
        Border.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "color": color,
                "is_default": False,
                "sort_order": sort_order,
            },
        )


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("avatar", "0008_create_tier_borders"),
    ]

    operations = [
        migrations.RunPython(add_borders, reverse_noop),
    ]
