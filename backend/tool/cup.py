"""Duelist Cup games the recorder saves go to a cup sheet of their own (특이점 2026-10-14). The recorder sends a cup
game to the ranked sheet unless the person picked a cup sheet, so cup and ranked games mixed in one sheet; a cup game
aimed at a sheet that already holds ranked or rated games now lands in that person's "듀얼리스트 컵 YYYY.MM", made
the first time, one a month as people name their cup sheets. Any other sheet keeps them: one picked for the cup, even
with a few games typed without a kind (live sheets such as "10월 듀컵1" have those)."""
from django.db.models import Q
from django.utils import timezone

from .models import MatchRecord, RecordGroup

CUP = "duelist_cup"


def holds_ladder_games(group):
    """Ranked games (a rank, no other kind) or rated ones."""
    ranked = Q(score_type__isnull=True) | Q(score_type="")
    return (MatchRecord.objects.filter(record_group=group, is_deleted=False)
            .filter((ranked & Q(rank__isnull=False) & ~Q(rank="")) | Q(score_type="rating")).exists())


def cup_sheet_name(when):
    return f"듀얼리스트 컵 {timezone.localtime(when):%Y.%m}"


def cup_sheet(user, when=None):
    name = cup_sheet_name(when or timezone.now())
    sheet = RecordGroup.objects.filter(user=user, name=name, kind="solo", is_deleted=False).order_by("id").first()
    return sheet or RecordGroup.objects.create(user=user, name=name, kind="solo")


def sheet_for_recorder_cup_game(user, group, when=None):
    """Where a cup game the recorder saved into `group` belongs."""
    return cup_sheet(user, when) if holds_ladder_games(group) else group
