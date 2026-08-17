from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated, AllowAny
from rest_framework.response import Response

from card.models import Card
from .models import CardIcon, Border, UserBorderUnlock, UserIconUnlock, CustomIllust, TwitterCredentials
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
    icons = CardIcon.objects.select_related("card", "custom_illust").all()
    return Response({"icons": CardIconSerializer(icons, many=True).data})


VALID_CATEGORIES = {"default", "shop", "exclusive"}
VALID_RARITIES = set(CardIcon.RARITY_PRICE_MAP.keys())


def _resolve_category_rarity(data, current=None):
    """Compute (category, rarity, price) given input data.
    For shop items, price is auto-derived from rarity using CardIcon.RARITY_PRICE_MAP.
    For non-shop items, price=0 and rarity is allowed but not enforced.
    """
    cat = (data.get("category") or (current.category if current else "exclusive")).strip()
    if cat not in VALID_CATEGORIES:
        cat = "exclusive"
    rarity_in = data.get("rarity")
    if rarity_in is None and current is not None:
        rarity = current.rarity or ""
    else:
        rarity = (rarity_in or "").strip()
    if rarity not in VALID_RARITIES:
        rarity = ""
    if cat == "shop":
        if not rarity:
            rarity = "common"
        price = CardIcon.RARITY_PRICE_MAP[rarity]
    else:
        price = 0
    return cat, rarity, price


@api_view(["POST"])
@permission_classes([IsAdminUser])
def create_icon(request):
    card_id = request.data.get("card") or request.data.get("card_id")
    custom_illust_id = request.data.get("custom_illust") or request.data.get("custom_illust_id")
    if not card_id and not custom_illust_id:
        return Response({"error": "card 또는 custom_illust 필드가 필요합니다."}, status=400)

    card = None
    custom_illust = None
    if custom_illust_id:
        try:
            custom_illust = CustomIllust.objects.get(pk=int(custom_illust_id))
        except (CustomIllust.DoesNotExist, ValueError, TypeError):
            return Response({"error": "커스텀 일러스트를 찾을 수 없습니다."}, status=404)
    else:
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

    cat, rarity, price = _resolve_category_rarity(request.data)
    title = (request.data.get("title") or "")[:80]
    theme = (request.data.get("theme") or "")[:80].strip()
    # If a non-empty title collides with an existing icon, overwrite that
    # row in place so every UserIconUnlock pointing at it instantly sees
    # the new artwork — handy for fixing a bad crop without re-granting.
    existing = CardIcon.objects.filter(title=title).first() if title else None
    if existing:
        existing.card = card
        existing.custom_illust = custom_illust
        existing.center_x = cx
        existing.center_y = cy
        existing.radius = r
        existing.category = cat
        existing.rarity = rarity
        existing.price = price
        existing.theme = theme
        existing.save()
        return Response(CardIconSerializer(existing).data, status=200)
    icon = CardIcon.objects.create(
        card=card,
        custom_illust=custom_illust,
        title=title,
        center_x=cx,
        center_y=cy,
        radius=r,
        category=cat,
        rarity=rarity,
        price=price,
        theme=theme,
        created_by=request.user,
    )
    return Response(CardIconSerializer(icon).data, status=201)


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def update_icon(request, icon_id):
    icon = get_object_or_404(CardIcon, id=icon_id)
    # Reject title rename that would collide with another icon's title.
    if "title" in request.data:
        new_title = (request.data.get("title") or "")[:80]
        if new_title and CardIcon.objects.filter(title=new_title).exclude(id=icon.id).exists():
            return Response({"error": f"이미 '{new_title}' 이름의 아이콘이 있습니다."}, status=400)
    for field in ("title", "center_x", "center_y", "radius"):
        if field in request.data:
            setattr(icon, field, request.data[field])
    if "theme" in request.data:
        icon.theme = (request.data.get("theme") or "")[:80].strip()
    if "category" in request.data or "rarity" in request.data or "price" in request.data:
        new_cat, new_rarity, new_price = _resolve_category_rarity({
            "category": request.data.get("category", icon.category),
            "rarity": request.data.get("rarity", icon.rarity),
        }, current=icon)
        icon.category = new_cat
        icon.rarity = new_rarity
        icon.price = new_price
    icon.save()
    return Response(CardIconSerializer(icon).data)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def delete_icon(request, icon_id):
    icon = get_object_or_404(CardIcon, id=icon_id)
    icon.delete()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def set_icon_new(request, icon_id):
    """Admin: toggle shop_listed_at to surface or hide the '신규 출시!'
    badge in the shop. POST body {is_new: bool}. true → stamp now;
    false → null out so the badge disappears immediately."""
    icon = get_object_or_404(CardIcon, id=icon_id)
    is_new = bool(request.data.get("is_new"))
    if is_new:
        from django.utils import timezone
        icon.shop_listed_at = timezone.now()
    else:
        icon.shop_listed_at = None
    icon.save(update_fields=["shop_listed_at"])
    return Response({"id": icon.id, "shop_listed_at": icon.shop_listed_at})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def bulk_set_theme(request):
    """Admin: assign a theme tag to multiple icons at once."""
    ids = request.data.get("icon_ids") or []
    if not isinstance(ids, list) or not ids:
        return Response({"error": "icon_ids는 비어있지 않은 배열이어야 합니다."}, status=400)
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return Response({"error": "icon_ids 값이 유효하지 않습니다."}, status=400)
    theme = (request.data.get("theme") or "")[:80].strip()
    updated = CardIcon.objects.filter(id__in=ids).update(theme=theme)
    return Response({"ok": True, "updated": updated, "theme": theme})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_icons(request):
    """Icons available to the current user: default category + their unlocked icons.
    Sorted by Korean card name. Optional ?q= search.
    """
    from django.db.models import Q
    user = request.user
    q = (request.GET.get("q") or "").strip()
    qs = CardIcon.objects.select_related("card").filter(
        Q(category="default") | Q(user_unlocks__user=user)
    )
    if q:
        qs = qs.filter(Q(card__korean_name__icontains=q) | Q(title__icontains=q))
    qs = qs.distinct().order_by("card__korean_name", "id")
    return Response({"icons": CardIconSerializer(qs, many=True).data})


@api_view(["GET"])
@permission_classes([AllowAny])
def shop_list_icons(request):
    """Shop only shows purchasable icons (category="shop"). 기본 지급/비매품은 노출 안 함.
    Icons listed within the last NEW_DAYS are flagged is_new=true and
    surfaced at the top; admin can null out shop_listed_at to drop an
    item off the new-arrivals row early."""
    from datetime import timedelta
    from django.utils import timezone
    NEW_DAYS = 7
    cutoff = timezone.now() - timedelta(days=NEW_DAYS)

    q = (request.GET.get("q") or "").strip()
    qs = CardIcon.objects.select_related("card").filter(category="shop")
    if q:
        qs = qs.filter(card__korean_name__icontains=q) | qs.filter(title__icontains=q)
    # Newest-first within the "new arrivals" window, then alphabetical.
    # NULLS LAST so admin-cleared listings drop into the regular bucket.
    qs = qs.distinct().order_by(
        models.F("shop_listed_at").desc(nulls_last=True),
        "card__korean_name", "id",
    )

    user = request.user if request.user.is_authenticated else None
    owned_ids = set()
    if user:
        owned_ids = set(
            UserIconUnlock.objects.filter(user=user).values_list("icon_id", flat=True)
        )
    data = CardIconSerializer(qs, many=True).data
    icons_by_id = {ic.id: ic for ic in qs}
    for d in data:
        d["owned"] = (d["category"] == "default") or (d["id"] in owned_ids)
        ic = icons_by_id.get(d["id"])
        listed = ic.shop_listed_at if ic else None
        d["shop_listed_at"] = listed.isoformat() if listed else None
        d["is_new"] = bool(listed and listed >= cutoff)
    return Response({"icons": data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def purchase_icon(request, icon_id):
    """Authenticated user buys a shop icon. Deducts price from user.points
    (lifetime_points_earned is NOT decremented — that's cumulative earning)
    and creates a UserIconUnlock. Atomic + lock to avoid double-spend on
    rapid double-clicks."""
    from django.db import transaction
    from django.contrib.auth import get_user_model
    User = get_user_model()
    try:
        icon = CardIcon.objects.get(id=int(icon_id))
    except (CardIcon.DoesNotExist, ValueError, TypeError):
        return Response({"error": "아이콘을 찾을 수 없습니다."}, status=404)
    if icon.category != "shop":
        return Response({"error": "구매할 수 없는 아이콘입니다."}, status=400)
    price = int(icon.price or 0)
    if price <= 0:
        return Response({"error": "가격이 설정되지 않은 아이콘입니다."}, status=400)
    with transaction.atomic():
        u = User.objects.select_for_update().get(pk=request.user.id)
        if UserIconUnlock.objects.filter(user=u, icon=icon).exists():
            return Response({"error": "이미 보유 중입니다.", "points": u.points}, status=400)
        if (u.points or 0) < price:
            return Response({"error": "포인트가 부족합니다.", "points": u.points, "price": price}, status=400)
        u.points = u.points - price
        u.save(update_fields=["points"])
        UserIconUnlock.objects.create(user=u, icon=icon, note="shop purchase")
        # Audit log: spend transaction visible on /mypage/points.
        from user.models import PointTransaction
        PointTransaction.objects.create(
            user=u, amount=-price, kind="icon_purchase",
            note=(icon.title or "")[:200], balance_after=u.points,
        )
    return Response({"ok": True, "points": u.points, "icon_id": icon.id})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def grant_icon(request):
    """Admin: grant an icon to a user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    user_id = request.data.get("user_id")
    icon_id = request.data.get("icon_id")
    note = request.data.get("note", "")
    try:
        target = User.objects.get(id=int(user_id))
        icon = CardIcon.objects.get(id=int(icon_id))
    except (User.DoesNotExist, CardIcon.DoesNotExist, ValueError, TypeError):
        return Response({"error": "유저나 아이콘을 찾을 수 없습니다."}, status=404)
    UserIconUnlock.objects.get_or_create(user=target, icon=icon, defaults={"note": note})
    return Response({"ok": True})


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
    """List ALL borders, marking which ones the user has unlocked and what
    the unlock condition is for the locked ones."""
    from user.points import BORDER_TIERS
    user = request.user
    _ensure_default_unlock(user)
    unlocked_ids = set(
        UserBorderUnlock.objects.filter(user=user).values_list("border_id", flat=True)
    )
    threshold_by_key = {key: thr for thr, key in BORDER_TIERS}
    out = []
    for b in Border.objects.all().order_by("sort_order", "id"):
        data = BorderSerializer(b).data
        data["unlocked"] = b.id in unlocked_ids
        thr = threshold_by_key.get(b.key)
        if b.is_default:
            data["unlock_condition"] = "기본 지급"
        elif b.key == "admin":
            data["unlock_condition"] = "관리자 전용"
        elif thr is not None:
            data["unlock_condition"] = f"누적 포인트 {thr:,}P 달성"
        else:
            data["unlock_condition"] = "특별 지급"
        out.append(data)
    return Response({"borders": out})


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


@api_view(["GET"])
@permission_classes([AllowAny])
def shop_list_borders(request):
    """Shop tab: purchasable borders (category='shop'). Marks owned ones —
    a border is 'owned' if the user has a UserBorderUnlock OR it's a
    default-category border (free for everyone)."""
    qs = Border.objects.filter(category="shop").order_by("sort_order", "id")
    user = request.user if request.user.is_authenticated else None
    owned_ids = set(
        UserBorderUnlock.objects.filter(user=user).values_list("border_id", flat=True)
    ) if user else set()
    data = BorderSerializer(qs, many=True).data
    for d in data:
        d["owned"] = (d["category"] == "default") or (d["id"] in owned_ids)
    return Response({"borders": data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def purchase_border(request, border_id):
    """Buy a shop border with points. Atomic + row lock vs double-spend.
    Mirrors purchase_icon — deducts user.points, logs a PointTransaction."""
    from django.db import transaction
    from django.contrib.auth import get_user_model
    User = get_user_model()
    try:
        border = Border.objects.get(id=int(border_id))
    except (Border.DoesNotExist, ValueError, TypeError):
        return Response({"error": "테두리를 찾을 수 없습니다."}, status=404)
    if border.category != "shop":
        return Response({"error": "구매할 수 없는 테두리입니다."}, status=400)
    price = int(border.price or 0)
    if price <= 0:
        return Response({"error": "가격이 설정되지 않은 테두리입니다."}, status=400)
    with transaction.atomic():
        u = User.objects.select_for_update().get(pk=request.user.id)
        if UserBorderUnlock.objects.filter(user=u, border=border).exists():
            return Response({"error": "이미 보유 중입니다.", "points": u.points}, status=400)
        if (u.points or 0) < price:
            return Response({"error": "포인트가 부족합니다.", "points": u.points, "price": price}, status=400)
        u.points = u.points - price
        u.save(update_fields=["points"])
        UserBorderUnlock.objects.create(user=u, border=border, note="shop purchase")
        from user.models import PointTransaction
        PointTransaction.objects.create(
            user=u, amount=-price, kind="border_purchase",
            note=(border.name or "")[:200], balance_after=u.points,
        )
    return Response({"ok": True, "points": u.points, "border_id": border.id})


@api_view(["GET"])
@permission_classes([IsAdminUser])
def list_borders_admin(request):
    """Admin: every border with its category/rarity/price for the
    icon-management '테두리' tab. (Borders are seeded fixtures — no
    create/delete here, just re-pricing.)"""
    qs = Border.objects.all().order_by("sort_order", "id")
    return Response({"borders": BorderSerializer(qs, many=True).data})


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def update_border(request, border_id):
    """Admin: set a border's category + rarity. Price is auto-derived in
    Border.save() (shop+rarity → RARITY_PRICE_MAP, else 0)."""
    try:
        border = Border.objects.get(id=int(border_id))
    except (Border.DoesNotExist, ValueError, TypeError):
        return Response({"error": "테두리를 찾을 수 없습니다."}, status=404)
    valid_cat = {c[0] for c in Border.CATEGORY_CHOICES}
    valid_rar = {r[0] for r in Border.RARITY_CHOICES}
    if "category" in request.data:
        cat = (request.data.get("category") or "").strip()
        if cat in valid_cat:
            border.category = cat
    if "rarity" in request.data:
        rar = (request.data.get("rarity") or "").strip()
        border.rarity = rar if rar in valid_rar else ""
    if border.category == "shop" and not border.rarity:
        border.rarity = "rare"  # shop borders need a tier for pricing
    border.save()
    return Response(BorderSerializer(border).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def set_my_avatar(request):
    """Set the current user's avatar to a CardIcon they own (or null to reset)."""
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
    is_default = icon.category == "default"
    is_unlocked = UserIconUnlock.objects.filter(user=user, icon=icon).exists()
    if not (is_default or is_unlocked):
        return Response({"error": "보유하지 않은 아이콘입니다."}, status=403)
    user.avatar_icon = icon
    user.save(update_fields=["avatar_icon"])
    return Response({"ok": True, "icon": CardIconSerializer(icon).data})


@api_view(["GET"])
@permission_classes([AllowAny])
def list_themes(request):
    """All non-empty distinct theme tags currently in use."""
    themes = (
        CardIcon.objects.exclude(theme="")
        .values_list("theme", flat=True)
        .distinct()
        .order_by("theme")
    )
    return Response({"themes": list(themes)})


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


@api_view(["GET"])
@permission_classes([IsAdminUser])
def list_custom_illusts(request):
    """List/search admin-uploaded custom illustrations for icon creation.
    Paginated 20-per-page, newest first."""
    q = (request.GET.get("q") or "").strip()
    try:
        page = max(1, int(request.GET.get("page") or 1))
    except (ValueError, TypeError):
        page = 1
    PAGE_SIZE = 20
    qs = CustomIllust.objects.all()
    if q:
        qs = qs.filter(name__icontains=q)
    total = qs.count()
    qs = qs.order_by("-created_at")[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
    results = [
        {"id": c.id, "name": c.name, "image_url": c.image.url if c.image else None}
        for c in qs
    ]
    return Response({
        "results": results,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "total_pages": max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def upload_custom_illust(request):
    """Admin uploads a high-res illustration to the icon-creation pool.
    multipart/form-data: name (required), image (file, required)."""
    name = (request.data.get("name") or "").strip()
    image = request.FILES.get("image")
    if not name:
        return Response({"error": "name이 필요합니다."}, status=400)
    if not image:
        return Response({"error": "image 파일이 필요합니다."}, status=400)
    obj = CustomIllust.objects.create(name=name[:100], image=image)
    return Response(
        {"id": obj.id, "name": obj.name, "image_url": obj.image.url if obj.image else None},
        status=201,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def twitter_credentials(request):
    """GET → returns whether creds are configured + last-updated timestamp
    (does NOT echo the cookies). POST → upserts new auth_token + ct0."""
    if request.method == "GET":
        cred = TwitterCredentials.objects.order_by("-updated_at").first()
        if not cred:
            return Response({"configured": False})
        return Response({
            "configured": True,
            "updated_at": cred.updated_at.isoformat(),
            "note": cred.note,
            # Last 4 chars only, so the admin can sanity-check without
            # exposing the full token in any DB dump or screenshot.
            "auth_token_tail": "…" + cred.auth_token[-4:] if cred.auth_token else "",
            "ct0_tail": "…" + cred.ct0[-4:] if cred.ct0 else "",
        })
    auth_token = (request.data.get("auth_token") or "").strip()
    ct0 = (request.data.get("ct0") or "").strip()
    note = (request.data.get("note") or "").strip()
    if not auth_token or not ct0:
        return Response({"error": "auth_token + ct0 둘 다 필요합니다."}, status=400)
    # Replace existing — only one set of creds is used at a time.
    TwitterCredentials.objects.all().delete()
    TwitterCredentials.objects.create(auth_token=auth_token, ct0=ct0, note=note)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def scrape_twitter_range(request):
    """Search OCG official tweets in a date range using stored cookies,
    download images that pass the SAMPLE filter, save as CustomIllust.

    Body: { since: 'YYYY-MM-DD', until: 'YYYY-MM-DD',
            username: 'YuGiOh_OCG_INFO' (optional, default OCG official) }"""
    import time
    from datetime import datetime
    import requests
    from PIL import Image
    from io import BytesIO
    from django.core.files.base import ContentFile

    cred = TwitterCredentials.objects.order_by("-updated_at").first()
    if not cred:
        return Response({"error": "Twitter 쿠키가 설정되지 않았습니다."}, status=400)

    since = (request.data.get("since") or "").strip()
    until = (request.data.get("until") or "").strip()
    username = (request.data.get("username") or "YuGiOh_OCG_INFO").strip()
    try:
        d_since = datetime.strptime(since, "%Y-%m-%d")
        d_until = datetime.strptime(until, "%Y-%m-%d")
    except ValueError:
        return Response({"error": "since/until은 YYYY-MM-DD 형식이어야 합니다."}, status=400)
    if (d_until - d_since).days > 90:
        return Response({"error": "한 번에 90일 이내로 요청해주세요."}, status=400)

    # Use tweety-ns for the actual scrape — it tracks Twitter's GraphQL
    # query-id changes internally so we don't need to hardcode.
    try:
        from tweety import TwitterAsync as _Async  # noqa: F401
    except Exception:
        pass
    from tweety import Twitter

    app = Twitter("ocg_scraper_session")
    try:
        # tweety can authenticate via cookies (no full account login).
        app.load_auth_token(cred.auth_token)
        # ct0 is auto-derived but we set it just in case.
        try:
            app.session.cookies.set("ct0", cred.ct0)
        except Exception:
            pass
    except Exception as e:
        return Response({"error": f"Twitter 인증 실패: {e}"}, status=502)

    raw_query = f"from:{username} since:{since} until:{until} filter:images"

    # tweety paginates ~20 tweets per page. 12 pages covers a busy
    # 90-day range (~240 tweets) without blowing past Twitter's
    # rate limit for a single search session.
    try:
        search = app.search(raw_query, filter_=None, pages=12)
    except Exception as e:
        return Response({"error": f"검색 실패: {e}"}, status=502)

    MIN_DIM = 1000

    def is_sample(w, h):
        # Square-only: single-card SAMPLE reveal posts come at ~1080×1080.
        # Pack-reveal composites (1596×1200) are excluded because they
        # cram pack art + card together and the SAMPLE region isn't a
        # clean avatar source.
        if w < MIN_DIM or h < MIN_DIM:
            return False
        a = w / h if h else 0
        return 0.95 <= a <= 1.05

    imported, skipped, duplicates, errors = [], [], 0, 0

    seen_ids = 0
    for tweet in search:
        seen_ids += 1
        if seen_ids > 1:
            time.sleep(1.0)  # be nice
        tweet_id = str(getattr(tweet, "id", "") or "")
        if not tweet_id:
            continue
        if CustomIllust.objects.filter(source_tweet_id=tweet_id).exists():
            duplicates += 1
            continue
        media_list = getattr(tweet, "media", None) or []
        for idx, m in enumerate(media_list):
            url = getattr(m, "media_url_https", None) or getattr(m, "url", None)
            if not url:
                continue
            # Twitter sometimes preserves PNG when the original upload
            # was PNG (especially older single-card SAMPLE reveals). Try
            # PNG first, fall back to JPEG. Either way name=orig gets
            # the largest variant.
            base_url = url.split("?")[0]
            png_url = base_url.rsplit(".", 1)[0] + ".png?name=orig"
            jpg_url = base_url + "?name=orig"
            r = None
            for attempt in (png_url, jpg_url):
                try:
                    rr = requests.get(attempt, timeout=20)
                    if rr.status_code == 200 and rr.content:
                        r = rr
                        used_url = attempt
                        break
                except Exception:
                    continue
            if r is None:
                errors += 1
                skipped.append({"tweet": tweet_id, "reason": "download failed"})
                continue
            try:
                with Image.open(BytesIO(r.content)) as im:
                    w, h = im.size
            except Exception as e:
                errors += 1
                skipped.append({"tweet": tweet_id, "reason": f"unreadable: {e}"})
                continue
            if not is_sample(w, h):
                skipped.append({"tweet": tweet_id, "reason": f"size {w}x{h}"})
                continue
            # Use the actual URL we successfully fetched to derive ext.
            ext = "png" if used_url.split("?")[0].endswith(".png") else "jpg"
            filename = f"tweet_{tweet_id}_{idx}.{ext}"
            # Build a human-friendly name from tweet text. OCG_INFO posts
            # the card name in the body, often inside 「」 brackets — try
            # to extract the first quoted name; map to our Korean name via
            # Card.name_ja so the admin sees recognizable Hangul instead
            # of raw kanji. Falls back to the JP name if no DB match.
            tweet_text = (getattr(tweet, "text", "") or "").strip()
            import re as _re
            m_quote = _re.search(r"[「『]([^」』]+)[」』]", tweet_text)
            if m_quote:
                jp_name = m_quote.group(1).strip()
                kr_match = Card.objects.filter(name_ja=jp_name).first()
                if kr_match and kr_match.korean_name:
                    base = kr_match.korean_name
                else:
                    base = jp_name
            else:
                cleaned = _re.sub(r"https?://\S+", "", tweet_text)
                cleaned = _re.sub(r"#\S+", "", cleaned).strip()
                base = cleaned.split("\n")[0][:60] if cleaned else f"트윗 {tweet_id}"
            name = base + (f" #{idx + 1}" if len(media_list) > 1 else "")
            obj = CustomIllust(name=name[:100], source_tweet_id=tweet_id)
            obj.image.save(filename, ContentFile(r.content), save=True)
            imported.append({"id": obj.id, "name": obj.name, "image_url": obj.image.url})

    return Response({
        "query": raw_query,
        "tweets_seen": seen_ids,
        "imported": imported,
        "imported_count": len(imported),
        "skipped": skipped,
        "skipped_count": len(skipped),
        "duplicates": duplicates,
        "errors": errors,
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def bulk_upload_custom_illusts(request):
    """Multi-file upload with size/aspect filtering. Reuses the same
    `is_likely_sample` rules as import_twitter_dump so the filter is
    consistent across CLI and admin UI. multipart: images[] (multiple)."""
    from PIL import Image
    files = request.FILES.getlist("images")
    if not files:
        return Response({"error": "images 파일이 없습니다."}, status=400)

    MIN_DIM = 1000

    def is_sample(w, h):
        # Square-only — see scrape_twitter_range for rationale.
        if w < MIN_DIM or h < MIN_DIM:
            return False, f"too small ({w}x{h})"
        a = w / h if h else 0
        if 0.95 <= a <= 1.05:
            return True, "single"
        return False, f"aspect {a:.2f} not square"

    imported, skipped, duplicates = [], [], 0
    for f in files:
        try:
            f.seek(0)
            with Image.open(f) as im:
                w, h = im.size
        except Exception as e:
            skipped.append({"name": f.name, "reason": f"unreadable: {e}"})
            continue
        ok, reason = is_sample(w, h)
        if not ok:
            skipped.append({"name": f.name, "reason": reason})
            continue
        # Name = filename stem
        from pathlib import Path
        name = Path(f.name).stem[:100]
        if CustomIllust.objects.filter(name=name).exists():
            duplicates += 1
            continue
        f.seek(0)
        obj = CustomIllust(name=name)
        obj.image.save(f.name, f, save=True)
        imported.append({"id": obj.id, "name": obj.name, "image_url": obj.image.url})

    return Response({
        "imported": imported,
        "imported_count": len(imported),
        "skipped": skipped,
        "skipped_count": len(skipped),
        "duplicates": duplicates,
    }, status=201 if imported else 200)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def import_tweet_illusts(request):
    """Pull every photo from a tweet URL and create one CustomIllust per
    image. Uses fxtwitter (community Twitter mirror) so we don't need
    auth/API keys; falls back gracefully if the tweet is photo-less.
    Body: { tweet_url, name (optional prefix, ' #N' suffix added when
    the tweet has multiple photos) }."""
    import re
    import requests
    from urllib.parse import urlparse
    from django.core.files.base import ContentFile

    tweet_url = (request.data.get("tweet_url") or "").strip()
    name_prefix = (request.data.get("name") or "").strip()
    m = re.search(r"/status(?:es)?/(\d+)", tweet_url)
    if not m:
        return Response({"error": "트윗 URL에서 ID를 추출할 수 없습니다."}, status=400)
    tweet_id = m.group(1)

    api_url = f"https://api.fxtwitter.com/i/status/{tweet_id}"
    try:
        r = requests.get(api_url, timeout=15, headers={"User-Agent": "ygodecks-importer/1.0"})
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return Response({"error": f"트윗 가져오기 실패: {e}"}, status=502)

    if data.get("code") != 200 or not data.get("tweet"):
        return Response({"error": "트윗을 찾을 수 없습니다 (비공개/삭제됨)."}, status=404)

    photos = ((data.get("tweet") or {}).get("media") or {}).get("photos") or []
    if not photos:
        return Response({"error": "트윗에 이미지가 없습니다."}, status=400)

    # Try to surface a Korean card name from tweet text (single-tweet path
    # often comes with a name_prefix already, but auto-match still wins).
    tweet_text = (data.get("tweet") or {}).get("text") or ""
    auto_name = name_prefix
    if not auto_name:
        m_quote = re.search(r"[「『]([^」』]+)[」』]", tweet_text)
        if m_quote:
            jp_name = m_quote.group(1).strip()
            kr_match = Card.objects.filter(name_ja=jp_name).first()
            if kr_match and kr_match.korean_name:
                auto_name = kr_match.korean_name
            else:
                auto_name = jp_name

    created = []
    for i, p in enumerate(photos):
        img_url = p.get("url")
        if not img_url:
            continue
        # Try PNG (some older tweets preserve PNG) before falling back
        # to whatever fxtwitter returned. Same trick as the bulk scraper.
        base = img_url.split("?")[0]
        png_url = base.rsplit(".", 1)[0] + ".png?name=orig"
        candidates = [png_url, img_url]
        img_r = None
        used_url = None
        for u in candidates:
            try:
                rr = requests.get(u, timeout=20, headers={"User-Agent": "ygodecks-importer/1.0"})
                if rr.status_code == 200 and rr.content:
                    img_r = rr
                    used_url = u
                    break
            except Exception:
                continue
        if img_r is None:
            continue
        ext = "png" if used_url.split("?")[0].endswith(".png") else "jpg"
        filename = f"tweet_{tweet_id}_{i}.{ext}"
        if auto_name and len(photos) > 1:
            name = f"{auto_name} #{i + 1}"
        elif auto_name:
            name = auto_name
        elif len(photos) > 1:
            name = f"트윗 {tweet_id} #{i + 1}"
        else:
            name = f"트윗 {tweet_id}"
        obj = CustomIllust(name=name[:100], source_tweet_id=tweet_id)
        obj.image.save(filename, ContentFile(img_r.content), save=True)
        created.append({
            "id": obj.id, "name": obj.name,
            "image_url": obj.image.url if obj.image else None,
        })

    if not created:
        return Response({"error": "이미지 다운로드에 모두 실패했습니다."}, status=502)
    return Response({"created": created}, status=201)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def delete_custom_illust(request, illust_id):
    """Delete a custom illust. Cascading FK protect — fails if any
    CardIcon still references it. Caller should warn the admin first."""
    from django.db.models import ProtectedError
    obj = get_object_or_404(CustomIllust, id=illust_id)
    used_count = CardIcon.objects.filter(custom_illust=obj).count()
    if used_count > 0:
        return Response(
            {"error": f"이 일러스트를 사용 중인 아이콘이 {used_count}개 있어 삭제할 수 없습니다."},
            status=400,
        )
    try:
        obj.delete()
    except ProtectedError:
        return Response({"error": "삭제할 수 없습니다 (참조 중)."}, status=400)
    return Response({"ok": True})
