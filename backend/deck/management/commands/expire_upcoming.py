from django.core.management.base import BaseCommand
from django.utils import timezone

from deck.models import Deck


class Command(BaseCommand):
    help = "업데이트 예정 마크 중 자동 해제 시각이 지난 것을 끈다 (화면은 시각이 지나는 즉시 바뀌고, 이 명령은 DB를 정리할 뿐)."

    def handle(self, *args, **options):
        expired = Deck.objects.filter(is_upcoming=True, upcoming_until__lte=timezone.now())
        names = list(expired.values_list("name", flat=True))
        expired.update(is_upcoming=False, upcoming_until=None)
        if names:
            self.stdout.write(f"{timezone.localtime():%Y-%m-%d %H:%M} 업데이트 예정 해제: {', '.join(names)}")
