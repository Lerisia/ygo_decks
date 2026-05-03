from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated, AllowAny
from rest_framework.response import Response

from card.models import Card
from .models import CardIcon, Border, UserBorderUnlock
from .serializers import CardIconSerializer, BorderSerializer


def _resolve_default_icon():
    """Return the default 'Kuriboh' icon if available, else first icon, else None."""
    icon = (
        CardIcon.objects
        .filter(card__korean_name="크리보")
        .select_related("card")
        .first()
    )
    if not icon:
        icon = CardIcon.objects.select_related("card").first()
    return icon


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
@permission_classes([AllowAny])
def public_list_icons(request):
    """User-facing icon list: sorted by Korean card name, optional ?q= search."""
    q = (request.GET.get("q") or "").strip()
    qs = CardIcon.objects.select_related("card").all()
    if q:
        qs = qs.filter(card__korean_name__icontains=q) | qs.filter(title__icontains=q)
    qs = qs.distinct().order_by("card__korean_name", "id")
    return Response({"icons": CardIconSerializer(qs, many=True).data})


def _resolve_default_border():
    return Border.objects.filter(is_default=True).first() or Border.objects.first()


def _ensure_default_unlock(user):
    """Make sure the user has the default border in their unlocks."""
    default_border = Border.objects.filter(is_default=True).first()
    if default_border:
        UserBorderUnlock.objects.get_or_create(user=user, border=default_border)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_avatar(request):
    """Get current user's avatar + border (with defaults)."""
    user = request.user
    icon = user.avatar_icon
    if icon is None:
        icon = _resolve_default_icon()

    border = user.equipped_border
    if border is None:
        border = _resolve_default_border()

    return Response({
        "icon": CardIconSerializer(icon).data if icon else None,
        "is_default_icon": user.avatar_icon is None,
        "border": BorderSerializer(border).data if border else None,
        "is_default_border": user.equipped_border is None,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_borders(request):
    """List borders the user has unlocked."""
    user = request.user
    _ensure_default_unlock(user)
    qs = Border.objects.filter(user_unlocks__user=user).distinct().order_by("sort_order", "id")
    return Response({"borders": BorderSerializer(qs, many=True).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def set_my_border(request):
    """Equip a border the user has unlocked. Pass null to reset to default."""
    user = request.user
    border_id = request.data.get("border_id")
    if border_id is None:
        user.equipped_border = None
        user.save(update_fields=["equipped_border"])
        return Response({"ok": True, "border": None})
    try:
        border = Border.objects.get(id=int(border_id))
    except (Border.DoesNotExist, ValueError, TypeError):
        return Response({"error": "테두리를 찾을 수 없습니다."}, status=404)
    if not UserBorderUnlock.objects.filter(user=user, border=border).exists():
        return Response({"error": "잠금 해제되지 않은 테두리입니다."}, status=403)
    user.equipped_border = border
    user.save(update_fields=["equipped_border"])
    return Response({"ok": True, "border": BorderSerializer(border).data})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def grant_border(request):
    """Admin: grant a border to a user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    user_id = request.data.get("user_id")
    border_id = request.data.get("border_id")
    note = request.data.get("note", "")
    try:
        target = User.objects.get(id=int(user_id))
        border = Border.objects.get(id=int(border_id))
    except (User.DoesNotExist, Border.DoesNotExist, ValueError, TypeError):
        return Response({"error": "유저나 테두리를 찾을 수 없습니다."}, status=404)
    UserBorderUnlock.objects.get_or_create(user=target, border=border, defaults={"note": note})
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def set_my_avatar(request):
    """Set the current user's avatar to a CardIcon (or null to reset to default)."""
    icon_id = request.data.get("icon_id")
    user = request.user
    if icon_id is None:
        user.avatar_icon = None
        user.save(update_fields=["avatar_icon"])
        return Response({"ok": True, "icon": None})
    try:
        icon = CardIcon.objects.get(id=int(icon_id))
    except (CardIcon.DoesNotExist, ValueError, TypeError):
        return Response({"error": "아이콘을 찾을 수 없습니다."}, status=404)
    user.avatar_icon = icon
    user.save(update_fields=["avatar_icon"])
    return Response({"ok": True, "icon": CardIconSerializer(icon).data})


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
