from django.db import models
from django.conf import settings
from django.utils import timezone
import secrets


def generate_room_code():
    """6-char alphanumeric room code (excluding ambiguous chars)."""
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not Room.objects.filter(code=code).exists():
            return code


class Room(models.Model):
    STATUS_CHOICES = [
        ("waiting", "대기 중"),
        ("in_game", "게임 진행 중"),
        ("closed", "종료됨"),
    ]

    code = models.CharField(max_length=8, unique=True, db_index=True, default=generate_room_code)
    name = models.CharField(max_length=50)
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="hosted_rooms",
    )
    password = models.CharField(max_length=128, blank=True, default="")
    max_players = models.PositiveSmallIntegerField(default=8)
    allow_guests = models.BooleanField(default=False)
    is_listed = models.BooleanField(default=True, help_text="방 목록 노출 여부")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="waiting")
    current_game = models.CharField(max_length=32, blank=True, default="")
    quiz_total_rounds = models.PositiveSmallIntegerField(default=5)
    duchmind_total_rounds = models.PositiveSmallIntegerField(default=5, help_text="듀치마인드 라운드 수 (= 한 사람당 그리는 횟수)")
    duchmind_draw_seconds = models.PositiveSmallIntegerField(default=80, help_text="듀치마인드 그리는 시간 (초)")
    duchmind_word_options = models.PositiveSmallIntegerField(default=3, help_text="듀치마인드 카드 선택지 개수")
    duchmind_show_word_length = models.BooleanField(default=True, help_text="듀치마인드: 정답 글자수(밑줄+숫자) 노출")
    duchmind_show_hints = models.BooleanField(default=True, help_text="듀치마인드: 시간 경과에 따라 글자 힌트 공개 (글자수 노출 OFF면 무의미)")
    duchmind_hide_winner_chat = models.BooleanField(
        default=False,
        help_text="듀치마인드: 정답을 맞힌 사람의 채팅을 아직 못 맞힌 사람에게 가림 (스포일러 방지)",
    )
    duchmind_first_correct_speedup = models.BooleanField(
        default=False,
        help_text="듀치마인드: 첫 정답자 발생 시 남은 시간이 60%로 줄어듦 (긴장감 ↑)",
    )
    is_anonymous = models.BooleanField(default=False, help_text="익명 방: 닉네임이 '플레이어1/2/3…' (입장 순서대로). 아이콘은 그대로.")
    twenty_total_rounds = models.PositiveSmallIntegerField(default=4, help_text="딱무고개 라운드 수 (= 한 사람당 출제하는 횟수)")
    twenty_mode = models.CharField(
        max_length=16,
        choices=[("competitive", "경쟁"), ("cooperative", "협력")],
        default="competitive",
        help_text="딱무고개 모드: 경쟁 = 맞힌 사람만 점수, 협력 = 모든 추측자 동일 점수",
    )
    twenty_guess_attempts = models.PositiveSmallIntegerField(
        default=3,
        help_text="딱무고개 인당 라운드별 정답 시도 횟수 (0 = 무제한, 2/3/4/5)",
    )
    spectators_can_chat = models.BooleanField(default=True, help_text="관전자가 채팅을 칠 수 있는지")
    duchmind_word_pack = models.ForeignKey(
        "DuchMindWordPack",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="rooms_using",
        help_text="null이면 기본 단어장 사용",
    )
    quiz_word_pack = models.ForeignKey(
        "DuchMindWordPack",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="quiz_rooms_using",
        help_text="화질구지 단어장 — null이면 전체 카드 풀에서 추첨. 유희왕 series 팩만 사용.",
    )
    game_state = models.JSONField(default=dict, blank=True)
    kicked_user_ids = models.JSONField(default=list, blank=True)
    kicked_guest_nicknames = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_activity_at"]

    def __str__(self):
        return f"[{self.code}] {self.name}"

    @property
    def has_password(self):
        return bool(self.password)

    def player_count(self):
        """Number of *active participants* (excludes spectators)."""
        return self.players.filter(is_spectator=False).count()

    def reserved_count(self):
        """Number of spectators who have reserved a seat for the next turn."""
        return self.players.filter(is_spectator=True, reserved_for_next=True).count()

    def is_full(self):
        # Reserved spectators count against capacity so a full lobby can't
        # be over-reserved (active 6 + reserved 3 in a room of 8 is invalid).
        return (self.player_count() + self.reserved_count()) >= self.max_players


class RoomPlayer(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="players")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="room_memberships",
    )
    guest_nickname = models.CharField(max_length=20, blank=True, default="")
    guest_token = models.CharField(max_length=64, blank=True, default="", db_index=True,
                                    help_text="게스트 세션 식별자 (등록 유저는 빈 문자열)")
    guest_icon = models.ForeignKey(
        "avatar.CardIcon",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="+",
        help_text="게스트가 선택한 아이콘 (기본 아이콘 풀 중에서)",
    )
    score = models.IntegerField(default=0)
    is_host = models.BooleanField(default=False)
    is_spectator = models.BooleanField(default=False, help_text="관전자: 게임에 참여하지 않고 구경만 함")
    is_hidden = models.BooleanField(default=False, help_text="몰래 입장: 플레이어 목록에 노출되지 않음 (운영진 전용)")
    # Spectator who has opted in to join from the next turn. Promoted to
    # active participant by the duchmind/twenty turn-advance path. Counts
    # against max_players (so a full room can't be over-reserved).
    reserved_for_next = models.BooleanField(
        default=False,
        help_text="입장 예약: 다음 턴 시작 시 자동으로 참가자로 승격됨",
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["joined_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["room", "user"],
                condition=models.Q(user__isnull=False),
                name="unique_user_per_room",
            ),
            models.UniqueConstraint(
                fields=["room", "guest_nickname"],
                condition=models.Q(user__isnull=True),
                name="unique_guest_nick_per_room",
            ),
        ]

    def __str__(self):
        return f"{self.display_name} in {self.room.code}"

    @property
    def display_name(self):
        if self.user:
            return getattr(self.user, "nickname", None) or self.user.username
        return self.guest_nickname

    @property
    def is_guest(self):
        return self.user is None


SERIES_CHOICES = [
    ("yugioh", "유희왕"),
    ("pokemon", "포켓몬"),
]


class DuchMindWordPack(models.Model):
    """A named collection of card words for 듀치마인드. Owned by a user, or
    by no one (system default). Public packs are browsable by everyone.
    """
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=200, blank=True, default="")
    series = models.CharField(
        max_length=20,
        choices=SERIES_CHOICES,
        default="yugioh",
        help_text="단어팩의 IP 시리즈 — 게임 진행 시 어느 카드 풀에서 단어를 뽑을지 결정",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True, blank=True,  # null = system pack
        related_name="duchmind_word_packs",
    )
    is_default = models.BooleanField(default=False, help_text="System default pack — only one")
    is_public = models.BooleanField(default=False, help_text="Public packs are listed for everyone")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["is_default"],
                condition=models.Q(is_default=True),
                name="unique_default_duchmind_pack",
            ),
        ]

    def __str__(self):
        owner = self.owner.username if self.owner else "(system)"
        return f"{self.name} [{owner}]"


class DuchMindWord(models.Model):
    """An entry inside a DuchMindWordPack. Either `card` (for yugioh
    packs) or `pokemon` (for pokemon packs) is set, never both."""
    pack = models.ForeignKey(
        DuchMindWordPack,
        on_delete=models.CASCADE,
        null=True, blank=True,  # nullable for migration; will be enforced
        related_name="entries",
    )
    card = models.ForeignKey(
        "card.Card",
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="duchmind_words",
    )
    pokemon = models.ForeignKey(
        "PokemonCard",
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="duchmind_words",
    )
    enabled = models.BooleanField(default=True, help_text="Disabled words are excluded from random draws")
    note = models.CharField(max_length=120, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="created_duchmind_words",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # One unique constraint per series — both `card` and `pokemon`
            # are nullable, so we constrain only when the relevant FK is
            # set. This keeps yugioh + pokemon entries from clashing on
            # the same row id.
            models.UniqueConstraint(
                fields=["pack", "card"],
                condition=models.Q(card__isnull=False),
                name="unique_pack_card",
            ),
            models.UniqueConstraint(
                fields=["pack", "pokemon"],
                condition=models.Q(pokemon__isnull=False),
                name="unique_pack_pokemon",
            ),
        ]

    def __str__(self):
        if self.card_id:
            return f"DM-Y:{self.card_id} {self.card.korean_name or self.card.name}"
        if self.pokemon_id:
            return f"DM-P:{self.pokemon_id} {self.pokemon.name_ko}"
        return f"DM:(empty)"


class PokemonCard(models.Model):
    """A pokemon entry used for the pokemon-series 듀치마인드 word pool.
    Imported from damage-calc/assets/pokemon/*.json, with names
    transformed (e.g. '테오키스 (노말폼)' → '노말폼 테오키스')."""
    dex_number = models.IntegerField(db_index=True)
    name_ko = models.CharField(max_length=100, db_index=True)
    name_ko_original = models.CharField(max_length=100, default="", help_text="원본 한국어 이름 (괄호 형태)")
    name_en = models.CharField(max_length=100, default="")
    name_ja = models.CharField(max_length=100, blank=True, default="")
    type1 = models.CharField(max_length=20, blank=True, default="")
    type2 = models.CharField(max_length=20, blank=True, default="")
    source_file = models.CharField(max_length=20, default="", help_text="gen1.json / mega.json / forms.json 등")
    image_url = models.CharField(max_length=200, blank=True, default="", help_text="/media/pokemon/<dex>.png 또는 form id")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["dex_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["dex_number", "source_file", "name_ko"],
                name="unique_pokemon_dex_source_name",
            ),
        ]

    def __str__(self):
        return f"#{self.dex_number} {self.name_ko}"


# ---------------------------------------------------------------------------
# Audit log models — capture rooms / chat / play history with a 7-day TTL
# (cleanup via `manage.py prune_room_logs`). Decoupled from `Room` so closed
# rooms can be deleted while their archive lives on (and vice versa).
# ---------------------------------------------------------------------------


class RoomLog(models.Model):
    """Snapshot of a room at the time it was created. Mirrors the live
    Room fields we care about for audit; not kept in sync afterwards."""
    # Room.id at the time of creation. Live Room rows can be deleted (close)
    # without affecting the log, hence not a FK.
    source_room_id = models.IntegerField(db_index=True)
    code = models.CharField(max_length=8, db_index=True)
    name = models.CharField(max_length=50)
    host_username = models.CharField(max_length=150, blank=True, default="")
    host_id = models.IntegerField(null=True, blank=True)
    max_players = models.PositiveSmallIntegerField()
    is_anonymous = models.BooleanField(default=False)
    allow_guests = models.BooleanField(default=False)
    spectators_can_chat = models.BooleanField(default=True)
    current_game = models.CharField(max_length=32, blank=True, default="")
    options_json = models.JSONField(default=dict, help_text="Room option fields snapshot (rounds, draw_secs, etc.)")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.code}] {self.name} ({self.created_at:%Y-%m-%d %H:%M})"


class ChatLog(models.Model):
    """Every chat message broadcast in a logged room — lobby + in-game."""
    CHANNEL_CHOICES = [
        ("lobby", "Lobby"),
        ("dm", "DuchMind"),
        ("tw", "Twenty"),
        ("quiz", "Quiz"),
    ]
    room_log = models.ForeignKey(RoomLog, on_delete=models.CASCADE, related_name="chats")
    channel = models.CharField(max_length=8, choices=CHANNEL_CHOICES)
    sender_user_id = models.IntegerField(null=True, blank=True)
    sender_display = models.CharField(max_length=64, blank=True, default="")
    is_spectator = models.BooleanField(default=False)
    is_system = models.BooleanField(default=False)
    kind = models.CharField(max_length=16, blank=True, default="", help_text="Game-specific kind (correct/wrong/system).")
    text = models.TextField()
    ts = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["ts"]

    def __str__(self):
        prefix = "[시스템] " if self.is_system else ""
        return f"{self.channel}: {prefix}{self.sender_display}: {self.text[:40]}"


class GameLog(models.Model):
    """A single game played inside a room. Holds final ranked payload."""
    room_log = models.ForeignKey(RoomLog, on_delete=models.CASCADE, related_name="games")
    game_type = models.CharField(max_length=16, help_text="duchmind / quiz / twenty")
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ranked_json = models.JSONField(default=list, help_text="finalize_game() output: list of {player, score, points_awarded}.")

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.game_type} @ {self.started_at:%Y-%m-%d %H:%M}"


class TurnLog(models.Model):
    """Per-turn detail for games that have turns (duchmind/twenty). Quiz
    rounds use the same shape — drawer_display is empty, word holds the
    quiz prompt summary."""
    game_log = models.ForeignKey(GameLog, on_delete=models.CASCADE, related_name="turns")
    turn_index = models.IntegerField()
    round_no = models.IntegerField()
    drawer_user_id = models.IntegerField(null=True, blank=True)
    drawer_display = models.CharField(max_length=64, blank=True, default="")
    word = models.CharField(max_length=200, blank=True, default="")
    word_card_id = models.CharField(max_length=64, blank=True, default="")
    correct_guessers_json = models.JSONField(default=list, help_text="List of {user_id?, display, score, order}.")
    given_up_json = models.JSONField(default=list, help_text="List of {user_id?, display}.")
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["game_log_id", "turn_index"]

    def __str__(self):
        return f"R{self.round_no}T{self.turn_index} {self.drawer_display} → {self.word}"
