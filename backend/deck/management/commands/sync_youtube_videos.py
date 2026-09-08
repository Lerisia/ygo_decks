from django.core.management.base import BaseCommand
from django.utils import timezone

from deck.models import ChannelVideo, Deck
from deck.youtube import CHANNEL_NAME, build_index, decks_for_title, sync_channel_videos


class Command(BaseCommand):
    help = f"{CHANNEL_NAME} 유튜브 채널 영상 목록을 ChannelVideo 캐시에 동기화하고, 새 영상이 어느 덱에 붙었는지 기록합니다."

    def handle(self, *args, **options):
        before = set(ChannelVideo.objects.values_list("video_id", flat=True))
        created, updated, removed = sync_channel_videos(log=lambda m: self.stdout.write(m))
        stamp = timezone.localtime().strftime("%Y-%m-%d %H:%M")
        self.stdout.write(self.style.SUCCESS(f"[{stamp}] synced: +{created} ~{updated} -{removed}"))
        if not created:
            return
        index = build_index(Deck.objects.prefetch_related("aliases"))
        names = dict(Deck.objects.values_list("id", "name"))
        for video in ChannelVideo.objects.exclude(video_id__in=before).order_by("position"):
            decks = sorted(names[i] for i in decks_for_title(video.title, index) if i in names)
            target = ", ".join(decks) if decks else "(매칭된 덱 없음 — 별칭 추가 검토)"
            self.stdout.write(f"  + {video.title[:80]} → {target}")
