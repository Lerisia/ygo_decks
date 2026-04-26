from rest_framework import serializers
from .models import Room, RoomPlayer


class RoomPlayerSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    is_guest = serializers.BooleanField(read_only=True)

    class Meta:
        model = RoomPlayer
        fields = ["id", "display_name", "is_guest", "score", "is_host", "joined_at"]


class RoomListItemSerializer(serializers.ModelSerializer):
    """Compact representation for room list view."""

    has_password = serializers.BooleanField(read_only=True)
    player_count = serializers.SerializerMethodField()
    host_name = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id", "code", "name", "host_name",
            "has_password", "max_players", "player_count",
            "allow_guests", "status", "current_game",
            "created_at",
        ]

    def get_player_count(self, obj):
        return obj.player_count()

    def get_host_name(self, obj):
        return getattr(obj.host, "nickname", None) or obj.host.username


class RoomDetailSerializer(serializers.ModelSerializer):
    has_password = serializers.BooleanField(read_only=True)
    players = RoomPlayerSerializer(many=True, read_only=True)
    host_name = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "id", "code", "name", "host", "host_name",
            "has_password", "max_players", "allow_guests", "is_listed",
            "status", "current_game", "game_state",
            "players", "created_at", "last_activity_at",
        ]

    def get_host_name(self, obj):
        return getattr(obj.host, "nickname", None) or obj.host.username


class RoomCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(required=False, allow_blank=True, max_length=128)

    class Meta:
        model = Room
        fields = ["name", "password", "max_players", "allow_guests", "is_listed", "current_game"]

    def validate_max_players(self, value):
        if not (2 <= value <= 16):
            raise serializers.ValidationError("플레이어 수는 2~16명 사이여야 합니다.")
        return value

    def validate_name(self, value):
        v = value.strip()
        if not v:
            raise serializers.ValidationError("방 이름을 입력하세요.")
        return v
