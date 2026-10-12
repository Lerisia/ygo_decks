from django.db import migrations
from django.db.models import F


def bump(apps, schema_editor):
    # Clients before 0.5.1 stored the engine's 0-based turn counter; players count turns from 1.
    apps.get_model("tracker", "TrackerGame").objects.update(turn=F("turn") + 1)


def unbump(apps, schema_editor):
    apps.get_model("tracker", "TrackerGame").objects.update(turn=F("turn") - 1)


class Migration(migrations.Migration):
    dependencies = [("tracker", "0004_trackergame_turn_times")]
    operations = [migrations.RunPython(bump, unbump)]
