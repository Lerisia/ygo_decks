from dj_rest_auth.registration.views import RegisterView, ConfirmEmailView
from .serializers import CustomRegisterSerializer
from allauth.account.utils import send_email_confirmation
from django.shortcuts import redirect
from django.core.management import call_command
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.decorators import api_view, permission_classes
from rest_framework import status
from .serializers import CustomTokenObtainPairSerializer
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from deck.models import Deck
from .models import User

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_username(request):
    user = request.user
    new_username = request.data.get("username")

    if not new_username:
        return Response({"error": "닉네임을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

    if user.username == new_username:
        return Response({"message": "현재 닉네임과 동일합니다."}, status=status.HTTP_200_OK)

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
        return redirect("https://ygodecks.com/")

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

    try:
        call_command("generate_lookup", user_id=user.id)
        return Response({"message": "보유 덱이 저장되었습니다."})
    except Exception as e:
        return Response({"message": "보유 덱이 저장되었지만 Look-up Table 갱신에 실패했습니다.", "error": str(e)}, status=500)
    
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_user_settings(request):
    user = request.user
    use_custom_lookup = request.data.get("use_custom_lookup")

    if use_custom_lookup is not None:
        user.use_custom_lookup = use_custom_lookup
        user.save()

    return Response({"message": "설정이 저장되었습니다.", "use_custom_lookup": user.use_custom_lookup})

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def is_admin(request):
    return Response({"is_admin": request.user.is_staff})
