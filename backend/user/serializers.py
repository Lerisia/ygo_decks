from dj_rest_auth.registration.serializers import RegisterSerializer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password

User = get_user_model()

class CustomRegisterSerializer(RegisterSerializer):
    def validate(self, data):
    # validate_password() 호출 막기 위해 validate 오버라이딩
        return data
    
    def validate_password1(self, value):
        # 기본에서는 여기서 validate_password(value)를 호출함
        # 그걸 막고 그냥 그대로 반환하면 검사 통과
        return value

    def validate_password2(self, value):
        return value

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
