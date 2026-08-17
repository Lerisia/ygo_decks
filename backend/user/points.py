"""Centralized points award + tier-based border unlock.

All point payouts (daily bonus, multiplayer game finalize) should go through
`award_points()` so lifetime totals and border tiers stay in sync.
"""
from django.db import transaction


# Cumulative-points threshold → Border.key. Order matters: ascending.
# Thresholds are placeholder; tune them when the economy is balanced.
BORDER_TIERS: list[tuple[int, str]] = [
    (10,    "iron"),      # unlocks on first daily-bonus claim (10P)
    (100,   "bronze"),
    (500,   "silver"),
    (2000,  "gold"),
    (5000,  "platinum"),
    (15000, "diamond"),
]


def award_points(user, amount: int, kind: str = "other", note: str = "") -> dict:
    """Atomically credit `amount` to user.points + lifetime_points_earned,
    grant any border tiers newly crossed, and record a PointTransaction so
    /mypage/points can show the user where their balance came from.
    `amount<=0` is a no-op (no transaction written either).
    Returns {newly_unlocked: [Border.key, ...]}.
    """
    if not user or not user.id or amount <= 0:
        return {"newly_unlocked": []}

    from .models import User, PointTransaction
    from avatar.models import Border, UserBorderUnlock

    with transaction.atomic():
        # Re-fetch under row lock to avoid races on concurrent awards.
        u = User.objects.select_for_update().get(pk=user.id)
        before = u.lifetime_points_earned or 0
        u.points = (u.points or 0) + amount
        u.lifetime_points_earned = before + amount
        u.save(update_fields=["points", "lifetime_points_earned"])
        # Mirror onto the caller-supplied instance so callers see updated values.
        user.points = u.points
        user.lifetime_points_earned = u.lifetime_points_earned

        PointTransaction.objects.create(
            user=u, amount=amount, kind=kind, note=note[:200],
            balance_after=u.points,
        )

        after = u.lifetime_points_earned
        crossed_keys = [key for thr, key in BORDER_TIERS if before < thr <= after]
        if not crossed_keys:
            return {"newly_unlocked": []}

        borders = list(Border.objects.filter(key__in=crossed_keys))
        existing = set(
            UserBorderUnlock.objects.filter(user=u, border__in=borders)
            .values_list("border__key", flat=True)
        )
        unlocked = []
        for b in borders:
            if b.key in existing:
                continue
            UserBorderUnlock.objects.get_or_create(
                user=u, border=b,
                defaults={"note": f"누적 {b.key} 등급 자동 지급"},
            )
            unlocked.append(b.key)
        return {"newly_unlocked": unlocked}


def record_spend(user, amount: int, kind: str, note: str = "") -> None:
    """Spend path: decrement user.points and log a NEGATIVE-amount
    PointTransaction. Caller is responsible for verifying balance and
    handling the actual product/service grant; this just logs. amount
    is the positive cost — we record `-amount` in the transaction."""
    if not user or not user.id or amount <= 0:
        return
    from .models import User, PointTransaction
    with transaction.atomic():
        u = User.objects.select_for_update().get(pk=user.id)
        if (u.points or 0) < amount:
            raise ValueError("포인트가 부족합니다.")
        u.points = u.points - amount
        u.save(update_fields=["points"])
        user.points = u.points
        PointTransaction.objects.create(
            user=u, amount=-amount, kind=kind, note=note[:200],
            balance_after=u.points,
        )
