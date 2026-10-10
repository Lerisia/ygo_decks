from django.conf import settings
from django.db import models
from PIL import Image
import os


def _write_atomically(rel, write):
    """Write a media file under a temporary name and swap it in, so a phone loading it never gets half a picture."""
    path = os.path.join(settings.MEDIA_ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "wb") as f:
            write(f)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _save_webp(img, rel, size, quality):
    """Scaled down to fit size×size (never up)."""
    im = img.convert("RGB")
    if max(im.size) > size:
        im.thumbnail((size, size), Image.LANCZOS)
    _write_atomically(rel, lambda f: im.save(f, "WEBP", quality=quality, method=6))

class SummoningMethod(models.Model):
    id = models.IntegerField(primary_key=True)
    class SummonType(models.IntegerChoices):
        # This field doesn't just indicate which summoning methods the deck can use,
        # but which one is commonly recognized as its signature or defining characteristic.
        # So 'All' means that the deck can use almost every summoning method but it do not has a signature.
        NONE = 0, '소환법 없음'
        FUSION = 1, '융합'
        RITUAL = 2, '의식'
        SYNCHRO = 3, '싱크로'
        XYZ = 4, '엑시즈'
        PENDULUM = 5, '펜듈럼'
        LINK = 6, '링크'
        ALL = 99, '다양'

    method = models.IntegerField(choices=SummonType.choices, unique=True)
    
    def __str__(self):
        return self.get_method_display()
    
class PerformanceTag(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True, help_text="Enter a brief description of this tag.")

    def __str__(self):
        return self.name

class AestheticTag(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True, help_text="Enter a brief description of this tag.")

    def __str__(self):
        return self.name

# Strength survey "band" — each survey option covers two neighbouring tiers (특이점 2026-10-03):
# 최상위·상위 / 상위·중상위 / 중상위·중하위 / 중하위·하위 / 하위·최하위. Deck.strength itself stays a single tier (0-5).
STRENGTH_BAND_TO_TIERS = {
    0: (0, 1),       # 최상위 + 상위
    1: (1, 2),       # 상위 + 중상위
    2: (2, 3),       # 중상위 + 중하위
    3: (3, 4),       # 중하위 + 하위
    4: (4, 5),       # 하위 + 최하위
}
# Reverse map: given a deck's tier, which bands include it (for lookup gen).
STRENGTH_TIER_TO_BANDS = {
    tier: tuple(b for b, tiers in STRENGTH_BAND_TO_TIERS.items() if tier in tiers)
    for tier in range(6)
}


class Deck(models.Model):
    class _Strength(models.IntegerChoices):
        TOP = 0, '최상위권'
        UPPER = 1, '상위권'
        MID_UPPER = 2, '중상위권'
        MID_LOWER = 3, '중하위권'
        LOWER = 4, '하위권'
        BOTTOM = 5, '최하위권'

    class _Difficulty(models.IntegerChoices):
        EASY = 0, '쉬움'
        INTERMEDIATE = 1, '보통'
        ADVANCED = 2, '어려움'

    class _DeckType(models.IntegerChoices):
        COMBO = 0, '전개'
        MIDRANGE = 1, '미드레인지'
        CONTROL = 2, '운영'
        ROGUE = 3, '특이'

    class _ArtStyle(models.IntegerChoices):
        COOL = 0, '멋있는'
        DARK = 1, '어두운'
        BRIGHT = 2, '명랑한'
        DREAMY = 3, '환상적'
        GRAND = 4, '웅장한'

    name = models.CharField(max_length=50)

    cover_image = models.ImageField(
        upload_to='deck_covers/',
        blank=True,
        null=True,
        help_text="Upload a representative image for the deck."
    )
    
    cover_image_small = models.ImageField(upload_to='deck_covers/small/', blank=True, null=True)
    # Deck database list: up to 480px (a 224px-wide card on a 2x screen), scaled down from the original, never up.
    cover_image_list = models.ImageField(upload_to='deck_covers/list/', blank=True, null=True)
    # Phones' list tiles (~100px on a 3x screen): up to 320px, under half the bytes of the 480px one (2026-10-06).
    cover_image_phone = models.ImageField(upload_to='deck_covers/phone/', blank=True, null=True)
    # Deck page and test result: up to 960px webp in place of the original upload, which can be a 3MB PNG.
    cover_image_detail = models.ImageField(upload_to='deck_covers/detail/', blank=True, null=True)

    strength = models.IntegerField(choices=_Strength.choices)
    difficulty = models.IntegerField(choices=_Difficulty.choices)
    deck_type = models.IntegerField(choices=_DeckType.choices)
    art_style = models.IntegerField(choices=_ArtStyle.choices)
    # 단일 덱으로는 드물고 다른 덱에 용병(엔진)으로 섞여 쓰이는 덱
    is_engine = models.BooleanField(default=False, verbose_name="Engine (용병)")
    # 신규 업데이트 덱 (특이점 2026-10-03, 도감에 파란 U 표시). 새 업데이트가 오면 기존 덱을 끄고 새 덱을 켠다.
    is_upcoming = models.BooleanField(default=False, verbose_name="Update (신규 업데이트)")
    # 덱 플레이 참고 영상 (예: 김빠방 유튜브). 비어 있으면 상세 페이지 버튼이 '준비 중'.
    play_video_url = models.URLField(max_length=300, blank=True, default="", verbose_name="플레이 영상 URL")
    summoning_methods = models.ManyToManyField(SummoningMethod)
    performance_tags = models.ManyToManyField(PerformanceTag, blank=True)  # 태그 없음 = 해당 없음 (2026-09-13)
    aesthetic_tags = models.ManyToManyField(AestheticTag, blank=True)
    stat_consistency = models.PositiveSmallIntegerField(null=True, blank=True, help_text="안정성 (0~10, 11 = 그래프에 ?로 표시)")
    stat_breakthrough = models.PositiveSmallIntegerField(null=True, blank=True, help_text="돌파력 (0~10, 11 = 그래프에 ?로 표시)")
    stat_interruption = models.PositiveSmallIntegerField(null=True, blank=True, help_text="견제력 (0~10, 11 = 그래프에 ?로 표시)")
    stat_recovery = models.PositiveSmallIntegerField(null=True, blank=True, help_text="복구력 (0~10, 11 = 그래프에 ?로 표시)")
    stat_deck_space = models.PositiveSmallIntegerField(null=True, blank=True, help_text="덱 스페이스 (0~10, 11 = 그래프에 ?로 표시)")
    num_views = models.PositiveIntegerField(default=0)
    

    description = models.TextField(
        blank=True,
        null=True,
        help_text="Provide details about the deck's features, usage tips, or overall concept."   
    )
    
    wiki_content = models.TextField(
        blank=True,
        null=True,
        help_text="A detailed explanation of the deck, its strategies, history, and variations. Supports HTML formatting."
    ) #  Wiki content with HTML

    def __str__(self):
        return self.name
    
    COVER_VERSIONS = ("cover_image_small", "cover_image_list", "cover_image_phone", "cover_image_detail")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Counting a view (update_fields=["num_views"]) used to re-encode every cover version on each test result.
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "cover_image" not in update_fields:
            return
        if self.cover_image and self.cover_versions_stale():
            self.make_cover_versions()

    def _cover_version_names(self):
        base = os.path.basename(self.cover_image.name)
        stem = f"{self.pk}_{os.path.splitext(base)[0]}"
        return {
            "cover_image_small": f"deck_covers/small/{base}",
            "cover_image_list": f"deck_covers/list/{stem}.webp",
            "cover_image_phone": f"deck_covers/phone/{stem}.webp",
            "cover_image_detail": f"deck_covers/detail/{stem}.webp",
        }

    def cover_versions_stale(self):
        """A version is missing, made from another cover, or older than the cover file."""
        try:
            source_mtime = os.path.getmtime(self.cover_image.path)
        except OSError:
            return False
        for field, name in self._cover_version_names().items():
            current = getattr(self, field)
            if not current or current.name != name:
                return True
            try:
                if os.path.getmtime(current.path) < source_mtime:
                    return True
            except OSError:
                return True
        return False

    def make_cover_versions(self):
        names = self._cover_version_names()
        with Image.open(self.cover_image.path) as img:
            img.load()
            small = img.resize((200, 200))
            small_format = Image.registered_extensions().get(os.path.splitext(names["cover_image_small"])[1].lower(), "PNG")
            if small_format == "JPEG" and small.mode not in ("RGB", "L"):
                small = small.convert("RGB")
            _write_atomically(names["cover_image_small"], lambda f: small.save(f, small_format))
            self.make_list_cover(img, self.pk, os.path.basename(self.cover_image.name))
            _save_webp(img, names["cover_image_phone"], 320, quality=80)
            _save_webp(img, names["cover_image_detail"], 960, quality=82)
        for field, name in names.items():
            getattr(self, field).name = name
        super().save(update_fields=list(names))

    @staticmethod
    def make_list_cover(img, deck_id, base, size=480):
        rel = f"deck_covers/list/{deck_id}_{os.path.splitext(base)[0]}.webp"
        _save_webp(img, rel, size, quality=85)
        return rel

    def increment_views(self):
        self.num_views += 1
        self.save(update_fields=['num_views'])
        
class DeckAlias(models.Model):
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name='aliases')
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class DeckArchetype(models.Model):
    """Card.archetype values (YGOPRODeck English names) that identify this deck.
    Used by the PC tracker to infer decks from card IDs; several decks may share an archetype."""
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="archetypes")
    name = models.CharField(max_length=100, db_index=True)
    # 0..1 multiplier — lower for engines/splash themes so they don't outvote the main theme
    weight = models.FloatField(default=1.0)

    class Meta:
        verbose_name = "덱 아키타입"
        verbose_name_plural = "덱 아키타입"
        constraints = [models.UniqueConstraint(fields=["deck", "name"], name="uniq_deck_archetype")]

    def __str__(self):
        return f"{self.deck.name}: {self.name}"


class DeckFeaturedVideo(models.Model):
    """One hand-picked / auto-picked representative YouTube video per deck (global, any channel)."""
    LANG_CHOICES = [("en", "영어권"), ("ja", "일본"), ("ko", "한국"), ("other", "기타")]
    deck = models.OneToOneField(Deck, on_delete=models.CASCADE, related_name="featured_video")
    video_id = models.CharField(max_length=20)
    title = models.CharField(max_length=300)
    channel = models.CharField(max_length=200, blank=True, default="")
    channel_url = models.URLField(max_length=300, blank=True, default="")
    lang = models.CharField(max_length=8, choices=LANG_CHOICES, default="en")
    view_count = models.PositiveIntegerField(null=True, blank=True)
    published_at = models.DateField(null=True, blank=True, help_text="업로드일")
    duration = models.PositiveIntegerField(null=True, blank=True, help_text="초")
    thumbnail_url = models.URLField(max_length=500, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="", help_text="선정 사유 메모")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "덱 대표 영상"
        verbose_name_plural = "덱 대표 영상"

    @property
    def url(self):
        return f"https://www.youtube.com/watch?v={self.video_id}"

    def __str__(self):
        return f"{self.deck.name}: {self.title}"


class DeckNote(models.Model):
    """Korean-language '강의노트' (deck guide) links shown on the deck detail page."""
    SOURCE_CHOICES = [("postype", "포스타입"), ("dcinside", "디시인사이드"), ("notion", "노션"), ("gdocs", "구글 문서"),
                      ("blog", "블로그"), ("twitter", "X(트위터)"), ("other", "기타")]
    GAME_CHOICES = [("md", "마스터 듀얼"), ("ocg", "OCG"), ("both", "공통")]
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="notes")
    title = models.CharField(max_length=300)
    author = models.CharField(max_length=100, blank=True, default="")
    url = models.URLField(max_length=500)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="other")
    game = models.CharField(max_length=8, choices=GAME_CHOICES, default="md")
    is_paid = models.BooleanField(default=False, verbose_name="유료")
    price = models.CharField(max_length=50, blank=True, default="", help_text="예: 3,000원")
    published_at = models.DateField(null=True, blank=True)
    summary = models.CharField(max_length=300, blank=True, default="")
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # One guide posted as several parts (1편, 2편, …): same series title → shown as one entry with a link per part.
    series = models.CharField(max_length=200, blank=True, default="", help_text="여러 편으로 나뉜 공략의 공통 제목 (같으면 하나로 묶임)")
    part = models.PositiveSmallIntegerField(null=True, blank=True, help_text="편 번호")
    part_label = models.CharField(max_length=100, blank=True, default="", help_text="편 부제 (예: 덱 소개)")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "-published_at", "id"]
        verbose_name = "덱 강의노트"
        verbose_name_plural = "덱 강의노트"
        constraints = [models.UniqueConstraint(fields=["deck", "url"], name="uniq_deck_note_url")]

    def __str__(self):
        return f"{self.deck.name}: {self.title}"


class DeckHyeol(models.Model):
    """혈자리 summary for one deck, from 듀얼 아카이브's 혈자리 아카이브 (mdarchive.pages.dev, by Hort — used with
    permission, 2026-10-02). Refreshed by `manage.py sync_hyeol`; `data` is the compact shape built in deck/hyeol.py."""
    deck = models.OneToOneField(Deck, on_delete=models.CASCADE, related_name="hyeol")
    data = models.JSONField(default=dict)
    source_updated_at = models.CharField(max_length=40, blank=True, default="")
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "덱 혈자리"
        verbose_name_plural = "덱 혈자리"

    def __str__(self):
        return f"{self.deck.name} 혈자리"


class DeckInferencePriority(models.Model):
    """Deck inference only: when both decks are candidates for the same duel, rank `winner` above `loser`.

    For hybrids the site treats as one deck — 십이수와 현람을 섞은 덱은 현람으로 분류한다(특이점 2026-09-15).
    Scores are untouched, so a deck seen alone is unaffected.
    """

    winner = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="inference_wins")
    loser = models.ForeignKey("deck.Deck", on_delete=models.CASCADE, related_name="inference_losses")
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["winner", "loser"], name="uniq_deck_inference_priority")]
        verbose_name = "덱 인식 우선순위"
        verbose_name_plural = "덱 인식 우선순위"

    def __str__(self):
        return f"{self.winner.name} > {self.loser.name}"
