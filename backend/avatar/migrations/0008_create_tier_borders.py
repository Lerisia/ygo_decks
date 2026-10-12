"""Create the 5 tier borders awarded for cumulative point milestones, and
backfill existing users' lifetime_points_earned from their current points
balance so they don't lose ground."""
from django.db import migrations


TIER_BORDERS = [
    # (key, name, color, sort_order)
    ("bronze",   "동",       "#cd7f32", 100),
    ("silver",   "은",       "#c0c0c0", 110),
    ("gold",     "금",       "#ffd700", 120),
    ("platinum", "플래티넘", "#e5e4e2", 130),
    ("rainbow",  "무지개",   "linear-gradient(135deg,#ff0000,#ff7f00,#ffff00,#00ff00,#0000ff,#4b0082,#9400d3)", 140),
]


def create_tier_borders_and_backfill(apps, schema_editor):
    Border = apps.get_model("avatar", "Border")
    UserBorderUnlock = apps.get_model("avatar", "UserBorderUnlock")
    User = apps.get_model("user", "User")

    for key, name, color, sort_order in TIER_BORDERS:
        Border.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "color": color,
                "is_default": False,
                "sort_order": sort_order,
            },
        )

    tiers = [(100, "bronze"), (500, "silver"), (2000, "gold"), (5000, "platinum"), (10000, "rainbow")]
    border_by_key = {b.key: b for b in Border.objects.filter(key__in=[k for _, k in tiers])}

    for u in User.objects.all().iterator():
        # Mirror current balance into lifetime so existing earners aren't penalized.
        if (u.lifetime_points_earned or 0) == 0 and (u.points or 0) > 0:
            u.lifetime_points_earned = u.points
            u.save(update_fields=["lifetime_points_earned"])
        lifetime = u.lifetime_points_earned or 0
        for thr, key in tiers:
            if lifetime >= thr and key in border_by_key:
                UserBorderUnlock.objects.get_or_create(
                    user=u, border=border_by_key[key],
                    defaults={"note": "마이그레이션: 누적 포인트 기준 자동 지급"},
                )


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("avatar", "0007_backfill_rarity"),
        ("user", "0010_user_lifetime_points_earned"),
    ]

    operations = [
        migrations.RunPython(create_tier_borders_and_backfill, reverse_noop),
    ]
