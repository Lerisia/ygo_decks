from django.db import models


class ChangelogEntry(models.Model):
    title = models.CharField(max_length=200)
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
