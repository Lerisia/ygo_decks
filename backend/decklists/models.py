import secrets
import string

from django.conf import settings
from django.db import models

ALPHABET = string.ascii_lowercase + string.digits


class DeckList(models.Model):
    """A member's deck list (덱 구축, 참혈's layout 2026-10-13, kept on the server from 2026-10-14): its main and extra
    decks as card book ids (carddb.Card), an id once per copy. Its owner's alone for now; a deck board comes next."""

    class Kind(models.TextChoices):
        OWN = "own", "own"        # made and kept in the deck builder
        ENTRY = "entry", "entry"  # a tournament's copy of what an entrant handed in: read here, changed only there

    code = models.CharField(max_length=12, unique=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deck_lists")
    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.OWN)
    name = models.CharField(max_length=40)
    description = models.TextField(blank=True, default="")
    main = models.JSONField(default=list)
    extra = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.owner_id} {self.name}"

    @classmethod
    def new_code(cls):
        """An unused 8-letter code (never "new", which is the builder's own address)."""
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            if code != "new" and not cls.objects.filter(code=code).exists():
                return code
