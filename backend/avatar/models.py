from django.db import models
from django.conf import settings


class Border(models.Model):
    """A circular border that wraps a user's avatar icon."""

    # Mirrors CardIcon's shop taxonomy so the shop + admin UIs work the
    # same way for borders. (Frames can't be authored from the UI — only
    # priced — so there's no creation flow, just rarity/category edits.)
    CATEGORY_CHOICES = [
        ("default", "기본 지급"),
        ("shop", "상점 판매"),
        ("exclusive", "비매품"),
    ]
    # Frames start at 희귀 — there's no 일반 tier for borders.
    RARITY_CHOICES = [
        ("rare", "희귀"),
        ("epic", "서사"),
        ("legendary", "전설"),
    ]
    RARITY_PRICE_MAP = {
        "rare": 500,
        "epic": 1000,
        "legendary": 2000,
    }

    key = models.SlugField(max_length=40, unique=True, help_text="programmatic identifier")
    name = models.CharField(max_length=60)
    color = models.CharField(max_length=20, default="#ffffff", help_text="CSS color for the ring (used when no image)")
    image = models.ImageField(upload_to="border_assets/", blank=True, null=True, help_text="optional ring asset (square PNG with transparent center)")
    is_default = models.BooleanField(default=False, help_text="auto-grant to all users when they sign up")
    category = models.CharField(max_length=16, choices=CATEGORY_CHOICES, default="exclusive")
    rarity = models.CharField(max_length=16, choices=RARITY_CHOICES, blank=True, default="", help_text="등급 (상점 판매 시 가격 자동 결정)")
    price = models.PositiveIntegerField(default=0, help_text="상점 테두리는 등급에서 자동 결정")
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def save(self, *args, **kwargs):
        # Auto-derive price for shop borders from rarity; non-shop = free.
        if self.category == "shop" and self.rarity in self.RARITY_PRICE_MAP:
            self.price = self.RARITY_PRICE_MAP[self.rarity]
        elif self.category != "shop":
            self.price = 0
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.key})"


class UserBorderUnlock(models.Model):
    """Tracks which borders a user has unlocked."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="border_unlocks")
    border = models.ForeignKey(Border, on_delete=models.CASCADE, related_name="user_unlocks")
    granted_at = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "border"], name="unique_user_border_unlock"),
        ]

    def __str__(self):
        return f"{self.user_id} unlocked {self.border.key}"


class UserIconUnlock(models.Model):
    """Tracks which CardIcons a user has unlocked / can equip."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="icon_unlocks")
    icon = models.ForeignKey("avatar.CardIcon", on_delete=models.CASCADE, related_name="user_unlocks")
    granted_at = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "icon"], name="unique_user_icon_unlock"),
        ]

    def __str__(self):
        return f"{self.user_id} unlocked icon {self.icon_id}"


class CustomIllust(models.Model):
    """Admin-uploaded custom illustration usable as a CardIcon source.
    Not exposed anywhere except the icon-creation admin page."""
    name = models.CharField(max_length=100, help_text="검색용 이름")
    image = models.ImageField(upload_to="custom_illusts/")
    created_at = models.DateTimeField(auto_now_add=True)
    # tweet_id is set when this row was created by the Twitter scraper —
    # used for dedup so re-scraping the same date range doesn't duplicate.
    source_tweet_id = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class TwitterCredentials(models.Model):
    """Singleton row holding the admin's Twitter session cookies for the
    on-demand SAMPLE scraper. Only the latest row is read; older rows
    can be deleted safely. Not user-facing — admin-only via /manage."""
    auth_token = models.CharField(max_length=200, help_text="Twitter cookie: auth_token")
    ct0 = models.CharField(max_length=200, help_text="Twitter cookie: ct0 (CSRF)")
    note = models.CharField(max_length=200, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"twitter creds (updated {self.updated_at:%Y-%m-%d %H:%M})"


class CardIcon(models.Model):
    """A circular crop of a card illustration, usable as a user avatar.

    Crop is stored as relative coordinates (0~1) on top of the card's
    `card_illust` image, so it's resolution-independent and easy to re-edit.
    """

    CATEGORY_CHOICES = [
        ("default", "기본 지급"),
        ("shop", "상점 판매"),
        ("exclusive", "비매품"),
    ]

    RARITY_CHOICES = [
        ("common", "일반"),
        ("rare", "희귀"),
        ("epic", "서사"),
        ("legendary", "전설"),
    ]
    RARITY_PRICE_MAP = {
        "common": 10,
        "rare": 100,
        "epic": 500,
        "legendary": 2000,
    }

    card = models.ForeignKey(
        "card.Card",
        on_delete=models.CASCADE,
        related_name="icons",
        null=True, blank=True,
    )
    custom_illust = models.ForeignKey(
        CustomIllust,
        on_delete=models.CASCADE,
        related_name="icons",
        null=True, blank=True,
    )
    title = models.CharField(max_length=80, blank=True, default="")
    center_x = models.FloatField(help_text="Crop center X (0~1)")
    center_y = models.FloatField(help_text="Crop center Y (0~1)")
    radius = models.FloatField(help_text="Crop radius (0~1, of image min(w,h))")
    cropped_image = models.ImageField(
        upload_to="card_icons_cropped/", blank=True, null=True,
        help_text="Auto-regenerated crop. Used by clients for fast rendering.",
    )
    category = models.CharField(max_length=16, choices=CATEGORY_CHOICES, default="exclusive")
    rarity = models.CharField(max_length=16, choices=RARITY_CHOICES, blank=True, default="", help_text="등급 (shop 카테고리에서 가격 자동 결정)")
    price = models.PositiveIntegerField(default=0, help_text="Auto-derived from rarity for shop icons")
    theme = models.CharField(max_length=80, blank=True, default="", db_index=True, help_text="Free-form theme/series tag for grouping (e.g., 'Blue-Eyes')")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="created_card_icons",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # When this icon first transitioned to category='shop'. Drives the
    # "신규 출시!" badge in the shop (< 7 days = new) and surfaces the
    # icon at the top of the shop list. Admin can null this out via the
    # `unfeature` endpoint to drop an item off the front page even if it
    # was just listed.
    shop_listed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    # Fields that, when changed, should trigger a crop regeneration.
    _CROP_INVALIDATING_FIELDS = ("card_id", "custom_illust_id", "center_x", "center_y", "radius")

    def __str__(self):
        if self.custom_illust_id:
            return self.title or f"icon for custom #{self.custom_illust_id}"
        return self.title or f"icon for card {self.card_id}"

    @property
    def source_image_path(self):
        """Path to the underlying illustration file (card or custom)."""
        if self.custom_illust_id and self.custom_illust and self.custom_illust.image:
            return self.custom_illust.image.path
        if self.card_id and self.card and self.card.card_illust:
            return self.card.card_illust.path
        return None

    def regenerate_crop(self, save=True):
        """(Re)generate the cropped icon image from the source illustration."""
        from io import BytesIO
        from django.core.files.base import ContentFile
        try:
            from PIL import Image
        except Exception:
            return
        path = self.source_image_path
        if not path:
            return
        try:
            with Image.open(path) as img:
                img = img.convert("RGB")
                w, h = img.size
                cx = float(self.center_x or 0.5) * w
                cy = float(self.center_y or 0.5) * h
                r = float(self.radius or 0.5) * min(w, h)
                left = max(0, int(round(cx - r)))
                top = max(0, int(round(cy - r)))
                right = min(w, int(round(cx + r)))
                bottom = min(h, int(round(cy + r)))
                if right <= left or bottom <= top:
                    return
                crop = img.crop((left, top, right, bottom))
                # 256x256 is large enough for any reasonable Avatar size on
                # retina screens; small enough that 600+ icons fit easily.
                crop = crop.resize((256, 256), Image.LANCZOS)
                buf = BytesIO()
                crop.save(buf, format="JPEG", quality=88, optimize=True)
                fname = f"icon_{self.pk or 'new'}.jpg"
                # Don't trigger a recursive save() — caller handles it.
                self.cropped_image.save(fname, ContentFile(buf.getvalue()), save=False)
                if save:
                    super().save(update_fields=["cropped_image"])
        except Exception:
            # Best-effort: never let crop generation break a normal save.
            pass

    def save(self, *args, **kwargs):
        regen = False
        prev_category = None
        if self._state.adding:
            regen = True
        else:
            try:
                old = type(self).objects.only(*self._CROP_INVALIDATING_FIELDS, "category").get(pk=self.pk)
                prev_category = old.category
                for f in self._CROP_INVALIDATING_FIELDS:
                    if getattr(old, f) != getattr(self, f):
                        regen = True
                        break
            except type(self).DoesNotExist:
                regen = True
        # Stamp shop_listed_at the first time this icon enters the shop.
        # Don't overwrite an existing value — admins can manually re-list
        # without losing the original release date, and the un-feature
        # action explicitly nulls it out elsewhere.
        if self.category == "shop" and prev_category != "shop" and self.shop_listed_at is None:
            from django.utils import timezone
            self.shop_listed_at = timezone.now()
        super().save(*args, **kwargs)
        if regen:
            self.regenerate_crop(save=True)


# Signal: when a Card's illustration changes, regenerate every dependent
# CardIcon's crop. Hooked here (instead of in card/) since the dependency is
# from avatar → card.
from django.db.models.signals import pre_save, post_save  # noqa: E402
from django.dispatch import receiver  # noqa: E402


def _track_card_illust_change(sender, instance, **kwargs):
    if not instance.pk:
        instance._card_illust_changed = True
        return
    try:
        old = sender.objects.only("card_illust").get(pk=instance.pk)
        instance._card_illust_changed = (old.card_illust != instance.card_illust)
    except sender.DoesNotExist:
        instance._card_illust_changed = True


def _regen_crops_for_card(sender, instance, **kwargs):
    if not getattr(instance, "_card_illust_changed", False):
        return
    for icon in CardIcon.objects.filter(card=instance):
        icon.regenerate_crop(save=True)


def _connect_card_signals():
    from card.models import Card
    pre_save.connect(_track_card_illust_change, sender=Card, dispatch_uid="avatar_track_card_illust")
    post_save.connect(_regen_crops_for_card, sender=Card, dispatch_uid="avatar_regen_crops_on_card_save")


# Connect lazily — `from card.models import Card` here would cause a circular
# import if avatar.models is loaded before card.models. AppConfig.ready() is
# the right place; we wire it from apps.py.
