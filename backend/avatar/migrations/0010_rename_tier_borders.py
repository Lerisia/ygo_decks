"""Rename tier borders to katakana-loanword form (브론즈/실버/골드) and drop
the rainbow border in favor of the cleaner 6-tier list.

Final order: 아이언 < 브론즈 < 실버 < 골드 < 플래티넘 < 다이아."""
from django.db import migrations


RENAMES = [
    ("bronze", "브론즈"),
    ("silver", "실버"),
    ("gold",   "골드"),
]


def fix_names(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    UserBorderUnlock = apps.get_model("avatar", "UserBorderUnlock")
    for key, new_name in RENAMES:
        Border.objects.filter(key=key).update(name=new_name)
    # Drop rainbow border (and any unlocks). Replaced by diamond as the top tier.
    rainbow = Border.objects.filter(key="rainbow").first()
    if rainbow:
        UserBorderUnlock.objects.filter(border=rainbow).delete()
        rainbow.delete()


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("avatar", "0009_add_iron_diamond_tiers"),
    ]

    operations = [
        migrations.RunPython(fix_names, reverse_noop),
    ]
