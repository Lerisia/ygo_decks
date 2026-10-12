from django.db import migrations


ADMIN_GRADIENT = (
    "linear-gradient(135deg,"
    "#ef4444 0%,"
    "#f59e0b 16%,"
    "#fbbf24 33%,"
    "#84cc16 50%,"
    "#06b6d4 66%,"
    "#8b5cf6 83%,"
    "#ef4444 100%)"
)


def _apply(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    Border.objects.filter(key="admin").update(name="관리자", color=ADMIN_GRADIENT)


def _revert(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    Border.objects.filter(key="admin").update(name="운영자", color="#facc15")


class Migration(migrations.Migration):
    dependencies = [
        ("avatar", "0011_recolor_platinum_diamond"),
    ]

    operations = [
        migrations.RunPython(_apply, _revert),
    ]
