"""Gems, the pack simulator's currency (엘리스 2026-10-13): operators grant them for now; buying them with points comes
once the rate is set (cheap: the simulator is for the fun of it)."""
from django.db import transaction


class NotEnoughGems(Exception):
    def __init__(self, held):
        super().__init__(f"not enough gems ({held})")
        self.held = held


def change_gems(user, amount: int, kind: str = "other", note: str = "") -> int:
    """Add (or, negative, take) gems and log it; the new balance. Taking more than is held raises NotEnoughGems and
    changes nothing."""
    from .models import GemTransaction, User
    with transaction.atomic():
        u = User.objects.select_for_update().get(pk=user.pk)
        if u.gems + amount < 0:
            raise NotEnoughGems(u.gems)
        u.gems += amount
        u.save(update_fields=["gems"])
        GemTransaction.objects.create(user=u, amount=amount, kind=kind, note=note[:200], balance_after=u.gems)
    user.gems = u.gems
    return u.gems
