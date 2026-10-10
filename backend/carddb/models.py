from django.conf import settings
from django.db import models


class Card(models.Model):
    class Category(models.TextChoices):
        MONSTER = "monster"
        SPELL = "spell"
        TRAP = "trap"

    id = models.PositiveIntegerField(primary_key=True, help_text="기본 마듀 ID (마듀에 없으면 코나미 번호)")
    category = models.CharField(max_length=8, choices=Category.choices)
    name_ja = models.CharField(max_length=200)
    name_ja_ruby = models.CharField(max_length=300, blank=True)
    name_ko = models.CharField(max_length=200, blank=True)
    name_en = models.CharField(max_length=200, blank=True)

    frame = models.CharField(max_length=20)
    types = models.JSONField(default=list, blank=True)
    attribute = models.CharField(max_length=8, blank=True)
    race = models.CharField(max_length=20, blank=True)
    level = models.PositiveSmallIntegerField(null=True, blank=True)
    rank = models.PositiveSmallIntegerField(null=True, blank=True)
    link_rating = models.PositiveSmallIntegerField(null=True, blank=True)
    atk = models.SmallIntegerField(null=True, blank=True, help_text="-1 = ?")
    def_value = models.SmallIntegerField(null=True, blank=True, help_text="-1 = ?, 링크는 비움")
    link_markers = models.JSONField(default=list, blank=True)
    pendulum_scale = models.PositiveSmallIntegerField(null=True, blank=True)
    spell_trap_subtype = models.CharField(max_length=12, blank=True)

    ocg_date = models.DateField(null=True, blank=True)
    kr_date = models.DateField(null=True, blank=True)
    tcg_date = models.DateField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.id} {self.name_ko or self.name_ja}"


class CardText(models.Model):
    class Lang(models.TextChoices):
        JA = "ja"
        KO = "ko"
        EN = "en"

    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="texts")
    lang = models.CharField(max_length=2, choices=Lang.choices)
    materials = models.TextField(blank=True)
    effect = models.TextField(blank=True)
    pendulum_effect = models.TextField(blank=True)
    flavor = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["card", "lang"], name="carddb_text_card_lang")]


class MdPrint(models.Model):
    class Rarity(models.TextChoices):
        N = "N"
        R = "R"
        SR = "SR"
        UR = "UR"

    md_id = models.PositiveIntegerField(primary_key=True)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="md_prints")
    is_alt_art = models.BooleanField(default=False)
    rarity = models.CharField(max_length=2, choices=Rarity.choices, blank=True)
    first_seen = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["md_id"]


class MdArt(models.Model):
    class Version(models.TextChoices):
        COMMON = "common"
        OCG = "ocg"
        TCG = "tcg"

    md_print = models.ForeignKey(MdPrint, on_delete=models.CASCADE, related_name="arts")
    version = models.CharField(max_length=6, choices=Version.choices)
    image = models.ImageField(upload_to="cards/art/")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["md_print", "version"], name="carddb_art_print_version")]


class SrcMd(models.Model):
    md_id = models.PositiveIntegerField()
    lang = models.CharField(max_length=2)
    name = models.CharField(max_length=200)
    ruby = models.CharField(max_length=400, blank=True)
    text = models.TextField(blank=True)
    prop_a = models.BigIntegerField()
    prop_b = models.BigIntegerField()
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["md_id", "lang"], name="carddb_srcmd_id_lang")]


class Override(models.Model):
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="overrides")
    field = models.CharField(max_length=40, help_text="예: name_ko, text.ko.effect")
    value = models.JSONField()
    reason = models.CharField(max_length=200, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["card", "field"], name="carddb_override_card_field")]


class Product(models.Model):
    class Region(models.TextChoices):
        OCG = "ocg"
        KR = "kr"
        TCG = "tcg"

    id = models.BigIntegerField(primary_key=True, help_text="공식 DB 상품 번호 (pid)")
    region = models.CharField(max_length=3, choices=Region.choices)
    name = models.CharField(max_length=300)
    category = models.CharField(max_length=40, blank=True)
    release_date = models.DateField(null=True, blank=True)


class ProductCard(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="cards")
    cid = models.PositiveIntegerField(db_index=True)
    rarity = models.CharField(max_length=20, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "cid", "rarity"], name="carddb_productcard_unique")]


class SrcOfficial(models.Model):
    cid = models.PositiveIntegerField()
    lang = models.CharField(max_length=2)
    name = models.CharField(max_length=200)
    data = models.JSONField()
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["cid", "lang"], name="carddb_srcofficial_cid_lang")]


class LegacyCard(models.Model):
    class How(models.TextChoices):
        KONAMI = "konami"
        NAME_KO = "name_ko"
        NAME_EN = "name_en"
        MANUAL = "manual"
        NONE = "none"

    old_id = models.PositiveIntegerField(primary_key=True, help_text="옛 card.Card.id")
    old_card_id = models.CharField(max_length=100, blank=True, help_text="옛 card_id (YGOPRODeck 패스코드×100+그림 번호)")
    card = models.ForeignKey(Card, null=True, blank=True, on_delete=models.SET_NULL, related_name="legacy_cards")
    how = models.CharField(max_length=8, choices=How.choices, default=How.NONE)


class CardGroup(models.Model):
    """카드군: cards whose Japanese name holds 「text」 read as `reading`, plus cards treated as such by their text."""

    class NameSource(models.TextChoices):
        PAIR = "pair", "효과문 대조"
        QUOTE = "quote", "한국어 효과문"
        COMMON = "common", "카드 이름 공통 부분"
        MANUAL = "manual", "운영진"
        NONE = "none", "없음"

    text = models.CharField(max_length=60, help_text="효과문 「」 안의 문자열 (NFKC)")
    reading = models.CharField(max_length=120, blank=True, help_text="같은 문자열도 읽는 법이 다르면 다른 카드군 (「C」 コクーン·チェーン)")
    name_ko = models.CharField(max_length=120, blank=True)
    name_source = models.CharField(max_length=8, choices=NameSource.choices, default=NameSource.NONE)
    name_agreement = models.FloatField(default=0, help_text="일본어·한국어 효과문 짝 가운데 이 이름인 비율")
    name_coverage = models.FloatField(default=0, help_text="회원 카드 한국어 이름에 이 이름이 들어 있는 비율")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    md_list = models.BooleanField(default=False, help_text="마듀 card_named 목록 하나와 회원이 똑같음")
    needs_review = models.BooleanField(default=False, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["text", "reading"]
        constraints = [models.UniqueConstraint(fields=["text", "reading"], name="uniq_card_group_text_reading")]

    def __str__(self):
        reading = f"({self.reading})" if self.reading and self.reading != self.text else ""
        return f"「{self.text}」{reading} {self.name_ko}"


class CardGroupMember(models.Model):
    class How(models.TextChoices):
        NAME = "name", "이름"
        READING = "reading", "읽는 법"
        TREATED = "treated", "취급 문구"
        ADDED = "added", "운영진 추가"
        REMOVED = "removed", "운영진 제외"

    MANUAL = (How.ADDED, How.REMOVED)

    group = models.ForeignKey(CardGroup, on_delete=models.CASCADE, related_name="members")
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="group_memberships")
    how = models.CharField(max_length=8, choices=How.choices)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "card"], name="carddb_group_card")]


def has_art(card_field="pk"):
    """Filter for cards (or rows pointing at one) with Master Duel art — the site leaves out cards outside Master Duel."""
    return models.Exists(MdArt.objects.filter(md_print_id=models.OuterRef(card_field)))
