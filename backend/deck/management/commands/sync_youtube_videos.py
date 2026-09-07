from django.core.management.base import BaseCommand

from deck.youtube import CHANNEL_NAME, sync_channel_videos


class Command(BaseCommand):
    help = f"{CHANNEL_NAME} 유튜브 채널 영상 목록을 ChannelVideo 캐시에 동기화합니다."

    def handle(self, *args, **options):
        created, updated, removed = sync_channel_videos(log=lambda m: self.stdout.write(m))
        self.stdout.write(self.style.SUCCESS(f"synced: +{created} ~{updated} -{removed}"))
