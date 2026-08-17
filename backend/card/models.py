import os
import requests
from django.db import models
from django.core.files.base import ContentFile
from django.conf import settings

class RegulationStatus(models.IntegerChoices):
    UNLIMITED = 0, '무제한'
    SEMI_LIMITED = 1, '준제한'
    LIMITED = 2, '제한'
    FORBIDDEN = 3, '금지'

class Card(models.Model):
    card_id = models.CharField(max_length=100, unique=True)
    konami_id = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    # When this row first appeared in our DB. Existing rows are backfilled
    # to 2020-01-01 in migration 0020; fresh inserts from fetch_ygo_cards
    # get the current timestamp via auto_now_add. Used to surface newly
    # scraped cards at the top of the 듀치마인드 단어장 browser.
    created_at = models.DateTimeField(auto_now_add=True)
    korean_name = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    # Japanese card name (e.g. 青眼の白龍). Backfilled from YGOPRODeck via
    # `manage.py backfill_card_jp_names` so the Twitter SAMPLE scraper can
    # map JP-only tweet text to our Korean DB entries.
    name_ja = models.CharField(max_length=255, null=True, blank=True, db_index=True)

    image_url = models.URLField(blank=True, null=True)
    card_illust = models.ImageField(upload_to='card_illusts/', blank=True, null=True, help_text="Upload a card image.")
    card_image = models.ImageField(upload_to='card_images/', blank=True, null=True, help_text="Upload a card image.")

    # YGOPRODeck-sourced metadata (English values; Korean shown via translation maps)
    card_type = models.CharField(max_length=50, blank=True, null=True, help_text="Effect Monster / Spell Card / Trap Card / ...")
    frame_type = models.CharField(max_length=20, blank=True, null=True, help_text="effect, synchro, xyz, link, spell, trap, ...")
    attribute = models.CharField(max_length=10, blank=True, null=True, db_index=True, help_text="DARK, LIGHT, WATER, FIRE, EARTH, WIND, DIVINE")
    race = models.CharField(max_length=50, blank=True, null=True, db_index=True, help_text="Fiend, Dragon, Spellcaster, ... or Spell/Trap subcategory")
    archetype = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    korean_archetype = models.CharField(max_length=100, blank=True, null=True, db_index=True)

    level = models.IntegerField(blank=True, null=True, help_text="Level for normal/effect, Rank for XYZ")
    atk = models.IntegerField(blank=True, null=True, help_text="-1 means '?'")
    def_value = models.IntegerField(blank=True, null=True, db_column='def_value', help_text="-1 means '?'")
    pendulum_scale = models.IntegerField(blank=True, null=True)
    link_value = models.IntegerField(blank=True, null=True)
    link_markers = models.JSONField(blank=True, null=True, help_text="['Top','Left',...]")

    description = models.TextField(blank=True, null=True, help_text="English effect text from API")
    korean_description = models.TextField(blank=True, null=True, help_text="Korean effect text (separate source)")

    # YGOPro / BabelCDB archetype membership — up to 4 archetype IDs packed
    # into one 64-bit int (each slot is 16 bits). Decoded on read for
    # questions / filtering. Sourced from cards.cdb's `setcode` column.
    setcode_raw = models.BigIntegerField(blank=True, null=True, db_index=True)

    # Yugipedia Semantic MediaWiki properties — community-curated effect
    # taxonomy, much more granular than BabelCDB. Each is a list of
    # descriptive English strings (e.g. "Sends itself from field to GY for
    # cost"). Sourced by passcode lookup. Raw values stored as-is; the
    # game-engine maps them to internal tag groups via a curated dict.
    yugipedia_actions = models.JSONField(default=list, blank=True)
    yugipedia_summoning = models.JSONField(default=list, blank=True)
    yugipedia_misc = models.JSONField(default=list, blank=True)
    # Yugipedia stores destroys/negates under MonsterSpellTrap, and banish
    # effects under a separate Banishing property — surprisingly NOT in
    # Actions. Both are crucial for our game taxonomy.
    yugipedia_monster_spell_trap = models.JSONField(default=list, blank=True)
    yugipedia_banishing = models.JSONField(default=list, blank=True)
    # Yugipedia Archseries — list of archetype/series names the card
    # belongs to (multi-valued, unlike YGOPRODeck which assigns only one).
    # Properly tracks sub-archetype hierarchy: e.g. DDD cards have both
    # ["D/D", "D/D/D"], 레드 데몬즈 드래곤 has ["Archfiend", "Red Dragon
    # Archfiend (archetype)", "Signer Dragon"].
    yugipedia_archseries = models.JSONField(default=list, blank=True)

    def get_image(self):
        return self.image_url if self.image_url else None

    def __str__(self):
        return f"{self.korean_name} (ID: {self.card_id})"

class Archetype(models.Model):
    """YGOPro/BabelCDB archetype (테마/시리즈). 16-bit setcode unique key.
    Multiple cards belong via Card.setcode_raw (which packs up to 4
    archetype ids per card).
    """
    setcode = models.PositiveIntegerField(unique=True, db_index=True)
    name_en = models.CharField(max_length=100, blank=True)
    name_ko = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ['name_ko', 'name_en', 'setcode']

    def __str__(self):
        return f"{self.name_ko or self.name_en} (0x{self.setcode:x})"


class LimitRegulation(models.Model):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class LimitRegulationEntry(models.Model):
    entry = models.ForeignKey(LimitRegulation, on_delete=models.CASCADE, related_name="entries")  
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="limit_regulation_entries")
    regulation_status = models.IntegerField(choices=RegulationStatus.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["entry", "card"], name="unique_entry_card")
        ]

    def __str__(self):
        return f"{self.entry.name} - {self.card.name}: {self.get_regulation_status_display()}"

class QuizHighScore(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_high_scores',
    )
    score = models.PositiveIntegerField()
    streak = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-score', '-streak', 'created_at']

    def __str__(self):
        return f"{self.user.username}: {self.score}pts ({self.streak} streak)"


class QuizMonthlyAward(models.Model):
    """End-of-month payout record for the top-3 solo Card Quiz scorers.
    Acts as the idempotency key for the `award_quiz_monthly_top3` command —
    re-running for the same (year, month) is a no-op."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_monthly_awards',
    )
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    rank = models.PositiveSmallIntegerField()
    score = models.PositiveIntegerField()
    points_awarded = models.PositiveIntegerField()
    awarded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year', '-month', 'rank']
        unique_together = [('year', 'month', 'rank')]

    def __str__(self):
        return f"{self.year}.{self.month:02d} #{self.rank} {self.user.username}: +{self.points_awarded}P"


class QuizAllTimeBest(models.Model):
    """Per-user all-time best Card Quiz score. Display-only — does NOT drive
    leaderboard ranking (current weekly best does). Updated on every score
    submission if the new score exceeds the stored value."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_all_time_best',
    )
    score = models.PositiveIntegerField()
    streak = models.PositiveIntegerField()
    achieved_at = models.DateTimeField()

    def __str__(self):
        return f"{self.user.username} all-time: {self.score}pts"


class QuizWeeklyAward(models.Model):
    """Weekly payout record for the top-3 solo Card Quiz scorers (Mon-Sun
    KST). Idempotency key for `award_quiz_weekly_top3` — re-running for the
    same week_start_date is a no-op. week_start_date is the Monday (KST) of
    the paid-out week."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_weekly_awards',
    )
    week_start_date = models.DateField(db_index=True)
    rank = models.PositiveSmallIntegerField()
    score = models.PositiveIntegerField()
    points_awarded = models.PositiveIntegerField()
    awarded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-week_start_date', 'rank']
        unique_together = [('week_start_date', 'rank')]

    def __str__(self):
        return f"{self.week_start_date} #{self.rank} {self.user.username}: +{self.points_awarded}P"


class CardEffectTag(models.Model):
    """LLM-classified semantic tags for a card's effect text. Each tag is a
    binary "does this card do X" flag where the classifier read the Korean
    description and decided based on active/intentional semantics (e.g.
    `destroys` excludes passive triggers like 파괴되었을 때).

    `manually_reviewed=True` marks a row a human has audited — the bulk
    re-classifier skips these so corrections aren't clobbered.
    `classifier_version` lets us invalidate previous tags wholesale when the
    prompt is materially changed.
    """
    card = models.OneToOneField(
        Card, on_delete=models.CASCADE, related_name='effect_tag',
    )
    # The 12 tag flags (see solo Twenty Questions spec for definitions).
    destroys = models.BooleanField(default=False, db_index=True)             # 파괴
    banishes = models.BooleanField(default=False, db_index=True)             # 제외
    banishes_facedown = models.BooleanField(default=False, db_index=True)    # 뒷면 제외
    draws = models.BooleanField(default=False, db_index=True)                # 드로우
    searches = models.BooleanField(default=False, db_index=True)             # 서치
    negates = models.BooleanField(default=False, db_index=True)              # 퍼미션
    bounces = models.BooleanField(default=False, db_index=True)              # 바운스
    special_summons = models.BooleanField(default=False, db_index=True)      # 특수 소환
    sends_to_graveyard = models.BooleanField(default=False, db_index=True)   # 묘지로 보내기 (필드→묘지, 파괴 아님)
    dumps = models.BooleanField(default=False, db_index=True)                # 덤핑 (자기 덱/패 → 자기 묘지)
    effect_damage = models.BooleanField(default=False, db_index=True)        # 효과 대미지
    revives = models.BooleanField(default=False, db_index=True)              # 소생
    salvages = models.BooleanField(default=False, db_index=True)             # 샐비지
    locks = models.BooleanField(default=False, db_index=True)                # 락 (지속 제약)
    # Sourced from the namuwiki 패 트랩 list rather than the LLM classifier —
    # community-curated for accuracy. Updated by the `populate_hand_traps`
    # management command (or a manual data migration) when the list changes.
    hand_trap = models.BooleanField(default=False, db_index=True)            # 패 트랩

    # ── YGOPro / EDOPro `cards.cdb` category bits (sourced from
    #    ProjectIgnis/BabelCDB, decoded via the 32-category filter scheme).
    #    Imported in bulk by matching Card.konami_id against cards.cdb's `id`
    #    column. This is the authoritative effect categorization — preferred
    #    over the LLM fields above for game queries.
    cat_destroy_monster   = models.BooleanField(default=False, db_index=True)  # 0x1
    cat_destroy_st        = models.BooleanField(default=False, db_index=True)  # 0x2
    cat_destroy_deck      = models.BooleanField(default=False, db_index=True)  # 0x4 (mill)
    cat_destroy_hand      = models.BooleanField(default=False, db_index=True)  # 0x8 (discard)
    cat_send_to_gy        = models.BooleanField(default=False, db_index=True)  # 0x10
    cat_send_to_hand      = models.BooleanField(default=False, db_index=True)  # 0x20
    cat_send_to_deck      = models.BooleanField(default=False, db_index=True)  # 0x40
    cat_banish            = models.BooleanField(default=False, db_index=True)  # 0x80
    cat_draw              = models.BooleanField(default=False, db_index=True)  # 0x100
    cat_search            = models.BooleanField(default=False, db_index=True)  # 0x200
    cat_change_atk_def    = models.BooleanField(default=False, db_index=True)  # 0x400
    cat_change_level_rank = models.BooleanField(default=False, db_index=True)  # 0x800
    cat_position          = models.BooleanField(default=False, db_index=True)  # 0x1000
    cat_piercing          = models.BooleanField(default=False, db_index=True)  # 0x2000
    cat_direct_attack     = models.BooleanField(default=False, db_index=True)  # 0x4000
    cat_multi_attack      = models.BooleanField(default=False, db_index=True)  # 0x8000
    cat_negate_activation = models.BooleanField(default=False, db_index=True)  # 0x10000
    cat_negate_effect     = models.BooleanField(default=False, db_index=True)  # 0x20000
    cat_damage_lp         = models.BooleanField(default=False, db_index=True)  # 0x40000
    cat_recover_lp        = models.BooleanField(default=False, db_index=True)  # 0x80000
    cat_special_summon    = models.BooleanField(default=False, db_index=True)  # 0x100000
    cat_non_effect        = models.BooleanField(default=False, db_index=True)  # 0x200000
    cat_token_related     = models.BooleanField(default=False, db_index=True)  # 0x400000
    cat_fusion_related    = models.BooleanField(default=False, db_index=True)  # 0x800000
    cat_ritual_related    = models.BooleanField(default=False, db_index=True)  # 0x1000000
    cat_synchro_related   = models.BooleanField(default=False, db_index=True)  # 0x2000000
    cat_xyz_related       = models.BooleanField(default=False, db_index=True)  # 0x4000000
    cat_link_related      = models.BooleanField(default=False, db_index=True)  # 0x8000000
    cat_counter_related   = models.BooleanField(default=False, db_index=True)  # 0x10000000
    cat_gamble            = models.BooleanField(default=False, db_index=True)  # 0x20000000
    cat_control           = models.BooleanField(default=False, db_index=True)  # 0x40000000
    cat_move_zones        = models.BooleanField(default=False, db_index=True)  # 0x80000000

    classified_at = models.DateTimeField(auto_now=True)
    classifier_version = models.CharField(max_length=20, default='v1')
    manually_reviewed = models.BooleanField(default=False, db_index=True)

    def __str__(self):
        return f"EffectTag<{self.card_id}>"


class UploadRecord(models.Model):
    uploaded_image = models.ImageField(upload_to='uploads/')
    detected_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )

class CardDetection(models.Model):
    record = models.ForeignKey(UploadRecord, on_delete=models.CASCADE)
    card = models.ForeignKey(Card, on_delete=models.CASCADE)
    confidence = models.FloatField()
    illust_image = models.ImageField(upload_to='illusts/')
