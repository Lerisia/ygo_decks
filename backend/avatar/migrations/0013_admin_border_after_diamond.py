from django.db import migrations


def _apply(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    Border.objects.filter(key="admin").update(sort_order=200)


def _revert(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    Border.objects.filter(key="admin").update(sort_order=100)


class Migration(migrations.Migration):
    dependencies = [
        ("avatar", "0012_admin_border_rename_and_recolor"),
    ]

    operations = [
        migrations.RunPython(_apply, _revert),
    ]
