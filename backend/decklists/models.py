import secrets
import string

from django.conf import settings
from django.db import models

from board.models import Comment

ALPHABET = string.ascii_lowercase + string.digits
# addresses under /decklists/ that are not a deck's
RESERVED = {"new", "classify", "comments"}


class DeckList(models.Model):
    """A member's deck list (덱 구축, 참혈's layout 2026-10-13, kept on the server from 2026-10-14): its main and extra
    decks as card book ids (carddb.Card), an id once per copy. Every one is a post on the deck list board (엘리스
    2026-10-17: there is no 마이덱 — a deck is made, read, liked and talked about there)."""

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
    # up to 3 of its cards standing for it, in order (대표 카드, 참혈 2026-10-16), and which copy of each (0 the first)
    cover_cards = models.JSONField(default=list, blank=True)
    cover_copies = models.JSONField(default=list, blank=True)
    # each copy's print and finish, lined up with main and extra (참혈 2026-10-16): {"main": [null | {"face": md id,
    # "finish": "normal" / "shine" / "royal"}, …], "extra": […]}; null its own print in 일반, {} when every copy is
    looks = models.JSONField(default=dict, blank=True)
    # the 금제 it is checked by (참혈 2026-10-16): "md" / "ocg" / "tcg" that game's newest, following the next one;
    # "md:2026-10-06" one list held to; "custom:<code>" one of ours; "none" 무금제 (carddb.banlist.parse_key)
    banlist = models.CharField(max_length=48, default="md", blank=True)
    # the board (엘리스 2026-10-17): the 도감 deck it is filed under — what its cards say (decklists.classify) on every
    # save, unless its author picked one (deck_chosen; a pick of none too) — how many liked it and opened it, and a
    # deletion that keeps the row for its comments and the log
    deck = models.ForeignKey("deck.Deck", null=True, blank=True, on_delete=models.SET_NULL, related_name="deck_lists")
    deck_chosen = models.BooleanField(default=False)
    like_count = models.PositiveIntegerField(default=0)
    view_count = models.PositiveIntegerField(default=0)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # the board's order: when it was posted, so a change doesn't lift a deck (엘리스 2026-10-17)
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.owner_id} {self.name}"

    @classmethod
    def new_code(cls):
        """An unused 8-letter code (never one of the board's own addresses)."""
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            if code not in RESERVED and not cls.objects.filter(code=code).exists():
                return code


class DeckListCard(models.Model):
    """A card a deck list holds, once with its copies, so the board can find the lists using a card (and a card's
    page the decks it is in)."""

    deck_list = models.ForeignKey(DeckList, on_delete=models.CASCADE, related_name="cards")
    card = models.ForeignKey("carddb.Card", on_delete=models.CASCADE, related_name="deck_list_uses")
    copies = models.PositiveSmallIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["deck_list", "card"], name="uniq_deck_list_card")]


class DeckListLike(models.Model):
    """A member's 추천 of a deck list, once each."""

    deck_list = models.ForeignKey(DeckList, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deck_list_likes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["deck_list", "user"], name="uniq_deck_list_like")]


class DeckListComment(Comment):
    """A member's comment under a deck list, on the boards' shared comment (board.models.Comment)."""

    post = models.ForeignKey(DeckList, on_delete=models.CASCADE, related_name="comments")

    class Meta(Comment.Meta):
        verbose_name = "덱 리스트 댓글"
        verbose_name_plural = "덱 리스트 댓글"
