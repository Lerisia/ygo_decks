from dj_rest_auth.registration.views import RegisterView, ConfirmEmailView
from .serializers import CustomRegisterSerializer
from allauth.account.utils import send_email_confirmation
from django.shortcuts import redirect
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.decorators import api_view
from rest_framework import status
from .serializers import CustomTokenObtainPairSerializer
from .models import User

User = get_user_model()

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