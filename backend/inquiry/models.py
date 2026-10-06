from django.conf import settings
from django.db import models


class InquiryPost(models.Model):
    """A question or report on one of the two inquiry boards (특이점 2026-10-07). Authors always show as 익명;
    a private post (the default) is readable only by its author and staff. Only staff can comment (answer)."""

    BOARD_CHOICES = [("deck", "덱 관련 제보 / 건의"), ("site", "사이트 관련 문의")]

    board = models.CharField(max_length=8, choices=BOARD_CHOICES, db_index=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="inquiry_posts")
    title = models.CharField(max_length=100)
    body = models.TextField(max_length=5000)
    is_private = models.BooleanField(default=True, verbose_name="비공개")
    notify_email = models.BooleanField(default=False, verbose_name="답변 시 메일 알림")
    answered_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "문의 글"
        verbose_name_plural = "문의 글"

    def __str__(self):
        return f"[{self.get_board_display()}] {self.title}"


class InquiryComment(models.Model):
    """A staff answer under an inquiry post; shown as 운영진."""

    post = models.ForeignKey(InquiryPost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="inquiry_comments")
    body = models.TextField(max_length=3000)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "문의 답변"
        verbose_name_plural = "문의 답변"
