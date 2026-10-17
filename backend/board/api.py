"""View helpers the boards share: the error reply, the staff check, pages of 20, how many posts one person may write
in a span, and the admin log of a staff member deleting someone else's post."""
from datetime import timedelta

from django.contrib.admin.models import DELETION, LogEntry
from django.utils import timezone
from rest_framework.response import Response

PAGE_SIZE = 20
# Enough for anyone with something to say, too little for a flood (문의 게시판, 특이점 2026-10-07).
POST_LIMITS = ((timedelta(minutes=10), 5), (timedelta(days=1), 30))
COMMENT_LIMITS = ((timedelta(minutes=10), 15), (timedelta(days=1), 100))
TOO_FAST = "짧은 시간에 글을 너무 많이 썼습니다. 잠시 뒤에 다시 써 주세요."


def error(message, code=400):
    return Response({"error": message}, status=code)


def is_staff(user):
    return bool(user and user.is_authenticated and user.is_staff)


def page_number(request):
    try:
        return max(int(request.GET.get("page") or 1), 1)
    except ValueError:
        return 1


def page_of(qs, request, out, size=PAGE_SIZE):
    """One page of a board: {"results": [out(row)…], "total", "page", "pages"}; a page past the end is empty."""
    total = qs.count()
    page = page_number(request)
    return {"results": [out(row) for row in qs[(page - 1) * size: page * size]], "total": total, "page": page,
            "pages": max((total + size - 1) // size, 1)}


def too_fast(qs, limits, now=None):
    """Has this person written more rows (qs: theirs, with created_at) than the limits allow in any of the spans?"""
    now = now or timezone.now()
    return any(qs.filter(created_at__gte=now - span).count() >= most for span, most in limits)


def log_deletion(user, obj, message):
    """A staff member's deletion of someone else's post or comment, in the admin log."""
    LogEntry.objects.log_actions(user_id=user.id, queryset=type(obj).objects.filter(pk=obj.pk), action_flag=DELETION,
                                 change_message=message)
