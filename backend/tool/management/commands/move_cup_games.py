import json
import os
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db.models import Q

from tool.cup import CUP, cup_sheet, cup_sheet_name, holds_other_games
from tool.models import MatchRecord


class Command(BaseCommand):
    help = ("Move Duelist Cup games the recorder saved into sheets holding other games into each person's "
            "'듀얼리스트 컵 YYYY.MM' (특이점 2026-10-14). A dry run unless --apply; --apply first writes where each game was.")

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--backup", default=os.path.expanduser(f"~/.cache/cup_moves/{datetime.now():%Y%m%d-%H%M%S}.json"))

    def handle(self, *args, **opts):
        from_recorder = Q(tracker_games__isnull=False) | Q(tracker_pending__isnull=False)
        games = (MatchRecord.objects.filter(score_type=CUP, is_deleted=False).filter(from_recorder).distinct()
                 .select_related("record_group", "recorded_by").order_by("id"))
        moves = [m for m in games if m.recorded_by_id and holds_other_games(m.record_group)]
        people = {m.recorded_by_id for m in moves}
        self.stdout.write(f"{len(moves)} cup games of {len(people)} people sit in sheets holding other games")
        for m in moves[:10]:
            self.stdout.write(f"  #{m.id} {m.recorded_by.username}: '{m.record_group.name}' -> '{cup_sheet_name(m.created_at)}'")
        if not opts["apply"]:
            self.stdout.write("dry run: nothing moved (add --apply)")
            return
        os.makedirs(os.path.dirname(opts["backup"]), exist_ok=True)
        with open(opts["backup"], "w") as f:
            json.dump([{"match": m.id, "from_group": m.record_group_id} for m in moves], f)
        for m in moves:
            m.record_group = cup_sheet(m.recorded_by, m.created_at)
            m.save(update_fields=["record_group"])
        self.stdout.write(f"moved {len(moves)}; where they were: {opts['backup']}")
