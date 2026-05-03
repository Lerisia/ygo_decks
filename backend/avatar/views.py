from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from card.models import Card
from .models import CardIcon
from .serializers import CardIconSerializer


@api_view(["GET"])
@permission_classes([IsAdminUser])
def list_icons(request):
    icons = CardIcon.objects.select_related("card").all()
    return Response({"icons": CardIconSerializer(icons, many=True).data})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def create_icon(request):
    card_id = request.data.get("card") or request.data.get("card_id")
    if not card_id:
        return Response({"error": "card 필드가 필요합니다."}, status=400)

    card = None
    try:
        card = Card.objects.get(pk=int(card_id))
    except (Card.DoesNotExist, ValueError, TypeError):
        try:
            card = Card.objects.get(card_id=str(card_id))
        except Card.DoesNotExist:
            return Response({"error": "카드를 찾을 수 없습니다."}, status=404)

    try:
        cx = float(request.data.get("center_x"))
        cy = float(request.data.get("center_y"))
        r = float(request.data.get("radius"))
    except (TypeError, ValueError):
        return Response({"error": "center_x, center_y, radius는 숫자여야 합니다."}, status=400)

    if not (0 <= cx <= 1 and 0 <= cy <= 1 and 0 < r <= 1):
        return Response({"error": "좌표 범위가 유효하지 않습니다."}, status=400)

    icon = CardIcon.objects.create(
        card=card,
        title=(request.data.get("title") or "")[:80],
        center_x=cx,
        center_y=cy,
        radius=r,
        created_by=request.user,
    )
    return Response(CardIconSerializer(icon).data, status=201)


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def update_icon(request, icon_id):
    icon = get_object_or_404(CardIcon, id=icon_id)
    for field in ("title", "center_x", "center_y", "radius"):
        if field in request.data:
            setattr(icon, field, request.data[field])
    icon.save()
    return Response(CardIconSerializer(icon).data)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def delete_icon(request, icon_id):
    icon = get_object_or_404(CardIcon, id=icon_id)
    icon.delete()
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def search_cards(request):
    q = (request.GET.get("q") or "").strip()
    qs = Card.objects.filter(card_illust__isnull=False).exclude(card_illust="")
    if q:
        qs = qs.filter(korean_name__icontains=q)
    qs = qs.order_by("korean_name")[:30]
    results = [
        {
            "id": c.id,
            "card_id": c.card_id,
            "name": c.korean_name or c.name,
            "image_url": c.card_illust.url if c.card_illust else None,
        }
        for c in qs
    ]
    return Response({"results": results})
