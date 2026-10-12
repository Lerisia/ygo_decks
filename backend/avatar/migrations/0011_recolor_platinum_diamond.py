"""Apply metallic-sheen gradients to all 6 tier borders so they read as
distinct shiny rings (not flat colors) and clearly differ from the plain
default border."""
from django.db import migrations


METALLIC = {
    "iron":     "linear-gradient(135deg,#3a3a40 0%,#7a7a82 30%,#52525b 50%,#2a2a32 70%,#52525b 100%)",
    "bronze":   "linear-gradient(135deg,#a05a1c 0%,#e6a566 30%,#cd7f32 50%,#8b5a1f 70%,#cd7f32 100%)",
    "silver":   "linear-gradient(135deg,#a0a0a0 0%,#ffffff 30%,#c0c0c0 50%,#7a7a7a 70%,#c0c0c0 100%)",
    "gold":     "linear-gradient(135deg,#b8970a 0%,#fff5b8 30%,#ffd700 50%,#a17a07 70%,#ffd700 100%)",
    "platinum": "linear-gradient(135deg,#1d756f 0%,#7be0d8 30%,#3aa6a0 50%,#0f5550 70%,#3aa6a0 100%)",
    "diamond":  "linear-gradient(135deg,#5dc7ff 0%,#ffffff 30%,#a8e6ff 50%,#3a8fd0 70%,#a8e6ff 100%)",
}


def apply_metallic(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    for key, color in METALLIC.items():
        Border.objects.filter(key=key).update(color=color)


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("avatar", "0010_rename_tier_borders"),
    ]

    operations = [
        migrations.RunPython(apply_metallic, reverse_noop),
    ]
