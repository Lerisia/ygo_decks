from django.urls import path, include
from dj_rest_auth.registration.views import VerifyEmailView
from .views import CustomRegisterView, CustomConfirmEmailView, CustomTokenObtainPairView, \
     check_email_exists, check_username_exists, change_username, change_password, get_user_info, \
     get_user_decks, update_user_decks, update_user_settings, is_admin
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

urlpatterns = [
    path("auth/", include("dj_rest_auth.urls")),
    path("change-username/", change_username, name="change_username"),
    path("change-password/", change_password, name="change_password"),
    path("check-email/", check_email_exists, name="check-email"),
    path("check-username/", check_username_exists, name="check-username"),
    path("user-decks/", get_user_decks, name="user-decks"),
    path("user-decks/update/", update_user_decks, name="update-user-decks"),
    path("user-info/", get_user_info, name="user-info"),
    path("auth/register/", CustomRegisterView.as_view(), name="custom_register"),
    path("account-confirm-email/<str:key>/", CustomConfirmEmailView.as_view(), name="account_confirm_email"),
    path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path("user/update-settings/", update_user_settings, name="update-user-settings"),
    path("is_admin/", is_admin, name="is_admin"),
]