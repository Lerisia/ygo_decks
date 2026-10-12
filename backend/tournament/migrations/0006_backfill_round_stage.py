from django.db import migrations

STAGE_BY_FORMAT = {"single_elim": "knockout", "swiss": "swiss", "round_robin": "league"}


def forwards(apps, schema_editor):
    Round = apps.get_model("tournament", "Round")
    for fmt, stage in STAGE_BY_FORMAT.items():
        Round.objects.filter(tournament__format=fmt).update(stage=stage)


class Migration(migrations.Migration):
    dependencies = [("tournament", "0005_round_stage_alter_tournament_format")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
