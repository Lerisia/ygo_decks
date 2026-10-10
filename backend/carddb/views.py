"""Staff review of 카드군: names and members, with every change in the admin log."""
from django.contrib.admin.models import CHANGE, LogEntry
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .display import art_url, display_name, thumb_url
from .models import Card, CardGroup, CardGroupMember

PAGE_SIZE = 50


def _log(request, group, message):
    LogEntry.objects.log_actions(user_id=request.user.id, queryset=CardGroup.objects.filter(id=group.id),
                                 action_flag=CHANGE, change_message=message)


def _row(g, members):
    return {
        "id": g.id, "text": g.text, "reading": g.reading if g.reading != g.text else "",
        "name_ko": g.name_ko, "name_source": g.name_source,
        "name_agreement": g.name_agreement, "name_coverage": g.name_coverage,
        "members": members, "md_list": g.md_list, "needs_review": g.needs_review, "minor": g.minor,
        "parent": {"id": g.parent_id, "text": g.parent.text, "name_ko": g.parent.name_ko} if g.parent_id else None,
    }


def _active():
    return Count("members", filter=~Q(members__how=CardGroupMember.How.REMOVED))


@api_view(["GET"])
@permission_classes([IsAdminUser])
def card_groups(request):
    q = (request.query_params.get("q") or "").strip()
    try:
        page = max(1, int(request.query_params.get("page") or 1))
    except ValueError:
        page = 1
    qs = CardGroup.objects.select_related("parent").annotate(n=_active())
    if q:
        qs = qs.filter(Q(text__icontains=q) | Q(name_ko__icontains=q) | Q(reading__icontains=q))
    if request.query_params.get("review") == "1":
        qs = qs.filter(needs_review=True)
    qs = qs.order_by("-needs_review", "-n", "text")
    total = qs.count()
    rows = [_row(g, g.n) for g in qs[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]]
    return Response({
        "results": rows, "total": total, "page": page, "page_size": PAGE_SIZE,
        "all_count": CardGroup.objects.count(), "review_count": CardGroup.objects.filter(needs_review=True).count(),
    })


def _detail(g):
    members = []
    for m in g.members.select_related("card"):
        c = m.card
        members.append({"card_id": c.id, "name": display_name(c), "name_ja": c.name_ja, "how": m.how,
                        "image_url": thumb_url(c.id) or art_url(c.id)})
    members.sort(key=lambda m: (m["how"] == CardGroupMember.How.REMOVED, m["name"]))
    children = list(g.children.annotate(n=_active()).order_by("text"))
    active = sum(1 for m in members if m["how"] != CardGroupMember.How.REMOVED)
    return {"group": _row(g, active), "members": members,
            "children": [{"id": c.id, "text": c.text, "name_ko": c.name_ko, "members": c.n} for c in children]}


@api_view(["GET", "PATCH"])
@permission_classes([IsAdminUser])
def card_group(request, group_id):
    g = get_object_or_404(CardGroup.objects.select_related("parent"), id=group_id)
    if request.method == "PATCH":
        changes = []
        if "name_ko" in request.data:
            name = (request.data.get("name_ko") or "").strip()[:120]
            if not name:
                return Response({"error": "한국어 이름을 입력해 주세요."}, status=400)
            changes.append(f"한국어 이름: {g.name_ko or '(없음)'} → {name}")
            g.name_ko, g.name_source = name, CardGroup.NameSource.MANUAL
            g.needs_review = False
        if "minor" in request.data:
            g.minor = bool(request.data.get("minor"))
            changes.append("효과용 소분류로 표시" if g.minor else "효과용 소분류 표시 해제")
        if request.data.get("reviewed"):
            changes.append(f"확인 완료: {g.name_ko}")
            g.name_source, g.needs_review = CardGroup.NameSource.MANUAL, False
        if changes:
            g.save()
            _log(request, g, "; ".join(changes))
    return Response(_detail(g))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def card_group_member(request, group_id):
    g = get_object_or_404(CardGroup, id=group_id)
    action = request.data.get("action")
    try:
        card = Card.objects.get(id=int(request.data.get("card_id")))
    except (Card.DoesNotExist, TypeError, ValueError):
        return Response({"error": "카드를 찾을 수 없습니다."}, status=404)
    if action not in ("add", "remove"):
        return Response({"error": "action은 add 또는 remove입니다."}, status=400)
    how = CardGroupMember.How.ADDED if action == "add" else CardGroupMember.How.REMOVED
    row = CardGroupMember.objects.filter(group=g, card=card).first()
    if action == "add" and row and row.how not in CardGroupMember.MANUAL:
        return Response(_detail(g))
    CardGroupMember.objects.update_or_create(group=g, card=card, defaults={"how": how})
    _log(request, g, f"{'회원 추가' if action == 'add' else '회원 제외'}: {display_name(card)} ({card.id})")
    return Response(_detail(g))
