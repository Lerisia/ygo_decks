from dj_rest_auth.registration.serializers import RegisterSerializer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.exceptions import AuthenticationFailed
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password

User = get_user_model()

class CustomRegisterSerializer(RegisterSerializer):
    def validate(self, data):
    # validate_password() 호출 막기 위해 validate 오버라이딩
        return data
    
    def validate_password1(self, value):
        # 기본에서는 여기서 validate_password(value)를 호출함
        # 세기 검사는 그대로 건너뛰되, 입력할 수 없는 문자만 걸러낸다
        return self._typable(value)

    def validate_password2(self, value):
        return self._typable(value)

    @staticmethod
    def _typable(value):
        from django.core.exceptions import ValidationError as DjangoValidationError
        from .validators import validate_password_characters
        try:
            return validate_password_characters(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.messages)

    def get_cleaned_data(self):
        data = super().get_cleaned_data()
        return data

    def validate_username(self, value):
        from .utils import contains_banned_word
        if contains_banned_word(value):
            raise serializers.ValidationError("사용할 수 없는 닉네임입니다.")
        return value

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
            if user.pending_deletion:
                user.is_active = True
                user.pending_deletion = False
                user.deletion_requested_at = None
                user.save(update_fields=["is_active", "pending_deletion", "deletion_requested_at"])
            else:
                raise AuthenticationFailed("Email not verified.")

        return super().validate(attrs)
