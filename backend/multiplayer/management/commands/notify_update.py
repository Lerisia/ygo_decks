"""Push a red `[공지]` chat message into every active room (lobby + DM +
Quiz + Twenty chat panels) so users see a refresh notice before a deploy.

Invoked automatically by deploy.sh."""
import time

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Send a deploy-time refresh notice to every active multiplayer room's chat."

    def add_arguments(self, parser):
        parser.add_argument(
            "--message",
            default="잠시 후 업데이트가 배포됩니다. 새로고침해주세요.",
            help="Notice text (default: deploy refresh notice).",
        )

    def handle(self, *args, **opts):
        from multiplayer import events
        from multiplayer.models import Room
        from multiplayer.consumers import (
            _LOBBY_CHAT_HISTORY,
            _DM_CHAT_HISTORY,
            _QUIZ_CHAT_HISTORY,
            _TW_CHAT_HISTORY,
            _CHAT_HISTORY_MAX,
        )

        msg = opts["message"]
        payload = {
            "player_id": "_system",
            "display_name": "[공지]",
            "kind": "wrong",
            "text": msg,
            "ts": time.time(),
            "is_system": True,
        }
        room_ids = list(
            Room.objects.exclude(status="closed").values_list("id", flat=True)
        )
        for rid in room_ids:
            for hist in (
                _LOBBY_CHAT_HISTORY.setdefault(rid, []),
                _DM_CHAT_HISTORY.setdefault(rid, []),
                _QUIZ_CHAT_HISTORY.setdefault(rid, []),
                _TW_CHAT_HISTORY.setdefault(rid, []),
            ):
                hist.append(dict(payload))
                if len(hist) > _CHAT_HISTORY_MAX:
                    del hist[: len(hist) - _CHAT_HISTORY_MAX]
            for evt in ("lobby_chat", "dm_chat", "quiz_chat", "tw_chat"):
                events.broadcast(rid, evt, payload)
        self.stdout.write(
            self.style.SUCCESS(f"Sent update notice to {len(room_ids)} room(s).")
        )
