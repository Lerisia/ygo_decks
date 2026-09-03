from dj_rest_auth.registration.views import RegisterView, ConfirmEmailView
from .serializers import CustomRegisterSerializer
from allauth.account.utils import send_email_confirmation
from django.shortcuts import redirect
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.decorators import api_view, permission_classes
from rest_framework import status
from django.utils import timezone
from .serializers import CustomTokenObtainPairSerializer
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from deck.models import Deck
from .models import User
from .utils import contains_banned_word

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_username(request):
    user = request.user
    new_username = request.data.get("username")

    if not new_username:
        return Response({"error": "닉네임을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

    if user.username == new_username:
        return Response({"message": "현재 닉네임과 동일합니다."}, status=status.HTTP_200_OK)

    if contains_banned_word(new_username):
        return Response({"error": "사용할 수 없는 닉네임입니다."}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(username=new_username).exists():
        return Response({"error": "이미 사용 중인 닉네임입니다."}, status=status.HTTP_400_BAD_REQUEST)

    user.username = new_username
    user.save()
    return Response({"message": "닉네임이 변경되었습니다."}, status=status.HTTP_200_OK)

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    user = request.user
    current_password = request.data.get("current_password")
    new_password = request.data.get("new_password")

    if not current_password or not new_password:
        return Response({"error": "현재 비밀번호와 새 비밀번호를 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(current_password):
        return Response({"error": "현재 비밀번호가 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(new_password, user=user)
    except ValidationError as e:
        return Response({"error": e.messages}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()

    return Response({"message": "비밀번호가 변경되었습니다."}, status=status.HTTP_200_OK)

@api_view(["GET"])
def check_email_exists(request):
    email = request.query_params.get("email")

    if not email:
        return Response({"error": "Email parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

    exists = User.objects.filter(email=email).exists()
    return Response({"exists": exists}, status=status.HTTP_200_OK)

@api_view(["GET"])
def check_username_exists(request):
    username = request.query_params.get("username")

    if not username:
        return Response({"error": "Username parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

    exists = User.objects.filter(username=username).exists()
    return Response({"exists": exists}, status=status.HTTP_200_OK)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_user_info(request):
    user = request.user
    return Response({
        "email": user.email,
        "username": user.username,
        "points": user.points,
        "lifetime_points_earned": user.lifetime_points_earned,
        "is_staff": bool(user.is_staff),
    })


DAILY_BONUS_AMOUNT = 10


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def claim_daily_bonus(request):
    user = request.user
    today = timezone.localdate()
    if user.last_daily_bonus_at == today:
        return Response({
            "claimed": False,
            "points_added": 0,
            "points": user.points,
        })
    from .points import award_points
    result = award_points(user, DAILY_BONUS_AMOUNT, kind="daily_bonus", note="데일리 보너스")
    user.last_daily_bonus_at = today
    user.save(update_fields=["last_daily_bonus_at"])
    return Response({
        "claimed": True,
        "points_added": DAILY_BONUS_AMOUNT,
        "points": user.points,
        "newly_unlocked_borders": result.get("newly_unlocked", []),
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_user_search(request):
    """Partial-match user lookup for admin tools (points grant, etc).
    Returns up to 20 matches by username (icontains)."""
    from .models import User as UserM
    q = (request.GET.get("q") or "").strip()
    if not q:
        return Response({"results": []})
    qs = (UserM.objects
          .filter(username__icontains=q)
          .order_by("username")[:20])
    return Response({
        "results": [
            {"id": u.id, "username": u.username, "points": u.points or 0}
            for u in qs
        ]
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_grant_points(request):
    """Admin grants/deducts points for a user with a free-text reason.
    Body: { username, amount (int, !=0), note }.
    - amount > 0: regular award_points path (lifetime +=, may unlock borders)
    - amount < 0: deduct from points, clamp at 0, lifetime untouched.
    Both paths write a PointTransaction(kind=admin_grant) for the audit log.
    """
    from .models import User as UserM, PointTransaction
    from django.db import transaction as dbtx
    username = (request.data.get("username") or "").strip()
    note = (request.data.get("note") or "").strip()
    try:
        amount = int(request.data.get("amount"))
    except (TypeError, ValueError):
        return Response({"error": "amount는 정수여야 합니다."}, status=400)
    if amount == 0:
        return Response({"error": "amount는 0일 수 없습니다."}, status=400)
    if not username:
        return Response({"error": "username이 필요합니다."}, status=400)
    try:
        target = UserM.objects.get(username=username)
    except UserM.DoesNotExist:
        return Response({"error": f"사용자 '{username}'을 찾을 수 없습니다."}, status=404)

    if amount > 0:
        from .points import award_points
        award_points(target, amount, kind="admin_grant", note=note)
    else:
        with dbtx.atomic():
            u = UserM.objects.select_for_update().get(pk=target.pk)
            new_points = max(0, (u.points or 0) + amount)  # amount is negative
            u.points = new_points
            u.save(update_fields=["points"])
            target.points = u.points
            PointTransaction.objects.create(
                user=u, amount=amount, kind="admin_grant", note=note[:200],
                balance_after=u.points,
            )
    return Response({
        "ok": True,
        "user": {"id": target.id, "username": target.username, "points": target.points},
        "amount": amount,
        "note": note,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def points_history(request):
    """Paginated transaction log for the authenticated user.
    Query params: page (1-indexed), page_size (default 50, max 200)."""
    from .models import PointTransaction
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(200, int(request.GET.get("page_size", 50))))
    except (TypeError, ValueError):
        page_size = 50
    qs = PointTransaction.objects.filter(user=request.user).order_by("-created_at", "-id")
    total = qs.count()
    start = (page - 1) * page_size
    rows = qs[start:start + page_size]
    kind_label_map = dict(PointTransaction.KIND_CHOICES)

    def _display(tx):
        label = kind_label_map.get(tx.kind, tx.kind)
        # Icon purchases want the icon's name baked into the label so the
        # row reads "아이콘 구매 (드래곤)" — note is then redundant.
        if tx.kind == "icon_purchase" and tx.note:
            return f"{label} ({tx.note})", ""
        return label, tx.note

    results = []
    for tx in rows:
        display_label, display_note = _display(tx)
        results.append({
            "id": tx.id,
            "amount": tx.amount,
            "kind": tx.kind,
            "kind_label": kind_label_map.get(tx.kind, tx.kind),
            "display_label": display_label,
            "note": display_note,
            "balance_after": tx.balance_after,
            "created_at": tx.created_at.isoformat(),
        })
    return Response({
        "results": results,
        "count": total,
        "page": page,
        "page_size": page_size,
        "has_next": start + page_size < total,
    })

class CustomRegisterView(RegisterView):
    serializer_class = CustomRegisterSerializer

    def perform_create(self, serializer):
        user = serializer.save(self.request)
        send_email_confirmation(self.request, user)
        
class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

class CustomConfirmEmailView(ConfirmEmailView):
    def get(self, request, *args, **kwargs):
        response = super().get(request, *args, **kwargs)
        return redirect("https://ygodecks.com/email-verified")

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_user_decks(request):  # Check owned decks of currently logged-in user
    user = request.user
    owned_decks = user.owned_decks.order_by("name")

    return Response({
        "owned_decks": [{"id": deck.id, "name": deck.name} for deck in owned_decks],
        "use_custom_lookup": user.use_custom_lookup
    })

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_user_decks(request): 
    user = request.user
    deck_ids = request.data.get("deck_ids", [])

    if not isinstance(deck_ids, list):
        return Response({"error": "deck_ids must be a list."}, status=400)

    owned_decks = Deck.objects.filter(id__in=deck_ids)

    user.owned_decks.set(owned_decks)
    return Response({"message": "보유 덱이 저장되었습니다."})
    
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_user_settings(request):
    user = request.user
    use_custom_lookup = request.data.get("use_custom_lookup")

    if use_custom_lookup is not None:
        user.use_custom_lookup = use_custom_lookup
        user.save()

    return Response({"message": "설정이 저장되었습니다.", "use_custom_lookup": user.use_custom_lookup})

@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_account(request):
    user = request.user
    user.is_active = False
    user.pending_deletion = True
    user.deletion_requested_at = timezone.now()
    user.save(update_fields=["is_active", "pending_deletion", "deletion_requested_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)

@api_view(["POST"])
def request_password_reset(request):
    from django.contrib.auth.tokens import default_token_generator
    from django.core.mail import send_mail
    from django.conf import settings

    email = request.data.get("email")
    if not email:
        return Response({"message": "이메일을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email=email, is_active=True)
    except User.DoesNotExist:
        return Response({"message": "비밀번호 재설정 링크가 발송되었습니다."})

    token = default_token_generator.make_token(user)
    reset_url = f"https://ygodecks.com/reset-password?uid={user.pk}&token={token}"

    send_mail(
        subject="[YGODecks] 비밀번호 재설정",
        message=f"아래 링크를 클릭하여 비밀번호를 재설정하세요.\n\n{reset_url}\n\n이 링크는 일정 시간 후 만료됩니다.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=True,
    )

    return Response({"message": "비밀번호 재설정 링크가 발송되었습니다."})

@api_view(["POST"])
def confirm_password_reset(request):
    from django.contrib.auth.tokens import default_token_generator

    uid = request.data.get("uid")
    token = request.data.get("token")
    new_password = request.data.get("new_password")

    if not all([uid, token, new_password]):
        return Response({"error": "필수 항목이 누락되었습니다."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(pk=uid)
    except User.DoesNotExist:
        return Response({"error": "유효하지 않은 링크입니다."}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"error": "만료되었거나 유효하지 않은 링크입니다."}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()
    return Response({"message": "비밀번호가 변경되었습니다."})

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def is_admin(request):
    return Response({"is_admin": request.user.is_staff})
