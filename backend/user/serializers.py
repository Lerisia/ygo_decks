from dj_rest_auth.registration.serializers import RegisterSerializer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password

User = get_user_model()

class CustomRegisterSerializer(RegisterSerializer):
    def get_cleaned_data(self):
        data = super().get_cleaned_data()
        return data

    def save(self, request):
        user = super().save(request)
        user.is_active = False
        user.save()
        return user

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise AuthenticationFailed("Invalid credentials.")

        if not check_password(password, user.password):
            raise AuthenticationFailed("Invalid credentials.")

        if not user.is_active:
            raise AuthenticationFailed("Email not verified.")

        return super().validate(attrs)
