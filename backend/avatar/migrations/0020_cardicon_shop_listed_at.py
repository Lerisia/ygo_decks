"""Add CardIcon.shop_listed_at, then backfill it for currently-listed
shop icons using their created_at. That gives existing shop items a
sane release date the moment the badge logic ships, instead of
treating them all as 'never listed'."""

from django.db import migrations, models


def backfill_shop_listed_at(apps, schema_editor):
    CardIcon = apps.get_model("avatar", "CardIcon")
    CardIcon.objects.filter(category="shop", shop_listed_at__isnull=True).update(
        shop_listed_at=models.F("created_at")
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('avatar', '0019_alter_border_rarity'),
    ]

    operations = [
        migrations.AddField(
            model_name='cardicon',
            name='shop_listed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_shop_listed_at, noop_reverse),
    ]
