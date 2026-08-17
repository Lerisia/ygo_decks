"""Auto-close rooms that have been sitting in 'waiting' status without
activity (any save) for too long. Removes all RoomPlayers and broadcasts a
notice so connected clients redirect out.

Run via cron, e.g.:
    */10 * * * * cd /home/elyss/ygo_decks/backend && /home/elyss/ygo_decks/backend/venv/bin/python manage.py cleanup_idle_rooms

Threshold defaults to 30 minutes; override with --minutes N.
"""
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Close rooms idle in 'waiting' status for N minutes (default 30)."

    def add_arguments(self, parser):
        parser.add_argument("--minutes", type=int, default=30, help="Idle threshold in minutes")

    def handle(self, *args, **opts):
        from multiplayer.models import Room, RoomPlayer
        from multiplayer import events

        cutoff = timezone.now() - timedelta(minutes=opts["minutes"])
        idle_rooms = Room.objects.filter(status="waiting", last_activity_at__lt=cutoff)
        n = 0
        for room in idle_rooms:
            player_count = room.players.count()
            # Notify any connected clients before we wipe membership.
            events.broadcast(room.id, "room_closed", {
                "reason": "idle",
                "message": f"30분 이상 비활성으로 방이 자동 종료되었습니다.",
            })
            RoomPlayer.objects.filter(room=room).delete()
            room.status = "closed"
            room.save(update_fields=["status"])
            n += 1
            self.stdout.write(self.style.WARNING(
                f"closed room {room.id} ({room.name!r}) — was idle since {room.last_activity_at}, "
                f"had {player_count} players"
            ))
        self.stdout.write(self.style.SUCCESS(f"done; closed {n} room(s)"))
