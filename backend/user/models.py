from django.contrib.auth.models import AbstractUser
from django.db import models

class User(AbstractUser):
    username = models.CharField(max_length=50, unique=True, verbose_name="닉네임")
    email = models.EmailField(unique=True, verbose_name="이메일")

    first_name = None
    last_name = None

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ["username"]

    def __str__(self):
        return self.email