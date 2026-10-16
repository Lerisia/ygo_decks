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


class ProvisionalArt(models.Model):
    """A stand-in illustration for a card Master Duel has not released: cut from the card image Konami published
    (via ygoprodeck, by Konami id), shown until a Master Duel print brings the real art (엘리스 2026-10-17)."""

    card = models.OneToOneField(Card, on_delete=models.CASCADE, related_name="provisional_art")
    image = models.ImageField(upload_to="cards/art/provisional/")
    source_id = models.CharField(max_length=20, blank=True, help_text="ygoprodeck의 id (발매 전엔 임시 번호)")
    fetched_at = models.DateTimeField(auto_now=True)


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


class CardSupport(models.Model):
    """서포트: `card` names a 카드군 (`group`) or a card (`target`) in its Japanese text without being one of them.
    Built from the texts with the groups (carddb/support.py), so every row is replaced on a rebuild."""

    class How(models.TextChoices):
        GROUP = "group", "카드군 언급"
        PARENT = "parent", "상위 카드군 언급"
        CARD = "card", "카드 언급"
        CARD_GROUP = "card_group", "언급한 카드의 카드군"
        NAMED = "named", "카드명 취급"   # bears the target's name ("…「X」として扱う"): one of it, not its support

    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="supports")
    group = models.ForeignKey(CardGroup, null=True, blank=True, on_delete=models.CASCADE, related_name="supporters")
    target = models.ForeignKey(Card, null=True, blank=True, on_delete=models.CASCADE, related_name="supporters")
    how = models.CharField(max_length=10, choices=How.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["card", "group"], name="carddb_support_card_group"),
            models.UniqueConstraint(fields=["card", "target"], name="carddb_support_card_target"),
            models.CheckConstraint(condition=models.Q(group__isnull=True) ^ models.Q(target__isnull=True),
                                   name="carddb_support_one_target"),
        ]


class BanStatus(models.TextChoices):
    """A card's place on a 금제 list; 미출시 is a card not yet out in that game on the day (엘리스 2026-10-12)."""
    FORBIDDEN = "forbidden", "금지"
    LIMITED = "limited", "제한"
    SEMI_LIMITED = "semi_limited", "준제한"
    UNLIMITED = "unlimited", "무제한"
    UNRELEASED = "unreleased", "미출시"


class Banlist(models.Model):
    """One 금제 (Forbidden & Limited list) of a game: every card it limits, from its day until the next list. Master
    Duel's first (엘리스 2026-10-12); the format leaves room for OCG and TCG."""

    class Format(models.TextChoices):
        MD = "md", "마스터 듀얼"
        OCG = "ocg", "OCG"
        TCG = "tcg", "TCG"

    format = models.CharField(max_length=8, choices=Format.choices)
    effective = models.DateField(help_text="시행일")
    source = models.CharField(max_length=200, blank=True, help_text="출처 문서 (Yugipedia)")

    class Meta:
        ordering = ["format", "-effective"]
        constraints = [models.UniqueConstraint(fields=["format", "effective"], name="carddb_banlist_format_day")]

    def __str__(self):
        return f"{self.get_format_display()} {self.effective}"


class BanlistEntry(models.Model):
    """A card on a list, as its source writes it: the status, and the one before when it changed. The source's name
    stays, so a card the card DB does not know yet is kept and linked once it is."""

    banlist = models.ForeignKey(Banlist, on_delete=models.CASCADE, related_name="entries")
    card = models.ForeignKey(Card, null=True, blank=True, on_delete=models.SET_NULL, related_name="banlist_entries")
    name = models.CharField(max_length=200, help_text="출처에 적힌 이름")
    status = models.CharField(max_length=12, choices=BanStatus.choices)
    previous = models.CharField(max_length=12, choices=BanStatus.choices, blank=True,
                                help_text="바뀐 카드의 바로 전 상태 (그대로면 비움)")

    class Meta:
        ordering = ["banlist", "name"]
        constraints = [models.UniqueConstraint(fields=["banlist", "name"], name="carddb_banlist_entry_name")]


def has_art(card_field="pk"):
    """Filter for cards (or rows pointing at one) with Master Duel art — the site leaves out cards outside Master Duel."""
    return models.Exists(MdArt.objects.filter(md_print_id=models.OuterRef(card_field)))


class MdPack(models.Model):
    """A Master Duel pack or deck, as masterduelmeta.com lists it, and the cards it holds (엘리스 2026-10-12, the pack
    simulator). A pack the source stops listing is kept."""

    class Kind(models.TextChoices):
        NORMAL = "normal", "노멀 팩"
        SECRET = "secret", "시크릿 팩"
        SELECTION = "selection", "셀렉션 팩"
        BONUS = "bonus", "보너스 팩"
        STRUCTURE = "structure", "스트럭처 덱"

    mdm_id = models.CharField(max_length=32, unique=True, help_text="masterduelmeta 세트 id")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    name_en = models.CharField(max_length=200)
    name_ko = models.CharField(max_length=200, blank=True)
    released = models.DateField(null=True, blank=True)
    game_id = models.PositiveIntegerField(null=True, blank=True, help_text="게임 속 팩 번호")
    cover = models.CharField(max_length=24, blank=True, help_text="게임 속 팩 그림 (md_ui/packs/<cover>.webp)")
    changed = models.DateField(null=True, blank=True, help_text="지금 구성이 시작된 날 (카드가 추가·제외된 마지막 날, Yugipedia)")

    class Meta:
        ordering = ["-released", "name_en"]

    def __str__(self):
        return self.name_ko or self.name_en


class MdPackCard(models.Model):
    """A print in a pack, at the rarity it comes in there (an other art from a bundle is UR), and how many a deck
    holds."""

    pack = models.ForeignKey(MdPack, on_delete=models.CASCADE, related_name="cards")
    md_print = models.ForeignKey(MdPrint, on_delete=models.CASCADE, related_name="packs")
    rarity = models.CharField(max_length=2, choices=MdPrint.Rarity.choices)
    amount = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ["pack", "md_print"]
        constraints = [models.UniqueConstraint(fields=["pack", "md_print"], name="carddb_mdpackcard_unique")]


class MdPackVersion(models.Model):
    """A selection or secret pack as it was sold while a campaign gave cards in it a new art or an 오버프레임, or before its
    cards last changed (Yugipedia's record of when each came, and of each card added or removed; 엘리스 2026-10-13: the
    usual pack and each version, side by side): the days, which of the pack's prints came as which art, the cards of
    today's lineup it did not hold yet and the ones it held that were removed since, and the cover the game gave it
    then."""

    pack = models.ForeignKey(MdPack, on_delete=models.CASCADE, related_name="versions")
    start = models.DateField()
    end = models.DateField()
    swaps = models.JSONField(default=dict)   # {base print id: art print id}
    missing = models.JSONField(default=list)   # [print id] of today's lineup, added since
    extra = models.JSONField(default=dict)     # {print id: rarity} held then, removed since
    cover = models.CharField(max_length=40, blank=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["pack", "start", "end"]
        constraints = [models.UniqueConstraint(fields=["pack", "start", "end"], name="carddb_mdpackversion_unique")]


class PackTally(models.Model):
    """A user's opening of one pack: gems spent, packs opened, URs and SRs pulled, and whether the next ten are owed a
    UR (ten without one)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pack_tallies")
    pack = models.ForeignKey(MdPack, on_delete=models.CASCADE, related_name="tallies")
    gems = models.PositiveIntegerField(default=0)
    packs = models.PositiveIntegerField(default=0)
    ur = models.PositiveIntegerField(default=0)
    sr = models.PositiveIntegerField(default=0)
    owed = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "pack"], name="carddb_packtally_unique")]
