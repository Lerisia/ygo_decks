from django.core.management.base import BaseCommand
from user.models import BannedWord

BANNED_WORDS = [
    # 일반 비속어
    "시발", "씨발", "시바", "씨바", "시팔", "씨팔",
    "ㅅㅂ", "ㅆㅂ", "시1발", "씨1발",
    "병신", "ㅂㅅ", "병1신", "byungsin",
    "지랄", "ㅈㄹ", "지1랄",
    "개새끼", "개세끼", "개색끼", "개색기", "개쉐끼",
    "새끼", "세끼", "샛끼",
    "미친놈", "미친년", "미친새끼",
    "꺼져", "닥쳐", "뒤져",
    "느금마", "느금", "니엄마", "니애미", "니애비",
    "엠창", "애미", "애비",
    "좆", "자지", "보지",
    "씹", "ㅆㅂ", "씹새",
    "걸레", "화냥", "창녀", "창남",
    "한남", "한녀",
    "장애인", "정신병자",
    "ㅄ", "ㅗ",
    "fuck", "shit", "bitch", "asshole", "nigger", "nigga",
    "dick", "pussy", "cunt", "fck", "stfu", "gtfo",
    # 성적 표현
    "섹스", "야동", "포르노", "porn",
    # 차별 표현
    "똥남아", "쪽바리", "짱깨", "짱개", "흑형",
    "게이", "레즈",
    # 혐오 표현
    "자살", "죽어",
    # 역대 한국 대통령
    "이승만", "윤보선", "박정희", "최규하",
    "전두환", "노태우", "김영삼", "김대중",
    "노무현", "이명박", "박근혜", "문재인",
    "윤석열",
]


class Command(BaseCommand):
    help = "Load default banned words into the database"

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Clear existing words before loading")

    def handle(self, *args, **options):
        if options["clear"]:
            deleted, _ = BannedWord.objects.all().delete()
            self.stdout.write(f"Cleared {deleted} existing words.")

        created = 0
        for word in BANNED_WORDS:
            _, was_created = BannedWord.objects.get_or_create(word=word.lower())
            if was_created:
                created += 1

        self.stdout.write(self.style.SUCCESS(f"Loaded {created} new banned words. (Total: {BannedWord.objects.count()})"))
