"""Add Card.created_at. Existing rows are stamped 2020-01-01 so the
duchmind-pack browser surfaces only genuinely new scrapes at the top —
all current cards stay in their historic id order behind that boundary.
"""

from datetime import datetime, timezone as dt_tz

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("card", "0019_card_yugipedia_archseries"),
    ]

    operations = [
        migrations.AddField(
            model_name="card",
            name="created_at",
            field=models.DateTimeField(
                default=datetime(2020, 1, 1, tzinfo=dt_tz.utc),
            ),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="card",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True),
        ),
    ]
