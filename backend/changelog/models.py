from django.db import models


class ChangelogEntry(models.Model):
    # A monthly deck-addition notice shows in its own colour so it reads apart from site updates (특이점 2026-10-10).
    KIND_CHOICES = [("update", "업데이트"), ("deck", "정기 덱 추가")]

    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default="update")
    body = models.TextField(help_text="마크다운 지원")
    published_at = models.DateTimeField(
        help_text="메인 화면 노출 시각. 미래 시각으로 두면 그 시간까지 숨겨집니다."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-published_at", "-id"]

    def __str__(self):
        return f"[{self.published_at:%Y-%m-%d %H:%M}] {self.title}"
