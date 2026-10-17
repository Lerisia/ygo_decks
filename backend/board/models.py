from django.conf import settings
from django.db import models


class Comment(models.Model):
    """A comment under a board's post: who wrote it, its text, a deletion mark that keeps the row, and when. A board
    adds `post` (the FK to its own post model) and its verbose names; `author` reverses as <app>_comments."""

    BODY_MAX = 3000

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="%(app_label)s_comments")
    body = models.TextField(max_length=BODY_MAX)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["created_at", "id"]
