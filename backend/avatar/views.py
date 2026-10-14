from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated, AllowAny
from rest_framework.response import Response

from carddb.models import Card, has_art
from .models import CardIcon, Border, UserBorderUnlock, UserIconUnlock, CustomIllust
from .serializers import CardIconSerializer, BorderSerializer


def _resolve_default_icon():
    """Return the default 'Kuriboh' icon if available, else first icon, else None."""
    icon = (
        CardIcon.objects
        .filter(new_card__name_ko="크리보")
        .select_related("new_card")
        .first()
    )
    if not icon:
        icon = CardIcon.objects.select_related("new_card").first()
    return icon


@api_view(["GET"])
@permission_classes([IsAdminUser])
def list_icons(request):
    icons = CardIcon.objects.select_related("new_card", "custom_illust").all()
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
            card = Card.objects.filter(has_art()).get(pk=int(card_id))
        except (Card.DoesNotExist, ValueError, TypeError):
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
        existing.new_card = card
        existing.art_print = None
        existing.art_version = ""
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
        new_card=card,
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
    qs = CardIcon.objects.select_related("new_card").filter(
        Q(category="default") | Q(user_unlocks__user=user)
    )
    if q:
        qs = qs.filter(Q(new_card__name_ko__icontains=q) | Q(title__icontains=q))
    qs = qs.distinct().order_by("new_card__name_ko", "id")
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
    qs = CardIcon.objects.select_related("new_card").filter(category="shop")
    if q:
        qs = qs.filter(new_card__name_ko__icontains=q) | qs.filter(title__icontains=q)
    # Newest-first within the "new arrivals" window, then alphabetical.
    # NULLS LAST so admin-cleared listings drop into the regular bucket.
    qs = qs.distinct().order_by(
        models.F("shop_listed_at").desc(nulls_last=True),
        "new_card__name_ko", "id",
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
    # Step borders in order (기본 0, 아이언 1, … 다이아): My Page shows only the owned ones and the next step (참혈 2026-10-11).
    rank_by_key = {key: i + 1 for i, (_thr, key) in enumerate(BORDER_TIERS)}
    out = []
    for b in Border.objects.all().order_by("sort_order", "id"):
        data = BorderSerializer(b).data
        data["unlocked"] = b.id in unlocked_ids
        data["tier_rank"] = 0 if b.is_default else rank_by_key.get(b.key)
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
        return Response({"error": "프레임을 찾을 수 없습니다."}, status=404)
    if not UserBorderUnlock.objects.filter(user=user, border=border).exists():
        return Response({"error": "잠금 해제되지 않은 프레임입니다."}, status=403)
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
        return Response({"error": "유저나 프레임을 찾을 수 없습니다."}, status=404)
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
        return Response({"error": "프레임을 찾을 수 없습니다."}, status=404)
    if border.category != "shop":
        return Response({"error": "구매할 수 없는 프레임입니다."}, status=400)
    price = int(border.price or 0)
    if price <= 0:
        return Response({"error": "가격이 설정되지 않은 프레임입니다."}, status=400)
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
    qs = Border.objects.all().order_by("sort_order", "id").annotate(
        unlock_count=models.Count("user_unlocks", distinct=True),
    )
    rows = []
    for b in qs:
        row = BorderSerializer(b).data
        row["owners"] = b.unlock_count
        rows.append(row)
    return Response({"borders": rows})


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def update_border(request, border_id):
    """Admin: set a border's category + rarity. Price is auto-derived in
    Border.save() (shop+rarity → RARITY_PRICE_MAP, else 0)."""
    try:
        border = Border.objects.get(id=int(border_id))
    except (Border.DoesNotExist, ValueError, TypeError):
        return Response({"error": "프레임을 찾을 수 없습니다."}, status=404)
    if "name" in request.data:
        name = " ".join(str(request.data.get("name") or "").split())
        if not name or len(name) > BORDER_NAME_MAX:
            return Response({"error": f"이름을 1~{BORDER_NAME_MAX}자로 입력해 주세요."}, status=400)
        border.name = name
    _set_border_listing(border, request.data)
    border.save()
    return Response(BorderSerializer(border).data)


BORDER_NAME_MAX = 60
BORDER_IMAGE_SIZE = 512             # what is stored and served, whatever was uploaded
BORDER_UPLOAD_MIN_SIZE = 256
BORDER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
BORDER_CLEAR_MIDDLE = 0.5           # the icon shows through the middle 74%; at least this much must be empty


def _set_border_listing(border, data):
    """Category and rarity from a request; the price follows in Border.save()."""
    valid_cat = {c[0] for c in Border.CATEGORY_CHOICES}
    valid_rar = {r[0] for r in Border.RARITY_CHOICES}
    if "category" in data:
        cat = (data.get("category") or "").strip()
        if cat in valid_cat:
            border.category = cat
    if "rarity" in data:
        rar = (data.get("rarity") or "").strip()
        border.rarity = rar if rar in valid_rar else ""
    if border.category == "shop" and not border.rarity:
        border.rarity = "rare"  # shop borders need a tier for pricing


def _border_image(upload):
    """An uploaded frame as the file the site serves (512x512 WebP), or ValueError saying what is wrong with it.

    The frame is drawn over the icon, so it has to be a square with a transparent background whose middle is empty.
    """
    from io import BytesIO
    from django.core.files.base import ContentFile
    from PIL import Image, ImageChops, ImageDraw, ImageStat

    if upload is None:
        raise ValueError("이미지 파일을 골라 주세요.")
    if upload.size > BORDER_UPLOAD_MAX_BYTES:
        raise ValueError("파일이 너무 큽니다. 5MB 이하로 올려 주세요.")
    try:
        img = Image.open(upload)
        img.load()
    except Exception:
        raise ValueError("이미지 파일이 아닙니다. PNG 또는 WebP로 올려 주세요.")
    if getattr(img, "is_animated", False):
        raise ValueError("움직이는 이미지는 올릴 수 없습니다.")
    w, h = img.size
    if w != h:
        raise ValueError(f"정사각형이어야 합니다. (올린 이미지: {w}×{h})")
    if w < BORDER_UPLOAD_MIN_SIZE:
        raise ValueError(f"너무 작습니다. 한 변이 {BORDER_UPLOAD_MIN_SIZE}px 이상이어야 합니다. (올린 이미지: {w}×{h})")
    if img.mode not in ("RGBA", "LA", "PA") and "transparency" not in img.info:
        raise ValueError("배경이 투명한 이미지여야 합니다. PNG 또는 WebP로 저장해 주세요.")
    img = img.convert("RGBA")
    alpha = img.getchannel("A")
    if alpha.getbbox() is None:
        raise ValueError("아무것도 그려져 있지 않습니다.")
    middle = Image.new("L", img.size, 0)
    m = w * (1 - BORDER_CLEAR_MIDDLE) / 2
    ImageDraw.Draw(middle).ellipse((m, m, w - m, w - m), fill=255)
    if ImageStat.Stat(ImageChops.multiply(alpha, middle), mask=middle).mean[0] > 255 * 0.05:
        raise ValueError("가운데가 비어 있어야 합니다. 아이콘이 들어갈 자리(가운데 원)를 투명하게 지워 주세요.")
    if w != BORDER_IMAGE_SIZE:
        img = img.resize((BORDER_IMAGE_SIZE, BORDER_IMAGE_SIZE), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, "WEBP", quality=90, method=6)
    return ContentFile(buf.getvalue())


def _save_border_image(border, content):
    """A fresh file name each time, so a replaced frame is not hidden behind a cached copy of the old one."""
    import secrets
    if border.image:
        border.image.delete(save=False)
    border.image.save(f"border_{secrets.token_hex(6)}.webp", content, save=False)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def create_border(request):
    """Admin: a new border from an uploaded frame image. Unlisted (비매품) unless a category is given."""
    import secrets
    name = " ".join(str(request.data.get("name") or "").split())
    if not name or len(name) > BORDER_NAME_MAX:
        return Response({"error": f"이름을 1~{BORDER_NAME_MAX}자로 입력해 주세요."}, status=400)
    try:
        content = _border_image(request.FILES.get("image"))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    last = Border.objects.aggregate(m=models.Max("sort_order"))["m"] or 0
    border = Border(key=Border.UPLOADED_KEY_PREFIX + secrets.token_hex(6), name=name, sort_order=last + 10)
    _set_border_listing(border, request.data)
    _save_border_image(border, content)
    border.save()
    return Response(BorderSerializer(border).data, status=201)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def replace_border_image(request, border_id):
    """Admin: a new frame image for an uploaded border. Everyone who has it sees the new one."""
    border = get_object_or_404(Border, id=border_id)
    if not border.is_uploaded:
        return Response({"error": "기본 제공 프레임은 이미지를 바꿀 수 없습니다."}, status=400)
    try:
        content = _border_image(request.FILES.get("image"))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    _save_border_image(border, content)
    border.save()
    return Response(BorderSerializer(border).data)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def delete_border(request, border_id):
    """Admin: remove an uploaded border, as long as nobody has it — a border someone bought or was given stays."""
    border = get_object_or_404(Border, id=border_id)
    if not border.is_uploaded:
        return Response({"error": "기본 제공 프레임은 지울 수 없습니다."}, status=400)
    owners = border.user_unlocks.count() + border.equipped_by_users.count()
    if owners:
        return Response({"error": "이미 가진 이용자가 있어 지울 수 없습니다. 비매품으로 돌려 더 풀리지 않게 할 수 있습니다."}, status=409)
    if border.image:
        border.image.delete(save=False)
    border.delete()
    return Response({"ok": True})


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
    """Cards with an illustration whose name matches, 30 a page in name order (an archetype can run past one page)."""
    PAGE_SIZE = 30
    q = (request.GET.get("q") or "").strip()
    try:
        page = max(1, int(request.GET.get("page") or 1))
    except (ValueError, TypeError):
        page = 1
    from carddb.display import art_url, display_name
    qs = Card.objects.filter(has_art())
    if q:
        qs = qs.filter(name_ko__icontains=q)
    total = qs.count()
    qs = qs.order_by("name_ko", "id")[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
    results = [
        {
            "id": c.id,
            "card_id": c.id,
            "name": display_name(c),
            "image_url": art_url(c.id),
        }
        for c in qs
    ]
    return Response({
        "results": results,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "total_pages": max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
    })


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


@api_view(["POST"])
@permission_classes([IsAdminUser])
def bulk_upload_custom_illusts(request):
    """Multi-file upload with size/aspect filtering. Reuses the same
    `is_likely_sample` rules as the import_twitter_dump command so the filter is
    consistent across CLI and admin UI. multipart: images[] (multiple)."""
    from PIL import Image
    files = request.FILES.getlist("images")
    if not files:
        return Response({"error": "images 파일이 없습니다."}, status=400)

    MIN_DIM = 1000

    def is_sample(w, h):
        # Square-only: SAMPLE card images are square; banners and composites are not.
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
