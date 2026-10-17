"""The deck list board (엘리스 2026-10-17: every deck list is a post on it; there is no 마이덱). Anyone reads the board
and a deck; a member posts, changes and deletes their own, comments on others'; staff delete with a log.
On the boards' shared base (board.api), as the inquiry board is, and with its reply shapes."""
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, F, Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from board.api import COMMENT_LIMITS, POST_LIMITS, TOO_FAST, author_of, error, is_staff, log_deletion, page_of, too_fast
from board.models import Comment
from notification.models import notify

from .models import DeckList, DeckListCard, DeckListComment
from .rules import DeckError, check, check_banlist, check_covers, check_looks, cover_copies_of, issues, looks_of

DECKS_MAX = 300   # a member's deck lists, at most
DESCRIPTION_MAX = 2000
ENTRY_ERROR = "대회에 제출한 덱은 대회 화면에서 고칩니다."
NOT_FOUND = "덱 리스트를 찾을 수 없습니다."
FORMATS = ("md", "ocg", "tcg", "custom", "none")
VIEW_TTL = 6 * 3600   # one open of a deck per viewer counts, this long


def _row(d, user):
    return {"code": d.code, "name": d.name, "description": d.description, "kind": d.kind, "main_count": len(d.main),
            "extra_count": len(d.extra), "cover_cards": d.cover_cards, "cover_copies": cover_copies_of(d), "banlist": d.banlist,
            "author": author_of(d.owner), "is_private": d.is_private, "view_count": d.view_count,
            "comment_count": getattr(d, "n_comments", None),
            "mine": user.is_authenticated and d.owner_id == user.id,
            "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat()}


def _comment_out(c, user):
    return {"id": c.id, "author": author_of(c.author), "body": c.body, "created_at": c.created_at.isoformat(),
            "mine": user.is_authenticated and c.author_id == user.id}


def _full(d, user):
    comments = [_comment_out(c, user) for c in d.comments.filter(is_deleted=False).select_related("author")]
    return {**_row(d, user), "main": d.main, "extra": d.extra, "looks": looks_of(d), "issues": issues(d.main, d.extra, d.banlist),
            "comments": comments, "comment_count": len(comments)}


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_id(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _fields(data, d=None):
    """The name, description, cards, their looks, 대표 카드 and 금제 sent, checked; DeckError on a rule broken. A
    body from a page before them keeps the deck's own (d): its 대표 카드 still in it (a copy gone, the last left), its
    looks while its cards are as they were."""
    name = " ".join(str(data.get("name") or "").split())
    if not name:
        raise DeckError("덱 이름을 적어 주세요.")
    if len(name) > 40:
        raise DeckError("덱 이름은 40자까지입니다.")
    description = str(data.get("description") or "").strip()
    if len(description) > DESCRIPTION_MAX:
        raise DeckError(f"덱 설명은 {DESCRIPTION_MAX:,}자까지입니다.")
    main, extra = data.get("main", []), data.get("extra", [])
    cards = check(main, extra)
    if "cover_cards" in data:
        covers, copies = data["cover_cards"], data.get("cover_copies")
    else:
        held = main + extra
        kept = [(c, k) for c, k in zip(d.cover_cards, cover_copies_of(d)) if c in held] if d else []
        covers, copies = [c for c, _ in kept], [min(k, held.count(c) - 1) for c, k in kept]
    copies = check_covers(covers, main, extra, copies)
    if "looks" in data:
        looks = check_looks(data["looks"], main, extra, cards)
    else:
        looks = d.looks if d and (d.main, d.extra) == (main, extra) else {}
    # its 금제 (참혈 2026-10-16); a page from before it keeps the deck's own, a new deck Master Duel's newest
    list_key = check_banlist(data["banlist"]) if "banlist" in data else (d.banlist if d else "md")
    # 비공개 (엘리스 2026-10-17): as sent; a page sending nothing keeps the deck's own, a new deck is public
    private = bool(data["is_private"]) if "is_private" in data else bool(d and d.is_private)
    return {"name": name, "description": description, "main": main, "extra": extra, "looks": looks,
            "cover_cards": covers, "cover_copies": copies, "banlist": list_key, "is_private": private}


def _index_cards(d):
    """The deck's cards as rows, for the board's search by card."""
    held = {}
    for cid in d.main + d.extra:
        held[cid] = held.get(cid, 0) + 1
    d.cards.all().delete()
    DeckListCard.objects.bulk_create([DeckListCard(deck_list=d, card_id=cid, copies=n) for cid, n in held.items()])


def _posted(request):
    """The decks on the board for this viewer: everyone's public ones and their own private ones."""
    qs = DeckList.objects.filter(kind=DeckList.Kind.OWN, is_deleted=False).select_related("owner")
    return qs.filter(Q(is_private=False) | Q(owner=request.user)) if request.user.is_authenticated else qs.filter(is_private=False)


def _board(request):
    """A page of the board, the newest first; narrowed by the 금제's game
    (banlist=md|ocg|tcg|custom|none — not ?format=, which DRF takes for itself), the author (author=<username>), a card
    held (card=<id>) and the name (q=)."""
    g = request.GET
    qs = _posted(request)
    if g.get("author"):
        qs = qs.filter(owner__username=g["author"])
    if g.get("banlist") in FORMATS:
        fmt = g["banlist"]
        qs = qs.filter(banlist="none") if fmt == "none" else qs.filter(Q(banlist=fmt) | Q(banlist__startswith=fmt + ":"))
    if g.get("card"):
        qs = qs.filter(cards__card_id=_int(g["card"]))
    if g.get("q", "").strip():
        qs = qs.filter(name__icontains=g["q"].strip())
    qs = qs.annotate(n_comments=Count("comments", filter=Q(comments__is_deleted=False), distinct=True))
    # said outright: the annotation groups the rows, and Django then drops Meta.ordering
    qs = qs.order_by("-created_at", "-id")
    return page_of(qs, request, lambda d: _row(d, request.user))


def _count_view(request, d):
    """One more open of the deck, once per viewer (member, else address) in VIEW_TTL."""
    who = request.user.id if request.user.is_authenticated else (
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR", ""))
    if cache.add(f"decklist-view:{d.code}:{who}", 1, VIEW_TTL):
        DeckList.objects.filter(pk=d.pk).update(view_count=F("view_count") + 1)
        d.view_count += 1


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def deck_lists(request):
    """The board (GET, anyone) or a new deck list posted on it (POST, a member)."""
    if request.method == "GET":
        return Response(_board(request))
    if not request.user.is_authenticated:
        return error("로그인한 뒤 덱 리스트를 올릴 수 있습니다.", 401)
    try:
        fields = _fields(request.data)
    except DeckError as e:
        return error(str(e))
    mine = DeckList.objects.filter(owner=request.user, kind=DeckList.Kind.OWN, is_deleted=False)
    if too_fast(mine, POST_LIMITS):
        return error(TOO_FAST, 429)
    with transaction.atomic():
        if mine.count() >= DECKS_MAX:
            return error(f"덱은 {DECKS_MAX}개까지 올릴 수 있습니다.")
        d = DeckList.objects.create(owner=request.user, code=DeckList.new_code(), **fields)
        _index_cards(d)
    return Response(_full(d, request.user), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([AllowAny])
def deck_list(request, code):
    """One deck list: read by anyone (a tournament's copy by its owner alone), changed by its author, deleted by its
    author or staff."""
    d = DeckList.objects.filter(code=code, is_deleted=False).select_related("owner").first()
    user = request.user
    mine = d is not None and user.is_authenticated and d.owner_id == user.id
    # a tournament's copy and a 비공개 deck are their owner's alone
    if d is None or ((d.kind == DeckList.Kind.ENTRY or d.is_private) and not mine):
        return error(NOT_FOUND, 404)
    if request.method == "GET":
        if not mine:
            _count_view(request, d)
        return Response(_full(d, user))
    if not user.is_authenticated:
        return error("로그인이 필요합니다.", 401)
    if d.kind == DeckList.Kind.ENTRY:
        return error(ENTRY_ERROR, 403)
    if request.method == "DELETE":
        if not (mine or is_staff(user)):
            return error("글쓴이나 운영자만 지울 수 있습니다.", 403)
        d.is_deleted = True
        d.save(update_fields=["is_deleted"])
        if not mine:
            log_deletion(user, d, f"사이트에서 덱 리스트 삭제: {d.name}")
        return Response(status=status.HTTP_204_NO_CONTENT)
    if not mine:
        return error("글쓴이만 고칠 수 있습니다.", 403)
    try:
        fields = _fields(request.data, d)
    except DeckError as e:
        return error(str(e))
    with transaction.atomic():
        for k, v in fields.items():
            setattr(d, k, v)
        d.save()
        _index_cards(d)
    return Response(_full(d, user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_comment(request, code):
    d = _posted(request).filter(code=code).first()
    if d is None:
        return error(NOT_FOUND, 404)
    body = str(request.data.get("body") or "").strip()
    if not body or len(body) > Comment.BODY_MAX:
        return error(f"댓글은 1~{Comment.BODY_MAX:,}자로 써 주세요.")
    if too_fast(DeckListComment.objects.filter(author=request.user), COMMENT_LIMITS):
        return error(TOO_FAST, 429)
    c = DeckListComment.objects.create(post=d, author=request.user, body=body)
    if d.owner_id != request.user.id:
        notify(d.owner, f"'{d.name}' 덱 리스트에 {request.user.username} 님이 댓글을 남겼습니다.", sender="덱리 게시판",
               action_label="보러 가기", action_url=f"/decklists/{d.code}", kind="deck_list_comment")
    return Response(_comment_out(c, request.user), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_comment(request, pk):
    c = DeckListComment.objects.filter(pk=pk, is_deleted=False).first()
    if c is None:
        return error("댓글을 찾을 수 없습니다.", 404)
    mine = c.author_id == request.user.id
    if not (mine or is_staff(request.user)):
        return error("글쓴이나 운영자만 지울 수 있습니다.", 403)
    c.is_deleted = True
    c.save(update_fields=["is_deleted"])
    if not mine:
        log_deletion(request.user, c, f"사이트에서 덱 리스트 댓글 삭제: {c.body[:40]}")
    return Response(status=status.HTTP_204_NO_CONTENT)

