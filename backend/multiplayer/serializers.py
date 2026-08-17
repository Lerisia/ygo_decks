from rest_framework import serializers
from .models import Room, RoomPlayer
from avatar.serializers import CardIconSerializer, BorderSerializer
from avatar.views import _resolve_default_icon, _resolve_default_border


def anonymized_display_name(player) -> str:
    """In an anonymous room, every player shows up as '플레이어N' where N is
    their join order (1-based) among non-hidden players in the room."""
    room = player.room
    # Stable order = joined_at; tie-break by id so two players joining in the
    # same instant still get a deterministic ordering.
    ordered_ids = list(
        room.players.filter(is_hidden=False)
        .order_by("joined_at", "id")
        .values_list("id", flat=True)
    )
    try:
        idx = ordered_ids.index(player.id) + 1
    except ValueError:
        idx = 0
    return f"플레이어{idx}"


class RoomPlayerSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    is_guest = serializers.BooleanField(read_only=True)
    avatar_icon = serializers.SerializerMethodField()
    border = serializers.SerializerMethodField()

    class Meta:
        model = RoomPlayer
        fields = [
            "id", "display_name", "is_guest", "score", "is_host",
            "is_spectator", "reserved_for_next", "joined_at", "avatar_icon", "border",
        ]

    def get_display_name(self, obj):
        if obj.room.is_anonymous and not obj.is_hidden:
            return anonymized_display_name(obj)
        return obj.display_name

    def get_avatar_icon(self, obj):
        if obj.user is None and obj.guest_icon is not None:
            icon = obj.guest_icon
        else:
            user = obj.user
            icon = getattr(user, "avatar_icon", None) if user else None
            if icon is None:
                icon = _resolve_default_icon()
        return CardIconSerializer(icon).data if icon else None

    def get_border(self, obj):
        user = obj.user
        border = getattr(user, "equipped_border", None) if user else None
        if border is None:
            border = _resolve_default_border()
        return BorderSerializer(border).data if border else None


class RoomListItemSerializer(serializers.ModelSerializer):
    """Compact representation for room list view. Includes the room rules
    so the lobby can offer a collapsible '방 규칙' expander without a
    second fetch — the fields are all booleans/ints, payload stays tiny."""

    has_password = serializers.BooleanField(read_only=True)
    player_count = serializers.SerializerMethodField()
    host_name = serializers.SerializerMethodField()
    duchmind_word_pack_name = serializers.SerializerMethodField()
    duchmind_word_pack_series = serializers.SerializerMethodField()
    quiz_word_pack_name = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id", "name", "host_name",
            "has_password", "max_players", "player_count",
            "allow_guests", "status", "current_game",
            "created_at",
            # Rule fields surfaced to all viewers (read-only)
            "is_anonymous", "spectators_can_chat",
            "quiz_total_rounds", "quiz_word_pack_name",
            "duchmind_total_rounds", "duchmind_word_pack_name", "duchmind_word_pack_series",
            "duchmind_draw_seconds", "duchmind_word_options",
            "duchmind_show_word_length", "duchmind_show_hints", "duchmind_hide_winner_chat",
            "twenty_total_rounds", "twenty_mode", "twenty_guess_attempts",
        ]

    def get_player_count(self, obj):
        return obj.player_count()

    def get_duchmind_word_pack_name(self, obj):
        return obj.duchmind_word_pack.name if obj.duchmind_word_pack_id else None

    def get_duchmind_word_pack_series(self, obj):
        if obj.duchmind_word_pack_id:
            return getattr(obj.duchmind_word_pack, "series", "yugioh")
        return "yugioh"

    def get_quiz_word_pack_name(self, obj):
        return obj.quiz_word_pack.name if obj.quiz_word_pack_id else None

    def get_host_name(self, obj):
        if obj.is_anonymous:
            host_player = obj.players.filter(user_id=obj.host_id, is_hidden=False).first()
            return anonymized_display_name(host_player) if host_player else "(익명)"
        return getattr(obj.host, "nickname", None) or obj.host.username


class RoomDetailSerializer(serializers.ModelSerializer):
    has_password = serializers.BooleanField(read_only=True)
    players = serializers.SerializerMethodField()
    host_name = serializers.SerializerMethodField()

    def get_players(self, obj):
        # Hide stealth admins from the public player list. They never appear
        # in the player UI / counts; only the broadcaster (channels group)
        # knows they exist.
        qs = obj.players.exclude(is_hidden=True)
        return RoomPlayerSerializer(qs, many=True).data

    duchmind_word_pack_name = serializers.SerializerMethodField()
    duchmind_word_pack_series = serializers.SerializerMethodField()
    quiz_word_pack_name = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id", "code", "name", "host", "host_name",
            "has_password", "max_players", "allow_guests", "is_listed",
            "status", "current_game", "game_state", "quiz_total_rounds",
            "quiz_word_pack", "quiz_word_pack_name",
            "duchmind_total_rounds", "duchmind_word_pack", "duchmind_word_pack_name", "duchmind_word_pack_series", "twenty_total_rounds",
            "duchmind_draw_seconds", "duchmind_word_options",
            "duchmind_show_word_length", "duchmind_show_hints", "duchmind_hide_winner_chat",
            "duchmind_first_correct_speedup",
            "spectators_can_chat", "is_anonymous",
            "twenty_mode", "twenty_guess_attempts",
            "players", "created_at", "last_activity_at",
        ]

    def get_duchmind_word_pack_name(self, obj):
        return obj.duchmind_word_pack.name if obj.duchmind_word_pack_id else None

    def get_duchmind_word_pack_series(self, obj):
        if obj.duchmind_word_pack_id:
            return getattr(obj.duchmind_word_pack, "series", "yugioh")
        return "yugioh"

    def get_quiz_word_pack_name(self, obj):
        return obj.quiz_word_pack.name if obj.quiz_word_pack_id else None

    def get_host_name(self, obj):
        if obj.is_anonymous:
            host_player = obj.players.filter(user_id=obj.host_id, is_hidden=False).first()
            return anonymized_display_name(host_player) if host_player else "(익명)"
        return getattr(obj.host, "nickname", None) or obj.host.username


class RoomCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(required=False, allow_blank=True, max_length=128)

    class Meta:
        model = Room
        fields = ["name", "password", "max_players", "is_listed", "current_game", "allow_guests", "spectators_can_chat", "duchmind_draw_seconds", "duchmind_word_options", "duchmind_show_word_length", "duchmind_show_hints", "duchmind_hide_winner_chat", "duchmind_first_correct_speedup", "duchmind_total_rounds", "duchmind_word_pack", "quiz_total_rounds", "quiz_word_pack", "twenty_total_rounds", "is_anonymous", "twenty_mode", "twenty_guess_attempts"]

    def validate_max_players(self, value):
        if not (2 <= value <= 12):
            raise serializers.ValidationError("플레이어 수는 2~12명 사이여야 합니다.")
        return value

    def validate_name(self, value):
        v = value.strip()
        if not v:
            raise serializers.ValidationError("방 이름을 입력하세요.")
        return v


class RoomUpdateSerializer(serializers.ModelSerializer):
    """Patch room settings while in lobby. All fields optional.
    `password`: omit to keep, "" to clear, non-empty to set.
    """
    password = serializers.CharField(required=False, allow_blank=True, max_length=128)

    class Meta:
        model = Room
        fields = ["name", "password", "max_players", "is_listed", "current_game", "quiz_total_rounds", "quiz_word_pack", "duchmind_total_rounds", "duchmind_word_pack", "twenty_total_rounds", "twenty_mode", "twenty_guess_attempts", "spectators_can_chat", "allow_guests", "duchmind_draw_seconds", "duchmind_word_options", "duchmind_show_word_length", "duchmind_show_hints", "duchmind_hide_winner_chat", "duchmind_first_correct_speedup"]
        extra_kwargs = {
            "name": {"required": False},
            "max_players": {"required": False},
            "is_listed": {"required": False},
            "current_game": {"required": False},
            "quiz_total_rounds": {"required": False},
            "quiz_word_pack": {"required": False, "allow_null": True},
            "duchmind_total_rounds": {"required": False},
            "duchmind_word_pack": {"required": False, "allow_null": True},
            "twenty_total_rounds": {"required": False},
            "spectators_can_chat": {"required": False},
            "allow_guests": {"required": False},
            "duchmind_draw_seconds": {"required": False},
            "duchmind_word_options": {"required": False},
            "duchmind_show_word_length": {"required": False},
            "duchmind_show_hints": {"required": False},
            "duchmind_hide_winner_chat": {"required": False},
            "duchmind_first_correct_speedup": {"required": False},
            "twenty_mode": {"required": False},
            "twenty_guess_attempts": {"required": False},
        }

    def validate_max_players(self, value):
        if not (2 <= value <= 12):
            raise serializers.ValidationError("플레이어 수는 2~12명 사이여야 합니다.")
        return value

    def validate_name(self, value):
        v = value.strip()
        if not v:
            raise serializers.ValidationError("방 이름을 입력하세요.")
        return v

    def validate_quiz_total_rounds(self, value):
        if value not in (5, 10, 15, 20):
            raise serializers.ValidationError("문제 수는 5, 10, 15, 20 중 하나여야 합니다.")
        return value

    def validate_duchmind_total_rounds(self, value):
        if value not in (5, 10, 15, 20):
            raise serializers.ValidationError("듀치마인드 라운드 수는 5/10/15/20 중 하나여야 합니다.")
        return value

    def validate_twenty_total_rounds(self, value):
        if value not in (3, 5, 7, 10):
            raise serializers.ValidationError("딱무고개 라운드 수는 3/5/7/10 중 하나여야 합니다.")
        return value

    def validate_duchmind_draw_seconds(self, value):
        if value not in (60, 80, 100, 120):
            raise serializers.ValidationError("그리는 시간은 60/80/100/120초 중 하나여야 합니다.")
        return value

    def validate_duchmind_word_options(self, value):
        if value not in (3, 4, 5):
            raise serializers.ValidationError("선택지 개수는 3/4/5 중 하나여야 합니다.")
        return value
