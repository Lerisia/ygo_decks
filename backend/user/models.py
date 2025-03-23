from django.contrib.auth.models import AbstractUser
from django.db import models
from deck.models import Deck

class User(AbstractUser):
    username = models.CharField(max_length=50, unique=True, verbose_name="닉네임")
    email = models.EmailField(unique=True, verbose_name="이메일")

    first_name = None
    last_name = None

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ["username"]

    owned_decks = models.ManyToManyField(Deck, blank=True, related_name="owners")
    
    use_custom_lookup = models.BooleanField(default=False)

    def __str__(self):
        return self.username