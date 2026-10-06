from datetime import timedelta

from django.conf import settings
from django.contrib.admin.models import DELETION, LogEntry
from django.core.mail import get_connection, send_mail
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import InquiryComment, InquiryPost

PAGE_SIZE = 20
# Lists and locked pages never show a real title: someone could put abuse in it (특이점 2026-10-07).
# The real title appears only on the post itself, for its author and staff.
HIDDEN_TITLE = "문의사항"
BOARDS = dict(InquiryPost.BOARD_CHOICES)
# Enough for anyone with a real problem, too little for a flood.
LIMITS = ((timedelta(minutes=10), 5), (timedelta(days=1), 30))


def _is_staff(user):
    return bool(user and user.is_authenticated and user.is_staff)


def _can_view(post, user):
    # Every post is private (특이점 2026-10-07: no one else needs to read someone's inquiry), whatever is_private says.
    return _is_staff(user) or (user.is_authenticated and post.author_id == user.id)


def _post_out(post, user, full=False):
    staff = _is_staff(user)
    mine = user.is_authenticated and post.author_id == user.id
    can_view = _can_view(post, user)
    out = {
        "id": post.id,
        "board": post.board,
        "board_label": BOARDS.get(post.board, post.board),
        "title": post.title if full and can_view else HIDDEN_TITLE,
        "is_private": post.is_private,
        "answered": post.answered_at is not None,
        "comment_count": getattr(post, "n_comments", None),
        "created_at": post.created_at,
        "mine": mine,
        "can_view": can_view,
    }
    if staff:
        out["author_name"] = post.author.username  # staff only, so they can follow up; everyone else sees 익명
    if full and can_view:
        out["body"] = post.body
        out["comments"] = [
            {"id": c.id, "body": c.body, "created_at": c.created_at}
            for c in post.comments.filter(is_deleted=False)
        ]
        out["comment_count"] = len(out["comments"])
        if mine or staff:
            out["notify_email"] = post.notify_email
    return out


def _error(message, code=400):
    return Response({"error": message}, status=code)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def posts(request):
    if request.method == "GET":
        board = request.GET.get("board")
        if board not in BOARDS:
            return _error("게시판을 골라 주세요.")
        qs = (InquiryPost.objects.filter(board=board, is_deleted=False).select_related("author")
              .annotate(n_comments=Count("comments", filter=Q(comments__is_deleted=False))))
        if request.GET.get("mine") == "1" and request.user.is_authenticated:
            qs = qs.filter(author=request.user)
        total = qs.count()
        try:
            page = max(int(request.GET.get("page") or 1), 1)
        except ValueError:
            page = 1
        rows = qs[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        out = {"results": [_post_out(p, request.user) for p in rows], "total": total, "page": page,
               "pages": max((total + PAGE_SIZE - 1) // PAGE_SIZE, 1)}
        if _is_staff(request.user):
            out["unanswered"] = InquiryPost.objects.filter(board=board, is_deleted=False, answered_at__isnull=True).count()
        return Response(out)

    if not request.user.is_authenticated:
        return _error("로그인한 뒤 글을 쓸 수 있습니다.", 401)
    data = request.data
    board = data.get("board")
    title = str(data.get("title") or "").strip()
    body = str(data.get("body") or "").strip()
    if board not in BOARDS:
        return _error("게시판을 골라 주세요.")
    if not title or len(title) > 100:
        return _error("제목은 1~100자로 써 주세요.")
    if not body or len(body) > 5000:
        return _error("내용은 1~5,000자로 써 주세요.")
    now = timezone.now()
    for span, most in LIMITS:
        if InquiryPost.objects.filter(author=request.user, created_at__gte=now - span).count() >= most:
            return _error("짧은 시간에 글을 너무 많이 썼습니다. 잠시 뒤에 다시 써 주세요.", 429)
    post = InquiryPost.objects.create(
        board=board, author=request.user, title=title, body=body,
        is_private=True, notify_email=bool(data.get("notify_email", False)),
    )
    return Response(_post_out(post, request.user, full=True), status=201)


@api_view(["GET", "DELETE"])
@permission_classes([AllowAny])
def post_detail(request, pk):
    post = InquiryPost.objects.filter(pk=pk, is_deleted=False).select_related("author").first()
    if not post:
        return _error("글을 찾을 수 없습니다.", 404)
    if request.method == "GET":
        out = _post_out(post, request.user, full=True)
        return Response(out, status=200 if out["can_view"] else 403)

    staff = _is_staff(request.user)
    if not (staff or (request.user.is_authenticated and post.author_id == request.user.id)):
        return _error("글쓴이나 운영진만 지울 수 있습니다.", 403)
    post.is_deleted = True
    post.save(update_fields=["is_deleted"])
    if staff and post.author_id != request.user.id:
        LogEntry.objects.log_actions(user_id=request.user.id, queryset=InquiryPost.objects.filter(id=post.id),
                                     action_flag=DELETION, change_message=f"사이트에서 문의 글 삭제: {post.title}")
    return Response(status=204)


def _notify_author(post):
    """Tell the author an answer arrived, only when they asked for it when writing."""
    email = post.author.email
    if not (post.notify_email and email):
        return
    url = f"https://ygodecks.com/inquiry/post/{post.id}"
    send_mail(
        subject="[YGO Decks] 문의하신 글에 답변이 등록되었습니다",
        message=(f"회원님이 문의한 내용에 관리자의 답변이 등록되었습니다.\n\n"
                 f"문의 제목: {post.title}\n아래 링크에서 답변을 확인하실 수 있습니다.\n{url}\n\n"
                 f"이 메일은 문의를 쓸 때 '답변 알림 메일 받기'를 선택하셔서 보내드렸습니다."),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=True,
        connection=get_connection(fail_silently=True, timeout=10),
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def add_comment(request, pk):
    if not _is_staff(request.user):
        return _error("댓글은 운영진만 달 수 있습니다.", 403 if request.user.is_authenticated else 401)
    post = InquiryPost.objects.filter(pk=pk, is_deleted=False).select_related("author").first()
    if not post:
        return _error("글을 찾을 수 없습니다.", 404)
    body = str(request.data.get("body") or "").strip()
    if not body or len(body) > 3000:
        return _error("답변은 1~3,000자로 써 주세요.")
    comment = InquiryComment.objects.create(post=post, author=request.user, body=body)
    post.answered_at = comment.created_at
    post.save(update_fields=["answered_at"])
    _notify_author(post)
    return Response({"id": comment.id, "body": comment.body, "created_at": comment.created_at}, status=201)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def delete_comment(request, pk):
    if not _is_staff(request.user):
        return _error("운영진만 지울 수 있습니다.", 403 if request.user.is_authenticated else 401)
    comment = InquiryComment.objects.filter(pk=pk, is_deleted=False).select_related("post").first()
    if not comment:
        return _error("답변을 찾을 수 없습니다.", 404)
    comment.is_deleted = True
    comment.save(update_fields=["is_deleted"])
    post = comment.post
    if not post.comments.filter(is_deleted=False).exists():
        post.answered_at = None
        post.save(update_fields=["answered_at"])
    return Response(status=204)
