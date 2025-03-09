from allauth.account.signals import email_confirmed
from django.dispatch import receiver
from django.contrib.auth import get_user_model

User = get_user_model()

@receiver(email_confirmed)
def activate_user(sender, request, email_address, **kwargs):
    user = email_address.user
    user.is_active = True # Require e-mail verification
    user.save()