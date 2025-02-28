from django.db import models

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

class Deck(models.Model):
    class _Strength(models.IntegerChoices):
        SUBPAR = 0, '티어권'
        NONMETA = 1, '준티어권'
        NEARMETA = 2, '비티어권'
        META = 3, '하위권'

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

    strength = models.IntegerField(choices=_Strength.choices)
    difficulty = models.IntegerField(choices=_Difficulty.choices)
    deck_type = models.IntegerField(choices=_DeckType.choices)
    art_style = models.IntegerField(choices=_ArtStyle.choices)
    summoning_methods = models.ManyToManyField(SummoningMethod)
    performance_tags = models.ManyToManyField(PerformanceTag)
    aesthetic_tags = models.ManyToManyField(AestheticTag)
    num_views = models.PositiveIntegerField(default=0)

    description = models.TextField(
        blank=True,
        null=True,
        help_text="Provide details about the deck's features, usage tips, or overall concept."   
    )
    
    def increment_views(self):
        self.num_views += 1
        self.save(update_fields=['num_views'])