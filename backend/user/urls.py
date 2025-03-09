from django.urls import path, include
from dj_rest_auth.registration.views import VerifyEmailView
from .views import CustomRegisterView, CustomConfirmEmailView, CustomTokenObtainPairView, check_email_exists, check_username_exists
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

urlpatterns = [
    path("auth/", include("dj_rest_auth.urls")),
    path("check-email/", check_email_exists, name="check-email"),
    path("check-username/", check_username_exists, name="check-username"),
    path("auth/register/", CustomRegisterView.as_view(), name="custom_register"),
    path("account-confirm-email/<str:key>/", CustomConfirmEmailView.as_view(), name="account_confirm_email"),
    path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
]