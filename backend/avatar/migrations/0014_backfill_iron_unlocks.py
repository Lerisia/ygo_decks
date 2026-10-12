"""Backfill iron border for users who already crossed 10 lifetime points.

Iron threshold was previously 0 with broken `before < thr <= after` check, so
iron was never granted automatically. Now that it's properly set to 10P, we
catch up everyone who already qualifies.
"""
from django.db import migrations


IRON_THRESHOLD = 10


def _apply(apps, schema_editor):
    User = apps.get_model("user", "User")
    Border = apps.get_model("avatar", "Border")
    UserBorderUnlock = apps.get_model("avatar", "UserBorderUnlock")
    iron = Border.objects.filter(key="iron").first()
    if iron is None:
        return
    qualified = User.objects.filter(lifetime_points_earned__gte=IRON_THRESHOLD)
    for u in qualified.iterator():
        UserBorderUnlock.objects.get_or_create(
            user=u, border=iron,
            defaults={"note": "누적 10P 달성 (백필)"},
        )


def _revert(apps, schema_editor):
    # No-op: don't strip unlocks on rollback.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("avatar", "0013_admin_border_after_diamond"),
        ("user", "0010_user_lifetime_points_earned"),
    ]

    operations = [
        migrations.RunPython(_apply, _revert),
    ]
