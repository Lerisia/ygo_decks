from rest_framework import serializers

from avatar.serializers import BorderSerializer, CardIconSerializer
from avatar.views import _resolve_default_border, _resolve_default_icon
from .models import Entrant, Match, Round, Tournament


def user_avatar(user):
    icon = getattr(user, "avatar_icon", None) if user else None
    if icon is None:
        icon = _resolve_default_icon()
    border = getattr(user, "equipped_border", None) if user else None
    if border is None:
        border = _resolve_default_border()
    return (
        CardIconSerializer(icon).data if icon else None,
        BorderSerializer(border).data if border else None,
    )


class EntrantSerializer(serializers.ModelSerializer):
    avatar_icon = serializers.SerializerMethodField()
    border = serializers.SerializerMethodField()

    class Meta:
        model = Entrant
        fields = ["id", "user", "name", "status", "seed", "avatar_icon", "border"]

    def get_avatar_icon(self, obj):
        return user_avatar(obj.user)[0]

    def get_border(self, obj):
        return user_avatar(obj.user)[1]


class MatchSerializer(serializers.ModelSerializer):
    entrant1 = EntrantSerializer(read_only=True)
    entrant2 = EntrantSerializer(read_only=True)

    class Meta:
        model = Match
        fields = ["id", "bracket_pos", "entrant1", "entrant2", "score1", "score2",
                  "result", "report_status", "reported_by"]


class RoundSerializer(serializers.ModelSerializer):
    matches = MatchSerializer(many=True, read_only=True)

    class Meta:
        model = Round
        fields = ["number", "status", "matches"]


class TournamentListSerializer(serializers.ModelSerializer):
    host_name = serializers.CharField(source="host.username", read_only=True)
    entrant_count = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = ["id", "name", "format", "status", "capacity", "event_date",
                  "current_round", "host_name", "entrant_count", "cover_image", "created_at"]

    def get_entrant_count(self, obj):
        return obj.entrants.exclude(status__in=["withdrawn", "kicked"]).count()


class TournamentDetailSerializer(TournamentListSerializer):
    entrants = serializers.SerializerMethodField()
    rounds = RoundSerializer(many=True, read_only=True)
    host_avatar_icon = serializers.SerializerMethodField()
    host_border = serializers.SerializerMethodField()

    class Meta(TournamentListSerializer.Meta):
        fields = TournamentListSerializer.Meta.fields + [
            "description", "format_config", "entrants", "rounds", "host", "host_avatar_icon", "host_border",
        ]

    def get_entrants(self, obj):
        qs = obj.entrants.exclude(status="kicked").select_related("user__avatar_icon", "user__equipped_border").order_by("created_at")
        return EntrantSerializer(qs, many=True).data

    def get_host_avatar_icon(self, obj):
        return user_avatar(obj.host)[0]

    def get_host_border(self, obj):
        return user_avatar(obj.host)[1]
