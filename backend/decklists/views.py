from django.db import transaction
from django.http import Http404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import DeckList
from .rules import DeckError, check, check_covers, issues

DECKS_MAX = 300   # a member's deck lists, at most
ENTRY_ERROR = "대회에 제출한 덱은 대회 화면에서 고칩니다."


def _row(d):
    return {"code": d.code, "name": d.name, "description": d.description, "kind": d.kind, "main_count": len(d.main),
            "extra_count": len(d.extra), "cover_cards": d.cover_cards, "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat()}


def _full(d):
    return {**_row(d), "main": d.main, "extra": d.extra, "issues": issues(d.main, d.extra)}


def _fields(data, covers=()):
    """The name, description, cards and 대표 카드 sent, checked; DeckError on a rule broken. A body without
    cover_cards (a page from before them) keeps the deck's own (covers), those still in it."""
    name = " ".join(str(data.get("name") or "").split())
    if not name:
        raise DeckError("덱 이름을 적어 주세요.")
    if len(name) > 40:
        raise DeckError("덱 이름은 40자까지입니다.")
    description = str(data.get("description") or "").strip()
    if len(description) > 500:
        raise DeckError("덱 설명은 500자까지입니다.")
    main, extra = data.get("main", []), data.get("extra", [])
    check(main, extra)
    if "cover_cards" in data:
        covers = data["cover_cards"]
    else:
        covers = [i for i in covers if i in set(main) | set(extra)]
    check_covers(covers, main, extra)
    return {"name": name, "description": description, "main": main, "extra": extra, "cover_cards": covers}


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def deck_lists(request):
    """The signed-in member's deck lists, the last changed first; or a new one saved."""
    if request.method == "GET":
        return Response({"decks": [_row(d) for d in DeckList.objects.filter(owner=request.user, kind=DeckList.Kind.OWN)]})
    try:
        fields = _fields(request.data)
    except DeckError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        if DeckList.objects.filter(owner=request.user, kind=DeckList.Kind.OWN).count() >= DECKS_MAX:
            return Response({"error": f"덱은 {DECKS_MAX}개까지 저장할 수 있습니다."}, status=status.HTTP_400_BAD_REQUEST)
        d = DeckList.objects.create(owner=request.user, code=DeckList.new_code(), **fields)
    return Response(_full(d), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def deck_list(request, code):
    """One of the member's deck lists: read, changed or deleted (no one else's yet)."""
    d = DeckList.objects.filter(code=code, owner=request.user).first()
    if d is None:
        raise Http404
    if request.method != "GET" and d.kind == DeckList.Kind.ENTRY:
        return Response({"error": ENTRY_ERROR}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "DELETE":
        d.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "PUT":
        try:
            fields = _fields(request.data, d.cover_cards)
        except DeckError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        for k, v in fields.items():
            setattr(d, k, v)
        d.save()
    return Response(_full(d))
